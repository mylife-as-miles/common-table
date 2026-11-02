import { handleApiRequest as handleMapRequest } from './worker-api.ts';
import { handleWeatherRequest } from './weather.ts';
import { handleSharedTablesRequest, type SharedDatabase } from './shared-tables/index.ts';
import { handleRecommendations } from './recommendations/handler.ts';
import { handleGuidance } from './guidance/index.ts';
import { handleVerification } from './verification.ts';

export interface ServiceContext {
  db?: SharedDatabase | null;
  identity: {userId:string;displayName:string;email?:string}|null;
  apiKey?: string;
  ownerEmail?: string;
  publicAiLimitKey?: string;
  fetcher?: typeof fetch;
  verificationSecret?: string;
}
const error=(status:number,code:string,message:string)=>Response.json({code,message},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});

/** Identity comes only from the host's trusted authenticated-user headers. */
export async function handleServices(request:Request,context:ServiceContext):Promise<Response>{
  const url=new URL(request.url),path=url.pathname;
  try{
    if(path==='/api/geocode')return handleMapRequest(request);
    if(path==='/api/weather')return handleWeatherRequest(request);
    if(path==='/api/internal/verification')return handleVerification(request,context);
    if(path==='/api/waiter/status'||path==='/api/waiter/reply'||path==='/api/waiter/enable')return handleGuidance(request,context);
    if(path==='/api/shared-tables'||path.startsWith('/api/shared-tables/'))return handleSharedTablesRequest(request,{db:context.db,identity:context.identity});
    if(path==='/api/recommendations')return handleRecommendations(request,context);
    return error(404,'not_found','This service is unavailable.');
  }catch{return error(503,'unavailable','This service is temporarily unavailable. Your saved work is unchanged.');}
}
