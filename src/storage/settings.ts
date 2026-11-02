import {useCallback,useEffect,useRef,useState,type SetStateAction} from 'react';
import {get,put,subscribe} from './index';
import {useDeviceStorageStatus} from './react';
/** Async device preference. A user's early interaction always wins over hydration. */
export function useBooleanSetting(key:string,fallback=false):[boolean,(next:SetStateAction<boolean>)=>void,{ready:boolean;error:string|null}] {
  const [value,setValue]=useState(fallback),[ready,setReady]=useState(false);
  const current=useRef(fallback),edited=useRef(false),hydrated=useRef(false),generation=useRef(0);
  const status=useDeviceStorageStatus();
  const change=useCallback((next:SetStateAction<boolean>)=>{const resolved=typeof next==='function'?next(current.current):next;edited.current=true;generation.current++;current.current=resolved;setValue(resolved);},[]);
  useEffect(()=>{
    let active=true;
    void get<unknown>('settings',key).then(saved=>{if(!active)return;if(!edited.current && typeof saved==='boolean'){current.current=saved;setValue(saved);}hydrated.current=true;setReady(true);});
    const stop=subscribe('settings',key,event=>{if(!event.external || edited.current || typeof event.record?.value!=='boolean')return;current.current=event.record.value;setValue(event.record.value);});
    return()=>{active=false;stop();};
  },[key]);
  useEffect(()=>{if(!ready || !edited.current)return;const stamp=generation.current;void put('settings',key,value).then(()=>{if(stamp===generation.current)edited.current=false;});},[ready,key,value]);
  return [value,change,{ready,error:status.error}];
}
export const readSetting=<T,>(key:string)=>get<T>('settings',key);
export const writeSetting=<T,>(key:string,value:T)=>put('settings',key,value);
