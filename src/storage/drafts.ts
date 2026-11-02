import {get,put,deleteValue} from './index';
export interface OfflineDraft<T>{schema:1;tableId:string;userId:string;baseRevision:number;updatedAt:number;value:T}
const key=(tableId:string,userId:string)=>`shared-draft:v1:${encodeURIComponent(userId)}:${encodeURIComponent(tableId)}`;
export async function loadDraft<T>(tableId:string,userId:string):Promise<OfflineDraft<T>|undefined>{
  const draft=await get<OfflineDraft<T>>('app',key(tableId,userId));
  return draft?.schema===1 && draft.tableId===tableId && draft.userId===userId && Number.isSafeInteger(draft.baseRevision) ? draft : undefined;
}
/** Only a local draft; replay requires the caller's explicit authenticated action. */
export async function saveDraft<T>(tableId:string,userId:string,value:T,baseRevision:number):Promise<OfflineDraft<T>>{
  const draft:OfflineDraft<T>={schema:1,tableId,userId,baseRevision,updatedAt:Date.now(),value};await put('app',key(tableId,userId),draft);return draft;
}
export async function removeDraft(tableId:string,userId:string){await deleteValue('app',key(tableId,userId));}
