import type {ServiceContext} from './services.ts';
import {handleGuidance} from './guidance/index.ts';
import {handleRecommendations} from './recommendations/handler.ts';

const reply=(status:number,code:string)=>Response.json({code},{status,headers:{'Cache-Control':'no-store'}});
const digest=async(text:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
/** Temporary machine capability. No visitor identity, shared records or arbitrary prompts are accepted. */
export async function handleVerification(request:Request,context:ServiceContext):Promise<Response>{
  let config:{token:string;expiresAt:number};
  try{config=JSON.parse(context.verificationSecret??'');}catch{return reply(404,'not_found');}
  if(!config||!/^([a-f0-9]{64})$/.test(config.token)||!Number.isFinite(config.expiresAt)||config.expiresAt<=Date.now())return reply(404,'not_found');
  const url=new URL(request.url);
  if(request.method!=='POST'||url.search||request.headers.get('origin')!==url.origin||request.headers.get('x-common-table-request')!=='verification')return reply(403,'forbidden');
  const authorization=request.headers.get('authorization')??'';
  if(!/^Bearer [a-f0-9]{64}$/.test(authorization))return reply(401,'authentication_required');
  const supplied=authorization.slice(7);
  const left=await digest(supplied),right=await digest(config.token);let mismatch=0;for(let i=0;i<left.length;i++)mismatch|=left[i]^right[i];
  if(mismatch)return reply(401,'authentication_required');
  if(!context.db||!context.apiKey||!context.ownerEmail)return reply(503,'unavailable');
  if(request.headers.get('content-type')!=='application/json'||request.headers.has('content-encoding'))return reply(415,'invalid_request');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
  let operation:unknown;
  try{
    const reader=request.body?.getReader();if(!reader)return reply(400,'invalid_request');let value='';
    const abort=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',abort,{once:true});
    try{for(;;){const part=await reader.read();if(controller.signal.aborted)return reply(408,'timeout');if(part.done)break;value+=new TextDecoder().decode(part.value);if(value.length>100)return reply(413,'invalid_request');}operation=JSON.parse(value);}
    finally{controller.signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
  }catch{return reply(400,'invalid_request');}finally{clearTimeout(timer);}
  if(!operation||typeof operation!=='object'||Array.isArray(operation)||Object.keys(operation).length!==1||!('operation'in operation)||typeof operation.operation!=='string'||!['enable','waiter','recommendations'].includes(operation.operation))return reply(400,'invalid_request');
  const action=String(operation.operation);
  // One explicit verification per operation and secret. The normal global $5
  // ledger is still the only authority for any paid request below.
  const scope=[...await digest(config.token)].map(v=>v.toString(16).padStart(2,'0')).join('');
  const receipt=await context.db.prepare('INSERT INTO service_quotas(scope,window_start,count) VALUES(?,0,1) ON CONFLICT(scope,window_start) DO NOTHING RETURNING count').bind(`verification:${scope}:${action}`).first();
  if(!receipt)return reply(429,'verification_already_run');
  const identity={userId:'service-verification',displayName:'Service verification',email:context.ownerEmail};
  const options={...context,identity};
  const headers={'Content-Type':'application/json',Origin:url.origin,'X-Common-Table-Request':action==='recommendations'?'recommendations':'waiter'};
  const path=action==='enable'?'/api/waiter/enable':action==='waiter'?'/api/waiter/reply':'/api/recommendations';
  const body=action==='enable'?{}:action==='waiter'?{message:'What can you verify about this mapped restaurant, and what should I confirm before choosing it?',context:{view:'table',mode:'book',venueId:'osm:node:5521624421',participantCount:1,budget:65,restrictions:[],tastes:['Italian','Seasonal'],planSaved:false}}:{latitude:40.69,longitude:-73.98,participants:[{tastes:['Italian'],budget:65,restrictions:[]}],vetoes:[]};
  const delegated=new Request(url.origin+path,{method:'POST',headers,body:JSON.stringify(body),signal:request.signal});
  return action==='recommendations'?handleRecommendations(delegated,options):handleGuidance(delegated,options);
}
