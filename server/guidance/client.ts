import { GuidanceError } from './errors.ts';
import { reserveGuidance } from './budget.ts';
import type { SharedDatabase } from '../shared-tables/index.ts';
export const GUIDANCE_MODEL='claude-sonnet-5-5';
export const GUIDANCE_VERSION='2026-10-21';
export const MAX_PROMPT_BYTES=16*1024;
export const MAX_OUTPUT_TOKENS=1024;
export const MAX_RESPONSE_BYTES=64*1024;
const ORIGIN='https://api.anthropic.com';
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const bytes=(v:string)=>new TextEncoder().encode(v).byteLength;
export interface GuidanceClientOptions {apiKey:string;db:SharedDatabase;fetcher?:typeof fetch;signal?:AbortSignal;timeoutMs?:number;additionalSecrets?:string[];outputSchema?:Record<string,unknown>}
export async function generateGuidance(message:string,system:string,options:GuidanceClientOptions):Promise<string>{
  const {apiKey,db}=options;
  if(typeof apiKey!=='string'||!apiKey||apiKey.length>4096||/[^\x21-\x7e]/.test(apiKey))throw new GuidanceError('unavailable',503);
  let schemaText='';try{if(options.outputSchema)schemaText=JSON.stringify(options.outputSchema);}catch{throw new GuidanceError('invalid_request',400);}
  if(typeof message!=='string'||!message.trim()||typeof system!=='string'||bytes(message)+bytes(system)+bytes(schemaText)>MAX_PROMPT_BYTES)throw new GuidanceError('body_too_large',413);
  if([apiKey,...(options.additionalSecrets||[])].some(secret=>secret&&(message.includes(secret)||system.includes(secret)||schemaText.includes(secret))))throw new GuidanceError('invalid_request',400);
  const fetcher=options.fetcher||((input,init)=>globalThis.fetch(input,init));
  const timeoutMs=options.timeoutMs??10_000;
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>15_000)throw new GuidanceError('unavailable',503);
  const controller=new AbortController();let timedOut=false;
  const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  let rejectAbort!:(error:GuidanceError)=>void;
  const stopped=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const onAbort=()=>rejectAbort(new GuidanceError(timedOut?'timeout':'cancelled',timedOut?504:499));
  controller.signal.addEventListener('abort',onAbort,{once:true});
  let activeReader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  async function request(path:'/v1/organizations/me'|`/v1/models/${typeof GUIDANCE_MODEL}`|'/v1/messages',body?:unknown){
    if(controller.signal.aborted)throw new GuidanceError('cancelled',499);
    const response=await Promise.race([fetcher(new URL(path,ORIGIN),{method:body===undefined?'GET':'POST',redirect:'manual',signal:controller.signal,
      headers:{Authorization:`Bearer ${apiKey}`,'anthropic-version':GUIDANCE_VERSION,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}).then(response=>{if(controller.signal.aborted)void response.body?.cancel().catch(()=>{});return response;}),stopped]);
    if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw new GuidanceError(timedOut?'timeout':'cancelled',timedOut?504:499);}
    if(!response.ok||response.redirected){
      console.warn('Common Table guidance unavailable',{step:path==='/v1/messages'?'generation':path.includes('/models/')?'model':'organization',reason:'upstream_http',status:response.status});
      void response.body?.cancel().catch(()=>{});throw new GuidanceError('upstream_unavailable',502);
    }
    const length=response.headers.get('content-length');if(length&&/^\d+$/.test(length)&&Number(length)>MAX_RESPONSE_BYTES){void response.body?.cancel().catch(()=>{});throw new GuidanceError('invalid_response',502);}
    if(!response.body)throw new GuidanceError('invalid_response',502);
    activeReader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    try{
      for(;;){const part=await Promise.race([activeReader.read(),stopped]);if(part.done)break;size+=part.value.byteLength;if(size>MAX_RESPONSE_BYTES){void activeReader.cancel().catch(()=>{});throw new GuidanceError('invalid_response',502);}chunks.push(part.value);}
      const combined=new Uint8Array(size);let offset=0;chunks.forEach(chunk=>{combined.set(chunk,offset);offset+=chunk.length;});
      try {const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(combined));if(!result||typeof result!=='object'||Array.isArray(result))throw 0;return record(result);}catch{throw new GuidanceError('invalid_response',502);}
    }finally{if(controller.signal.aborted)void activeReader.cancel().catch(()=>{});try{activeReader.releaseLock();}catch{}activeReader=undefined;}
  }
  try{
    if(options.signal?.aborted)abort();
    const org=await request('/v1/organizations/me');
    if(org.type!=='organization'||typeof org.id!=='string'||!/^[\w-]{1,200}$/.test(org.id)||typeof org.name!=='string'||org.name.trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US')!=='startrz')throw new GuidanceError('verification_failed',403);
    if(String(org.name).includes(apiKey)||String(org.id).includes(apiKey))throw new GuidanceError('invalid_response',502);
    const model=await request(`/v1/models/${GUIDANCE_MODEL}`);if(model.id!==GUIDANCE_MODEL)throw new GuidanceError('verification_failed',403);
    if(controller.signal.aborted)throw new GuidanceError('cancelled',499);
    await reserveGuidance(db);
    // The reservation is irrevocable, including unknown network outcomes. There is no retry path.
    if(controller.signal.aborted)throw new GuidanceError(timedOut?'timeout':'cancelled',timedOut?504:499);
    const reply=await request('/v1/messages',{model:GUIDANCE_MODEL,max_tokens:MAX_OUTPUT_TOKENS,thinking:{type:'between_tools'},output_config:{effort:'low',...(options.outputSchema?{format:{type:'json_schema',schema:options.outputSchema}}:{})},service_tier:'standard_only',system,messages:[{role:'user',content:message}]});
    const invalidReply=(reason:'invalid_envelope'|'output_limit'|'unsupported_block'|'invalid_content'):never=>{
      const usage=record(reply.usage);
      console.warn('Common Table guidance unavailable',{step:'generation',reason,outputTokens:Number.isSafeInteger(usage.output_tokens)&&Number(usage.output_tokens)>=0&&Number(usage.output_tokens)<=100_000?usage.output_tokens:undefined});
      throw new GuidanceError('invalid_response',502);
    };
    if(reply.stop_reason==='max_tokens')invalidReply('output_limit');
    if(reply.model!==GUIDANCE_MODEL||reply.type!=='message'||reply.role!=='assistant'||!Array.isArray(reply.content)||!reply.content.length||reply.content.length>30)invalidReply('invalid_envelope');
    const texts:string[]=[];for(const value of reply.content as unknown[]){const block=record(value);if(block.type==='text'&&typeof block.text==='string')texts.push(block.text);else if(block.type!=='thinking'&&block.type!=='redacted_thinking')invalidReply('unsupported_block');}
    const text=texts.join('\n').trim(),usage=record(reply.usage);
    if(!text||text.length>8000||[apiKey,...(options.additionalSecrets||[])].some(key=>key&&text.includes(key))||/sk-ant-[\w-]{10,}/.test(text)||!Number.isSafeInteger(usage.input_tokens)||Number(usage.input_tokens)<0||!Number.isSafeInteger(usage.output_tokens)||Number(usage.output_tokens)<0||Number(usage.output_tokens)>MAX_OUTPUT_TOKENS||(Number(usage.input_tokens)*2+Number(usage.output_tokens)*10)>50_000)invalidReply('invalid_content');
    // UI prose stays in the voice of the companion, including when a question asks about infrastructure.
    return text.replace(/\b(?:Claude|Anthropic|Sonnet(?:\s*5\.5)?|Haiku)\b/gi,'The Waiter').replace(/\bQloo\b/gi,'restaurant discovery').replace(/\bAPIs?\b/gi,word=>word.toLowerCase().endsWith('s')?'services':'service');
  }catch(error){if(timedOut)throw new GuidanceError('timeout',504);if(options.signal?.aborted)throw options.signal.reason instanceof GuidanceError?options.signal.reason:new GuidanceError('cancelled',499);if(error instanceof GuidanceError)throw error;throw new GuidanceError('upstream_unavailable',502);}
  finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',onAbort);if(controller.signal.aborted)void activeReader?.cancel().catch(()=>{});}
}
