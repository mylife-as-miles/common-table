import type { SharedDatabase } from '../shared-tables/index.ts';
import { GuidanceError } from './errors.ts';
import { readBudget, initializeBudget, MAX_ATTEMPTS } from './budget.ts';
import { generateGuidance } from './client.ts';
import { parseGuidanceContext, buildGuidanceSystem } from './context.ts';
export interface GuidanceOptions {apiKey?:string;db?:SharedDatabase|null;identity:{userId:string;displayName:string;email?:string}|null;ownerEmail?:string;qlooApiKey?:string;fetcher?:typeof fetch;timeoutMs?:number}
const json=(payload:unknown,status=200,headers:Record<string,string>={})=>Response.json(payload,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin',...headers}});
const record=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const email=(v:unknown)=>typeof v==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())?v.trim().toLowerCase():'';
function enforceOrigin(request:Request,required:boolean){
  const expected=new URL(request.url).origin,origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  if((required&&origin===null)||(origin!==null&&origin!==expected)||(site!==null&&site!=='same-origin'&&site!=='none')||request.headers.get('sec-fetch-mode')==='navigate')throw new GuidanceError('origin_rejected',403);
  if(required&&request.headers.get('x-common-table-request')!=='waiter')throw new GuidanceError('csrf_rejected',403);
}
async function body(request:Request,signal:AbortSignal):Promise<Record<string,unknown>>{
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(request.headers.get('content-type')||'')||request.headers.has('content-encoding'))throw new GuidanceError('unsupported_media_type',415);
  const declared=request.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>4096))throw new GuidanceError('body_too_large',413);
  const reader=request.body?.getReader();if(!reader)throw new GuidanceError('invalid_request',400);
  let rejectAbort!:(error:GuidanceError)=>void;const stopped=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const abort=()=>{void reader.cancel().catch(()=>{});rejectAbort(signal.reason instanceof GuidanceError?signal.reason:new GuidanceError('cancelled',499));};signal.addEventListener('abort',abort,{once:true});
  const chunks:Uint8Array[]=[];let size=0;
  try{
    if(signal.aborted)throw signal.reason instanceof GuidanceError?signal.reason:new GuidanceError('cancelled',499);
    for(;;){const part=await Promise.race([reader.read(),stopped]);if(signal.aborted)throw signal.reason instanceof GuidanceError?signal.reason:new GuidanceError('cancelled',499);if(part.done)break;size+=part.value.byteLength;if(size>4096){void reader.cancel().catch(()=>{});throw new GuidanceError('body_too_large',413);}chunks.push(part.value);}
    const combined=new Uint8Array(size);let offset=0;chunks.forEach(chunk=>{combined.set(chunk,offset);offset+=chunk.length;});
    try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(combined));if(!record(value))throw 0;return value;}catch{throw new GuidanceError('invalid_request',400);}
  }finally{signal.removeEventListener('abort',abort);try{reader.releaseLock();}catch{}}
}
/** Identity is supplied by the authenticated server wrapper, never by request headers or JSON. */
export async function handleGuidance(request:Request,options:GuidanceOptions):Promise<Response>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const url=new URL(request.url),isStatus=url.pathname==='/api/waiter/status',isEnable=url.pathname==='/api/waiter/enable';
    if(!isStatus&&!isEnable&&url.pathname!=='/api/waiter/reply')throw new GuidanceError('not_found',404);
    if(url.search||url.hash)throw new GuidanceError('invalid_request',400);
    if(request.method!==(isStatus?'GET':'POST'))return json({code:'method_not_allowed',message:'Use the supported action for this route.'},405,{Allow:isStatus?'GET':'POST'});
    enforceOrigin(request,!isStatus);
    const configured=Boolean(options.apiKey?.trim()&&options.db&&email(options.ownerEmail));
    const owner=Boolean(options.identity&&email(options.identity.email)&&email(options.identity.email)===email(options.ownerEmail));
    if(isStatus){
      if(!configured)return json({mode:'disabled',canEnable:false});
      if(!options.identity)return json({mode:'sign_in',canEnable:false});
      if(!owner)return json({mode:'disabled',canEnable:false});
      const state=await readBudget(options.db!);return json({mode:state.initialized&&state.attempts<MAX_ATTEMPTS?'live':'disabled',canEnable:!state.initialized});
    }
    if(!options.identity)throw new GuidanceError('authentication_required',401);
    if(!configured)throw new GuidanceError('unavailable',503);
    if(!owner)throw new GuidanceError('forbidden',403);
    const controller=new AbortController();const abort=()=>controller.abort(new GuidanceError('cancelled',499));request.signal.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>controller.abort(new GuidanceError('timeout',504)),25_000);if(request.signal.aborted)abort();
    try{
      const value=await body(request,controller.signal);
      if(isEnable){if(Object.keys(value).length)throw new GuidanceError('invalid_request',400);const state=await initializeBudget(options.db!);return json({enabled:true,mode:state.attempts<MAX_ATTEMPTS?'live':'disabled'});}
      if(Object.keys(value).length!==2||typeof value.message!=='string'||!value.message.trim()||value.message.length>600||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.message)||/sk-ant-[\w-]{10,}/.test(value.message)||[options.apiKey,options.qlooApiKey].some(secret=>secret&&String(value.message).includes(secret)))throw new GuidanceError('invalid_request',400);
      const context=parseGuidanceContext(value.context);
      const budget=await readBudget(options.db!);if(!budget.initialized)throw new GuidanceError('budget_unavailable',503);if(budget.attempts>=MAX_ATTEMPTS)throw new GuidanceError('budget_exhausted',429);
      const system=await buildGuidanceSystem(context,{db:options.db!,userId:options.identity.userId,qlooApiKey:options.qlooApiKey,fetcher:options.fetcher,signal:controller.signal});
      let message=value.message.trim();
      // Explicitly known personal fields are never forwarded even if pasted into the question.
      for(const personal of [options.identity.displayName,options.identity.email].filter((s):s is string=>Boolean(s&&s.length>2)))message=message.split(personal).join('[private detail]');
      const text=await generateGuidance(message,system,{apiKey:options.apiKey!,db:options.db!,fetcher:options.fetcher,signal:controller.signal,timeoutMs:options.timeoutMs,additionalSecrets:options.qlooApiKey?[options.qlooApiKey]:[]});
      return json({source:'live',text});
    }finally{request.signal.removeEventListener('abort',abort);}
  }catch(error){const safe=error instanceof GuidanceError?error:new GuidanceError('unavailable',503);return json({code:safe.code,message:safe.message},safe.status);}
  finally{if(timer)clearTimeout(timer);}
}
