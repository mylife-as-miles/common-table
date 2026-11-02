export interface HydratingState<S,A>{value:S;ready:boolean;pending:A[];sequence:number}
export type HydrationEvent<S,A>={kind:'action';action:A}|{kind:'hydrate';value:S}|{kind:'replace';value:S};
/** Pure replay is important: React may evaluate reducers twice in development. */
export function hydrationReducer<S,A>(reduce:(state:S,action:A)=>S){
  return (current:HydratingState<S,A>,event:HydrationEvent<S,A>):HydratingState<S,A>=>{
    if(event.kind==='action')return {value:reduce(current.value,event.action),ready:current.ready,pending:current.ready?[]:[...current.pending,event.action],sequence:current.sequence+1};
    if(event.kind==='replace')return {...current,value:event.value,ready:true,pending:[]};
    if(current.ready)return current;
    return {...current,value:current.pending.reduce(reduce,event.value),ready:true,pending:[]};
  };
}
/** Recognize the established app envelope without restricting future additive fields. */
export function isSerializedAppSnapshot(raw:unknown):raw is string {
  if(typeof raw!=='string')return false;
  try{
    const parsed=JSON.parse(raw),state=parsed?.state??parsed;
    if(!state || typeof state!=='object' || (parsed.version!==undefined && parsed.version!==1))return false;
    return Array.isArray(state.participants) && state.participants.length>0 && state.participants.every((p:Record<string,unknown>)=>p && typeof p.id==='string' && typeof p.name==='string' && typeof p.budget==='number' && Number.isFinite(p.budget) && Array.isArray(p.tastes) && Array.isArray(p.restrictions)) && Array.isArray(state.shortlist) && Array.isArray(state.vetoes) && typeof state.selectedVenueId==='string' && state.plan && typeof state.plan==='object' && typeof state.plan.date==='string' && typeof state.plan.time==='string' && typeof state.plan.note==='string';
  }catch{return false;}
}
