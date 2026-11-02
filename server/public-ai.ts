import type { SharedDatabase } from "./shared-tables/index.ts";

export const PUBLIC_AI_COOKIE = "__Host-ct-ai";
export const PUBLIC_AI_COOKIE_SECONDS = 24 * 60 * 60;
export const PUBLIC_AI_VISITOR_DAILY_LIMIT = 5;
export const PUBLIC_AI_GLOBAL_MINUTE_LIMIT = 6;
export const PUBLIC_AI_GLOBAL_SCOPE = "public-ai:global-minute:v1";
const encoder = new TextEncoder();
const tokenPattern = /^v1\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(0|[1-9][0-9]{0,12})\.([A-Za-z0-9_-]{43})$/;
const quotaPattern = /^ai:[0-9a-f]{64}$/;

export class PublicAiError extends Error {
  readonly code = "public_ai_unavailable";
  readonly status = 503;
  constructor() { super("Public guidance is temporarily unavailable."); this.name = "PublicAiError"; }
}
export interface PublicAiVisitorOptions {
  secret: string;
  /** Only the trusted Sites identity supplied by the route wrapper. */
  identity: { userId: string } | null;
  now?: () => number;
}
export interface PublicAiVisitor { quotaKey: string; setCookie?: string; authenticated: boolean }

function timestamp(now: (() => number) | undefined): number {
  const result = (now ?? Date.now)();
  if (!Number.isSafeInteger(result) || result < 0 || result > 8_640_000_000_000_000) throw new PublicAiError();
  return result;
}
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function signatureBytes(value: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=");
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    return bytes.length === 32 && base64url(bytes) === value ? bytes : undefined;
  } catch { return; }
}
async function signingKey(secret: unknown): Promise<CryptoKey> {
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 4096 || /[^\x21-\x7e]/.test(secret)) throw new PublicAiError();
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function sign(key: CryptoKey, value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
async function quotaKey(key: CryptoKey, subject: string): Promise<string> {
  return `ai:${[...await sign(key, `ct-ai-quota-v1:${subject}`)].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
function oneCookie(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header || header.length > 8192) return;
  const matching = header.split(";").map(part => part.trim()).filter(part => (part.includes("=") ? part.slice(0, part.indexOf("=")).trim() : part) === PUBLIC_AI_COOKIE);
  if (matching.length !== 1) return;
  if (!matching[0].includes("=")) return;
  const token = matching[0].slice(matching[0].indexOf("=") + 1);
  return token.length <= 256 ? token : undefined;
}

/** A fair-use marker only. A guest cookie can never establish Sites identity or record access. */
export async function resolvePublicAiVisitor(request: Request, options: PublicAiVisitorOptions): Promise<PublicAiVisitor> {
  try {
    const key = await signingKey(options?.secret);
    const seconds = Math.floor(timestamp(options.now) / 1000);
    if (options.identity !== null) {
      if (!options.identity || typeof options.identity.userId !== "string" || !options.identity.userId || options.identity.userId.length > 256 || /[^\x21-\x7e]/.test(options.identity.userId)) throw new PublicAiError();
      return { quotaKey: await quotaKey(key, `user:${options.identity.userId}`), authenticated: true };
    }
    const token = oneCookie(request);
    const parts = token && tokenPattern.exec(token);
    if (parts) {
      const issued = Number(parts[2]);
      const bytes = signatureBytes(parts[3]);
      if (bytes && issued <= seconds && seconds - issued < PUBLIC_AI_COOKIE_SECONDS && await crypto.subtle.verify("HMAC", key, bytes, encoder.encode(`ct-ai-cookie-v1:${parts[1]}:${parts[2]}`))) {
        return { quotaKey: await quotaKey(key, `guest:${parts[1]}`), authenticated: false };
      }
    }
    const id = crypto.randomUUID();
    const signature = base64url(await sign(key, `ct-ai-cookie-v1:${id}:${seconds}`));
    return {
      quotaKey: await quotaKey(key, `guest:${id}`), authenticated: false,
      setCookie: `${PUBLIC_AI_COOKIE}=v1.${id}.${seconds}.${signature}; Path=/; Max-Age=${PUBLIC_AI_COOKIE_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
    };
  } catch { throw new PublicAiError(); }
}

function reserved(result: unknown, limit: number): boolean {
  if (result === null) return false;
  if (!result || typeof result !== "object" || Array.isArray(result) || Object.keys(result).length !== 1 || !Object.hasOwn(result, "count")) throw new PublicAiError();
  const row = result as { count?: unknown };
  if (!Number.isSafeInteger(row.count) || Number(row.count) < 1 || Number(row.count) > limit) throw new PublicAiError();
  return true;
}

/** Shared by guidance and discovery. This guard does not replace the separate fixed spending ledger. */
export async function reservePublicAiQuota(db: SharedDatabase, visitorKey: string, options: { now?: () => number } = {}): Promise<boolean> {
  try {
    if (!quotaPattern.test(visitorKey) || !db || typeof db.prepare !== "function") throw new PublicAiError();
    const time = timestamp(options.now);
    const day = String(Math.floor(time / 86_400_000));
    const minute = String(Math.floor(time / 60_000));
    const visitorScope = `public-ai:visitor:${visitorKey}`;
    // Each guarded UPSERT is atomic. Stop before creating a visitor row when
    // the global burst is full. A visitor already at their daily limit also
    // cannot drain global capacity by repeating refused requests.
    const burst = db.prepare(`INSERT INTO service_quotas(scope,window_start,count)
      SELECT ?,?,1 WHERE COALESCE((SELECT count FROM service_quotas WHERE scope=? AND window_start=?),0)<?
      ON CONFLICT(scope,window_start) DO UPDATE SET count=count+1 WHERE count<? RETURNING count`)
      .bind(PUBLIC_AI_GLOBAL_SCOPE, minute, visitorScope, day, PUBLIC_AI_VISITOR_DAILY_LIMIT, PUBLIC_AI_GLOBAL_MINUTE_LIMIT).first();
    if (!reserved(await burst, PUBLIC_AI_GLOBAL_MINUTE_LIMIT)) return false;
    // A concurrent request may use the visitor's final slot after the burst
    // reservation. Denial/error retains that burst reservation, never refunds.
    const visitor = db.prepare(`INSERT INTO service_quotas(scope,window_start,count) VALUES(?,?,1)
      ON CONFLICT(scope,window_start) DO UPDATE SET count=count+1 WHERE count<? RETURNING count`)
      .bind(visitorScope, day, PUBLIC_AI_VISITOR_DAILY_LIMIT).first();
    return reserved(await visitor, PUBLIC_AI_VISITOR_DAILY_LIMIT);
  } catch { throw new PublicAiError(); }
}
