import { handleApiRequest as handleMapRequest } from './worker-api.ts';
import { handleWeatherRequest } from './weather.ts';
import { handleSharedTablesRequest, type SharedDatabase } from './shared-tables/index.ts';
import { handleRecommendations } from './recommendations/handler.ts';
import { handleGuidance } from './guidance/index.ts';

export interface ServiceContext {
  db?: SharedDatabase | null;
  identity: {userId:string;displayName:string;email?:string}|null;
  apiKey?: string;
  qlooApiKey?: string;
  ownerEmail?: string;
}
const error=(status:number,code:string,message:string)=>Response.json({code,message},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});

/** A persistent quota, shared by every Worker instance. Failed attempts also count. */
export async function reserveDiscoveryQuota(db:SharedDatabase,userId:string,now=Date.now()):Promise<boolean>{
  const window=Math.floor(now/86_400_000);
  for(const [scope,limit] of [[`discovery:user:${userId}`,20],['discovery:global',200]] as const){
    const row=await db.prepare('INSERT INTO service_quotas(scope,window_start,count) VALUES(?,?,1) ON CONFLICT(scope,window_start) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(scope,window,limit).first<{count:number}>();
    if(!row)return false;
  }
  return true;
}

/** Identity comes only from the host's trusted authenticated-user headers. */
export async function handleServices(request:Request,context:ServiceContext):Promise<Response>{
  const url=new URL(request.url),path=url.pathname;
  try{
    if(path==='/api/geocode')return handleMapRequest(request);
    if(path==='/api/weather')return handleWeatherRequest(request);
    if(path==='/api/waiter/status'||path==='/api/waiter/reply'||path==='/api/waiter/enable')return handleGuidance(request,context);
    if(path==='/api/shared-tables'||path.startsWith('/api/shared-tables/'))return handleSharedTablesRequest(request,{db:context.db,identity:context.identity});
    if(path==='/api/recommendations'){
      if(request.method!=='POST')return error(405,'method_not_allowed','Use restaurant discovery from your table.');
      if(url.search||request.headers.get('origin')!==url.origin||request.headers.get('x-common-table-request')!=='recommendations'||!['same-origin','none',null].includes(request.headers.get('sec-fetch-site')))return error(403,'forbidden','Open discovery from Common Table.');
      if(!context.qlooApiKey||!context.db)return error(503,'unavailable','Restaurant discovery is not available yet.');
      if(!context.identity)return error(401,'authentication_required','Sign in to find places for your table.');
      if(!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(request.headers.get('content-type')??'')||request.headers.has('content-encoding'))return error(415,'invalid_request','Check the table details and try again.');
      if(!await reserveDiscoveryQuota(context.db,context.identity.userId))return error(429,'rate_limited','Discovery is busy. Please try again later.');
      return handleRecommendations(request,{apiKey:context.qlooApiKey});
    }
    return error(404,'not_found','This service is unavailable.');
  }catch{return error(503,'unavailable','This service is temporarily unavailable. Your saved work is unchanged.');}
}
