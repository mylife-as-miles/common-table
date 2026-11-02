import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { handleServices } from "../../../server/services";
async function handleApiRequest(request:Request) {
  const runtime=env as unknown as Record<string,unknown>;
  return handleServices(request,{
    identity:await getChatGPTUser(),
    db:runtime.DB as Parameters<typeof handleServices>[1]['db'],
    apiKey:typeof runtime.ANTHROPIC_API_KEY==='string'?runtime.ANTHROPIC_API_KEY:undefined,
    qlooApiKey:typeof runtime.QLOO_API_KEY==='string'?runtime.QLOO_API_KEY:undefined,
    ownerEmail:typeof runtime.APP_OWNER_EMAIL==='string'?runtime.APP_OWNER_EMAIL:undefined,
  });
}
export const dynamic = "force-dynamic";
export const GET = handleApiRequest;
export const POST = handleApiRequest;
export const HEAD = handleApiRequest;
export const OPTIONS = handleApiRequest;
export const PUT = handleApiRequest;
export const PATCH = handleApiRequest;
export const DELETE = handleApiRequest;
