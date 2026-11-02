import { defaultSharedPreferences, emptySharedPlan, type SharedIdentity, type SharedPlan, type SharedPreferences, type SharedTableSnapshot } from "../../src/collaboration/types.ts";
import { sanitizeVenueSnapshot } from "../../src/domain/catalog.ts";

export interface SharedStatement {
  bind(...values: unknown[]): SharedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface SharedDatabase { prepare(sql: string): SharedStatement; batch(statements: SharedStatement[]): Promise<unknown[]> }
export interface SharedRequestContext { db?: SharedDatabase | null; identity: SharedIdentity | null; now?: () => number }
type Row = Record<string, unknown>;
type ErrorCode = "authentication_required" | "unavailable" | "not_found" | "forbidden" | "invalid_request" | "conflict" | "idempotency_conflict" | "invitation_unavailable" | "table_full" | "approval_required" | "plan_unfit" | "details_unconfirmed";
const errors: Record<ErrorCode, string> = {
  authentication_required: "Sign in to use a shared table.", unavailable: "Shared tables are unavailable right now. Your local work is unchanged.",
  not_found: "This shared table is not available to your account.", forbidden: "Your account cannot make that change.", invalid_request: "Check the shared-table request and try again.",
  conflict: "This table changed. Review the latest version before trying your change again.", idempotency_conflict: "This request identifier has already been used for a different change.",
  invitation_unavailable: "This invitation is expired, revoked, already accepted, or unavailable.", table_full: "This table already has six members.", approval_required: "Every current member must approve this exact dinner plan before it can be saved.",
  plan_unfit: "This demo venue does not fit every member’s budget and listed dietary needs.", details_unconfirmed: "Acknowledge the restaurant details that still need confirmation before saving.",
};
class SharedError extends Error { constructor(readonly code: ErrorCode, readonly status: number) { super(errors[code]); } }
const object = (v: unknown): v is Row => Boolean(v && typeof v === "object" && !Array.isArray(v));
const string = (v: unknown, max: number, empty = false): v is string => typeof v === "string" && v.length <= max && (empty || Boolean(v.trim())) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const keys = (v: Row, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const uuid = () => crypto.randomUUID();
const isVersion = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 1;
const idPattern = /^[a-zA-Z0-9-]{8,80}$/;
const tokenPattern = /^[a-zA-Z0-9_-]{43}$/;
const encoder = new TextEncoder();
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (object(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
};
const hash = async (v: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(v)))].map(n => n.toString(16).padStart(2, "0")).join("");
function json(status: number, value: unknown, extra: Record<string, string> = {}) {
  return new Response(status === 304 ? null : JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", ...extra } });
}
function preferences(v: unknown): SharedPreferences {
  if (!object(v) || !keys(v, ["tastes", "budget", "restrictions"]) || typeof v.budget !== "number" || !Number.isFinite(v.budget) || v.budget < 1 || v.budget > 1000) throw new SharedError("invalid_request", 400);
  const labels = (list: unknown, max: number) => Array.isArray(list) && list.length <= max && list.every(x => string(x, 40)) && new Set(list).size === list.length;
  if (!labels(v.tastes, 16) || !labels(v.restrictions, 12)) throw new SharedError("invalid_request", 400);
  return { tastes: (v.tastes as string[]).map(x => x.trim()), budget: v.budget, restrictions: (v.restrictions as string[]).map(x => x.trim()) };
}
function plan(v: unknown): SharedPlan {
  if (!object(v) || !keys(v, ["venueId", "venueSnapshot", "date", "time", "note", "saved", "detailsAcknowledged"]) || !string(v.date, 10, true) || !string(v.time, 5) || !string(v.note, 1000, true) || typeof v.saved !== "boolean" || (v.detailsAcknowledged !== undefined && typeof v.detailsAcknowledged !== "boolean")) throw new SharedError("invalid_request", 400);
  if (v.venueId !== null && !string(v.venueId, 180)) throw new SharedError("invalid_request", 400);
  if (v.venueId === null ? v.venueSnapshot !== null : !object(v.venueSnapshot)) throw new SharedError("invalid_request", 400);
  // One shared sanitizer owns canonical demo facts, bounded real metadata and
  // approved local placeholders. Parallel validators drift and reject real plans.
  const snapshot = v.venueSnapshot === null ? null : sanitizeVenueSnapshot(v.venueSnapshot);
  if (v.venueId !== null && (!snapshot || snapshot.id !== v.venueId)) throw new SharedError("invalid_request", 400);
  return { venueId: v.venueId as string | null, venueSnapshot: snapshot ?? null, date: v.date, time: v.time, note: v.note, saved: false, ...(v.detailsAcknowledged !== undefined ? { detailsAcknowledged: v.detailsAcknowledged as boolean } : {}) };
}
function validSchedule(p: SharedPlan, time: number) {
  const date = new Date(`${p.date}T${p.time}:00`);
  return /^\d{4}-\d{2}-\d{2}$/.test(p.date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.time) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === p.date && date.getTime() > time;
}
async function readBody(request: Request): Promise<Row> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(request.headers.get("content-type") ?? "") || request.headers.has("content-encoding")) throw new SharedError("invalid_request", 415);
  if (Number(request.headers.get("content-length") ?? 0) > 24 * 1024) throw new SharedError("invalid_request", 413);
  const reader = request.body?.getReader(); if (!reader) throw new SharedError("invalid_request", 400);
  const chunks: Uint8Array[] = []; let size = 0;
  let rejectTimeout!: (error: SharedError) => void;
  const timeout = new Promise<never>((_, reject) => { rejectTimeout = reject; });
  const cancel = () => { void reader.cancel().catch(() => undefined); rejectTimeout(new SharedError("invalid_request", 408)); };
  const timer = setTimeout(cancel, 8000); request.signal.addEventListener("abort", cancel, { once: true });
  try {
    if (request.signal.aborted) cancel();
    while (true) { const item = await Promise.race([reader.read(), timeout]); if (item.done) break; size += item.value.byteLength; if (size > 24 * 1024) { void reader.cancel().catch(() => undefined); throw new SharedError("invalid_request", 413); } chunks.push(item.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown; try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new SharedError("invalid_request", 400); }
    if (!object(value)) throw new SharedError("invalid_request", 400); return value;
  } finally { clearTimeout(timer); request.signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}
function csrf(request: Request) {
  const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
  if (origin !== new URL(request.url).origin || request.headers.get("x-common-table-request") !== "shared-table" || (site !== null && site !== "same-origin" && site !== "none")) throw new SharedError("forbidden", 403);
}

/** Identity must be supplied by getChatGPTUser(), never parsed from request data here. */
export async function handleSharedTablesRequest(request: Request, ctx: SharedRequestContext): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname;
  const identity = ctx.identity ? { userId: ctx.identity.userId, displayName: ctx.identity.displayName } : null; const db = ctx.db; const now = ctx.now ?? Date.now;
  try {
    if (path === "/api/shared-tables/session" && request.method === "GET") return json(200, { identity, available: Boolean(db) });
    if (!identity || !string(identity.userId, 200) || !string(identity.displayName, 160)) throw new SharedError("authentication_required", 401);
    if (!db) throw new SharedError("unavailable", 503);
    if (url.search || url.hash || !path.startsWith("/api/shared-tables")) throw new SharedError("invalid_request", 400);
    const q = (sql: string, ...values: unknown[]) => db.prepare(sql).bind(...values);
    const owned = async (id: string, owner = false) => {
      const row = await q("SELECT t.* FROM shared_tables t JOIN shared_members m ON m.table_id=t.id WHERE t.id=? AND m.user_id=?", id, identity.userId).first<Row>();
      if (!row) throw new SharedError("not_found", 404); if (owner && row.owner_id !== identity.userId) throw new SharedError("forbidden", 403); return row;
    };
    const snapshot = async (id: string, attempt = 0): Promise<SharedTableSnapshot> => {
      const row = await owned(id); const members = (await q("SELECT * FROM shared_members WHERE table_id=? ORDER BY joined_at,user_id", id).all<Row>()).results;
      const invites = row.owner_id === identity.userId ? (await q("SELECT id,expires_at,accepted_at,revoked_at FROM shared_invites WHERE table_id=? ORDER BY created_at DESC LIMIT 50", id).all<Row>()).results.map(i => ({ id: String(i.id), expiresAt: Number(i.expires_at), accepted: i.accepted_at !== null, revoked: i.revoked_at !== null })) : undefined;
      const latest = await q("SELECT version FROM shared_tables WHERE id=?", id).first<Row>();
      if (!latest || latest.version !== row.version) { if (attempt < 2) return snapshot(id, attempt + 1); throw new SharedError("unavailable", 503); }
      return { id, title: String(row.title), ownerId: String(row.owner_id), viewerId: identity.userId, revision: Number(row.revision), version: Number(row.version), plan: JSON.parse(String(row.plan_json)), updatedAt: Number(row.updated_at), members: members.map(m => ({ userId: String(m.user_id), displayName: String(m.display_name), role: m.role as "owner" | "member", preferences: JSON.parse(String(m.preferences_json)), approvedRevision: m.approved_revision === null ? null : Number(m.approved_revision) })), ...(invites ? { invites } : {}) };
    };
    if (request.method === "GET") {
      if (path === "/api/shared-tables") {
        const tables = (await q("SELECT t.id,t.title,t.updated_at,m.role FROM shared_tables t JOIN shared_members m ON m.table_id=t.id WHERE m.user_id=? ORDER BY t.updated_at DESC LIMIT 100", identity.userId).all<Row>()).results.map(r => ({ id: r.id, title: r.title, updatedAt: r.updated_at, role: r.role })); return json(200, { identity, tables });
      }
      const match = path.match(/^\/api\/shared-tables\/([a-zA-Z0-9-]{8,80})$/); if (!match) throw new SharedError("not_found", 404);
      const current = await owned(match[1]); const currentEtag = `"ct:${match[1]}:${current.version}"`;
      if (request.headers.get("if-none-match") === currentEtag) return json(304, null, { ETag: currentEtag });
      const table = await snapshot(match[1]); return json(200, { table }, { ETag: `"ct:${table.id}:${table.version}"` });
    }
    if (request.method !== "POST") return json(405, { code: "method_not_allowed", message: "Use GET or POST for shared tables." }, { Allow: "GET, POST" });
    csrf(request); const body = await readBody(request);
    if (path === "/api/shared-tables/invites/preview") {
      if (!keys(body, ["token"]) || typeof body.token !== "string" || !tokenPattern.test(body.token)) throw new SharedError("invalid_request", 400);
      const found = await q("SELECT t.id,t.title,i.expires_at,(SELECT COUNT(*) FROM shared_members WHERE table_id=t.id) AS member_count FROM shared_invites i JOIN shared_tables t ON t.id=i.table_id WHERE i.token_hash=? AND i.expires_at>? AND i.accepted_at IS NULL AND i.revoked_at IS NULL", await hash(body.token), now()).first<Row>();
      if (!found) throw new SharedError("invitation_unavailable", 410); return json(200, { invitation: { id: found.id, title: found.title, memberCount: found.member_count, expiresAt: found.expires_at } });
    }
    const operationKey = request.headers.get("idempotency-key"); if (!operationKey || !/^[a-zA-Z0-9-]{16,80}$/.test(operationKey)) throw new SharedError("invalid_request", 400);
    const requestHash = await hash(`${path}\n${canonical(body)}`);
    const operation = async () => q("SELECT request_hash,response_json FROM shared_operations WHERE actor_id=? AND idempotency_key=?", identity.userId, operationKey).first<Row>();
    const replay = async () => { const old = await operation(); if (!old) return null; if (old.request_hash !== requestHash) throw new SharedError("idempotency_conflict", 409); const receipt = JSON.parse(String(old.response_json)); return path.endsWith("/leave") ? json(200, { left: true, tableId: receipt.tableId, replayed: true }) : json(200, { table: await snapshot(receipt.tableId), replayed: true }); };
    const previous = await replay(); if (previous) return previous;
    const marker = uuid(); const timestamp = now(); if (!Number.isSafeInteger(timestamp)) throw new SharedError("unavailable", 503);
    const receipt = (id: string) => q("INSERT INTO shared_operations(actor_id,idempotency_key,request_hash,response_json,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM shared_tables WHERE id=? AND last_operation=?)", identity.userId, operationKey, requestHash, JSON.stringify({ tableId: id }), timestamp, id, marker);
    const guarded = (id: string, version: number, revisionChange: boolean, nextPlan: SharedPlan, extra = "", values: unknown[] = []) => q(`UPDATE shared_tables SET version=version+1,revision=revision+?,plan_json=?,updated_at=?,last_operation=? WHERE id=? AND version=? AND NOT EXISTS(SELECT 1 FROM shared_operations WHERE actor_id=? AND idempotency_key=?) ${extra}`, revisionChange ? 1 : 0, JSON.stringify(nextPlan), timestamp, marker, id, version, identity.userId, operationKey, ...values);
    let tableId: string;
    let statements: SharedStatement[];
    if (path === "/api/shared-tables") {
      if (!keys(body, ["title", "preferences", "plan"]) || !string(body.title, 100)) throw new SharedError("invalid_request", 400);
      const prefs = preferences(body.preferences); const p = body.plan === undefined ? emptySharedPlan() : plan(body.plan); tableId = uuid();
      statements = [q("INSERT INTO shared_tables(id,owner_id,title,revision,version,plan_json,created_at,updated_at,last_operation) SELECT ?,?,?,1,1,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM shared_operations WHERE actor_id=? AND idempotency_key=?)", tableId, identity.userId, body.title.trim(), JSON.stringify(p), timestamp, timestamp, marker, identity.userId, operationKey), q("INSERT INTO shared_members(table_id,user_id,display_name,role,preferences_json,approved_revision,joined_at) SELECT ?,?,?,'owner',?,NULL,? WHERE EXISTS(SELECT 1 FROM shared_tables WHERE id=? AND last_operation=?)", tableId, identity.userId, identity.displayName, JSON.stringify(prefs), timestamp, tableId, marker), receipt(tableId)];
    } else if (path === "/api/shared-tables/join") {
      if (!keys(body, ["token", "preferences"]) || typeof body.token !== "string" || !tokenPattern.test(body.token)) throw new SharedError("invalid_request", 400);
      const prefs = body.preferences === undefined ? defaultSharedPreferences() : preferences(body.preferences);
      const tokenHash = await hash(body.token); const invite = await q("SELECT i.*,t.version,t.plan_json FROM shared_invites i JOIN shared_tables t ON t.id=i.table_id WHERE i.token_hash=? AND i.expires_at>? AND i.accepted_at IS NULL AND i.revoked_at IS NULL", tokenHash, timestamp).first<Row>();
      if (!invite) throw new SharedError("invitation_unavailable", 410); tableId = String(invite.table_id);
      if (await q("SELECT user_id FROM shared_members WHERE table_id=? AND user_id=?", tableId, identity.userId).first()) return json(200, { table: await snapshot(tableId), alreadyMember: true });
      const count = await q("SELECT COUNT(*) AS n FROM shared_members WHERE table_id=?", tableId).first<Row>(); if (Number(count?.n) >= 6) throw new SharedError("table_full", 409);
      const p = { ...JSON.parse(String(invite.plan_json)), saved: false };
      statements = [guarded(tableId, Number(invite.version), true, p, "AND (SELECT COUNT(*) FROM shared_members WHERE table_id=?)<6 AND EXISTS(SELECT 1 FROM shared_invites WHERE id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?)", [tableId, invite.id, timestamp]), q("INSERT INTO shared_members(table_id,user_id,display_name,role,preferences_json,approved_revision,joined_at) SELECT ?,?,?,'member',?,NULL,? WHERE EXISTS(SELECT 1 FROM shared_tables WHERE id=? AND last_operation=?)", tableId, identity.userId, identity.displayName, JSON.stringify(prefs), timestamp, tableId, marker), q("UPDATE shared_invites SET accepted_by=?,accepted_at=? WHERE id=? AND EXISTS(SELECT 1 FROM shared_tables WHERE id=? AND last_operation=?)", identity.userId, timestamp, invite.id, tableId, marker), receipt(tableId)];
    } else {
      const match = path.match(/^\/api\/shared-tables\/([a-zA-Z0-9-]{8,80})\/(preferences|plan|approval|save|invites|revoke-invite|remove-member|leave)$/); if (!match || !idPattern.test(match[1])) throw new SharedError("not_found", 404);
      tableId = match[1]; const action = match[2]; const ownerAction = ["plan", "save", "invites", "revoke-invite", "remove-member"].includes(action);
      const current = await owned(tableId, ownerAction); if (!isVersion(body.version)) throw new SharedError("invalid_request", 400); if (body.version !== current.version) throw new SharedError("conflict", 409);
      const p: SharedPlan = JSON.parse(String(current.plan_json)); const extra: SharedStatement[] = []; let nextPlan = p; let contentChange = false;
      if (action === "preferences") {
        if (!keys(body, ["version", "preferences"])) throw new SharedError("invalid_request", 400); const prefs = preferences(body.preferences);
        const mine = await q("SELECT preferences_json FROM shared_members WHERE table_id=? AND user_id=?", tableId, identity.userId).first<Row>(); contentChange = canonical(JSON.parse(String(mine?.preferences_json))) !== canonical(prefs);
        extra.push(q("UPDATE shared_members SET preferences_json=?,display_name=? WHERE table_id=? AND user_id=? AND EXISTS(SELECT 1 FROM shared_tables WHERE id=? AND last_operation=?)", JSON.stringify(prefs), identity.displayName, tableId, identity.userId, tableId, marker));
      } else if (action === "plan") {
        if (!keys(body, ["version", "plan"])) throw new SharedError("invalid_request", 400); const candidate = plan(body.plan); contentChange = canonical({ ...p, saved: false }) !== canonical(candidate); nextPlan = contentChange ? candidate : p;
      } else if (action === "approval") {
        if (!keys(body, ["version", "approved"]) || typeof body.approved !== "boolean" || !p.venueId) throw new SharedError("invalid_request", 400);
        extra.push(q("UPDATE shared_members SET approved_revision=? WHERE table_id=? AND user_id=? AND EXISTS(SELECT 1 FROM shared_tables WHERE id=? AND last_operation=?)", body.approved ? current.revision : null, tableId, identity.userId, tableId, marker)); if (!body.approved) nextPlan = { ...p, saved: false };
      } else if (action === "save") {
        if (!keys(body, ["version"]) || !p.venueId || !validSchedule(p, timestamp)) throw new SharedError("invalid_request", 400);
        if (!p.venueSnapshot) throw new SharedError("invalid_request", 400);
        if (p.venueSnapshot.source && p.venueSnapshot.source !== "demo") { if (!p.detailsAcknowledged) throw new SharedError("details_unconfirmed", 409); }
        else {
          const members = (await q("SELECT preferences_json FROM shared_members WHERE table_id=?", tableId).all<Row>()).results;
          if (members.some(m => { const prefs: SharedPreferences = JSON.parse(String(m.preferences_json)); return prefs.budget < p.venueSnapshot!.price || prefs.restrictions.some(r => !p.venueSnapshot!.dietary.some(d => d.toLowerCase() === r.toLowerCase())); })) throw new SharedError("plan_unfit", 409);
        }
        const missing = await q("SELECT COUNT(*) AS n FROM shared_members WHERE table_id=? AND (approved_revision IS NULL OR approved_revision<>?)", tableId, current.revision).first<Row>(); if (Number(missing?.n) !== 0) throw new SharedError("approval_required", 409); nextPlan = { ...p, saved: true };
      } else if (action === "invites") {
        if (!keys(body, ["version", "token"]) || typeof body.token !== "string" || !tokenPattern.test(body.token)) throw new SharedError("invalid_request", 400);
        const inviteId = uuid(); extra.push(q("INSERT INTO shared_invites(id,table_id,token_hash,created_by,created_at,expires_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM shared_tables WHERE id=? AND last_operation=?)", inviteId, tableId, await hash(body.token), identity.userId, timestamp, timestamp + 7 * 86400000, tableId, marker));
      } else if (action === "revoke-invite") {
        if (!keys(body, ["version", "inviteId"]) || !string(body.inviteId, 80)) throw new SharedError("invalid_request", 400);
        extra.push(q("UPDATE shared_invites SET revoked_at=? WHERE id=? AND table_id=? AND accepted_at IS NULL AND EXISTS(SELECT 1 FROM shared_tables WHERE id=? AND last_operation=?)", timestamp, body.inviteId, tableId, tableId, marker));
      } else {
        const target = action === "leave" ? identity.userId : body.userId;
        if (!keys(body, action === "leave" ? ["version"] : ["version", "userId"]) || !string(target, 200) || target === current.owner_id) throw new SharedError("forbidden", 403);
        if (!await q("SELECT user_id FROM shared_members WHERE table_id=? AND user_id=?", tableId, target).first()) throw new SharedError("not_found", 404);
        contentChange = true; extra.push(q("DELETE FROM shared_members WHERE table_id=? AND user_id=? AND EXISTS(SELECT 1 FROM shared_tables WHERE id=? AND last_operation=?)", tableId, target, tableId, marker));
      }
      if (contentChange) nextPlan = { ...nextPlan, saved: false };
      statements = [guarded(tableId, body.version, contentChange, nextPlan), ...extra, receipt(tableId)];
    }
    await db.batch(statements);
    const done = await operation(); if (!done) throw new SharedError("conflict", 409); if (done.request_hash !== requestHash) throw new SharedError("idempotency_conflict", 409);
    const resultId = String(JSON.parse(String(done.response_json)).tableId);
    if (path.endsWith("/leave")) return json(200, { left: true, tableId: resultId });
    return json(200, { table: await snapshot(resultId) });
  } catch (error) { const safe = error instanceof SharedError ? error : new SharedError("unavailable", 503); return json(safe.status, { code: safe.code, message: safe.message }); }
}
