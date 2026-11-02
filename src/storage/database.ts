import { isSerializedAppSnapshot } from './hydration';

export const DATABASE_NAME = 'common-table';
export const DATABASE_VERSION = 1;
export const STORE_NAMES = ['app', 'location', 'settings', 'cache', 'meta'] as const;
export type StoreName = typeof STORE_NAMES[number];
export const APP_RECORD_KEY = 'main';
export const LOCATION_RECORD_KEY = 'context';
export const LEGACY_APP_KEY = 'common-table.demo.v1';
export const LEGACY_MIGRATION_KEY = 'migration:local-storage:v1';

export interface DeviceRecord<T> {
  schema: 1;
  value: T;
  revision: number;
  updatedAt: number;
  writerId: string;
  persistent: boolean;
}
export interface StorageStatus {
  state: 'loading' | 'ready' | 'session-only';
  ready: boolean;
  available: boolean;
  error: string | null;
}
export interface StorageOptions { persist?: boolean; expectedRevision?: number }
export interface StorageChange { store: StoreName; key: string; record: DeviceRecord<unknown> | undefined; external: boolean }
export class StorageConflictError extends Error {
  constructor(public readonly latest: DeviceRecord<unknown> | undefined) { super('This record changed in another tab. Review the newer device copy before replacing it.'); this.name='StorageConflictError'; }
}
export class StorageInputError extends Error { constructor(message:string) { super(message);this.name='StorageInputError'; } }
export class StorageCorruptionError extends Error { constructor(){super('Saved device data could not be read. This session is kept in memory to protect the existing copy.');this.name='StorageCorruptionError';} }
interface StoreEnvironment {
  indexedDB?: IDBFactory;
  legacyStorage?: Pick<Storage,'getItem'|'removeItem'> | null;
  databaseName?: string;
  writerId?: string;
  broadcast?: () => BroadcastChannel;
  now?: () => number;
}
const clone = <T,>(value:T):T => value === undefined ? value : typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
const secretKeys=new Set(['token','apikey','accesstoken','refreshtoken','authtoken','authorization','password','clientsecret','secretkey','privatekey','credential','credentials','bearertoken','sessiontoken']);
/** Device stores are for product state and caches, never credentials. */
function assertSafeValue(value:unknown,seen=new WeakSet<object>()) {
  if(!value || typeof value!=='object')return;
  if(seen.has(value))return;seen.add(value);
  for(const [key,entry] of Object.entries(value)) {
    if(secretKeys.has(key.toLowerCase().replace(/[^a-z]/g,'')))throw new StorageInputError('Secrets must never be saved on this device.');
    assertSafeValue(entry,seen);
  }
}
function recordOf<T>(raw:unknown):DeviceRecord<T>|undefined {
  if(raw===undefined)return undefined;
  if(!raw || typeof raw!=='object')throw new StorageCorruptionError();
  const r=raw as DeviceRecord<T>;
  if(r.schema!==1 || !('value' in r) || !Number.isSafeInteger(r.revision) || r.revision<1 || !Number.isFinite(r.updatedAt) || typeof r.writerId!=='string' || !r.writerId.length)throw new StorageCorruptionError();
  return {...r,persistent:true};
}
function errorText(error:unknown) {
  if(error instanceof StorageCorruptionError)return error.message;
  const name=error instanceof DOMException || error instanceof Error ? error.name : '';
  if(name==='VersionError')return 'This device has a newer storage version. Reload the app; changes are kept only for this session.';
  if(name==='QuotaExceededError')return 'Device storage is full. Changes are kept only for this session; export important plans.';
  if(name==='SecurityError' || name==='NotAllowedError')return 'This browser denied device storage. Changes are kept only for this session.';
  return 'Device storage is unavailable. Changes are kept only for this session; export important plans.';
}

/** One transactional writer per tab; IndexedDB read/write transactions serialize across tabs. */
export class DeviceStore {
  private db:IDBDatabase|null=null;
  private boot:Promise<void>|null=null;
  private tail:Promise<unknown>=Promise.resolve();
  private memory=new Map<string,DeviceRecord<unknown>>();
  private sessionKeys=new Set<string>();
  private listeners=new Set<(event:StorageChange)=>void>();
  private statusListeners=new Set<()=>void>();
  private channel:BroadcastChannel|null=null;
  private status:StorageStatus={state:'loading',ready:false,available:false,error:null};
  private closed=false;
  readonly writerId:string;
  readonly databaseName:string;
  constructor(private env:StoreEnvironment={}) {
    this.writerId=env.writerId ?? (typeof crypto!=='undefined' && 'randomUUID' in crypto?crypto.randomUUID():`tab-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    this.databaseName=env.databaseName??DATABASE_NAME;
  }
  getStatus=()=>this.status;
  subscribeStatus=(listener:()=>void)=>{this.statusListeners.add(listener);return()=>this.statusListeners.delete(listener);};
  subscribe=(store:StoreName,key:string,listener:(event:StorageChange)=>void)=>{
    const filter=(event:StorageChange)=>{if(event.store===store && event.key===key)listener(event);};
    this.listeners.add(filter);return()=>this.listeners.delete(filter);
  };
  private setStatus(next:StorageStatus){this.status=next;for(const listener of this.statusListeners)listener();}
  sessionOnly(error:unknown){this.setStatus({state:'session-only',ready:true,available:false,error:errorText(error)});}
  private cacheKey(store:StoreName,key:string){return `${store}\0${key}`;}
  private makeRecord<T>(value:T,revision:number,persistent:boolean):DeviceRecord<T>{return{schema:1,value:clone(value),revision,updatedAt:(this.env.now??Date.now)(),writerId:this.writerId,persistent};}
  private notify(change:StorageChange){for(const listener of this.listeners)listener(change);}
  private async openDatabase():Promise<IDBDatabase> {
    const factory=this.env.indexedDB ?? globalThis.indexedDB;
    if(!factory)throw new Error('IndexedDB is not supported.');
    return await new Promise((resolve,reject)=>{
      let settled=false;
      const request=factory.open(this.databaseName,DATABASE_VERSION);
      const fail=(error:unknown)=>{if(!settled){settled=true;reject(error);}};
      request.onupgradeneeded=()=>{for(const name of STORE_NAMES)if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
      request.onblocked=()=>fail(new Error('Another tab is holding a database upgrade.'));
      request.onerror=()=>fail(request.error);
      request.onsuccess=()=>{
        if(settled || this.closed){request.result.close();if(!settled)fail(new Error('Storage closed.'));return;}
        settled=true;resolve(request.result);
      };
    });
  }
  initialize=():Promise<void>=>{
    if(this.boot)return this.boot;
    this.boot=(async()=>{
      try {
        this.db=await this.openDatabase();
        this.db.onversionchange=()=>{this.db?.close();this.db=null;this.sessionOnly(new Error('Device storage was upgraded in another tab. Reload to use the new version.'));};
        await this.migrateLegacy();
        if(this.status.state!=='session-only')this.setStatus({state:'ready',ready:true,available:true,error:null});
        if(this.env.broadcast || typeof window!=='undefined') {
          try {
            this.channel=this.env.broadcast?.() ?? (typeof BroadcastChannel!=='undefined'?new BroadcastChannel(`${this.databaseName}:changes`):null);
            if(this.channel)this.channel.onmessage=(event:MessageEvent)=>{void this.receive(event.data);};
          } catch { /* IndexedDB remains available without cross-tab notifications. */ }
        }
      } catch(error){this.sessionOnly(error);this.seedLegacyForSession();}
    })();
    return this.boot;
  };
  private seedLegacyForSession(){
    if(this.memory.has(this.cacheKey('app',APP_RECORD_KEY)))return;
    try{
      const legacy=this.env.legacyStorage!==undefined?this.env.legacyStorage:typeof window!=='undefined'?window.localStorage:null;
      const raw=legacy?.getItem(LEGACY_APP_KEY);
      if(raw && isSerializedAppSnapshot(raw)){assertSafeValue(JSON.parse(raw));this.memory.set(this.cacheKey('app',APP_RECORD_KEY),this.makeRecord(raw,1,false));}
    }catch{/* Preserve the untouched source; no empty write or destructive recovery. */}
  }
  private async migrateLegacy() {
    const markerAlreadyExists = await new Promise<boolean>((resolve,reject)=>{const tx=this.db!.transaction('meta','readonly'),read=tx.objectStore('meta').get(LEGACY_MIGRATION_KEY);read.onsuccess=()=>{try{resolve(Boolean(recordOf(read.result)));}catch(error){reject(error);}};read.onerror=()=>reject(read.error);});
    if(markerAlreadyExists)return;
    let legacy:StoreEnvironment['legacyStorage'];
    try {legacy=this.env.legacyStorage!==undefined?this.env.legacyStorage:typeof window!=='undefined'?window.localStorage:null;}catch{legacy=null;}
    let raw:string|null=null,lowPower:string|null=null;
    try{raw=legacy?.getItem(LEGACY_APP_KEY)??null;lowPower=legacy?.getItem('common-table-low-power')??null;}catch{/* LocalStorage denial does not imply IndexedDB denial. */}
    let payload:unknown;
    if(raw!==null){
      try {payload=JSON.parse(raw);if(!isSerializedAppSnapshot(raw))throw new Error('Invalid legacy snapshot');assertSafeValue(payload);}
      catch{throw new StorageCorruptionError();}
    }
    const db=this.db!;
    let migrated=false;
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['app','settings','meta'],'readwrite');
      const meta=tx.objectStore('meta'),apps=tx.objectStore('app'),settings=tx.objectStore('settings');
      let problem:unknown;
      const marker=meta.get(LEGACY_MIGRATION_KEY);
      marker.onsuccess=()=>{
        if(marker.result!==undefined)return;
        const app=apps.get(APP_RECORD_KEY);
        app.onsuccess=()=>{
          try {
          const previous=recordOf(app.result);
          if(previous)this.memory.set(this.cacheKey('app',APP_RECORD_KEY),previous);
          if(previous===undefined && raw!==null){this.memory.set(this.cacheKey('app',APP_RECORD_KEY),this.makeRecord(raw,1,false));apps.put(this.makeRecord(raw,1,true),APP_RECORD_KEY);}
          const setting=settings.get('lowPower');
          setting.onsuccess=()=>{if(setting.result===undefined && (lowPower==='true'||lowPower==='false'))settings.put(this.makeRecord(lowPower==='true',1,true),'lowPower');};
          meta.put(this.makeRecord({completed:true,source:LEGACY_APP_KEY,hadLegacy:raw!==null},1,true),LEGACY_MIGRATION_KEY);migrated=true;
          }catch(error){problem=error;tx.abort();}
        };
      };
      tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(problem??tx.error??new Error('Legacy migration failed.'));
    });
    if(migrated){try{legacy?.removeItem(LEGACY_APP_KEY);legacy?.removeItem('common-table-low-power');}catch{/* The committed marker prevents remigration if removal is denied. */}}
  }
  private async receive(raw:unknown){
    if(!raw || typeof raw!=='object' || !this.status.available)return;
    const event=raw as {store:StoreName;key:string;writerId:string};
    if(event.writerId===this.writerId || !STORE_NAMES.includes(event.store) || typeof event.key!=='string' || event.key.length>500)return;
    const record=await this.getRecord(event.store,event.key);
    if(record?.writerId===this.writerId)return;
    this.notify({store:event.store,key:event.key,record,external:true});
  }
  async getRecord<T>(store:StoreName,key:string,options:StorageOptions={}):Promise<DeviceRecord<T>|undefined>{
    await this.initialize();const memoryKey=this.cacheKey(store,key);
    if(options.persist===false || this.sessionKeys.has(memoryKey) || !this.status.available || !this.db)return clone(this.memory.get(memoryKey) as DeviceRecord<T>|undefined);
    try {
      const raw=await new Promise<unknown>((resolve,reject)=>{const tx=this.db!.transaction(store,'readonly');const request=tx.objectStore(store).get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);tx.onabort=()=>reject(tx.error);});
      const record=recordOf<T>(raw);
      if(record)this.memory.set(memoryKey,record);else this.memory.delete(memoryKey);
      return clone(record);
    } catch(error){this.sessionOnly(error);return clone(this.memory.get(memoryKey) as DeviceRecord<T>|undefined);}
  }
  async get<T>(store:StoreName,key:string,options:StorageOptions={}):Promise<T|undefined>{return (await this.getRecord<T>(store,key,options))?.value;}
  private enqueue<T>(task:()=>Promise<T>):Promise<T>{const next=this.tail.then(task);this.tail=next.catch(()=>undefined);return next;}
  put<T>(store:StoreName,key:string,value:T,options:StorageOptions={}):Promise<DeviceRecord<T>>{
    let snapshot:T;
    try{
      assertSafeValue(typeof value==='string' && store==='app'?JSON.parse(value):value);
      snapshot=clone(value);
    }catch(error){
      if(error instanceof StorageInputError)return Promise.reject(error);
      try{snapshot=clone(value);}catch{return Promise.reject(new StorageInputError('Only serializable product data can be saved on this device.'));}
    }
    return this.update<T>(store,key,()=>snapshot,options).then(record=>record!);
  }
  deleteValue(store:StoreName,key:string,options:StorageOptions={}):Promise<void>{return this.update(store,key,()=>undefined,options).then(()=>undefined);}
  update<T>(store:StoreName,key:string,updater:(current:T|undefined)=>T|undefined,options:StorageOptions={}):Promise<DeviceRecord<T>|undefined>{
    if(key.split(/[:./]/).some(part=>secretKeys.has(part.toLowerCase().replace(/[^a-z]/g,''))))return Promise.reject(new StorageInputError('Secrets must never be saved on this device.'));
    return this.enqueue(async()=>{
      await this.initialize();
      const memoryKey=this.cacheKey(store,key);
      const fallback=()=>{
        const current=this.memory.get(memoryKey) as DeviceRecord<T>|undefined;
        if(options.expectedRevision!==undefined && options.expectedRevision!==(current?.revision??0))throw new StorageConflictError(current);
        const value=updater(clone(current?.value));assertSafeValue(value);
        const next=value===undefined?undefined:this.makeRecord(value,(current?.revision??0)+1,false);
        if(next)this.memory.set(memoryKey,next);else this.memory.delete(memoryKey);
        this.sessionKeys.add(memoryKey);this.notify({store,key,record:next,external:false});return clone(next);
      };
      if(options.persist===false || this.sessionKeys.has(memoryKey) || !this.status.available || !this.db)return fallback();
      try {
        const next=await new Promise<DeviceRecord<T>|undefined>((resolve,reject)=>{
          const tx=this.db!.transaction(store,'readwrite'),objectStore=tx.objectStore(store),read=objectStore.get(key);let result:DeviceRecord<T>|undefined;let problem:unknown;
          read.onsuccess=()=>{
            try {
              const current=recordOf<T>(read.result);
              if(options.expectedRevision!==undefined && options.expectedRevision!==(current?.revision??0))throw new StorageConflictError(current);
              let value:T|undefined;try{value=updater(clone(current?.value));assertSafeValue(value);if(store==='app' && typeof value==='string'){try{assertSafeValue(JSON.parse(value));}catch(error){if(error instanceof StorageInputError)throw error;}}clone(value);}catch(error){throw error instanceof StorageInputError?error:new StorageInputError('The device-storage update was invalid.');}
              result=value===undefined?undefined:this.makeRecord(value,(current?.revision??0)+1,true);
              if(result)objectStore.put(result,key);else objectStore.delete(key);
            }catch(error){problem=error;tx.abort();}
          };
          tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(problem??tx.error??new Error('Device write failed.'));
        });
        if(next)this.memory.set(memoryKey,next);else this.memory.delete(memoryKey);
        this.notify({store,key,record:next,external:false});
        try{this.channel?.postMessage({store,key,writerId:this.writerId,revision:next?.revision??0});}catch{/* Optional tab notification. */}
        return clone(next);
      }catch(error){if(error instanceof StorageConflictError || error instanceof StorageInputError)throw error;this.sessionOnly(error);return fallback();}
    });
  }
  flush=async()=>{await this.initialize();await this.tail;};
  close(){this.closed=true;this.db?.close();this.db=null;this.channel?.close();this.channel=null;}
}
export const deviceStore=new DeviceStore();
