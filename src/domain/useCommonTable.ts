import {useCallback,useEffect,useMemo,useReducer,useRef,useState} from 'react';
import {venues} from './data';
import {getVenue} from './catalog';
import {rankVenues} from './ranking';
import {createInitialState,hydrateState,reducer,serializeState} from './state';
import type {AppAction,AppState} from './types';
import {APP_RECORD_KEY,StorageConflictError,StorageCorruptionError,getRecord,put,subscribe,useSessionStorageOnly,type DeviceRecord} from '../storage';
import {hydrationReducer,isSerializedAppSnapshot,type HydratingState} from '../storage/hydration';
import {useDeviceStorageStatus} from '../storage/react';
const reduceHydration=hydrationReducer<AppState,AppAction>(reducer);
function decoded(record:DeviceRecord<string>|undefined){
  if(record && !isSerializedAppSnapshot(record.value))throw new StorageCorruptionError();
  return hydrateState(record?.value??null);
}

export function useCommonTable(){
  const [working,send]=useReducer(reduceHydration,undefined,():HydratingState<AppState,AppAction>=>({value:createInitialState(),ready:false,pending:[],sequence:0}));
  const {value:state}=working;
  const status=useDeviceStorageStatus();
  const [storageConflict,setStorageConflict]=useState<string|null>(null);
  const [storageSaving,setStorageSaving]=useState(false);
  const revision=useRef(0),issued=useRef(0),settled=useRef(0);
  const stored=useRef(''),ready=useRef(false),alive=useRef(true),conflict=useRef<string|null>(null);
  const latestState=useRef(state);latestState.current=state;
  const writes=useRef<Promise<unknown>>(Promise.resolve());
  const dispatch=useCallback((action:AppAction)=>{issued.current++;setStorageSaving(true);send({kind:'action',action});},[]);
  const noteConflict=useCallback((message:string)=>{conflict.current=message;if(alive.current)setStorageConflict(message);},[]);
  useEffect(()=>{
    alive.current=true;let active=true;
    void (async()=>{
      const record=await getRecord<string>('app',APP_RECORD_KEY);if(!active)return;
      let base:AppState;
      try{base=decoded(record);}catch(error){useSessionStorageOnly(error);base=createInitialState();}
      revision.current=record?.revision??0;stored.current=serializeState(base);ready.current=true;
      send({kind:'hydrate',value:base});
    })();
    const stop=subscribe('app',APP_RECORD_KEY,event=>{
      if(!event.external || !ready.current || !active)return;
      if(event.record && event.record.revision<=revision.current)return;
      if(issued.current>settled.current){noteConflict('Another tab changed this device’s table while this tab had unsaved edits. Your local draft is preserved; choose which copy to keep.');return;}
      try{
        const record=event.record as DeviceRecord<string>|undefined,base=decoded(record);
        revision.current=record?.revision??0;stored.current=serializeState(base);
        send({kind:'replace',value:base});
      }catch(error){useSessionStorageOnly(error);}
    });
    return()=>{active=false;alive.current=false;stop();};
  },[noteConflict]);
  useEffect(()=>{
    if(!working.ready)return;
    const snapshot=serializeState(working.value),sequence=working.sequence;
    if(snapshot===stored.current){settled.current=Math.max(settled.current,sequence);if(sequence===issued.current)setStorageSaving(false);return;}
    if(conflict.current){setStorageSaving(false);return;}
    setStorageSaving(true);
    const save=writes.current.then(async()=>{
      if(conflict.current)return;
      try{
        const record=await put('app',APP_RECORD_KEY,snapshot,{expectedRevision:revision.current});
        revision.current=record.revision;stored.current=snapshot;settled.current=Math.max(settled.current,sequence);
      }catch(error){
        if(error instanceof StorageConflictError)noteConflict(error.message);
        else useSessionStorageOnly(error);
      }
    });
    writes.current=save.finally(()=>{if(alive.current && sequence===issued.current)setStorageSaving(false);});
  },[working.value,working.ready,working.sequence,noteConflict,storageConflict]);
  /** Explicit device-tab conflict resolution; never represents remote friend activity. */
  const resolveStorageConflict=useCallback(async(choice:'reload'|'keep-local')=>{
    const requestedAt=issued.current;
    await writes.current;
    const record=await getRecord<string>('app',APP_RECORD_KEY);
    if(choice==='reload'){
      if(issued.current!==requestedAt){noteConflict('This tab received another edit while loading the device copy. Your draft is preserved; choose again when ready.');return;}
      try{const base=decoded(record);revision.current=record?.revision??0;stored.current=serializeState(base);settled.current=issued.current;conflict.current=null;setStorageConflict(null);setStorageSaving(false);send({kind:'replace',value:base});}
      catch(error){useSessionStorageOnly(error);}
      return;
    }
    try{
      const snapshot=serializeState(latestState.current),sequence=issued.current;
      const saved=await put('app',APP_RECORD_KEY,snapshot,{expectedRevision:record?.revision??0});
      revision.current=saved.revision;stored.current=snapshot;settled.current=sequence;conflict.current=null;setStorageConflict(null);setStorageSaving(false);
    }catch(error){if(error instanceof StorageConflictError)noteConflict(error.message);else useSessionStorageOnly(error);}
  },[noteConflict]);
  const ranked=useMemo(()=>rankVenues(state),[state]);
  const selectedVenue=getVenue(state,state.selectedVenueId)??venues[0];
  return {state,dispatch,ranked,selectedVenue,storageAvailable:working.ready && status.available && !storageConflict,storageReady:working.ready,storageError:storageConflict??status.error,storageStatus:status,storageConflict,storageSaving,resolveStorageConflict};
}
