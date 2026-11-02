import { RecommendationError, retrieveRecommendations, validateRecommendationInput, type RecommendationOptions } from './client.ts';
export { resolveVenue } from './client.ts';
/** Caller supplies authenticated request scope/rate limit and server-only environment secret. */
export async function handleRecommendations(request:Request, options:RecommendationOptions):Promise<Response> {
  const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  if(request.method!=='POST')return json({error:{code:'method_not_allowed',message:'Use restaurant discovery from your table.'}},405);
  if(Number(request.headers.get('content-length'))>24_000)return json({error:{code:'invalid_request',message:'The table details are too large.'}},413);
  try {
    const reader=request.body?.getReader();let bytes=0;const chunks:Uint8Array[]=[];
    let rejectStopped!:(error:RecommendationError)=>void;
    const stopped=new Promise<never>((_,reject)=>{rejectStopped=reject;});
    const cancel=()=>{void reader?.cancel().catch(()=>{});rejectStopped(new RecommendationError('invalid_request',request.signal.aborted?499:408,'The table request was interrupted. Try again when you’re ready.'));};
    const bodyTimer=setTimeout(cancel,6000);request.signal.addEventListener('abort',cancel,{once:true});
    try{
      if(request.signal.aborted)cancel();
      if(reader)for(;;){const part=await Promise.race([reader.read(),stopped]);if(part.done)break;bytes+=part.value.length;if(bytes>24_000){void reader.cancel().catch(()=>{});return json({error:{code:'invalid_request',message:'The table details are too large.'}},413);}chunks.push(part.value);}
    }finally{clearTimeout(bodyTimer);request.signal.removeEventListener('abort',cancel);try{reader?.releaseLock();}catch{}}
    const combined=new Uint8Array(bytes);let offset=0;chunks.forEach(chunk=>{combined.set(chunk,offset);offset+=chunk.length;});
    const body=new TextDecoder().decode(combined);
    let value:unknown;try{value=JSON.parse(body);}catch{throw new RecommendationError('invalid_request',400,'Check the table details and try again.');}
    const input=validateRecommendationInput(value);
    return json(await retrieveRecommendations(input,{...options,signal:AbortSignal.any([request.signal,...(options.signal?[options.signal]:[]),AbortSignal.timeout(18_000)])}));
  } catch(error) {
    return error instanceof RecommendationError ? json({error:{code:error.code,message:error.message}},error.status) : json({error:{code:'upstream_unavailable',message:'Restaurant discovery is temporarily unavailable.'}},502);
  }
}
