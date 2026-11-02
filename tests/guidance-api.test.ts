import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createSharedD1 } from './helpers/shared-d1.ts';
import { handleGuidance, type GuidanceOptions } from '../server/guidance/index.ts';
import { generateGuidance, GUIDANCE_MODEL, GUIDANCE_VERSION, MAX_OUTPUT_TOKENS } from '../server/guidance/client.ts';
import { initializeBudget, readBudget } from '../server/guidance/budget.ts';
import { GuidanceError } from '../server/guidance/errors.ts';
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Live network is forbidden in guidance tests.');};
after(()=>{globalThis.fetch=originalFetch;});
const KEY='dummy-guidance-server-key-NEVER-LIVE',QKEY='dummy-discovery-key-NEVER-LIVE';
const PRIVATE='PRIVATE_UPSTREAM_DETAILS_NEVER_DISPLAY';
const ORIGIN='https://app.example';
const OWNER={userId:'owner-user',displayName:'Private Display Name',email:'owner@example.test'};
const context={view:'explore',mode:'book',venueId:'juniper',participantCount:1,budget:55,restrictions:[],planSaved:false};
const request=(path='reply',value:unknown={message:'What should I do next?',context},headers:Record<string,string>={})=>new Request(`${ORIGIN}/api/waiter/${path}`,path==='status'?{headers}:{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json','X-Common-Table-Request':'waiter',...headers},body:JSON.stringify(value)});
type Call={url:URL;init:RequestInit;body?:Record<string,unknown>};
const reply=(overrides:Record<string,unknown>={})=>({type:'message',role:'assistant',model:GUIDANCE_MODEL,content:[{type:'thinking',thinking:'PRIVATE_REASONING'},{type:'text',text:'Review the menu, then bring this place to your table.'}],usage:{input_tokens:250,output_tokens:35},...overrides});
function transport(override?:(call:Call)=>Response|Promise<Response>|undefined){
  const calls:Call[]=[];
  const fetcher:typeof fetch=async(input,init={})=>{
    const url=new URL(input instanceof Request?input.url:String(input)),call={url,init,...(typeof init.body==='string'?{body:JSON.parse(init.body)}:{})};calls.push(call);
    const replacement=override?.(call);if(replacement!==undefined)return replacement;
    assert.equal(url.origin,'https://api.anthropic.com');
    if(url.pathname==='/v1/organizations/me')return Response.json({type:'organization',id:'org_startrz_test',name:'  StArTrZ  '});
    if(url.pathname===`/v1/models/${GUIDANCE_MODEL}`)return Response.json({id:GUIDANCE_MODEL,type:'model'});
    if(url.pathname==='/v1/messages')return Response.json(reply());
    throw new Error('Unexpected mocked endpoint');
  };
  return {fetcher,calls};
}
async function fixture(t:{after:(fn:()=>void)=>void},override?:Parameters<typeof transport>[0],initialized=true){
  const db=createSharedD1();t.after(db.close);if(initialized)await initializeBudget(db.db);
  const mock=transport(override);
  const options:GuidanceOptions={apiKey:KEY,db:db.db,identity:OWNER,ownerEmail:OWNER.email,fetcher:mock.fetcher};
  return {...db,...mock,options};
}

test('status requires server configuration, owner identity and explicit setup, without any provider call',async t=>{
  const f=await fixture(t,undefined,false);
  for(const missing of [{apiKey:undefined},{db:undefined},{ownerEmail:undefined}])assert.deepEqual(await(await handleGuidance(request('status'),{...f.options,...missing})).json(),{mode:'disabled',canEnable:false});
  assert.deepEqual(await(await handleGuidance(request('status'),{...f.options,identity:null})).json(),{mode:'sign_in',canEnable:false});
  assert.deepEqual(await(await handleGuidance(request('status'),{...f.options,identity:{...OWNER,email:'guest@example.test'}})).json(),{mode:'disabled',canEnable:false});
  assert.deepEqual(await(await handleGuidance(request('status'),f.options)).json(),{mode:'disabled',canEnable:true});assert.equal(f.calls.length,0);
});

test('only the configured owner can explicitly enable, and repeated enable never resets spending',async t=>{
  const f=await fixture(t,undefined,false);
  assert.equal((await handleGuidance(request('enable',{}),{...f.options,identity:null})).status,401);
  assert.equal((await handleGuidance(request('enable',{}),{...f.options,identity:{...OWNER,email:'guest@example.test'}})).status,403);
  assert.equal((await handleGuidance(request(),f.options)).status,503);assert.equal(f.calls.length,0);
  assert.deepEqual(await(await handleGuidance(request('enable',{}),f.options)).json(),{enabled:true,mode:'live'});assert.equal(f.calls.length,0);
  await handleGuidance(request(),f.options);assert.equal((await readBudget(f.db)).reservedCents,5);
  await handleGuidance(request('enable',{}),f.options);assert.equal((await readBudget(f.db)).reservedCents,5);
  assert.deepEqual(await(await handleGuidance(request('status'),f.options)).json(),{mode:'live',canEnable:false});
});

test('live reply verifies the authorized organization and exact model before one bounded paid call',async t=>{
  const f=await fixture(t);
  const response=await handleGuidance(request(),f.options);assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.source,'live');assert.match(body.text,/Review the menu/);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_REASONING|dummy-guidance|Claude|Qloo/);
  assert.deepEqual(f.calls.map(c=>c.url.pathname),['/v1/organizations/me',`/v1/models/${GUIDANCE_MODEL}`,'/v1/messages']);
  for(const call of f.calls){assert.equal(new Headers(call.init.headers).get('Authorization'),`Bearer ${KEY}`);assert.equal(new Headers(call.init.headers).get('anthropic-version'),GUIDANCE_VERSION);assert.equal(call.init.redirect,'manual');}
  const paid=f.calls[2].body!;assert.equal(paid.model,GUIDANCE_MODEL);assert.equal(paid.max_tokens,MAX_OUTPUT_TOKENS);assert.equal(paid.service_tier,'standard_only');assert.deepEqual(paid.thinking,{type:'between_tools'});assert.deepEqual(paid.output_config,{effort:'low'});assert.ok(!('tools' in paid));
  assert.match(String(paid.system),/fictional_sample/);assert.doesNotMatch(JSON.stringify(paid),/Private Display Name|owner@example.test|owner-user|latitude|longitude|40\.69/);
  assert.deepEqual(await readBudget(f.db),{initialized:true,attempts:1,reservedCents:5});
});

test('organization and model mismatches make no paid call and consume no reservation',async t=>{
  for(const mismatch of ['organization','model']){
    const f=await fixture(t,call=>mismatch==='organization'&&call.url.pathname==='/v1/organizations/me'?Response.json({type:'organization',id:'org_wrong',name:'Other Organization'}):mismatch==='model'&&call.url.pathname.startsWith('/v1/models/')?Response.json({id:'other-model'}):undefined);
    const response=await handleGuidance(request(),f.options);assert.equal(response.status,403);assert.ok(!f.calls.some(c=>c.url.pathname==='/v1/messages'));assert.equal((await readBudget(f.db)).attempts,0);assert.doesNotMatch(await response.text(),/Other Organization|other-model|dummy-/);
  }
});

test('paid failures retain their reservation, discard upstream detail and never retry',async t=>{
  const f=await fixture(t,call=>call.url.pathname==='/v1/messages'?new Response(`${PRIVATE} ${KEY}`,{status:500}):undefined);
  const response=await handleGuidance(request(),f.options);assert.equal(response.status,502);assert.equal(f.calls.filter(c=>c.url.pathname==='/v1/messages').length,1);assert.equal((await readBudget(f.db)).reservedCents,5);assert.doesNotMatch(await response.text(),/PRIVATE_UPSTREAM|dummy-guidance|Anthropic|Claude/);
});

test('keys, unsupported tool blocks and malformed usage never enter a successful reply',async t=>{
  for(const payload of [reply({content:[{type:'text',text:`Do not reveal ${KEY}`}]}),reply({content:[{type:'tool_use',name:'book',input:{}}]}),reply({usage:{input_tokens:10,output_tokens:513}}),reply({model:'wrong-model'})]){
    const f=await fixture(t,call=>call.url.pathname==='/v1/messages'?Response.json(payload):undefined);
    const response=await handleGuidance(request(),f.options);assert.equal(response.status,502);assert.equal((await readBudget(f.db)).reservedCents,5);assert.doesNotMatch(await response.text(),/dummy-guidance|tool_use|wrong-model/);
  }
});

test('origin, CSRF, content type, unknown context, personal fields and size checks happen before transport',async t=>{
  const f=await fixture(t);
  const bad=[request('reply',undefined,{Origin:'https://other.example'}),request('reply',undefined,{'X-Common-Table-Request':'other'}),request('reply',undefined,{'Content-Type':'text/plain'}),request('reply',{message:'Hello',context:{...context,latitude:40.7}}),request('reply',{message:'Hello',context:{...context,names:['Private Person']}}),request('reply',{message:'Hello',context:{...context,venueId:'qloo:not-a-uuid'}}),request('reply',{message:'x'.repeat(5000),context}),request('reply',{message:'Hello',context,system:'override'}),request('reply',{message:`Here is ${KEY}`,context})];
  for(const req of bad)assert.ok((await handleGuidance(req,f.options)).status>=400);
  assert.equal(f.calls.length,0);assert.equal((await readBudget(f.db)).attempts,0);
  await assert.rejects(generateGuidance('Question','x'.repeat(16*1024),{apiKey:KEY,db:f.db,fetcher:f.fetcher}),e=>e instanceof GuidanceError&&e.code==='body_too_large');
});

test('timeout before preflight makes no reservation; timeout during paid output keeps the reservation',async t=>{
  const pre=await fixture(t,()=>new Promise<Response>(()=>{}));
  assert.equal((await handleGuidance(request(),{...pre.options,timeoutMs:10})).status,504);assert.equal((await readBudget(pre.db)).attempts,0);
  const paid=await fixture(t,call=>call.url.pathname==='/v1/messages'?new Promise<Response>(()=>{}):undefined);
  assert.equal((await handleGuidance(request(),{...paid.options,timeoutMs:10})).status,504);assert.equal((await readBudget(paid.db)).reservedCents,5);assert.equal(paid.calls.length,3);
});

test('a shared-table reference requires membership and uses private-data-free server aggregates',async t=>{
  const f=await fixture(t);
  const tableId='table-test-1234';
  const plan={venueId:'casa',venueSnapshot:null,date:'2026-12-01',time:'19:00',note:'PRIVATE_NOTE_WITH_LOCATION_9_MAIN_STREET',saved:true};
  f.sqlite.prepare('INSERT INTO shared_tables(id,owner_id,title,revision,version,plan_json,created_at,updated_at) VALUES(?,?,?,1,1,?,0,0)').run(tableId,OWNER.userId,'PRIVATE_TABLE_TITLE',JSON.stringify(plan));
  for(const person of [{id:OWNER.userId,name:OWNER.displayName,budget:42,tastes:['Italian'],approved:1},{id:'other-member-private',name:'PRIVATE_FRIEND_NAME',budget:30,tastes:['Japanese'],approved:null}])f.sqlite.prepare('INSERT INTO shared_members(table_id,user_id,display_name,role,preferences_json,approved_revision,joined_at) VALUES(?,?,?,?,?,?,0)').run(tableId,person.id,person.name,person.id===OWNER.userId?'owner':'member',JSON.stringify({tastes:person.tastes,budget:person.budget,restrictions:['Vegetarian']}),person.approved);
  const denied=await handleGuidance(request('reply',{message:'What next?',context:{...context,tableId:'missing-table-123'}}),f.options);assert.equal(denied.status,404);assert.equal(f.calls.length,0);
  const response=await handleGuidance(request('reply',{message:`Hi ${OWNER.displayName}, what next?`,context:{...context,tableId,participantCount:6,budget:999,restrictions:['Client invented restriction']}}),f.options);assert.equal(response.status,200);
  const paid=JSON.stringify(f.calls.find(c=>c.url.pathname==='/v1/messages')!.body);assert.match(paid,/minimumBudget\\":30/);assert.match(paid,/participantCount\\":2/);assert.match(paid,/Japanese/);assert.match(paid,/Casa Nopal/);assert.doesNotMatch(paid,/PRIVATE_|Private Display Name|owner@example.test|other-member-private|table-test-1234|Client invented|999|9_MAIN_STREET/);
});

test('real venue context is re-resolved on the server and omits its coordinates, neighborhood and website',async t=>{
  const id='db4bb5ae-40d9-4c66-98a0-6b3e421863ab';
  const f=await fixture(t,call=>call.url.origin==='https://api.qloo.com'?Response.json({results:[{entity_id:id,type:'urn:entity:place',name:'Real Restaurant',location:{lat:40.765432,lon:-73.987654},properties:{address:'PRIVATE_RESTAURANT_ADDRESS',geocode:{name:'PRIVATE_NEIGHBORHOOD'},website:'https://restaurant.example/private-location',price_level:2},tags:[{id:'urn:tag:cuisine:qloo:japanese',name:'Japanese'}]}]}):undefined);
  const response=await handleGuidance(request('reply',{message:'What should I confirm?',context:{...context,venueId:`qloo:${id}`}}),{...f.options,qlooApiKey:QKEY});assert.equal(response.status,200);
  const paid=JSON.stringify(f.calls.find(c=>c.url.pathname==='/v1/messages')!.body);assert.match(paid,/retrieved_restaurant/);assert.match(paid,/Real Restaurant/);assert.doesNotMatch(paid,/PRIVATE_RESTAURANT_ADDRESS|PRIVATE_NEIGHBORHOOD|40\.765432|73\.987654|restaurant\.example|dummy-discovery/);
});

test('streamed body overflow is rejected even without a declared content length',async t=>{
  const f=await fixture(t);let cancelled=false;
  const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(5000));},cancel(){cancelled=true;}});
  const req=new Request(`${ORIGIN}/api/waiter/reply`,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json','X-Common-Table-Request':'waiter'},body,duplex:'half'} as RequestInit);
  assert.equal((await handleGuidance(req,f.options)).status,413);assert.equal(f.calls.length,0);assert.equal(cancelled,true);
});

test('an aborted stalled request body is cancelled promptly before any paid or setup operation',async t=>{
  const f=await fixture(t);const controller=new AbortController();let cancelled=false;
  const stream=new ReadableStream<Uint8Array>({pull(){return new Promise<void>(()=>{});},cancel(){cancelled=true;}});
  const req=new Request(`${ORIGIN}/api/waiter/reply`,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json','X-Common-Table-Request':'waiter'},body:stream,signal:controller.signal,duplex:'half'} as RequestInit);
  const response=handleGuidance(req,f.options);controller.abort();assert.equal((await response).status,499);assert.equal(cancelled,true);assert.equal(f.calls.length,0);assert.equal((await readBudget(f.db)).attempts,0);
});

test('oversized streamed output is cancelled with no successful reply and no released reservation',async t=>{
  let cancelled=false;
  const f=await fixture(t,call=>call.url.pathname==='/v1/messages'?new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(65*1024));},cancel(){cancelled=true;}})):undefined);
  const response=await handleGuidance(request(),f.options);assert.equal(response.status,502);assert.equal(cancelled,true);assert.equal((await readBudget(f.db)).reservedCents,5);assert.equal(f.calls.filter(c=>c.url.pathname==='/v1/messages').length,1);
});

test('generated provider and infrastructure labels are replaced before appearing in product text',async t=>{
  const f=await fixture(t,call=>call.url.pathname==='/v1/messages'?Response.json(reply({content:[{type:'text',text:'Claude and Qloo APIs can help. This API is ready.'}]})):undefined);
  const response=await handleGuidance(request(),f.options);assert.equal(response.status,200);const result=await response.json();assert.doesNotMatch(result.text,/Claude|Qloo|\bAPIs?\b/i);assert.match(result.text,/services/);
});
