import test from "node:test";
import assert from "node:assert/strict";
import { createSharedD1 } from "./helpers/shared-d1.ts";
import { handleSharedTablesRequest } from "../server/shared-tables/index.ts";
import { venues } from "../src/domain/data.ts";
import { sanitizeVenueSnapshot } from "../src/domain/catalog.ts";
import { sharedMutationTarget } from "../src/collaboration/types.ts";

const origin = "https://table.example";
const alice = { userId: "site-alice", displayName: "Alice" };
const bob = { userId: "site-bob", displayName: "Bob" };
const eve = { userId: "site-eve", displayName: "Eve" };
const prefs = { tastes: ["Italian"], budget: 65, restrictions: ["Vegetarian"] };
const plan = { venueId: "juniper", venueSnapshot: venues[0], date: "2099-04-12", time: "19:00", note: "Dinner", saved: false };
function fixture(t: { after(fn: () => void): unknown }) {
  const d1 = createSharedD1(); t.after(d1.close);
  const call = async (path: string, user: typeof alice | null = alice, body?: unknown, key = crypto.randomUUID()) => {
    const request = new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { Origin: origin, "Content-Type": "application/json", "X-Common-Table-Request": "shared-table", "Idempotency-Key": key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const response = await handleSharedTablesRequest(request, { db: d1.db, identity: user, now: () => 1800000000000 });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const create = async () => { const r = await call("/api/shared-tables", alice, { title: "Friday supper", preferences: prefs, plan }); assert.equal(r.status, 200); return r.body.table; };
  return { ...d1, call, create };
}

test("shared tables require trusted identity, enforce membership and never accept a client identity", async t => {
  const f = fixture(t);
  assert.equal((await f.call("/api/shared-tables", null)).status, 401);
  const table = await f.create();
  assert.equal((await f.call(`/api/shared-tables/${table.id}`, eve)).status, 404);
  assert.equal((await f.call(`/api/shared-tables/${table.id}/preferences`, alice, { version: table.version, userId: eve.userId, preferences: prefs })).status, 400);
  const rejected = await handleSharedTablesRequest(new Request(origin + "/api/shared-tables", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json", "X-Common-Table-Request": "shared-table", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ title: "Forged", preferences: prefs }) }), { db: f.db, identity: alice });
  assert.equal(rejected.status, 403);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM shared_tables").get()?.n, 1);
});

test("invites store only hashes, require explicit authenticated acceptance and cannot be reused", async t => {
  const f = fixture(t); let table = await f.create(); const token = "a".repeat(43);
  const invited = await f.call(`/api/shared-tables/${table.id}/invites`, alice, { version: table.version, token }); assert.equal(invited.status, 200); table = invited.body.table;
  const stored = f.sqlite.prepare("SELECT * FROM shared_invites").get(); assert.equal(String(stored?.token_hash).length, 64); assert.ok(!JSON.stringify(stored).includes(token));
  assert.ok(!JSON.stringify(f.sqlite.prepare("SELECT * FROM shared_operations").all()).includes(token));
  assert.equal((await f.call("/api/shared-tables/invites/preview", null, { token })).status, 401);
  const preview = await f.call("/api/shared-tables/invites/preview", bob, { token }); assert.equal(preview.status, 200); assert.equal(preview.body.invitation.title, "Friday supper"); assert.equal(preview.body.invitation.members, undefined);
  assert.equal((await f.call(`/api/shared-tables/${table.id}`, bob)).status, 404);
  const accepted = await f.call("/api/shared-tables/join", bob, { token, preferences: prefs }); assert.equal(accepted.status, 200); assert.equal(accepted.body.table.members.length, 2); assert.equal(accepted.body.table.revision, 2);
  assert.equal((await f.call("/api/shared-tables/join", eve, { token, preferences: prefs })).status, 410);
  assert.equal((await f.call(`/api/shared-tables/${table.id}/plan`, bob, { version: accepted.body.table.version, plan })).status, 403);
});

test("own approvals bind exact content revision, saving needs every member, and preference edits invalidate agreement", async t => {
  const f = fixture(t); let table = await f.create(); const token = "b".repeat(43);
  table = (await f.call(`/api/shared-tables/${table.id}/invites`, alice, { version: table.version, token })).body.table;
  table = (await f.call("/api/shared-tables/join", bob, { token, preferences: prefs })).body.table;
  table = (await f.call(`/api/shared-tables/${table.id}/approval`, alice, { version: table.version, approved: true })).body.table;
  assert.equal((await f.call(`/api/shared-tables/${table.id}/save`, alice, { version: table.version })).status, 409);
  assert.equal((await f.call(`/api/shared-tables/${table.id}/approval`, alice, { version: table.version, approved: true, userId: bob.userId })).status, 400);
  table = (await f.call(`/api/shared-tables/${table.id}/approval`, bob, { version: table.version, approved: true })).body.table;
  const approvedRevision = table.revision;
  table = (await f.call(`/api/shared-tables/${table.id}/save`, alice, { version: table.version })).body.table;
  assert.equal(table.plan.saved, true); assert.equal(table.revision, approvedRevision);
  table = (await f.call(`/api/shared-tables/${table.id}/preferences`, bob, { version: table.version, preferences: { ...prefs, budget: 55 } })).body.table;
  assert.equal(table.revision, approvedRevision + 1); assert.equal(table.plan.saved, false);
  assert.ok(table.members.every((m: { approvedRevision: number }) => m.approvedRevision !== table.revision));
  assert.equal((await f.call(`/api/shared-tables/${table.id}/save`, alice, { version: table.version })).status, 409);
});

test("optimistic concurrency and durable idempotency prevent stale and repeated writes", async t => {
  const f = fixture(t); const key = crypto.randomUUID();
  const first = await f.call("/api/shared-tables", alice, { title: "Once", preferences: prefs, plan }, key);
  const repeated = await f.call("/api/shared-tables", alice, { title: "Once", preferences: prefs, plan }, key);
  assert.equal(repeated.status, 200); assert.equal(repeated.body.replayed, true); assert.equal(first.body.table.id, repeated.body.table.id); assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM shared_tables").get()?.n, 1);
  assert.equal((await f.call("/api/shared-tables", alice, { title: "Twice", preferences: prefs, plan }, key)).status, 409);
  const id = first.body.table.id, version = first.body.table.version;
  assert.equal((await f.call(`/api/shared-tables/${id}/plan`, alice, { version, plan: { ...plan, note: "Changed" } })).status, 200);
  assert.equal((await f.call(`/api/shared-tables/${id}/plan`, alice, { version, plan: { ...plan, note: "Stale" } })).status, 409);
  assert.equal((await f.call(`/api/shared-tables/${id}`)).body.table.plan.note, "Changed");
});

test("revoked and expired invitations cannot grant membership; owners cannot leave their own table", async t => {
  const f = fixture(t); let table = await f.create(); const token = "c".repeat(43);
  table = (await f.call(`/api/shared-tables/${table.id}/invites`, alice, { version: table.version, token })).body.table;
  table = (await f.call(`/api/shared-tables/${table.id}/revoke-invite`, alice, { version: table.version, inviteId: table.invites[0].id })).body.table;
  assert.equal((await f.call("/api/shared-tables/join", bob, { token })).status, 410);
  assert.equal((await f.call(`/api/shared-tables/${table.id}/leave`, alice, { version: table.version })).status, 403);
  const expiredToken = "d".repeat(43);
  table = (await f.call(`/api/shared-tables/${table.id}/invites`, alice, { version: table.version, token: expiredToken })).body.table;
  f.sqlite.prepare("UPDATE shared_invites SET expires_at=0 WHERE revoked_at IS NULL").run();
  assert.equal((await f.call("/api/shared-tables/join", bob, { token: expiredToken })).status, 410);
});

test("concurrent invite acceptance cannot exceed six seats and leaving is durably idempotent", async t => {
  const f = fixture(t); let table = await f.create();
  for (let i = 0; i < 4; i++) {
    const token = String(i).repeat(43); table = (await f.call(`/api/shared-tables/${table.id}/invites`, alice, { version: table.version, token })).body.table;
    table = (await f.call("/api/shared-tables/join", { userId: `member-${i}`, displayName: `Member ${i}` }, { token, preferences: prefs })).body.table;
  }
  const tokens = ["e".repeat(43), "f".repeat(43)];
  for (const token of tokens) table = (await f.call(`/api/shared-tables/${table.id}/invites`, alice, { version: table.version, token })).body.table;
  const joined = await Promise.all([f.call("/api/shared-tables/join", bob, { token: tokens[0], preferences: prefs }), f.call("/api/shared-tables/join", eve, { token: tokens[1], preferences: prefs })]);
  assert.equal(joined.filter(r => r.status === 200).length, 1); assert.equal(joined.filter(r => r.status === 409).length, 1);
  table = (await f.call(`/api/shared-tables/${table.id}`)).body.table; assert.equal(table.members.length, 6);
  const winner = joined[0].status === 200 ? bob : eve; const key = crypto.randomUUID();
  const left = await f.call(`/api/shared-tables/${table.id}/leave`, winner, { version: table.version }, key); assert.equal(left.status, 200); assert.equal(left.body.left, true);
  const replayed = await f.call(`/api/shared-tables/${table.id}/leave`, winner, { version: table.version }, key); assert.equal(replayed.status, 200); assert.equal(replayed.body.replayed, true);
  assert.equal((await f.call(`/api/shared-tables/${table.id}`, winner)).status, 404);
});

test("saving cannot bypass a demo budget mismatch and budget schema keeps the fixed test ceiling", async t => {
  const f = fixture(t); let table = await f.create();
  table = (await f.call(`/api/shared-tables/${table.id}/preferences`, alice, { version: table.version, preferences: { ...prefs, budget: 20 } })).body.table;
  table = (await f.call(`/api/shared-tables/${table.id}/approval`, alice, { version: table.version, approved: true })).body.table;
  const saved = await f.call(`/api/shared-tables/${table.id}/save`, alice, { version: table.version }); assert.equal(saved.status, 409); assert.equal(saved.body.code, "plan_unfit");
  f.sqlite.prepare("INSERT INTO ai_test_budget(scope,cap_cents,reserved_cents,attempts,updated_at) VALUES('global-test-v1',500,500,100,0)").run();
  assert.throws(() => f.sqlite.prepare("UPDATE ai_test_budget SET attempts=101,reserved_cents=505").run());
  assert.throws(() => f.sqlite.prepare("UPDATE ai_test_budget SET cap_cents=1000").run());
  assert.throws(() => f.sqlite.prepare("INSERT INTO ai_test_attempts(id,scope,attempt,reservation_cents,created_at) VALUES('wrong','global-test-v1',1,100,0)").run());
});

test("real shared plans accept the trusted placeholder, restore provider identity and require missing-detail acknowledgment", async t => {
  const f = fixture(t);
  const venue = sanitizeVenueSnapshot({ id: "qloo:11111111-1111-4111-8111-111111111111", providerEntityId: "11111111-1111-4111-8111-111111111111", source: "qloo", name: "A real candidate", latitude: 40.7, longitude: -74, description: "x".repeat(1800), neighborhood: "n".repeat(180) })!;
  assert.equal(venue.image, "/venue-placeholder.svg");
  const created = await f.call("/api/shared-tables", alice, { title: "Real dinner", preferences: prefs, plan: { ...plan, venueId: venue.id, venueSnapshot: venue } }); assert.equal(created.status, 200);
  let table = (await f.call(`/api/shared-tables/${created.body.table.id}`)).body.table;
  assert.equal(table.plan.venueSnapshot.id, venue.id); assert.equal(table.plan.venueSnapshot.image, "/venue-placeholder.svg"); assert.equal(table.plan.venueSnapshot.priceKnown, false);
  table = (await f.call(`/api/shared-tables/${table.id}/approval`, alice, { version: table.version, approved: true })).body.table;
  const unconfirmed = await f.call(`/api/shared-tables/${table.id}/save`, alice, { version: table.version }); assert.equal(unconfirmed.body.code, "details_unconfirmed");
  table = (await f.call(`/api/shared-tables/${table.id}/plan`, alice, { version: table.version, plan: { ...table.plan, detailsAcknowledged: true } })).body.table;
  table = (await f.call(`/api/shared-tables/${table.id}/approval`, alice, { version: table.version, approved: true })).body.table;
  assert.equal((await f.call(`/api/shared-tables/${table.id}/save`, alice, { version: table.version })).body.table.plan.saved, true);
});

test("approval and save intents bind the displayed version and cannot consent to an unseen polled update", async t => {
  const f = fixture(t); const displayed = await f.create(); const intent = sharedMutationTarget(displayed)!;
  const changed = await f.call(`/api/shared-tables/${displayed.id}/plan`, alice, { version: displayed.version, plan: { ...plan, note: "Changed after rendering" } }); assert.equal(changed.status, 200);
  const polled = changed.body.table;
  assert.notEqual(polled.version, intent.version);
  assert.equal((await f.call(`/api/shared-tables/${intent.tableId}/approval`, alice, { version: intent.version, approved: true })).status, 409);
  assert.equal((await f.call(`/api/shared-tables/${intent.tableId}/save`, alice, { version: intent.version })).status, 409);
  const current = (await f.call(`/api/shared-tables/${displayed.id}`)).body.table;
  assert.equal(current.members[0].approvedRevision, null); assert.equal(current.plan.saved, false);
  assert.equal(sharedMutationTarget(null), null);
  assert.equal(sharedMutationTarget(displayed, polled.version)?.version, polled.version);
});
