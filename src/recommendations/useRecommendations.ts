import { useEffect, useRef, useState, type Dispatch } from 'react';
import { sanitizeVenueSnapshot } from '../domain/catalog';
import type { AppAction, AppState, Venue } from '../domain/types';
export interface DiscoveryLocation {latitude:number;longitude:number;label?:string}
export type DiscoveryStatus='idle'|'loading'|'ready'|'unavailable'|'error';
interface DiscoveryOptions {
  state:AppState;dispatch:Dispatch<AppAction>;location:DiscoveryLocation;
  /** Root may supply authenticated same-origin transport. No credentials are persisted here. */
  fetcher?:typeof fetch;
}
export function useRecommendations({state,dispatch,location,fetcher=fetch}:DiscoveryOptions) {
  const [status,setStatus]=useState<DiscoveryStatus>('idle');
  const [message,setMessage]=useState('');
  const [lastQuery,setLastQuery]=useState('');
  const controller=useRef<AbortController|null>(null);
  const mounted=useRef(true);
  const query=JSON.stringify({latitude:location.latitude,longitude:location.longitude,participants:state.participants.map(({tastes,budget,restrictions})=>({tastes,budget,restrictions})),vetoes:state.vetoes,seedVenueIds:state.shortlist.filter(id=>id.startsWith('qloo:'))});
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
  useEffect(()=>{if(controller.current){controller.current.abort();controller.current=null;setStatus('idle');setMessage('The table changed. Refresh to find places for the latest preferences.');}},[query]);
  async function refresh() {
    if(controller.current)return;
    const operation=new AbortController();controller.current=operation;const snapshot=query;
    setStatus('loading');setMessage('Finding a little common ground…');
    try {
      const response=await fetcher('/api/recommendations',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Common-Table-Request':'recommendations'},body:snapshot,signal:operation.signal});
      const payload=await response.json();
      if(operation.signal.aborted||!mounted.current)return;
      if(!response.ok){setStatus(response.status===503?'unavailable':'error');setMessage(response.status===401?'Sign in to find real places for your table.':response.status===503?'Restaurant discovery is not available yet. Your saved plans are still here.':response.status===429?'Discovery is busy. Please try again later.':response.status===422?'Try a cuisine such as Italian or Japanese so we can match your tastes.':'We couldn’t find places right now. Please try again.');return;}
      if(!payload||!Array.isArray(payload.venues)||payload.venues.length>30||!Array.isArray(payload.orderedIds)||payload.orderedIds.length>30||typeof payload.retrievedAt!=='string'||!Number.isFinite(Date.parse(payload.retrievedAt)))throw new Error('Invalid discovery response');
      const venues=payload.venues.map(sanitizeVenueSnapshot).filter((v:Venue|undefined):v is Venue=>Boolean(v)&&v!.source==='qloo');
      if(venues.length!==payload.venues.length||!payload.orderedIds.every((id:unknown)=>typeof id==='string'&&venues.some((v:Venue)=>v.id===id)))throw new Error('Incomplete restaurant details');
      dispatch({type:'receive-recommendations',venues,orderedIds:payload.orderedIds,retrievedAt:payload.retrievedAt});
      setLastQuery(snapshot);setStatus('ready');setMessage(venues.length?`${venues.length} real places to explore. Confirm menu, cost and dietary needs before agreeing.`:'No places matched this search. Adjust your tastes or choose another area.');
    } catch {if(!operation.signal.aborted&&mounted.current){setStatus('error');setMessage('Discovery couldn’t connect. Your current table and plan are safe.');}}
    finally {if(controller.current===operation)controller.current=null;}
  }
  function cancel(){controller.current?.abort();controller.current=null;setStatus('idle');setMessage('Search cancelled. Your current plan is unchanged.');}
  return {status,message,refresh,cancel,needsRefresh:Boolean(lastQuery&&lastQuery!==query),hasResults:state.recommendationIds!==undefined};
}
