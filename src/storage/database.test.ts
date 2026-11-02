import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBObjectStore as FakeObjectStore} from 'fake-indexeddb';
import {DeviceStore,APP_RECORD_KEY,LEGACY_APP_KEY,LEGACY_MIGRATION_KEY,StorageConflictError,StorageInputError,type StorageChange} from './database';
import {hydrationReducer} from './hydration';
import {applyLocationChange,cleanLocationSnapshot,emptyLocation} from './location';
const fixture=()=>JSON.stringify({version:1,state:{participants:[{id:'you',name:'You',color:'#667755',budget:70,tastes:['Italian'],restrictions:[]}],shortlist:['juniper'],vetoes:['olive'],selectedVenueId:'juniper',plan:{venueId:'juniper',date:'2099-11-02',time:'19:00',note:'An evening kept.',saved:false,approvals:[]},catalog:[]}});
function legacy(values:Record<string,string>={}){const map=new Map(Object.entries(values));return {map,getItem:(key:string)=>map.get(key)??null,removeItem:(key:string)=>{map.delete(key);}};}
async function direct(factory:IDBFactory,store:string,key:string,value?:unknown){const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=factory.open('common-table');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{return await new Promise<unknown>((resolve,reject)=>{const tx=db.transaction(store,value===undefined?'readonly':'readwrite'),request=value===undefined?tx.objectStore(store).get(key):tx.objectStore(store).put(value,key);let result:unknown;request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
function device(factory=new IDBFactory(),extra:ConstructorParameters<typeof DeviceStore>[0]={}){return new DeviceStore({indexedDB:factory,legacyStorage:null,...extra});}

test('legacy app and low-power preference migrate once, only after a committed transaction',async()=>{
  const factory=new IDBFactory(),old=legacy({[LEGACY_APP_KEY]:fixture(),'common-table-low-power':'true'}),store=device(factory,{legacyStorage:old});
  await store.initialize();assert.equal(store.getStatus().state,'ready');assert.equal(await store.get('app',APP_RECORD_KEY),fixture());assert.equal(await store.get('settings','lowPower'),true);assert.equal(old.map.has(LEGACY_APP_KEY),false);assert.equal((await store.get<{completed:boolean}>('meta',LEGACY_MIGRATION_KEY))?.completed,true);
  await store.put('app',APP_RECORD_KEY,fixture().replace('An evening kept.','Newer device copy.'));store.close();
  old.map.set(LEGACY_APP_KEY,'corrupt stale legacy text');const next=device(factory,{legacyStorage:old});assert.match((await next.get<string>('app',APP_RECORD_KEY))!,/Newer device copy/);assert.equal(next.getStatus().available,true);next.close();
});
test('existing IndexedDB state wins over a stale legacy snapshot',async()=>{
  const factory=new IDBFactory(),first=device(factory);await first.put('app',APP_RECORD_KEY,fixture());first.close();const old=legacy({[LEGACY_APP_KEY]:fixture().replace('An evening kept.','Stale copy')});const next=device(factory,{legacyStorage:old});assert.equal(await next.get('app',APP_RECORD_KEY),fixture());next.close();
});
test('native transactions serialize atomic updates across independent tabs',async()=>{
  const factory=new IDBFactory(),a=device(factory,{writerId:'a'}),b=device(factory,{writerId:'b'});await Promise.all([a.initialize(),b.initialize()]);await Promise.all(Array.from({length:40},(_,index)=>(index%2?a:b).update<number>('cache','counter',old=>(old??0)+1)));assert.equal(await a.get('cache','counter'),40);assert.equal((await b.getRecord('cache','counter'))?.revision,40);a.close();b.close();
});
test('queued puts capture a snapshot rather than a caller-mutable object',async()=>{
  const store=device(),value={note:'Original'};const pending=store.put('cache','snapshot',value);value.note='Changed after the call';await pending;assert.deepEqual(await store.get('cache','snapshot'),{note:'Original'});store.close();
});
test('revision checks preserve the newer tab and expose conflict without downgrading storage',async()=>{
  const factory=new IDBFactory(),a=device(factory),b=device(factory);const original=await a.put('settings','draft',{note:'first'});await b.put('settings','draft',{note:'newer'});await assert.rejects(a.put('settings','draft',{note:'stale'},{expectedRevision:original.revision}),StorageConflictError);assert.deepEqual(await a.get('settings','draft'),{note:'newer'});assert.equal(a.getStatus().available,true);a.close();b.close();
});
test('denied IndexedDB retains usable session-only state and honest status',async()=>{
  const denied={open(){throw new DOMException('Denied','SecurityError');}} as unknown as IDBFactory;const store=device(denied);await store.initialize();assert.equal(store.getStatus().state,'session-only');const record=await store.put('app',APP_RECORD_KEY,fixture());assert.equal(record.persistent,false);assert.equal(await store.get('app',APP_RECORD_KEY),fixture());assert.match(store.getStatus().error!,/denied/);store.close();
});
test('a denied database can still restore the untouched legacy plan into the session',async()=>{
  const denied={open(){throw new DOMException('Denied','SecurityError');}} as unknown as IDBFactory;
  const old=legacy({[LEGACY_APP_KEY]:fixture()}),store=device(denied,{legacyStorage:old});
  assert.equal(await store.get('app',APP_RECORD_KEY),fixture());assert.equal(old.map.get(LEGACY_APP_KEY),fixture());assert.equal(store.getStatus().available,false);store.close();
});
test('an incompatible newer database is not downgraded or overwritten',async()=>{
  const factory=new IDBFactory();const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=factory.open('common-table',2);request.onupgradeneeded=()=>request.result.createObjectStore('app');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction('app','readwrite');tx.objectStore('app').put({schema:2,value:'future data'},APP_RECORD_KEY);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();
  const store=device(factory);await store.initialize();assert.equal(store.getStatus().available,false);assert.match(store.getStatus().error!,/newer storage version/);await store.put('app',APP_RECORD_KEY,fixture());assert.deepEqual(await direct(factory,'app',APP_RECORD_KEY),{schema:2,value:'future data'});store.close();
});
test('localStorage denial does not disable functioning IndexedDB',async()=>{
  const store=device(new IDBFactory(),{legacyStorage:{getItem(){throw new DOMException('Denied','SecurityError');},removeItem(){}}});await store.put('settings','lowPower',true);assert.equal(store.getStatus().available,true);assert.equal(await store.get('settings','lowPower'),true);store.close();
});
test('a quota failure keeps edits in memory without claiming durability',async t=>{
  const factory=new IDBFactory(),store=device(factory);await store.initialize();const original=FakeObjectStore.prototype.put;t.mock.method(FakeObjectStore.prototype,'put',function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){if(key==='quota')throw new DOMException('Full','QuotaExceededError');return original.call(this,value,key);});const result=await store.put('app','quota',{note:'keep me'});assert.equal(result.persistent,false);assert.equal(store.getStatus().available,false);assert.deepEqual(await store.get('app','quota'),{note:'keep me'});assert.equal(await direct(factory,'app','quota'),undefined);store.close();
});
test('a failed migration preserves the legacy copy and its session-readable contents',async t=>{
  const factory=new IDBFactory(),old=legacy({[LEGACY_APP_KEY]:fixture()}),original=FakeObjectStore.prototype.put;t.mock.method(FakeObjectStore.prototype,'put',function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){if(this.name==='app')throw new DOMException('Full','QuotaExceededError');return original.call(this,value,key);});const store=device(factory,{legacyStorage:old});await store.initialize();assert.equal(old.map.get(LEGACY_APP_KEY),fixture());assert.equal(await store.get('app',APP_RECORD_KEY),fixture());assert.equal(store.getStatus().available,false);store.close();
});
test('corrupt envelopes are protected from an automatic empty overwrite',async()=>{
  const factory=new IDBFactory(),store=device(factory);await store.initialize();await direct(factory,'app',APP_RECORD_KEY,{schema:99,value:'unrecognized future record'});assert.equal(await store.get('app',APP_RECORD_KEY),undefined);assert.equal(store.getStatus().state,'session-only');await store.put('app',APP_RECORD_KEY,fixture());assert.deepEqual(await direct(factory,'app',APP_RECORD_KEY),{schema:99,value:'unrecognized future record'});store.close();
});
test('malformed legacy data is retained for recovery and never copied over the database',async()=>{
  const factory=new IDBFactory(),old=legacy({[LEGACY_APP_KEY]:'{"state":null}'}),store=device(factory,{legacyStorage:old});await store.initialize();assert.equal(store.getStatus().available,false);assert.equal(old.map.has(LEGACY_APP_KEY),true);assert.equal(await direct(factory,'app',APP_RECORD_KEY),undefined);store.close();
});
test('session-only cache entries never reach IndexedDB or another tab',async()=>{
  const factory=new IDBFactory(),a=device(factory),b=device(factory);await a.put('cache','weather:device',{latitude:12.34567},{persist:false});assert.deepEqual(await a.get('cache','weather:device',{persist:false}),{latitude:12.34567});assert.equal(await b.get('cache','weather:device'),undefined);assert.equal(await direct(factory,'cache','weather:device'),undefined);assert.equal(a.getStatus().available,true);a.close();b.close();
});
test('API keys and credential tokens are rejected, including nested serialized app state',async()=>{
  const store=device();await store.initialize();await assert.rejects(store.put('settings','credentials',{apiKey:'do-not-store'}),StorageInputError);await assert.rejects(store.put('settings','accessToken','do-not-store'),StorageInputError);await assert.rejects(store.update('app','bad-json',()=>JSON.stringify({nested:{refresh_token:'do-not-store'}})),StorageInputError);assert.equal(await store.get('app','bad-json'),undefined);assert.equal(store.getStatus().available,true);store.close();
});
test('bad updater callbacks abort without pretending the database is broken',async()=>{
  const store=device();await store.put('cache','value',{n:1});await assert.rejects(store.update('cache','value',()=>{throw new Error('Bad callback');}),StorageInputError);assert.deepEqual(await store.get('cache','value'),{n:1});assert.equal(store.getStatus().available,true);store.close();
});
test('hydration replays every early action over saved state, never an empty initial overwrite',()=>{
  const reduce=(state:number,action:{add?:number;set?:number})=>action.set??state+(action.add??0),hydration=hydrationReducer(reduce);let state={value:0,ready:false,pending:[] as {add?:number;set?:number}[],sequence:0};state=hydration(state,{kind:'action',action:{add:2}});state=hydration(state,{kind:'action',action:{add:3}});state=hydration(state,{kind:'hydrate',value:100});assert.equal(state.value,105);assert.equal(state.sequence,2);assert.equal(state.ready,true);const untouched=hydration(state,{kind:'hydrate',value:999});assert.equal(untouched,state);
});
test('an early no-op action still expresses intent against later saved state',()=>{const hydration=hydrationReducer((_:number,value:number)=>value);let state={value:0,ready:false,pending:[] as number[],sequence:0};state=hydration(state,{kind:'action',action:0});state=hydration(state,{kind:'hydrate',value:100});assert.equal(state.value,0);});
test('location snapshots omit GPS areas but keep an explicitly bookmarked real point',()=>{
  const point={id:'osm:1',name:'The cafe',category:'coffee' as const,latitude:12.3456,longitude:34.5678};const saved=applyLocationChange(emptyLocation(),{kind:'point',point,saved:true});const malicious={...saved,area:{latitude:12.3456,longitude:34.5678,label:'Device GPS',source:'device'}};assert.equal(cleanLocationSnapshot(malicious).area,null);assert.deepEqual(cleanLocationSnapshot(malicious).savedPoints,[point]);const searched=applyLocationChange(saved,{kind:'area',area:{latitude:51.5,longitude:-.1,label:'London',source:'search'}});assert.equal(searched.area?.label,'London');
});
class TestChannel {static all=new Set<TestChannel>();onmessage:((event:MessageEvent)=>void)|null=null;constructor(){TestChannel.all.add(this);}postMessage(value:unknown){for(const other of TestChannel.all)if(other!==this)queueMicrotask(()=>other.onmessage?.({data:value} as MessageEvent));}close(){TestChannel.all.delete(this);}}
test('cross-tab notifications read the committed device revision without transmitting whole snapshots',async()=>{
  const factory=new IDBFactory(),a=device(factory,{writerId:'a',broadcast:()=>new TestChannel() as unknown as BroadcastChannel}),b=device(factory,{writerId:'b',broadcast:()=>new TestChannel() as unknown as BroadcastChannel});await Promise.all([a.initialize(),b.initialize()]);const changed=new Promise<StorageChange>(resolve=>b.subscribe('settings','lowPower',event=>{if(event.external)resolve(event);}));await a.put('settings','lowPower',true);const event=await changed;assert.equal(event.external,true);assert.equal(event.record?.value,true);assert.equal(event.record?.revision,1);a.close();b.close();
});
