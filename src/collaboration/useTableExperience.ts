import {useEffect,useMemo,useRef,useState} from 'react';
import {getVenue,rankVenues,reducer,useCommonTable,venues,type AppAction} from '../domain';
import {getRecord,put,deleteValue,StorageConflictError} from '../storage';
import {sanitizeVenueSnapshot} from '../domain/catalog';
import {useSharedTable} from './useSharedTable';
import {snapshotToAppState} from './projection';
import {canEditSharedPlan,type SharedPlan,type SharedPreferences} from './types';

export interface EditorDraft {version:number;preferences?:SharedPreferences;plan?:SharedPlan}
/** A device draft cannot supply saved/approved claims or malformed preference data. */
export function parseEditorDraft(value:unknown):EditorDraft|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const draft=value as EditorDraft;
  if(!Number.isSafeInteger(draft.version)||draft.version<1||(!draft.preferences&&!draft.plan))return null;
  let preferences:SharedPreferences|undefined,plan:SharedPlan|undefined;
  if(draft.preferences){
    const p=draft.preferences;
    const labels=(v:unknown,n:number):v is string[]=>Array.isArray(v)&&v.length<=n&&v.every(x=>typeof x==='string'&&x.length<=40);
    if(!Number.isFinite(p.budget)||p.budget<1||p.budget>1000||!labels(p.tastes,16)||!labels(p.restrictions,12))return null;
    preferences={budget:p.budget,tastes:[...p.tastes],restrictions:[...p.restrictions]};
  }
  if(draft.plan){
    const p=draft.plan;
    if(typeof p.date!=='string'||p.date.length>10||typeof p.time!=='string'||p.time.length>5||typeof p.note!=='string'||p.note.length>1000||(p.detailsAcknowledged!==undefined&&typeof p.detailsAcknowledged!=='boolean'))return null;
    const venueSnapshot=p.venueId===null?null:sanitizeVenueSnapshot(p.venueSnapshot);
    if(p.venueId!==null&&(!venueSnapshot||venueSnapshot.id!==p.venueId))return null;
    plan={venueId:p.venueId,venueSnapshot:venueSnapshot??null,date:p.date,time:p.time,note:p.note,saved:false,detailsAcknowledged:p.detailsAcknowledged};
  }
  return {version:draft.version,...(preferences?{preferences}:{}),...(plan?{plan}:{})};
}
/** Server snapshots are authoritative. Unsubmitted form edits remain explicit device drafts. */
export function useTableExperience(){
  const local=useCommonTable(),shared=useSharedTable();
  const [draft,setDraft]=useState<EditorDraft|null>(null),[draftReady,setDraftReady]=useState(false);
  const [reviewedVersion,setReviewedVersion]=useState<number|null>(null),[applying,setApplying]=useState(false);
  const [storageError,setStorageError]=useState<string|null>(null);
  const key=shared.table?`shared-editor:v1:${shared.table.viewerId}:${shared.table.id}`:null;
  const edited=useRef(false),generation=useRef(0),applyingRef=useRef(false);
  const loadedKey=useRef<string|null>(null),activeKey=useRef(key),revisions=useRef(new Map<string,number>()),blockedKeys=useRef(new Set<string>()),writes=useRef<Promise<unknown>>(Promise.resolve());
  activeKey.current=key;
  const reviewed=Boolean(shared.table&&reviewedVersion===shared.table.version);
  const setReviewed=(value:boolean)=>setReviewedVersion(value&&shared.table?shared.table.version:null);
  useEffect(()=>{
    generation.current++;loadedKey.current=null;edited.current=false;setDraft(null);setDraftReady(false);setReviewed(false);setStorageError(null);
    if(!key)return;
    let active=true;
    void writes.current.then(()=>getRecord<EditorDraft>('app',key)).then(saved=>{
      if(!active)return;
      revisions.current.set(key,saved?.revision??0);
      if(!edited.current&&saved){const parsed=parseEditorDraft(saved.value);if(parsed)setDraft(parsed);else{blockedKeys.current.add(key);setStorageError('The stored draft could not be read. It has been preserved; the shared table is unchanged.');}}
      loadedKey.current=key;setDraftReady(true);
    }).catch(()=>{if(active){loadedKey.current=key;setDraftReady(true);setStorageError('This device draft could not be loaded. New edits remain in this session.');}});
    return()=>{active=false;};
  },[key]);
  useEffect(()=>{
    // On a key switch the old draft still exists for one render. Never write it
    // into the new table/account before that key has completed hydration.
    if(!key||loadedKey.current!==key||!draftReady||!edited.current)return;
    const captured=draft;
    writes.current=writes.current.then(async()=>{
      if(blockedKeys.current.has(key))return;
      try{
        const expectedRevision=revisions.current.get(key)??0;
        if(captured){const record=await put('app',key,captured,{expectedRevision});revisions.current.set(key,record.revision);}
        else{await deleteValue('app',key,{expectedRevision});revisions.current.set(key,0);}
      }catch(failure){blockedKeys.current.add(key);if(activeKey.current===key)setStorageError(failure instanceof StorageConflictError?'Another tab changed this device draft. Your current edits remain in memory and the other stored copy is preserved.':'This device draft could not be saved. Your edits remain in this session.');}
    }).catch(()=>undefined);
  },[key,draftReady,draft]);
  const baseline=shared.table?snapshotToAppState(shared.table,local.state):local.state;
  const state=useMemo(()=>{
    if(!shared.table||!draft||loadedKey.current!==key)return baseline;
    const plan=draft.plan;
    return {...baseline,
      participants:draft.preferences?baseline.participants.map(p=>p.id==='you'?{...p,...draft.preferences}:p):baseline.participants,
      plan:plan?{...baseline.plan,...plan,approvals:[],saved:false}:draft.preferences?{...baseline.plan,approvals:[],saved:false}:baseline.plan};
  },[baseline,draft,shared.table,key]);
  function dispatch(action:AppAction){
    const table=shared.table;
    if(!table){local.dispatch(action);return;}
    if(action.type==='update-plan'||action.type==='acknowledge-details'||action.type==='update-participant'){
      if(action.type==='update-participant'&&action.id!=='you')return;
      if(action.type!=='update-participant'&&!canEditSharedPlan(table))return;
      const next=reducer(state,action);edited.current=true;generation.current++;setReviewed(false);
      setDraft(current=>({...current,version:current?.version??table.version,
        ...(action.type==='update-participant'?{preferences:{tastes:next.participants[0].tastes,budget:next.participants[0].budget,restrictions:next.participants[0].restrictions}}:{plan:{venueId:next.plan.venueId,venueSnapshot:getVenue(next,next.plan.venueId)??null,date:next.plan.date,time:next.plan.time,note:next.plan.note,saved:false,detailsAcknowledged:next.plan.detailsAcknowledged}})}));return;
    }
    if(action.type==='choose-plan'){
      if(!canEditSharedPlan(table)||draft||applyingRef.current)return;
      const next=reducer(state,action);
      if(next.plan.venueId!==action.venueId||next.plan.venueId===table.plan.venueId)return;
      void shared.updatePlan({venueId:next.plan.venueId,venueSnapshot:getVenue(next,next.plan.venueId)??null,date:next.plan.date,time:next.plan.time,note:next.plan.note,saved:false});return;
    }
    if(action.type==='toggle-approval'){if(action.participantId==='you'&&!draft&&!applyingRef.current)void shared.approve(!state.plan.approvals.includes('you'));return;}
    if(action.type==='save-plan'){if(!draft&&!applyingRef.current&&canEditSharedPlan(table))void shared.save();return;}
    if(['add-participant','remove-participant','reset'].includes(action.type))return;
    local.dispatch(action);
  }
  const draftConflict=Boolean(draft&&shared.table&&draft.version!==shared.table.version);
  async function applyDraft(){
    if(!draft||!shared.table||applyingRef.current||(draftConflict&&!reviewed))return;
    applyingRef.current=true;edited.current=true;setApplying(true);const at=generation.current,captured=draft,capturedKey=key;
    const stillCurrent=()=>generation.current===at&&activeKey.current===capturedKey;
    try{
      let nextVersion=shared.table.version;
      if(captured.preferences){const confirmed=await shared.updatePreferences(captured.preferences,nextVersion);if(!confirmed||!stillCurrent())return;nextVersion=confirmed.version;if(captured.plan)setDraft({version:nextVersion,plan:captured.plan});}
      if(captured.plan){if(!stillCurrent()||!await shared.updatePlan(captured.plan,nextVersion))return;}
      if(stillCurrent()){edited.current=true;setDraft(null);setReviewed(false);}
    }finally{applyingRef.current=false;setApplying(false);}
  }
  function discardDraft(){generation.current++;edited.current=true;setDraft(null);setReviewed(false);}
  const ranked=useMemo(()=>rankVenues(state),[state]);
  return {...local,state,dispatch,ranked,selectedVenue:getVenue(state,state.selectedVenueId)??venues[0],shared,editor:{draft,draftReady,draftConflict,reviewed,setReviewed,applying,applyDraft,discardDraft,storageError}};
}
