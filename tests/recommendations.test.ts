import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleRecommendations } from '../server/recommendations/handler.ts';
import { retrieveRecommendations, resolveVenue, validateRecommendationInput } from '../server/recommendations/client.ts';
import { createInitialState, reducer, hydrateState, serializeState, planValidationErrors } from '../src/domain/state.ts';
import { getVenue, getVenueCatalog, sanitizeVenueSnapshot, venuePriceLabel, safePublicUrl } from '../src/domain/catalog.ts';
import { eligibilityReasons, rankVenues } from '../src/domain/ranking.ts';
const ID='ab4bb5ae-40d9-4c66-98a0-6b3e421863ab';
const VETO='ab4bb5ae-40d9-4c66-98a0-6b3e421863ac';
const entity=(id=ID)=>({entity_id:id,name:'A real neighborhood restaurant',type:'urn:entity:place',location:{lat:40.7,lon:-73.9},properties:{address:'100 Main Street',geocode:{city:'New York'},price_level:2,business_rating:4.2,website:'https://restaurant.example/dinner',description:'Provider restaurant description.'},tags:[{id:'urn:tag:cuisine:qloo:italian',name:'Italian'}],query:{affinity:0.72}});
const input={latitude:40.7,longitude:-73.9,participants:[{tastes:['Italian'],budget:42,restrictions:['Vegetarian']}],vetoes:[`qloo:${VETO}`],seedVenueIds:[`qloo:${ID}`]};
const options=(fetcher:typeof fetch)=>({apiKey:'mock-server-secret',fetcher,now:()=>new Date('2026-11-02T12:00:00Z')});
const snapshot=()=>sanitizeVenueSnapshot({id:`qloo:${ID}`,providerEntityId:ID,source:'qloo',name:'A real neighborhood restaurant',latitude:40.7,longitude:-73.9,price:35,priceKnown:true,rating:4.2,ratingKnown:true,walkMinutes:5,menu:[{name:'Invented',description:'No',price:12}],dietary:['Vegetarian'],websiteUrl:'https://restaurant.example/dinner'})!;

test('recommendations resolve actual taste tag IDs and use geographic affinity with veto and coarse group price filtering',async()=>{
  const calls:URL[]=[];
  const fetcher:typeof fetch=async(url,init)=>{
    const u=new URL(String(url));calls.push(u);assert.equal(u.origin,'https://api.qloo.com');assert.equal(new Headers(init?.headers).get('X-Api-Key'),'mock-server-secret');assert.equal(init?.redirect,'manual');
    if(u.pathname==='/v2/tags')return Response.json({results:{tags:[{tag_id:`urn:tag:cuisine:qloo:${u.searchParams.get('filter.query')?.toLowerCase()}`,name:u.searchParams.get('filter.query')}]}});
    assert.equal(u.pathname,'/v2/insights/');assert.equal(u.searchParams.get('filter.location'),'POINT(-73.9 40.7)');assert.equal(u.searchParams.get('filter.location.radius'),'8000');assert.equal(u.searchParams.get('filter.price_level.max'),'2');assert.equal(u.searchParams.get('filter.exclude.entities'),VETO);assert.equal(u.searchParams.get('signal.interests.entities'),ID);assert.match(u.searchParams.get('signal.interests.tags')||'',/italian/);assert.equal(u.searchParams.get('sort_by'),'affinity');
    return Response.json({success:true,results:{entities:[entity(),entity(VETO)]}});
  };
  const result=await retrieveRecommendations(validateRecommendationInput(input),options(fetcher));
  assert.equal(calls.length,3);assert.deepEqual(result.orderedIds,[`qloo:${ID}`]);const venue=result.venues[0];
  assert.equal(venue.price,0);assert.equal(venue.priceKnown,false);assert.equal(venue.priceLevel,2);assert.deepEqual(venue.menu,[]);assert.deepEqual(venue.dietary,[]);assert.equal(venue.walkKnown,false);assert.equal(venue.image,'/venue-placeholder.svg');assert.equal(venue.websiteUrl,'https://restaurant.example/dinner');assert.equal(venue.source,'qloo');
  assert.doesNotMatch(venuePriceLabel(venue),/\$0/);
});

test('discovery unavailable without server secret and performs no network calls',async()=>{
  let calls=0;const response=await handleRecommendations(new Request('https://app.example/api/recommendations',{method:'POST',body:JSON.stringify(input)}),{fetcher:async()=>{calls++;throw Error('No');}});
  assert.equal(response.status,503);assert.equal(calls,0);assert.equal((await response.json()).error.code,'unavailable');
});

test('provider errors are sanitized and never automatically retried',async()=>{
  let calls=0;const response=await handleRecommendations(new Request('https://app.example/api/recommendations',{method:'POST',body:JSON.stringify({...input,participants:[{tastes:[],budget:50,restrictions:[]}]})}),options(async()=>{calls++;return new Response('private upstream debug: secret',{status:429});}));
  assert.equal(response.status,429);assert.equal(calls,1);const body=await response.text();assert.doesNotMatch(body,/secret|debug/);
});

test('malformed candidate response fails rather than fabricating candidate details',async()=>{
  const response=await handleRecommendations(new Request('https://app.example/api/recommendations',{method:'POST',body:JSON.stringify({...input,participants:[{tastes:[],budget:50,restrictions:[]}]})}),options(async()=>Response.json({results:{entities:'oops'}})));
  assert.equal(response.status,502);assert.equal((await response.json()).error.code,'invalid_response');
});

test('invalid coordinates and unbounded preferences never reach discovery transport',async()=>{
  let calls=0;const response=await handleRecommendations(new Request('https://app.example/api/recommendations',{method:'POST',body:JSON.stringify({...input,latitude:91})}),options(async()=>{calls++;throw Error('No');}));assert.equal(response.status,400);assert.equal(calls,0);
  assert.throws(()=>validateRecommendationInput({...input,participants:[{tastes:Array(31).fill('a'),budget:50,restrictions:[]}]}));
});

test('trusted details resolver only accepts canonical IDs and never follows client URLs',async()=>{
  let calls=0;const opts=options(async(url)=>{calls++;const u=new URL(String(url));assert.equal(u.origin,'https://api.qloo.com');assert.equal(u.pathname,'/entities');assert.equal(u.searchParams.get('entity_ids'),'cb4bb5ae-40d9-4c66-98a0-6b3e421863ab');return Response.json({results:[entity('cb4bb5ae-40d9-4c66-98a0-6b3e421863ab')]});});
  assert.equal(await resolveVenue('https://127.0.0.1/internal',opts),undefined);assert.equal(await resolveVenue('qloo:not-a-uuid',opts),undefined);assert.equal(calls,0);
  const venue=await resolveVenue('qloo:cb4bb5ae-40d9-4c66-98a0-6b3e421863ab',opts);assert.ok(venue);assert.equal(calls,1);
});

test('untrusted snapshots strip invented menus, exact cost, walk times and dietary claims',()=>{
  const venue=snapshot();assert.equal(venue.priceKnown,false);assert.equal(venue.price,0);assert.equal(venue.walkMinutes,0);assert.deepEqual(venue.menu,[]);assert.deepEqual(venue.dietary,[]);
  assert.equal(sanitizeVenueSnapshot({...venue,id:'qloo:not-a-uuid'}),undefined);assert.equal(sanitizeVenueSnapshot({...venue,latitude:999}),undefined);
  for(const url of ['http://restaurant.example','https://127.0.0.1/private','https://user:password@restaurant.example','https://localhost','https://thing.local/path','javascript:alert(1)','https://[::1]/'])assert.equal(safePublicUrl(url),undefined);
});

test('real candidate joins the same chosen plan and survives refresh, hydration and repeated actions',()=>{
  const venue=snapshot();let state=reducer(createInitialState(),{type:'receive-recommendations',venues:[venue],orderedIds:[venue.id],retrievedAt:'2026-11-02T12:00:00Z'});
  assert.equal(getVenue(state,state.selectedVenueId)?.id,venue.id);assert.deepEqual(rankVenues(state).map(r=>r.venue.id),[venue.id]);
  state=reducer(state,{type:'choose-plan',venueId:venue.id});assert.ok(planValidationErrors(state).some(x=>/confirmation/.test(x)));assert.deepEqual(eligibilityReasons(venue,state),[]);
  state=reducer(state,{type:'acknowledge-details',acknowledged:true});state=reducer(state,{type:'toggle-approval',participantId:'you'});state=reducer(state,{type:'save-plan'});assert.equal(state.plan.saved,true);
  const other=sanitizeVenueSnapshot({...venue,id:`qloo:${VETO}`,providerEntityId:VETO})!;
  state=reducer(state,{type:'receive-recommendations',venues:[other],orderedIds:[other.id],retrievedAt:'2026-11-02T12:01:00Z'});assert.equal(state.plan.venueId,venue.id);assert.equal(state.plan.saved,true);assert.ok(getVenueCatalog(state).some(v=>v.id===venue.id));
  const restored=hydrateState(serializeState(state));assert.equal(restored.plan.venueId,venue.id);assert.equal(restored.plan.saved,true);assert.ok(restored.catalog?.length);
  const vetoed=reducer(restored,{type:'veto',venueId:venue.id});assert.equal(vetoed.plan.venueId,null);assert.deepEqual(reducer(vetoed,{type:'veto',venueId:venue.id}),vetoed);
});

test('browsing samples preserves a saved real plan and discovery results, then selecting a real venue restores live order',()=>{
  const first=snapshot();const second=sanitizeVenueSnapshot({...first,id:`qloo:${VETO}`,providerEntityId:VETO,name:'Another real restaurant'})!;
  const liveOrder=[second.id,first.id];
  let state=reducer(createInitialState(),{type:'receive-recommendations',venues:[first,second],orderedIds:liveOrder,retrievedAt:'2026-11-02T12:00:00Z'});
  state=reducer(state,{type:'choose-plan',venueId:first.id});state=reducer(state,{type:'acknowledge-details',acknowledged:true});state=reducer(state,{type:'toggle-approval',participantId:'you'});state=reducer(state,{type:'save-plan'});
  const plan=state.plan;assert.equal(plan.saved,true);
  state=reducer(state,{type:'browse-sample'});assert.equal(state.discoveryMode,'sample');assert.ok(!state.selectedVenueId.startsWith('qloo:'));assert.ok(rankVenues(state).every(r=>!r.venue.id.startsWith('qloo:')));assert.equal(state.plan,plan);assert.deepEqual(state.recommendationIds,liveOrder);assert.ok(getVenue(state,first.id));
  const restored=hydrateState(serializeState(state));assert.equal(restored.discoveryMode,'sample');assert.equal(restored.plan.venueId,first.id);assert.equal(restored.plan.saved,true);assert.deepEqual(restored.recommendationIds,liveOrder);
  state=reducer(restored,{type:'select',venueId:first.id});assert.equal(state.discoveryMode,'live');assert.deepEqual(rankVenues(state).map(r=>r.venue.id),liveOrder);assert.equal(state.plan.venueId,first.id);assert.equal(state.plan.saved,true);
  state=reducer(state,{type:'select',venueId:'casa'});assert.equal(state.discoveryMode,'sample');assert.equal(state.plan.venueId,first.id);assert.ok(rankVenues(state).every(r=>!r.venue.id.startsWith('qloo:')));
});

test('a cached real venue can be browsed in live mode when no recommendation order was stored',()=>{
  const venue=snapshot();let state={...createInitialState(),catalog:[venue]};
  state=reducer(state,{type:'select',venueId:venue.id}) as typeof state;assert.equal(state.discoveryMode,'live');assert.deepEqual(rankVenues(state).map(r=>r.venue.id),[venue.id]);
  const restored=hydrateState(serializeState({...state,discoveryMode:'invalid'}));assert.equal(restored.discoveryMode,'live');assert.equal(restored.selectedVenueId,venue.id);
});

test('Worker default transport resolves fetch at request time with its required receiver and supported manual redirects',async()=>{
  const previous=globalThis.fetch;let calls=0;
  globalThis.fetch=function(this:typeof globalThis,_input,init){assert.equal(this,globalThis);assert.equal(init?.redirect,'manual');calls++;return Promise.resolve(Response.json({results:{entities:[]}}));};
  try{
    const result=await retrieveRecommendations({...input,participants:[{tastes:[],budget:50,restrictions:[]}]},{apiKey:'mock-server-secret'});
    assert.deepEqual(result.venues,[]);assert.equal(calls,1);
  }finally{globalThis.fetch=previous;}
});

test('Worker transport rejects redirects without following or retrying and cancels their bodies',async()=>{
  for(const redirectedSuccess of [false,true]){
    let calls=0,cancelled=false;
    const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:redirectedSuccess?200:302,headers:{Location:'https://untrusted.example/steal'}});
    if(redirectedSuccess)Object.defineProperty(response,'redirected',{value:true});
    const result=await handleRecommendations(new Request('https://app.example/api/recommendations',{method:'POST',body:JSON.stringify({...input,participants:[{tastes:[],budget:50,restrictions:[]}]})}),options(async(url,init)=>{calls++;assert.equal(new URL(String(url)).origin,'https://api.qloo.com');assert.equal(init?.redirect,'manual');return response;}));
    assert.equal(result.status,502);assert.equal(calls,1);assert.equal(cancelled,true);assert.doesNotMatch(await result.text(),/untrusted\.example|mock-server-secret/);
  }
});

test('Worker transport deadline covers an uncooperative fetch and a stalled streamed body',async()=>{
  const requestInput={...input,participants:[{tastes:[],budget:50,restrictions:[]}]};
  for(const stalledBody of [false,true]){
    let cancelled=false,calls=0;
    const fetcher:typeof fetch=async()=>{calls++;return stalledBody?new Response(new ReadableStream<Uint8Array>({pull(){return new Promise<void>(()=>{});},cancel(){cancelled=true;}})):new Promise<Response>(()=>{});};
    await assert.rejects(retrieveRecommendations(requestInput,{...options(fetcher),timeoutMs:10}),error=>Boolean(error&&typeof error==='object'&&'code' in error&&error.code==='timeout'));
    assert.equal(calls,1);if(stalledBody)assert.equal(cancelled,true);
  }
});

test('Worker transport respects caller cancellation while a response stream ignores the fetch signal',async()=>{
  const controller=new AbortController();let cancelled=false;
  const fetcher:typeof fetch=async()=>new Response(new ReadableStream<Uint8Array>({pull(){controller.abort();return new Promise<void>(()=>{});},cancel(){cancelled=true;}}));
  await assert.rejects(retrieveRecommendations({...input,participants:[{tastes:[],budget:50,restrictions:[]}]},{...options(fetcher),signal:controller.signal,timeoutMs:100}),error=>Boolean(error&&typeof error==='object'&&'code' in error&&error.code==='cancelled'));
  assert.equal(cancelled,true);
});
