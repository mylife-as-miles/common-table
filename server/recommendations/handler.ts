import { RecommendationError, retrieveRecommendations, validateRecommendationInput, type RecommendationOptions } from './client.ts';
import { GuidanceError } from '../guidance/errors.ts';
import { readBudget, MAX_ATTEMPTS } from '../guidance/budget.ts';
export { resolveVenue } from './client.ts';
export interface RecommendationRequestOptions extends RecommendationOptions {identity?:{userId:string;displayName:string;email?:string}|null;ownerEmail?:string}
const email=(v:unknown)=>typeof v==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())?v.trim().toLowerCase():'';
/** Authenticated owner only: semantic retrieval/ranking shares the already authorized immutable test allowance. */
export async function handleRecommendations(request:Request,options:RecommendationRequestOptions):Promise<Response>{
  const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'}});
  if(request.method!=='POST')return json({error:{code:'method_not_allowed',message:'Use restaurant discovery from your table.'}},405);
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const url=new URL(request.url);
    if(url.search||url.hash)throw new RecommendationError('invalid_request',400,'Check the discovery request.');
    if(request.headers.get('origin')!==url.origin||request.headers.get('x-common-table-request')!=='recommendations'||(request.headers.get('sec-fetch-site')!==null&&!['same-origin','none'].includes(request.headers.get('sec-fetch-site')!))||request.headers.get('sec-fetch-mode')==='navigate')return json({error:{code:'forbidden',message:'Open this action from Common Table.'}},403);
    if(!options.identity)return json({error:{code:'authentication_required',message:'Sign in to find real places for your table.'}},401);
    if(!options.apiKey?.trim()||!options.db||!email(options.ownerEmail))throw new RecommendationError('unavailable',503,'Restaurant discovery is not available yet. Your saved plan is still here.');
    if(!email(options.identity.email)||email(options.identity.email)!==email(options.ownerEmail))return json({error:{code:'forbidden',message:'Discovery is not enabled for this account.'}},403);
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(request.headers.get('content-type')||'')||request.headers.has('content-encoding'))return json({error:{code:'invalid_request',message:'Use an uncompressed JSON request.'}},415);
    const declared=request.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>24_000))throw new RecommendationError('invalid_request',413,'The table details are too large.');
    const reader=request.body?.getReader();if(!reader)throw new RecommendationError('invalid_request',400,'Check the table details.');
    let rejectStopped!:(error:RecommendationError)=>void;const stopped=new Promise<never>((_,reject)=>{rejectStopped=reject;});void stopped.catch(()=>{});
    let bodyInterrupted:RecommendationError|undefined;
    const cancel=()=>{bodyInterrupted=new RecommendationError('cancelled',request.signal.aborted?499:408,'The table request was interrupted. Try again when you’re ready.');void reader.cancel().catch(()=>{});rejectStopped(bodyInterrupted);};
    const bodyTimer=setTimeout(cancel,6000);request.signal.addEventListener('abort',cancel,{once:true});
    const chunks:Uint8Array[]=[];let bytes=0;
    try{if(request.signal.aborted)throw new RecommendationError('cancelled',499,'The table request was cancelled.');for(;;){const part=await Promise.race([reader.read(),stopped]);if(bodyInterrupted)throw bodyInterrupted;if(request.signal.aborted)throw new RecommendationError('cancelled',499,'The table request was cancelled.');if(part.done)break;bytes+=part.value.byteLength;if(bytes>24_000){void reader.cancel().catch(()=>{});throw new RecommendationError('invalid_request',413,'The table details are too large.');}chunks.push(part.value);}}
    finally{clearTimeout(bodyTimer);request.signal.removeEventListener('abort',cancel);try{reader.releaseLock();}catch{}}
    const combined=new Uint8Array(bytes);let offset=0;chunks.forEach(chunk=>{combined.set(chunk,offset);offset+=chunk.length;});
    let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(combined));}catch{throw new RecommendationError('invalid_request',400,'Check the table details and try again.');}
    const input=validateRecommendationInput(value),budget=await readBudget(options.db);
    if(!budget.initialized)throw new GuidanceError('budget_unavailable',503);if(budget.attempts>=MAX_ATTEMPTS)throw new GuidanceError('budget_exhausted',429);
    const controller=new AbortController();timer=setTimeout(()=>controller.abort(),36_000);
    const signal=AbortSignal.any([request.signal,controller.signal,...(options.signal?[options.signal]:[])]);
    return json(await retrieveRecommendations(input,{...options,signal}));
  }catch(error){
    if(error instanceof RecommendationError||error instanceof GuidanceError)return json({error:{code:error.code,message:error.message}},error.status);
    return json({error:{code:'upstream_unavailable',message:'Restaurant discovery is temporarily unavailable.'}},502);
  }finally{if(timer)clearTimeout(timer);}
}
