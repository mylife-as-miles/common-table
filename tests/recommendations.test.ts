import assert from 'node:assert/strict';
import { test,after } from 'node:test';
import { handleRecommendations, type RecommendationRequestOptions } from '../server/recommendations/handler.ts';
import { retrieveOsmCandidates, retrieveRecommendations, resolveVenue, validateRecommendationInput } from '../server/recommendations/client.ts';
import { initializeBudget, readBudget, reserveGuidance } from '../server/guidance/budget.ts';
import { GUIDANCE_MODEL, MAX_OUTPUT_TOKENS } from '../server/guidance/client.ts';
import { createSharedD1 } from './helpers/shared-d1.ts';
import { createInitialState, reducer, hydrateState, serializeState, planValidationErrors } from '../src/domain/state.ts';
import { getVenue, getVenueCatalog, sanitizeVenueSnapshot, venuePriceLabel } from '../src/domain/catalog.ts';
import { rankVenues } from '../src/domain/ranking.ts';
const realFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Live network is forbidden in recommendation tests.');};after(()=>{globalThis.fetch=realFetch;});
const KEY='dummy-model-secret-never-live';
const LIMIT_KEY='public-ai-test-secret-'.repeat(3);
const OWNER={userId:'private-owner-id',displayName:'PRIVATE_OWNER_NAME',email:'owner@example.test'};
const ORIGIN='https://app.example';
let sequence=0;
type Call={url:URL;init:RequestInit;body?:Record<string,unknown>};
const request=(value:unknown,headers:Record<string,string>={})=>new Request(`${ORIGIN}/api/recommendations`,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json','X-Common-Table-Request':'recommendations',...headers},body:JSON.stringify(value)});
function mapRecords(lat:number,lon:number,base:number){return [
  {type:'node',id:base+1,lat,lon,tags:{name:'Mapped Italian Restaurant',amenity:'restaurant',cuisine:'italian',website:'https://restaurant.example/menu','diet:vegetarian':'yes',opening_hours:'24/7',stars:'5'}},
  {type:'way',id:base+2,center:{lat:lat+.0005,lon:lon+.0005},tags:{name:'Mapped Japanese Cafe',amenity:'cafe',cuisine:'japanese;coffee_shop'}},
  {type:'relation',id:base+3,center:{lat:lat-.0005,lon:lon-.0005},tags:{name:'Mapped Mexican Restaurant',amenity:'restaurant',cuisine:'mexican'}},
];}
function photonRecords(elements:ReturnType<typeof mapRecords>){return {type:'FeatureCollection',features:elements.map(e=>({type:'Feature',geometry:{type:'Point',coordinates:e.type==='node'?[e.lon,e.lat]:[e.center!.lon,e.center!.lat]},properties:{osm_type:({node:'N',way:'W',relation:'R'} as Record<string,string>)[e.type],osm_id:e.id,osm_key:'amenity',osm_value:e.tags.amenity,name:e.tags.name,extra:{cuisine:e.tags.cuisine,website:e.tags.website}}}))};}
function modelReply(value:unknown){return Response.json({type:'message',role:'assistant',model:GUIDANCE_MODEL,content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}],usage:{input_tokens:800,output_tokens:100}});}
async function fixture(t:{after:(fn:()=>void)=>void},override?:(call:Call)=>Response|Promise<Response>|undefined,initialized=true){
  const db=createSharedD1();t.after(db.close);if(initialized)await initializeBudget(db.db);
  const index=++sequence,latitude=Number((40+index*.01).toFixed(3)),longitude=-73.9,base=1_000_000+index*100;
  const input={latitude,longitude,participants:[{tastes:['Italian','Japanese'],budget:42,restrictions:['Vegetarian']}],vetoes:[] as string[],seedVenueIds:[] as string[]};
  const elements=mapRecords(latitude,longitude,base);const calls:Call[]=[];
  const fetcher:typeof fetch=async(raw,init={})=>{
    const url=new URL(raw instanceof Request?raw.url:String(raw)),call={url,init,...(typeof init.body==='string'?{body:JSON.parse(init.body)}:{})};calls.push(call);
    const replaced=override?.(call);if(replaced!==undefined)return replaced;
    if(url.origin==='https://photon.komoot.io'){assert.equal(url.pathname,'/reverse');return Response.json(photonRecords(elements));}
    if(url.origin==='https://overpass-api.de'){assert.equal(url.pathname,'/api/interpreter');return Response.json({elements});}
    assert.equal(url.origin,'https://api.anthropic.com');
    if(url.pathname==='/v1/organizations/me')return Response.json({type:'organization',id:'org_startrz_test',name:'Startrz'});
    if(url.pathname===`/v1/models/${GUIDANCE_MODEL}`)return Response.json({id:GUIDANCE_MODEL});
    if(url.pathname==='/v1/messages'){
      const system=String(call.body?.system),records=JSON.parse(system.split('Trusted candidate records: ')[1]);
      const chosen=[...records].reverse().slice(0,8);
      return modelReply({orderedIds:chosen.map(v=>v.id)});
    }
    throw new Error('Unexpected mocked endpoint');
  };
  const options:RecommendationRequestOptions={apiKey:KEY,publicAiLimitKey:LIMIT_KEY,db:db.db,identity:OWNER,ownerEmail:OWNER.email,fetcher,now:()=>new Date('2026-11-02T12:00:00Z')};
  return {...db,input,elements,calls,fetcher,options,base};
}

test('real map records supply dining facts and the model alone orders the exact trusted IDs',async t=>{
  const f=await fixture(t);f.input.latitude+=.00042;f.input.vetoes=[`osm:relation:${f.base+3}`];
  const response=await handleRecommendations(request(f.input),f.options);assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.source,'osm');assert.deepEqual(result.orderedIds,[`osm:way:${f.base+2}`,`osm:node:${f.base+1}`]);assert.deepEqual(result.venues.map(v=>v.id),result.orderedIds);
  const mapCall=f.calls.find(c=>c.url.origin==='https://photon.komoot.io')!;
  assert.equal(mapCall.url.searchParams.get('lat'),String(f.elements[0].lat));assert.equal(mapCall.url.searchParams.get('lon'),'-73.9');assert.equal(mapCall.url.searchParams.get('radius'),'1.8');assert.equal(mapCall.url.searchParams.get('limit'),'40');assert.deepEqual(mapCall.url.searchParams.getAll('osm_tag'),['amenity:restaurant','amenity:cafe']);
  assert.equal(mapCall.init.redirect,'manual');assert.equal(new Headers(mapCall.init.headers).has('Authorization'),false);assert.equal(new Headers(mapCall.init.headers).has('X-Api-Key'),false);
  for(const venue of result.venues){assert.equal(venue.source,'osm');assert.equal(venue.price,0);assert.equal(venue.priceKnown,false);assert.equal(venue.ratingKnown,false);assert.equal(venue.walkKnown,false);assert.deepEqual(venue.menu,[]);assert.deepEqual(venue.dietary,[]);assert.equal(venue.image,'/venue-placeholder.svg');assert.doesNotMatch(venuePriceLabel(venue),/\$0/);}
  assert.equal(result.venues[1].latitude,f.elements[0].lat);assert.equal(result.venues[0].latitude,f.elements[1].center!.lat);
  const paid=f.calls.find(c=>c.url.pathname==='/v1/messages')!;assert.doesNotMatch(String(paid.body?.system),new RegExp(`osm:relation:${f.base+3}`));
  assert.deepEqual(f.calls.filter(c=>c.url.origin==='https://api.anthropic.com').map(c=>c.url.pathname),['/v1/organizations/me',`/v1/models/${GUIDANCE_MODEL}`,'/v1/messages']);
  assert.equal(paid.body?.max_tokens,MAX_OUTPUT_TOKENS);assert.ok(!('tools' in paid.body!));assert.equal((await readBudget(f.db)).reservedCents,5);
});

test('configured anonymous visitors and nonowner accounts can rank real candidates without disclosing identity',async t=>{
  for(const identity of [null,{userId:'private-guest-id',displayName:'PRIVATE_GUEST_NAME',email:'private-guest@example.test'}]){
    const f=await fixture(t);
    const response=await handleRecommendations(request(f.input),{...f.options,identity,ownerEmail:undefined});assert.equal(response.status,200);assert.equal((await response.json()).source,'osm');
    const paid=JSON.stringify(f.calls.find(c=>c.url.pathname==='/v1/messages')!.body);assert.doesNotMatch(paid,/PRIVATE_|private-guest|private-owner|owner@example|public-ai-test-secret/);
    if(identity===null){const cookie=response.headers.get('set-cookie')!;assert.match(cookie,/__Host-ct-ai=/);assert.match(cookie,/HttpOnly/i);assert.match(cookie,/Secure/i);assert.match(cookie,/SameSite=Lax/i);}
    assert.equal((await readBudget(f.db)).reservedCents,5);
  }
});

test('missing public limiter configuration and an uninitialized allowance fail closed before quotas, facts or generation',async t=>{
  const disabled=await fixture(t,undefined,false);assert.equal((await handleRecommendations(request(disabled.input),disabled.options)).status,503);assert.equal(disabled.calls.length,0);
  for(const changes of [{apiKey:undefined},{db:null},{publicAiLimitKey:undefined},{publicAiLimitKey:''},{publicAiLimitKey:'  '}]){
    const f=await fixture(t);assert.equal((await handleRecommendations(request(f.input),{...f.options,...changes})).status,503);assert.equal(f.calls.length,0);assert.equal((await readBudget(f.db)).reservedCents,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM service_quotas').get()!.n,0);
  }
});

test('empty map candidates and all-vetoed candidates do not generate or reserve new credit',async t=>{
  const empty=await fixture(t,call=>call.url.origin==='https://photon.komoot.io'?Response.json({type:'FeatureCollection',features:[]}):undefined);
  const a=await handleRecommendations(request(empty.input),empty.options);assert.equal(a.status,200);assert.deepEqual((await a.json()).orderedIds,[]);assert.equal(empty.calls.length,1);assert.equal((await readBudget(empty.db)).attempts,0);
  const veto=await fixture(t);veto.input.vetoes=veto.elements.map(e=>`osm:${e.type}:${e.id}`);
  const b=await handleRecommendations(request(veto.input),veto.options);assert.deepEqual((await b.json()).orderedIds,[]);assert.equal(veto.calls.length,1);assert.equal((await readBudget(veto.db)).attempts,0);
});

test('unknown IDs, duplicates, extra facts and unsupported rationale claims fail closed after exactly one paid attempt',async t=>{
  const invalids=[
    ()=>({orderedIds:['osm:node:999999999']}),
    (id:string)=>({orderedIds:[id,id]}),
    (id:string)=>({orderedIds:[id],rationales:['Costs $20 and is allergy safe.']}),
    (id:string)=>({orderedIds:[id],rationales:['A pasta menu is available.']}),
    (id:string)=>({orderedIds:[id],rationales:['Your booking is confirmed.']}),
    (id:string)=>({orderedIds:[id],rationales:['A different option to explore.'],venues:[{name:'Invented place',latitude:99}]}),
    ()=>'{not JSON}',
  ];
  for(const build of invalids){
    let chosen='';const f=await fixture(t,call=>call.url.pathname==='/v1/messages'?modelReply(build(chosen)):undefined);chosen=`osm:node:${f.base+1}`;
    const response=await handleRecommendations(request(f.input),f.options);assert.equal(response.status,502);assert.equal((await readBudget(f.db)).reservedCents,5);assert.equal(f.calls.filter(c=>c.url.pathname==='/v1/messages').length,1);assert.doesNotMatch(await response.text(),/999999999|\$20|Invented|PRIVATE|dummy-model/);
  }
});

test('Photon rejects mixed malformed, nondining, unnamed, duplicate and out-of-area records without guessing cuisine or websites',async t=>{
  let features:unknown[]=[];
  const f=await fixture(t,call=>call.url.origin==='https://photon.komoot.io'?Response.json({type:'FeatureCollection',features}):undefined);
  const point=[f.input.longitude+.0001234,f.input.latitude+.0001234];
  const valid={type:'Feature',geometry:{type:'Point',coordinates:point},properties:{osm_type:'N',osm_id:f.base+1,osm_key:'amenity',osm_value:'restaurant',name:'Italian in name is not cuisine evidence',extra:{website:'https://127.0.0.1/private'}}};
  features=[valid,valid,{...valid,properties:{...valid.properties,osm_id:'malformed'}},{...valid,properties:{...valid.properties,osm_type:'X'}},{...valid,properties:{...valid.properties,osm_id:f.base+2,osm_value:'pharmacy'}},{...valid,properties:{...valid.properties,osm_id:f.base+3,name:''}},{...valid,geometry:{type:'Point',coordinates:[10,99]},properties:{...valid.properties,osm_id:f.base+4}},{...valid,geometry:{type:'Point',coordinates:[10,10]},properties:{...valid.properties,osm_id:f.base+5}}];
  const response=await handleRecommendations(request(f.input),f.options);assert.equal(response.status,200);const result=await response.json();assert.equal(result.venues.length,1);
  const venue=result.venues[0];assert.equal(venue.id,`osm:node:${f.base+1}`);assert.equal(venue.cuisine,'Restaurant');assert.equal(venue.websiteUrl,undefined);assert.equal(venue.latitude,point[1]);assert.equal(venue.longitude,point[0]);assert.deepEqual(venue.dietary,[]);assert.deepEqual(venue.menu,[]);
  const candidateText=String(f.calls.find(c=>c.url.pathname==='/v1/messages')!.body?.system);for(const invalidId of [f.base+2,f.base+3,f.base+4,f.base+5])assert.ok(!candidateText.includes(`osm:node:${invalidId}`));
});

test('malformed map responses and source errors are sanitized, not retried and never charged',async t=>{
  for(const payload of [{type:'FeatureCollection',features:'oops'},{type:'FeatureCollection',features:Array(41).fill({})},{type:'FeatureCollection',features:[{PRIVATE:'invalid'}]}]){
    const f=await fixture(t,call=>call.url.origin==='https://photon.komoot.io'?Response.json(payload):undefined);const response=await handleRecommendations(request(f.input),f.options);assert.equal(response.status,502);assert.equal(f.calls.length,1);assert.equal((await readBudget(f.db)).attempts,0);assert.doesNotMatch(await response.text(),/PRIVATE/);
  }
});

test('same coarse map cell uses bounded cached facts while each explicit ranking uses the same shared allowance',async t=>{
  const f=await fixture(t);await reserveGuidance(f.db);
  await handleRecommendations(request({...f.input,latitude:f.input.latitude+.0001}),f.options);
  await handleRecommendations(request({...f.input,latitude:f.input.latitude+.0002}),f.options);
  assert.equal(f.calls.filter(c=>c.url.origin==='https://photon.komoot.io').length,1);assert.equal(f.calls.filter(c=>c.url.pathname==='/v1/messages').length,2);assert.equal((await readBudget(f.db)).reservedCents,15);
});

test('model context includes aggregate group preferences but omits identity, coordinates, websites and client extra fields',async t=>{
  const f=await fixture(t);
  const input={...f.input,participants:[{...f.input.participants[0],name:'PRIVATE_FRIEND_NAME'},{tastes:['Mexican'],budget:25,restrictions:['Gluten-free'],name:'PRIVATE_SECOND_NAME'}]};
  const response=await handleRecommendations(request(input),f.options);assert.equal(response.status,200);
  const paid=JSON.stringify(f.calls.find(c=>c.url.pathname==='/v1/messages')!.body);assert.match(paid,/minimumBudget\\":25/);assert.match(paid,/Mexican/);assert.match(paid,/Gluten-free/);assert.doesNotMatch(paid,/PRIVATE_|private-owner|owner@example.test|restaurant\.example|around:1800|latitude|longitude/);
});

test('canonical node, way and relation snapshots stay connected to the same plan through sample browsing and refresh',async t=>{
  const f=await fixture(t);const result=await retrieveRecommendations(f.input,f.options);let state=reducer(createInitialState(),{type:'receive-recommendations',venues:result.venues,orderedIds:result.orderedIds,rationales:result.rationales,retrievedAt:result.retrievedAt});
  const venue=result.venues[0];assert.ok(getVenueCatalog(state).some(v=>v.id===venue.id));state=reducer(state,{type:'choose-plan',venueId:venue.id});assert.ok(planValidationErrors(state).some(e=>/confirmation/.test(e)));
  state=reducer(state,{type:'acknowledge-details',acknowledged:true});state=reducer(state,{type:'toggle-approval',participantId:'you'});state=reducer(state,{type:'save-plan'});assert.equal(state.plan.saved,true);const plan=state.plan;
  state=reducer(state,{type:'browse-sample'});assert.equal(state.discoveryMode,'sample');assert.equal(state.plan,plan);assert.ok(rankVenues(state).every(v=>v.venue.source!=='osm'));
  state=hydrateState(serializeState(state));assert.equal(state.plan.venueId,venue.id);assert.equal(state.plan.saved,true);state=reducer(state,{type:'select',venueId:venue.id});assert.deepEqual(rankVenues(state).map(v=>v.venue.id),result.orderedIds);
  state=reducer(state,{type:'receive-recommendations',venues:[],orderedIds:[],rationales:{},retrievedAt:'2026-11-02T12:01:00Z'});assert.equal(state.plan.venueId,venue.id);assert.ok(getVenue(state,venue.id));assert.equal(state.plan.saved,true);
  state=reducer(state,{type:'veto',venueId:venue.id});assert.equal(state.plan.venueId,null);assert.equal(sanitizeVenueSnapshot({...venue,latitude:99}),undefined);
});

test('trusted resolver accepts canonical map element IDs only and never follows browser links',async()=>{
  let calls=0;const fetcher:typeof fetch=async(url,init)=>{calls++;const u=new URL(String(url));assert.equal(u.origin,'https://api.openstreetmap.org');assert.equal(init?.redirect,'manual');assert.equal(u.pathname,'/api/0.6/way/88776655/full.json');assert.equal(u.search,'');return Response.json({elements:[{type:'way',id:88776655,center:{lat:40.7,lon:-73.9},tags:{name:'Verified Map Cafe',amenity:'cafe',website:'http://127.0.0.1/private'}}]});};
  for(const id of ['https://127.0.0.1/internal','osm:node:0','osm:way:-1','osm:node:9223372036854775808','osm:node:1);out;','made-up-id'])assert.equal(await resolveVenue(id,{fetcher}),undefined);assert.equal(calls,0);
  const venue=await resolveVenue('osm:way:88776655',{fetcher});assert.equal(venue?.name,'Verified Map Cafe');assert.equal(venue?.websiteUrl,undefined);assert.equal(calls,1);
});

test('Worker default map fetch is late-bound with its required receiver and only manual redirects',async()=>{
  const previous=globalThis.fetch;let calls=0;globalThis.fetch=function(this:typeof globalThis,_url,init){assert.equal(this,globalThis);assert.equal(init?.redirect,'manual');calls++;return Promise.resolve(Response.json({type:'FeatureCollection',features:[]}));};
  try{assert.deepEqual(await retrieveOsmCandidates({latitude:55.555,longitude:44.444}),[]);assert.equal(calls,1);}finally{globalThis.fetch=previous;}
});

test('Worker map redirects are rejected and bodies cancelled without retries or credential forwarding',async()=>{
  for(const redirected of [false,true]){let cancelled=false,calls=0;const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:redirected?200:302,headers:{Location:'https://untrusted.example/steal'}});if(redirected)Object.defineProperty(response,'redirected',{value:true});
    await assert.rejects(retrieveOsmCandidates({latitude:56+(redirected?1:0),longitude:44},{fetcher:async()=>{calls++;return response;}}));assert.equal(calls,1);assert.equal(cancelled,true);
  }
});

test('map fetch and streamed-body deadlines work even when transport ignores AbortSignal',async()=>{
  for(const body of [false,true]){let cancelled=false,calls=0;const fetcher:typeof fetch=async()=>{calls++;return body?new Response(new ReadableStream({pull(){return new Promise<void>(()=>{});},cancel(){cancelled=true;}})):new Promise<Response>(()=>{});};
    await assert.rejects(retrieveOsmCandidates({latitude:58+(body?1:0),longitude:44},{fetcher,timeoutMs:10}),e=>Boolean(e&&typeof e==='object'&&'code' in e&&e.code==='timeout'));assert.ok(calls>=1&&calls<=2);if(body)assert.equal(cancelled,true);
  }
});

test('caller cancellation cancels a stalled map stream without a retry',async()=>{
  const controller=new AbortController();let cancelled=false;
  const fetcher:typeof fetch=async()=>new Response(new ReadableStream({pull(){controller.abort();return new Promise<void>(()=>{});},cancel(){cancelled=true;}}));
  await assert.rejects(retrieveOsmCandidates({latitude:60,longitude:44},{fetcher,signal:controller.signal,timeoutMs:100}),e=>Boolean(e&&typeof e==='object'&&'code' in e&&e.code==='cancelled'));assert.equal(cancelled,true);
});

test('CSRF, malformed coordinates, oversized streamed input and invalid profiles make no map or model request',async t=>{
  const f=await fixture(t);
  for(const req of [request(f.input,{Origin:'https://other.example'}),request(f.input,{'X-Common-Table-Request':'wrong'}),request({...f.input,latitude:91}),request({...f.input,latitude:'40);out;'}),request({...f.input,participants:[{tastes:Array(31).fill('Italian'),budget:42,restrictions:[]}]})])assert.ok((await handleRecommendations(req,f.options)).status>=400);
  let cancelled=false;const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(25_000));},cancel(){cancelled=true;}});
  const streamed=new Request(`${ORIGIN}/api/recommendations`,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json','X-Common-Table-Request':'recommendations'},body:stream,duplex:'half'} as RequestInit);assert.equal((await handleRecommendations(streamed,f.options)).status,413);assert.equal(cancelled,true);assert.equal(f.calls.length,0);
  assert.throws(()=>validateRecommendationInput({...f.input,longitude:Infinity}));
});

test('the model may explicitly return no suitable trusted candidate without inventing a fallback',async t=>{
  const f=await fixture(t,call=>call.url.pathname==='/v1/messages'?modelReply({orderedIds:[]}):undefined);
  const response=await handleRecommendations(request(f.input),f.options);assert.equal(response.status,200);const result=await response.json();assert.deepEqual(result.venues,[]);assert.deepEqual(result.orderedIds,[]);assert.equal((await readBudget(f.db)).reservedCents,5);
});

test('a caller-aborted stalled request body returns before any source lookup or paid operation',async t=>{
  const f=await fixture(t),controller=new AbortController();let cancelled=false;
  const stream=new ReadableStream({pull(){return new Promise<void>(()=>{});},cancel(){cancelled=true;}});
  const req=new Request(`${ORIGIN}/api/recommendations`,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json','X-Common-Table-Request':'recommendations'},body:stream,signal:controller.signal,duplex:'half'} as RequestInit);
  const result=handleRecommendations(req,f.options);controller.abort();assert.equal((await result).status,499);assert.equal(cancelled,true);assert.equal(f.calls.length,0);assert.equal((await readBudget(f.db)).attempts,0);
});

test('a transient public source failure can use the documented fixed secondary without retrying paid ranking',async t=>{
  let elements:unknown[]=[];
  const f=await fixture(t,call=>call.url.hostname==='photon.komoot.io'?new Response('busy',{status:503}):call.url.hostname==='overpass-api.de'?Response.json({elements}):undefined);elements=f.elements;
  const response=await handleRecommendations(request(f.input),f.options);assert.equal(response.status,200);assert.equal((await response.json()).orderedIds.length,3);
  assert.deepEqual(f.calls.filter(c=>c.url.hostname!=='api.anthropic.com').map(c=>c.url.hostname),['photon.komoot.io','overpass-api.de']);assert.equal(f.calls.filter(c=>c.url.pathname==='/v1/messages').length,1);assert.equal((await readBudget(f.db)).reservedCents,5);
});

test('authorization failures and malformed source payloads never trigger a secondary request',async()=>{
  let location=62;
  for(const response of [new Response('private',{status:401}),new Response('forbidden',{status:403}),Response.json({elements:'invalid'})]){
    let calls=0;await assert.rejects(retrieveOsmCandidates({latitude:location++,longitude:44},{fetcher:async()=>{calls++;return response;}}));assert.equal(calls,1);
  }
});

test('fallback attempts share one short total deadline even if both free transports ignore cancellation',async()=>{
  const calls:string[]=[];const started=performance.now();
  await assert.rejects(retrieveOsmCandidates({latitude:65,longitude:44},{timeoutMs:30,fetcher:async(raw)=>{calls.push(new URL(String(raw)).hostname);return new Promise<Response>(()=>{});}}));
  // A busy event loop may exhaust the whole deadline during the first attempt.
  // Starting a second request after that point would violate the shared bound.
  assert.ok(calls.length>=1&&calls.length<=2);
  assert.deepEqual(calls,['photon.komoot.io','overpass-api.de'].slice(0,calls.length));
  assert.ok(performance.now()-started<500);
});

test('cold exact-ID reads derive a way center only from complete valid geometry and reject unrelated or incomplete records',async()=>{
  const complete=[{type:'node',id:910001,lat:40.7,lon:-73.9},{type:'node',id:910002,lat:40.702,lon:-73.902},{type:'way',id:910003,nodes:[910001,910002],tags:{name:'Exact Way Restaurant',amenity:'restaurant',cuisine:'italian'}}];
  const venue=await resolveVenue('osm:way:910003',{fetcher:async(raw)=>{assert.equal(String(raw),'https://api.openstreetmap.org/api/0.6/way/910003/full.json');return Response.json({elements:complete});}});
  assert.equal(venue?.latitude,40.701);assert.ok(Math.abs(venue!.longitude!+73.901)<1e-10);assert.equal(venue?.cuisine,'Italian');
  for(const id of [910004,910005]){
    const elements=id===910004?[{...complete[2],id,nodes:[910001,999999]},complete[0]]:[complete[0]];
    assert.equal(await resolveVenue(`osm:way:${id}`,{fetcher:async()=>Response.json({elements})}),undefined);
  }
});

test('compact structured ranking schema contains only trusted IDs and response labels come only from factual source fields',async t=>{
  const f=await fixture(t);await handleRecommendations(request(f.input),f.options);
  const paid=f.calls.find(c=>c.url.pathname==='/v1/messages')!.body!;
  const config=paid.output_config as {format:{type:string;schema:{type:string;properties:{orderedIds:{type:string;items:{type:string;enum:string[]}}};required:string[];additionalProperties:boolean}}};
  assert.equal(config.format.type,'json_schema');assert.equal(config.format.schema.type,'object');assert.deepEqual(config.format.schema.required,['orderedIds']);assert.equal(config.format.schema.additionalProperties,false);
  assert.deepEqual(config.format.schema.properties.orderedIds.items.enum,f.elements.map(e=>`osm:${e.type}:${e.id}`));
  assert.doesNotMatch(JSON.stringify(config.format.schema),/PRIVATE|latitude|longitude|https?:|dummy-model/);assert.ok(!('maxItems' in config.format.schema.properties.orderedIds));
});

test('fenced or truncated ranking output is never repaired, and rejection diagnostics cannot expose the response',async t=>{
  const previous=console.warn,logs:unknown[][]=[];console.warn=(...values)=>{logs.push(values);};
  try{
    for(const text of ['```json\n{"orderedIds":[]}\n```','{"orderedIds":["PRIVATE_TRUNCATED_SECRET','{"orderedIds":["PRIVATE_UNKNOWN_ID"]}']){
      const f=await fixture(t,call=>call.url.pathname==='/v1/messages'?modelReply(text):undefined);
      const response=await handleRecommendations(request(f.input),f.options);assert.equal(response.status,502);assert.equal((await readBudget(f.db)).reservedCents,5);
    }
    assert.equal(logs.length,3);assert.doesNotMatch(JSON.stringify(logs),/PRIVATE_|dummy-model|osm:node|```/);for(const [,details] of logs){assert.equal(typeof (details as {replyBytes:number}).replyBytes,'number');assert.equal(typeof (details as {candidateCount:number}).candidateCount,'number');}
  }finally{console.warn=previous;}
});
