import { QLOO_ID, safePublicUrl, sanitizeVenueSnapshot } from '../../src/domain/catalog.ts';
import type { Venue } from '../../src/domain/types.ts';

// Official current contracts: https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md
// /v2/tags resolves actual taste URNs; /v2/insights/ returns geo-constrained Places; /entities revalidates a place.
const ORIGIN = 'https://api.qloo.com';
const RESTAURANT_TAG = 'urn:tag:genre:place:restaurant';
const MAX_RESPONSE_BYTES = 1_000_000;
export class RecommendationError extends Error {
  constructor(readonly code: 'unavailable'|'invalid_request'|'upstream_unavailable'|'invalid_response'|'no_taste_match'|'timeout'|'cancelled', readonly status:number, message:string) { super(message); }
}
export interface RecommendationInput {
  latitude:number; longitude:number;
  participants: { tastes:string[]; budget:number; restrictions:string[] }[];
  vetoes:string[]; seedVenueIds?:string[];
}
export interface RecommendationResult { venues:Venue[]; orderedIds:string[]; retrievedAt:string; source:'qloo'; unresolvedTastes:string[]; }
export interface RecommendationOptions { apiKey?:string; fetcher?:typeof fetch; now?:()=>Date; signal?:AbortSignal; timeoutMs?:number; }
const object = (v:unknown):Record<string,unknown> => v && typeof v==='object' && !Array.isArray(v) ? v as Record<string,unknown> : {};
const text = (v:unknown, max=160) => typeof v==='string' ? v.trim().slice(0,max) : '';
const rawId = (v:string) => v.replace(/^qloo:/i,'').toLowerCase();
const realIds = (ids:string[]) => [...new Set(ids.map(rawId).filter(id=>QLOO_ID.test(id)))].slice(0,40);
export function validateRecommendationInput(value:unknown):RecommendationInput {
  const v=object(value);
  if (typeof v.latitude!=='number' || !Number.isFinite(v.latitude) || Math.abs(v.latitude)>90 || typeof v.longitude!=='number' || !Number.isFinite(v.longitude) || Math.abs(v.longitude)>180 || !Array.isArray(v.participants) || v.participants.length<1 || v.participants.length>6) throw new RecommendationError('invalid_request',400,'Choose a location and add your table’s tastes first.');
  const labels=(x:unknown):x is string[] => Array.isArray(x) && x.length<=30 && x.every(s=>typeof s==='string' && s.trim().length>0 && s.length<=80);
  const participants=v.participants.map(p=>{
    const person=object(p);
    if (!labels(person.tastes) || !labels(person.restrictions) || typeof person.budget!=='number' || !Number.isFinite(person.budget) || person.budget<1 || person.budget>1000) throw new RecommendationError('invalid_request',400,'Check the table’s tastes, budget and dietary needs.');
    return {tastes:person.tastes,restrictions:person.restrictions,budget:person.budget};
  });
  const ids=(x:unknown):string[] => x===undefined ? [] : Array.isArray(x) && x.length<=80 && x.every(i=>typeof i==='string' && i.length<=100) ? x : (()=>{throw new RecommendationError('invalid_request',400,'Check the selected places.');})();
  return {latitude:v.latitude,longitude:v.longitude,participants,vetoes:ids(v.vetoes),seedVenueIds:ids(v.seedVenueIds)};
}
async function request(path:string, params:Record<string,string>, opts:RecommendationOptions):Promise<Record<string,unknown>> {
  if (!opts.apiKey?.trim()) throw new RecommendationError('unavailable',503,'Restaurant discovery is not available yet. Your saved plan is still here.');
  const url=new URL(path,ORIGIN); Object.entries(params).forEach(([key,value])=>url.searchParams.set(key,value));
  const timeoutMs=opts.timeoutMs??9000;
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>15_000)throw new RecommendationError('unavailable',503,'Restaurant discovery is temporarily unavailable.');
  // Bind the platform receiver at request time; Worker fetch shims may be request scoped.
  const fetcher=opts.fetcher??((input,init)=>globalThis.fetch(input,init));
  const controller=new AbortController();let timedOut=false;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const stoppedError=()=>new RecommendationError(timedOut?'timeout':'cancelled',timedOut?504:499,timedOut?'Restaurant discovery took too long. Try again when you’re ready.':'Restaurant discovery was cancelled.');
  let rejectStopped!:(error:RecommendationError)=>void;
  const stopped=new Promise<never>((_,reject)=>{rejectStopped=reject;});
  const stop=()=>{void reader?.cancel().catch(()=>{});rejectStopped(stoppedError());};
  controller.signal.addEventListener('abort',stop,{once:true});
  const externalAbort=()=>controller.abort();opts.signal?.addEventListener('abort',externalAbort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  try {
    if(opts.signal?.aborted)throw stoppedError();
    // Manual redirects are supported by Workers; every redirect/non-2xx is rejected without a second request.
    const pending=fetcher(url,{headers:{'X-Api-Key':opts.apiKey,'Accept':'application/json'},redirect:'manual',signal:controller.signal})
      .then(response=>{if(controller.signal.aborted)void response.body?.cancel().catch(()=>{});return response;});
    const response=await Promise.race([pending,stopped]);
    if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw stoppedError();}
    if (!response.ok||response.redirected) {
      void response.body?.cancel().catch(()=>{});
      throw new RecommendationError('upstream_unavailable',response.status===429?429:502,response.status===429?'Restaurant discovery is busy. Please try again later.':'Restaurant discovery is temporarily unavailable.');
    }
    const declared=response.headers.get('content-length');
    if(declared!==null&&/^\d+$/.test(declared)&&Number(declared)>MAX_RESPONSE_BYTES){void response.body?.cancel().catch(()=>{});throw new RecommendationError('invalid_response',502,'Restaurant details could not be verified.');}
    reader=response.body?.getReader();if(!reader)throw new RecommendationError('invalid_response',502,'Restaurant details could not be verified.');
    const chunks:Uint8Array[]=[];let bytes=0;
    for(;;){
      const result=await Promise.race([reader.read(),stopped]);
      if(controller.signal.aborted)throw stoppedError();
      if(result.done)break;
      bytes+=result.value.byteLength;
      if(bytes>MAX_RESPONSE_BYTES){void reader.cancel().catch(()=>{});throw new RecommendationError('invalid_response',502,'Restaurant details could not be verified.');}
      chunks.push(result.value);
    }
    const combined=new Uint8Array(bytes);let offset=0;chunks.forEach(chunk=>{combined.set(chunk,offset);offset+=chunk.length;});
    try {
      const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(combined));
      if(!result||typeof result!=='object'||Array.isArray(result)||result.success===false)throw new Error('shape');
      return result;
    }catch{throw new RecommendationError('invalid_response',502,'Restaurant details could not be verified.');}
  } catch(error) {
    if(timedOut||opts.signal?.aborted)throw stoppedError();
    if(error instanceof RecommendationError)throw error;
    throw new RecommendationError('upstream_unavailable',502,'Restaurant discovery could not connect. Try again when you’re ready.');
  } finally {
    clearTimeout(timer);opts.signal?.removeEventListener('abort',externalAbort);controller.signal.removeEventListener('abort',stop);
    if(controller.signal.aborted)void reader?.cancel().catch(()=>{});
    try{reader?.releaseLock();}catch{ /* An ignored abort can leave a read pending. */ }
  }
}
function resultArray(payload:Record<string,unknown>,kind:'entities'|'tags'):unknown[] {
  const results=object(payload.results);
  const value=results[kind]??payload[kind]??(Array.isArray(payload.results)?payload.results:undefined);
  if (!Array.isArray(value) || value.length>100) throw new RecommendationError('invalid_response',502,'Restaurant details could not be verified.');
  return value;
}
function mapEntity(value:unknown,retrievedAt:string):Venue|undefined {
  const e=object(value), properties=object(e.properties), location=object(e.location), geo=object(properties.geocode);
  const id=text(e.entity_id||e.id); if(!QLOO_ID.test(id))return;
  const types=Array.isArray(e.types)?e.types:typeof e.type==='string'?[e.type]:[];
  if(!types.includes('urn:entity:place'))return;
  const latitude=location.lat??location.latitude, longitude=location.lon??location.lng??location.longitude;
  // Reject incomplete coordinates; no fake pins on a real map.
  const tags=Array.isArray(e.tags)?e.tags.map(t=>text(object(t).name||object(t).title,80)).filter(Boolean):[];
  const cuisine=tags.filter(t=>/italian|japanese|thai|mexican|mediterranean|korean|indian|french|chinese|vietnamese|ethiopian|american|lebanese|turkish|spanish|greek/i.test(t)).slice(0,2).join(' · ')||'Restaurant';
  const website=Array.isArray(properties.websites)?properties.websites[0]:properties.website;
  const external=object(e.external), resy=object(Array.isArray(external.resy)?external.resy[0]:external.resy);
  const resyUrl=safePublicUrl(resy.url);
  // Only an actual provider-supplied Resy public page may appear as a reservation link.
  const bookingUrl=resyUrl && (new URL(resyUrl).hostname==='resy.com'||new URL(resyUrl).hostname.endsWith('.resy.com'))?resyUrl:undefined;
  return sanitizeVenueSnapshot({id:`qloo:${id.toLowerCase()}`,providerEntityId:id,source:'qloo',name:e.name,
    latitude,longitude,cuisine,neighborhood:text(geo.neighborhood||geo.name||geo.city||properties.address,200),
    priceLevel:properties.price_level,rating:properties.business_rating,ratingKnown:typeof properties.business_rating==='number',
    description:text(properties.description,2000),story:text(properties.description,3000),tags,
    image:typeof properties.image==='string'?properties.image:object(properties.image).url,
    websiteUrl:website,bookingUrl,retrievedAt,affinity:object(e.query).affinity??object(e.query).affinity_score??e.affinity});
}
const tagCache=new Map<string,{until:number;ids:string[]}>();
const venueCache=new Map<string,{until:number;venue:Venue}>();
async function resolveTaste(taste:string,opts:RecommendationOptions):Promise<string[]> {
  const key=taste.toLowerCase();const cached=tagCache.get(key);if(cached && cached.until>Date.now())return cached.ids;
  const payload=await request('/v2/tags',{'filter.query':taste,take:'8'},opts);
  const tags=resultArray(payload,'tags').map(object).map((t):Record<string,unknown>=>({...t,id:t.tag_id??t.id})).filter(t=>typeof t.id==='string' && /^urn:tag:[\w:.,&+% /()'’-]{1,240}$/u.test(t.id) && /restaurant|cuisine|place|dining|food/i.test(String(t.id)));
  const exact=tags.filter(t=>text(t.name||t.title).toLowerCase()===key);
  const ids=(exact.length?exact:tags).slice(0,2).map(t=>t.id as string);
  if(tagCache.size>200)tagCache.clear();tagCache.set(key,{until:Date.now()+3_600_000,ids});return ids;
}
export async function retrieveRecommendations(input:RecommendationInput,opts:RecommendationOptions):Promise<RecommendationResult> {
  if(!opts.apiKey?.trim())throw new RecommendationError('unavailable',503,'Restaurant discovery is not available yet. Your saved plan is still here.');
  // Round-robin across seats prevents one person's long taste list from crowding out the group.
  const tastes:string[]=[];
  const lists=input.participants.map(p=>[...p.tastes,...p.restrictions]);
  for(let i=0;i<30&&tastes.length<6;i++) for(const list of lists){const taste=list[i]?.trim();if(taste&&!tastes.some(t=>t.toLowerCase()===taste.toLowerCase()))tastes.push(taste);if(tastes.length===6)break;}
  const resolutions=await Promise.all(tastes.map(async taste=>({taste,ids:await resolveTaste(taste,opts)})));
  const tags=[...new Set(resolutions.flatMap(r=>r.ids))];const seeds=realIds(input.seedVenueIds||[]);
  if(tastes.length && !tags.length && !seeds.length)throw new RecommendationError('no_taste_match',422,'Those tastes could not be matched yet. Try a cuisine such as Italian or Japanese.');
  const budget=Math.min(...input.participants.map(p=>p.budget));
  const priceMax=budget<=25?1:budget<=50?2:budget<=100?3:4;
  const params:Record<string,string>={'filter.type':'urn:entity:place','filter.tags':RESTAURANT_TAG,'filter.location':`POINT(${input.longitude} ${input.latitude})`,'filter.location.radius':'8000','filter.price_level.max':String(priceMax),take:'20',sort_by:tags.length||seeds.length?'affinity':'distance'};
  if(tags.length)params['signal.interests.tags']=tags.join(',');
  if(seeds.length)params['signal.interests.entities']=seeds.join(',');
  const excludes=realIds(input.vetoes);if(excludes.length)params['filter.exclude.entities']=excludes.join(',');
  const payload=await request('/v2/insights/',params,opts);
  const retrievedAt=(opts.now?.()||new Date()).toISOString();
  const rawEntities=resultArray(payload,'entities');
  const mapped=rawEntities.map(e=>mapEntity(e,retrievedAt)).filter((v):v is Venue=>Boolean(v));
  if(rawEntities.length&&!mapped.length)throw new RecommendationError('invalid_response',502,'Restaurant details could not be verified.');
  const radians=(degrees:number)=>degrees*Math.PI/180;
  const nearby=(v:Venue)=>{const dLat=radians(v.latitude!-input.latitude),dLon=radians(v.longitude!-input.longitude);const a=Math.sin(dLat/2)**2+Math.cos(radians(input.latitude))*Math.cos(radians(v.latitude!))*Math.sin(dLon/2)**2;return 6_371_000*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))<=8_100;};
  const venues=mapped.filter(v=>!excludes.includes(v.providerEntityId!)&&nearby(v));
  const deduped=[...new Map(venues.map(v=>[v.id,v])).values()].slice(0,20);
  if(venueCache.size>300)venueCache.clear();deduped.forEach(venue=>venueCache.set(venue.id,{until:Date.now()+900_000,venue}));
  return {venues:deduped,orderedIds:deduped.map(v=>v.id),retrievedAt,source:'qloo',unresolvedTastes:resolutions.filter(r=>!r.ids.length).map(r=>r.taste)};
}
/** For trusted Waiter/booking context: never accept a browser snapshot as provider evidence. */
export async function resolveVenue(id:string,opts:RecommendationOptions):Promise<Venue|undefined> {
  if(!id.startsWith('qloo:')||!QLOO_ID.test(rawId(id)))return;
  if(!opts.apiKey?.trim())throw new RecommendationError('unavailable',503,'Restaurant details are not available yet.');
  const normalized=`qloo:${rawId(id)}`;const cached=venueCache.get(normalized);if(cached&&cached.until>Date.now())return cached.venue;
  const payload=await request('/entities',{entity_ids:rawId(id)},opts);
  const venue=resultArray(payload,'entities').map(e=>mapEntity(e,(opts.now?.()||new Date()).toISOString())).find(v=>v?.id===normalized);
  if(venue)venueCache.set(normalized,{until:Date.now()+900_000,venue});return venue;
}
