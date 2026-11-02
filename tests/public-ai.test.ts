import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { resolvePublicAiVisitor, reservePublicAiQuota, PublicAiError, PUBLIC_AI_COOKIE, PUBLIC_AI_COOKIE_SECONDS, PUBLIC_AI_GLOBAL_SCOPE } from "../server/public-ai.ts";
import type { SharedDatabase } from "../server/shared-tables/index.ts";
import { createSharedD1 } from "./helpers/shared-d1.ts";

const SECRET = "public-ai-unit-fixture-secret-never-live-0001";
const NOW = Date.parse("2026-11-02T12:00:00Z");
const request = (cookie?: string, extra: Record<string, string> = {}) => new Request("https://table.example/api/waiter/status", { headers: { ...(cookie ? { Cookie: cookie } : {}), ...extra } });
const cookie = (setCookie: string | undefined) => { assert.ok(setCookie); return setCookie.split(";")[0]; };
const visitor = (req = request(), now = NOW) => resolvePublicAiVisitor(req, { secret: SECRET, identity: null, now: () => now });
function database(t: TestContext) { const d1 = createSharedD1(); t.after(d1.close); return d1; }
function unavailable(error: unknown) { return error instanceof PublicAiError && error.code === "public_ai_unavailable" && error.status === 503 && error.message === "Public guidance is temporarily unavailable."; }

test("an anonymous marker is opaque, HttpOnly, Secure, host-scoped and valid for exactly one day", async () => {
  const first = await visitor();
  assert.equal(first.authenticated, false); assert.match(first.quotaKey, /^ai:[a-f0-9]{64}$/);
  const header = first.setCookie!;
  assert.ok(header.startsWith(`${PUBLIC_AI_COOKIE}=v1.`));
  assert.deepEqual(header.split(";").slice(1).map(v => v.trim()), ["Path=/", "Max-Age=86400", "HttpOnly", "Secure", "SameSite=Lax"]);
  assert.ok(!header.includes("Domain=")); assert.equal(PUBLIC_AI_COOKIE_SECONDS, 86400);
  const reused = await visitor(request(cookie(header)), NOW + 86_399_000);
  assert.equal(reused.quotaKey, first.quotaKey); assert.equal(reused.setCookie, undefined); assert.equal(reused.authenticated, false);
  const expired = await visitor(request(cookie(header)), NOW + 86_400_000);
  assert.notEqual(expired.quotaKey, first.quotaKey); assert.ok(expired.setCookie); assert.equal(expired.authenticated, false);
});

test("forged, duplicate, overlong, noncanonical and future-issued cookies mint new guests and never identity", async () => {
  const first = await visitor(); const original = cookie(first.setCookie);
  const changed = original.slice(0, -1) + (original.endsWith("A") ? "B" : "A");
  const future = await visitor(request(), NOW + 60_000);
  for (const value of [changed, `${original}; ${original}`, `${original}; ${PUBLIC_AI_COOKIE}`, `${PUBLIC_AI_COOKIE}=${"x".repeat(400)}`, `${PUBLIC_AI_COOKIE}=user:local_seedy`, `${PUBLIC_AI_COOKIE}=v1.not-a-uuid.0.unsigned`, cookie(future.setCookie), `padding=${"x".repeat(9000)}; ${original}`]) {
    const resolved = await visitor(request(value)); assert.ok(resolved.setCookie); assert.equal(resolved.authenticated, false); assert.notEqual(resolved.quotaKey, first.quotaKey);
  }
  const anotherSecret = await resolvePublicAiVisitor(request(original), { secret: SECRET + "rotated", identity: null, now: () => NOW });
  assert.ok(anotherSecret.setCookie); assert.notEqual(anotherSecret.quotaKey, first.quotaKey);
});

test("signed-in quota subjects depend only on trusted stable identity and cannot be forged with a guest marker or IP headers", async () => {
  const guest = await visitor();
  const first = await resolvePublicAiVisitor(request(cookie(guest.setCookie)), { secret: SECRET, identity: { userId: "site-alice" }, now: () => NOW });
  const repeated = await resolvePublicAiVisitor(request(undefined, { "X-Forwarded-For": "192.0.2.9", "CF-Connecting-IP": "198.51.100.2" }), { secret: SECRET, identity: { userId: "site-alice" }, now: () => NOW + 1000 });
  assert.equal(first.authenticated, true); assert.equal(first.setCookie, undefined); assert.equal(first.quotaKey, repeated.quotaKey); assert.ok(!first.quotaKey.includes("site-alice")); assert.notEqual(first.quotaKey, guest.quotaKey);
  const bob = await resolvePublicAiVisitor(request(), { secret: SECRET, identity: { userId: "site-bob" }, now: () => NOW }); assert.notEqual(first.quotaKey, bob.quotaKey);
  const anonymous = await visitor(request(cookie(guest.setCookie), { "oai-authenticated-user-id": "site-alice", "X-Forwarded-For": "203.0.113.1" }));
  assert.equal(anonymous.authenticated, false); assert.equal(anonymous.quotaKey, guest.quotaKey);
});

test("configuration and trusted-identity failures close safely without exposing secret or user values", async () => {
  for (const secret of ["", "short", " ".repeat(40), SECRET + "\n"]) await assert.rejects(resolvePublicAiVisitor(request(), { secret, identity: null }), unavailable);
  await assert.rejects(resolvePublicAiVisitor(request(), { secret: SECRET, identity: { userId: "" } }), unavailable);
  await assert.rejects(resolvePublicAiVisitor(request(), { secret: SECRET, identity: { userId: "invalid\nidentity" } }), unavailable);
  await assert.rejects(resolvePublicAiVisitor(request(), { secret: SECRET, identity: null, now: () => NaN }), unavailable);
});

test("guidance and ranking share five visitor requests per UTC day, with no refund or isolate-local reset", async t => {
  const f = database(t); const who = await visitor();
  const flow = async (_name: "guidance" | "ranking", now = NOW) => reservePublicAiQuota(f.db, who.quotaKey, { now: () => now });
  for (const name of ["guidance", "ranking", "guidance", "ranking", "guidance"] as const) assert.equal(await flow(name), true);
  assert.equal(await flow("ranking"), false);
  assert.equal(await flow("guidance", NOW + 60_000), false);
  const row = f.sqlite.prepare("SELECT count FROM service_quotas WHERE scope=? AND window_start=?").get(`public-ai:visitor:${who.quotaKey}`, String(Math.floor(NOW / 86_400_000)));
  assert.equal(row?.count, 5);
  assert.equal(await flow("ranking", NOW + 86_400_000), true);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM ai_test_budget").get()?.n, 0);
});

test("a visitor already limited cannot consume the global minute allowance", async t => {
  const f = database(t); const first = await visitor();
  for (let i = 0; i < 5; i++) assert.equal(await reservePublicAiQuota(f.db, first.quotaKey, { now: () => NOW }), true);
  for (let i = 0; i < 4; i++) assert.equal(await reservePublicAiQuota(f.db, first.quotaKey, { now: () => NOW }), false);
  assert.equal(f.sqlite.prepare("SELECT count FROM service_quotas WHERE scope=?").get(PUBLIC_AI_GLOBAL_SCOPE)?.count, 5);
  const second = await visitor(); assert.equal(await reservePublicAiQuota(f.db, second.quotaKey, { now: () => NOW }), true);
  const third = await visitor(); assert.equal(await reservePublicAiQuota(f.db, third.quotaKey, { now: () => NOW }), false);
});

test("concurrent callers cannot exceed the global six-request minute burst or each visitor's five-request day", async t => {
  const f = database(t);
  const visitors = await Promise.all(Array.from({ length: 12 }, () => visitor()));
  const allowed = await Promise.all(visitors.map(who => reservePublicAiQuota(f.db, who.quotaKey, { now: () => NOW })));
  assert.equal(allowed.filter(Boolean).length, 6);
  assert.equal(f.sqlite.prepare("SELECT count FROM service_quotas WHERE scope=?").get(PUBLIC_AI_GLOBAL_SCOPE)?.count, 6);
  const who = visitors[0];
  const same = await Promise.all(Array.from({ length: 12 }, () => reservePublicAiQuota(f.db, who.quotaKey, { now: () => NOW + 60_000 })));
  assert.equal(same.filter(Boolean).length, 4);
  assert.equal(f.sqlite.prepare("SELECT count FROM service_quotas WHERE scope=?").get(`public-ai:visitor:${who.quotaKey}`)?.count, 5);
});

test("database errors, malformed receipts and invalid quota subjects never allow a request", async () => {
  let calls = 0;
  const key = (await visitor()).quotaKey;
  const broken = { prepare() { return { bind() { return this; }, async first() { calls++; throw new Error("PRIVATE_DATABASE_CANARY"); } }; } } as unknown as SharedDatabase;
  await assert.rejects(reservePublicAiQuota(broken, "site-alice"), unavailable); assert.equal(calls, 0);
  await assert.rejects(reservePublicAiQuota(broken, key), unavailable); assert.equal(calls, 1);
  for (const result of [undefined, [], {}, { count: 0 }, { count: 7 }, { count: 1.5 }, { success: false, count: 1 }]) {
    const malformed = { prepare() { return { bind() { return this; }, async first() { return result; } }; } } as unknown as SharedDatabase;
    await assert.rejects(reservePublicAiQuota(malformed, key), unavailable);
  }
});

test("fresh markers denied by a full burst cannot create unbounded visitor rows", async t => {
  const f = database(t);
  for (let i = 0; i < 6; i++) assert.equal(await reservePublicAiQuota(f.db, `ai:${i.toString(16).padStart(64, "0")}`, { now: () => NOW }), true);
  const count = () => f.sqlite.prepare("SELECT COUNT(*) AS n FROM service_quotas WHERE scope LIKE 'public-ai:visitor:%'").get()?.n;
  assert.equal(count(), 6);
  for (let i = 6; i < 40; i++) assert.equal(await reservePublicAiQuota(f.db, `ai:${i.toString(16).padStart(64, "0")}`, { now: () => NOW }), false);
  assert.equal(count(), 6);
  assert.equal(f.sqlite.prepare("SELECT count FROM service_quotas WHERE scope=?").get(PUBLIC_AI_GLOBAL_SCOPE)?.count, 6);
  const deniedVisitor = `ai:${(39).toString(16).padStart(64, "0")}`;
  for (let i = 0; i < 5; i++) assert.equal(await reservePublicAiQuota(f.db, deniedVisitor, { now: () => NOW + 60_000 }), true);
  assert.equal(await reservePublicAiQuota(f.db, deniedVisitor, { now: () => NOW + 60_000 }), false);
  assert.equal(f.sqlite.prepare("SELECT count FROM service_quotas WHERE scope=?").get(`public-ai:visitor:${deniedVisitor}`)?.count, 5);
});
