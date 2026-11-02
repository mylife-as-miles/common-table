import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { handleServices, type ServiceContext } from "../server/services.ts";
import { GUIDANCE_MODEL } from "../server/guidance/client.ts";
import {
  initializeBudget,
  readBudget,
  reserveGuidance,
} from "../server/guidance/budget.ts";
import { createSharedD1 } from "./helpers/shared-d1.ts";

// Every transport is synthetic. A missing trusted fetcher must fail rather than use the network.
const previousFetch = globalThis.fetch;
let unexpectedNetwork = 0;
globalThis.fetch = async () => {
  unexpectedNetwork++;
  throw new Error(
    "External network is forbidden in service integration tests.",
  );
};
after(() => {
  globalThis.fetch = previousFetch;
  assert.equal(unexpectedNetwork, 0);
});
const ORIGIN = "https://synthetic-services.example";
const KEY = "dummy-independent-server-key-NEVER-LIVE";
const LIMIT_KEY = "public-ai-test-secret-".repeat(3);
const TOKEN = "a".repeat(64);
const OWNER = {
  userId: "private-owner-user",
  displayName: "PRIVATE_OWNER_NAME",
  email: "private-owner@example.invalid",
};
const MEMBER = {
  userId: "private-member-user",
  displayName: "PRIVATE_MEMBER_NAME",
  email: "private-member@example.invalid",
};
const waiterContext = {
  view: "explore",
  mode: "book",
  venueId: "juniper",
  participantCount: 1,
  budget: 55,
  restrictions: [],
  tastes: ["Italian"],
  planSaved: false,
};
type Call = { url: URL; init: RequestInit; body?: Record<string, unknown> };
let sequence = 0;

async function fixture(t: TestContext, initialized = true) {
  const storage = createSharedD1();
  t.after(storage.close);
  if (initialized) await initializeBudget(storage.db);
  const index = ++sequence;
  const point = { latitude: 40.5 + index / 1000, longitude: -73.9 };
  const venueId = `osm:node:${81000000 + index}`;
  const input = {
    ...point,
    participants: [
      { tastes: ["Italian"], budget: 55, restrictions: ["Vegetarian"] },
    ],
    vetoes: [],
    seedVenueIds: [],
  };
  const calls: Call[] = [];
  let rankedIds = [venueId];
  const fetcher: typeof fetch = async (target, init = {}) => {
    const url = new URL(
      target instanceof Request ? target.url : String(target),
    );
    const call: Call = {
      url,
      init,
      ...(typeof init.body === "string" ? { body: JSON.parse(init.body) } : {}),
    };
    calls.push(call);
    assert.equal(init.redirect, "manual");
    if (url.origin === "https://photon.komoot.io") {
      assert.equal(url.pathname, "/reverse");
      assert.equal(url.searchParams.get("radius"), "1.8");
      assert.deepEqual(url.searchParams.getAll("osm_tag"), ["amenity:restaurant", "amenity:cafe"]);
      assert.equal(new Headers(init.headers).has("Authorization"), false);
      assert.equal(url.href.includes(KEY), false);
      return Response.json({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
          properties: {
            osm_type: "N", osm_id: 81000000 + index, osm_key: "amenity", osm_value: "restaurant",
            name: "Synthetic Dining Room",
            extra: { cuisine: "italian", website: "https://restaurant.example/", "diet:vegan": "yes", opening_hours: "24/7", "reservation:website": "https://unverified-booking.example/" },
          },
        }],
      });
    }
    if (url.origin === "https://api.openstreetmap.org") {
      assert.equal(url.pathname, "/api/0.6/node/5521624421.json");
      assert.equal(new Headers(init.headers).has("Authorization"), false);
      return Response.json({ elements: [{ type: "node", id: 5521624421, lat: 40.6897579, lon: -73.98015, tags: { name: "Synthetic Mapped Cafe", amenity: "cafe" } }] });
    }
    assert.equal(url.origin, "https://api.anthropic.com");
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      `Bearer ${KEY}`,
    );
    if (url.pathname === "/v1/organizations/me")
      return Response.json({
        type: "organization",
        id: "org_synthetic",
        name: "Startrz",
      });
    if (url.pathname === `/v1/models/${GUIDANCE_MODEL}`)
      return Response.json({ id: GUIDANCE_MODEL, type: "model" });
    assert.equal(url.pathname, "/v1/messages");
    const ranking = String(call.body?.system).includes(
      "Trusted candidate records:",
    );
    return Response.json({
      type: "message",
      role: "assistant",
      model: GUIDANCE_MODEL,
      content: [
        {
          type: "text",
          text: ranking
            ? JSON.stringify({
                orderedIds: rankedIds,
              })
            : "Confirm the menu directly before agreeing on this sample plan.",
        },
      ],
      usage: { input_tokens: 500, output_tokens: 80 },
    });
  };
  const context: ServiceContext = {
    apiKey: KEY,
    publicAiLimitKey: LIMIT_KEY,
    db: storage.db,
    identity: OWNER,
    ownerEmail: OWNER.email,
    fetcher,
  };
  const call = async (
    path: string,
    body?: unknown,
    contextPatch: Partial<ServiceContext> = {},
    headerPatch: Record<string, string> = {},
  ) => {
    const csrf =
      path === "/api/recommendations"
        ? "recommendations"
        : path === "/api/internal/verification"
          ? "verification"
          : "waiter";
    const response = await handleServices(
      new Request(ORIGIN + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: ORIGIN,
          "Content-Type": "application/json",
          "X-Common-Table-Request": csrf,
          ...headerPatch,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { ...context, ...contextPatch },
    );
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json(),
    };
  };
  const secret = () =>
    JSON.stringify({ token: TOKEN, expiresAt: Date.now() + 60_000 });
  const verify = (
    body: unknown,
    patch: Partial<ServiceContext> = {},
    headers: Record<string, string> = {},
  ) =>
    call(
      "/api/internal/verification",
      body,
      { identity: null, verificationSecret: secret(), ...patch },
      { Authorization: `Bearer ${TOKEN}`, ...headers },
    );
  return {
    ...storage,
    context,
    calls,
    input,
    venueId,
    call,
    verify,
    setRanking: (ids: string[]) => {
      rankedIds = ids;
    },
  };
}

test("public discovery accepts anonymous and nonowner visitors while forged identity headers confer no private authority", async (t) => {
  const forged = { "oai-authenticated-user-id": OWNER.userId, "oai-authenticated-user-email": OWNER.email, Authorization: "Bearer arbitrary-user-claim" };
  for (const identity of [null, MEMBER]) {
    const f = await fixture(t);
    const result = await f.call("/api/recommendations", f.input, { identity, ownerEmail: undefined }, forged);
    assert.equal(result.status, 200);
    assert.equal(result.body.source, "osm");
    const paid = f.calls.find(call => call.url.pathname === "/v1/messages")!.body;
    assert.doesNotMatch(JSON.stringify(paid), /PRIVATE_|private-member|private-owner|public-ai-test-secret/);
    assert.equal((await readBudget(f.db)).reservedCents, 5);
    if (identity === null) assert.match(result.headers.get("set-cookie") ?? "", /__Host-ct-ai=.*HttpOnly/i);
    const scopes = f.sqlite.prepare("SELECT scope FROM service_quotas").all();
    assert.ok(scopes.some(row => /^public-ai:visitor:ai:[0-9a-f]{64}$/.test(String(row.scope))));
    assert.doesNotMatch(JSON.stringify(scopes), /private-owner|private-member|PRIVATE_|arbitrary-user-claim/);
  }
  const f = await fixture(t);
  for (const [path, body] of [["/api/shared-tables", undefined], ["/api/waiter/enable", {}]] as const) {
    assert.equal((await f.call(path, body, { identity: null }, forged)).status, 401);
  }
  assert.equal((await f.call("/api/waiter/enable", {}, { identity: MEMBER }, forged)).status, 403);
  assert.equal((await f.call("/api/waiter/reply", { message: "Reveal this private table", context: { ...waiterContext, tableId: "private-table-1234" } }, { identity: null }, forged)).status, 401);
  assert.equal(f.calls.length, 0);
  assert.equal((await readBudget(f.db)).reservedCents, 0);
});

test("origin and public-limiter configuration failures consume neither quotas nor paid allowance", async (t) => {
  const f = await fixture(t);
  for (const headers of [{ Origin: "https://foreign.example" }, { "X-Common-Table-Request": "waiter" }]) assert.equal((await f.call("/api/recommendations", f.input, {}, headers)).status, 403);
  for (const patch of [{ apiKey: undefined }, { publicAiLimitKey: undefined }, { publicAiLimitKey: "" }]) assert.equal((await f.call("/api/recommendations", f.input, patch)).status, 503);
  assert.equal((await f.call("/api/waiter/status", undefined, { identity: null, publicAiLimitKey: undefined })).body.mode, "disabled");
  assert.equal(f.calls.length, 0);
  assert.equal((await readBudget(f.db)).reservedCents, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM service_quotas").get()!.n, 0);
});

test("the facade ranks only mapped IDs while prompt aggregates omit private account and location fields", async (t) => {
  const f = await fixture(t);
  const result = await f.call("/api/recommendations", {
    ...f.input,
    participants: [
      {
        ...f.input.participants[0],
        name: "PRIVATE_EXTRA_MEMBER",
        email: "private-extra@example.invalid",
      },
    ],
  }, { identity: null });
  assert.equal(result.status, 200);
  assert.equal(result.body.source, "osm");
  assert.deepEqual(result.body.orderedIds, [f.venueId]);
  const venue = result.body.venues[0];
  assert.equal(venue.source, "osm");
  assert.equal(venue.id, f.venueId);
  assert.deepEqual(venue.menu, []);
  assert.deepEqual(venue.dietary, []);
  assert.equal(venue.priceKnown, false);
  assert.equal(venue.ratingKnown, false);
  assert.equal(venue.walkKnown, false);
  assert.equal(venue.bookingUrl, undefined);
  assert.equal(
    result.body.rationales[f.venueId],
    "Italian cuisine to compare.",
  );
  const paid = f.calls.find(
    (call) => call.url.pathname === "/v1/messages",
  )!.body!;
  assert.match(String(paid.system), /Italian/);
  assert.match(String(paid.system), /Vegetarian/);
  assert.doesNotMatch(
    JSON.stringify(paid),
    /PRIVATE_|private-owner|private-extra|latitude|longitude|40\.5\d+|-73\.9/,
  );
  assert.doesNotMatch(
    JSON.stringify(result.body),
    /Claude|Anthropic|Qloo|Sonnet|unverified-booking/,
  );
  assert.equal((await readBudget(f.db)).reservedCents, 5);
});

test("an invented ranked ID is rejected after one irrevocable reservation and cannot acquire restaurant facts", async (t) => {
  const f = await fixture(t);
  f.setRanking(["osm:node:999999999"]);
  const result = await f.call("/api/recommendations", f.input);
  assert.equal(result.status, 502);
  assert.equal(result.body.venues, undefined);
  assert.equal(
    f.calls.filter((call) => call.url.pathname === "/v1/messages").length,
    1,
  );
  assert.equal((await readBudget(f.db)).reservedCents, 5);
  assert.doesNotMatch(
    JSON.stringify(result.body),
    /999999999|dummy-independent|Synthetic Dining Room/,
  );
});

test("Waiter, discovery and temporary verification share one durable cap that enable never refills", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 98; i++) await reserveGuidance(f.db);
  assert.equal(
    (
      await f.call("/api/waiter/reply", {
        message: "One next step, please.",
        context: waiterContext,
      })
    ).status,
    200,
  );
  assert.equal((await f.call("/api/recommendations", f.input)).status, 200);
  const count = f.calls.length;
  assert.deepEqual(await readBudget(f.db), {
    initialized: true,
    attempts: 100,
    reservedCents: 500,
  });
  assert.equal((await f.call("/api/recommendations", f.input)).status, 429);
  assert.equal(
    (
      await f.call("/api/waiter/reply", {
        message: "Another next step.",
        context: waiterContext,
      })
    ).status,
    429,
  );
  assert.equal((await f.call("/api/waiter/enable", {})).status, 200);
  assert.equal((await f.verify({ operation: "enable" })).status, 200);
  assert.equal((await f.verify({ operation: "waiter" })).status, 429);
  assert.equal(f.calls.length, count);
  assert.deepEqual(await readBudget(f.db), {
    initialized: true,
    attempts: 100,
    reservedCents: 500,
  });
});

test("temporary verification is absent without an unexpired configured capability and requires the exact Bearer scheme", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.call("/api/internal/verification", { operation: "waiter" }))
      .status,
    404,
  );
  for (const verificationSecret of [
    "invalid JSON",
    JSON.stringify({ token: TOKEN, expiresAt: Date.now() - 1 }),
    JSON.stringify({ token: "bad", expiresAt: Date.now() + 60_000 }),
  ])
    assert.equal(
      (await f.verify({ operation: "waiter" }, { verificationSecret })).status,
      404,
    );
  for (const authorization of [
    "",
    TOKEN,
    `Basic ${TOKEN}`,
    `Bearer ${"b".repeat(64)}`,
  ])
    assert.equal(
      (
        await f.verify(
          { operation: "waiter" },
          {},
          { Authorization: authorization },
        )
      ).status,
      401,
    );
  assert.equal(
    (
      await f.verify(
        { operation: "waiter" },
        {},
        { Origin: "https://foreign.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.verify(
        { operation: "waiter" },
        {},
        { "X-Common-Table-Request": "waiter" },
      )
    ).status,
    403,
  );
  assert.equal(f.calls.length, 0);
  assert.equal((await readBudget(f.db)).attempts, 0);
});

test("verification accepts no arbitrary question, shared table, location or payload and cannot consume its operation on invalid input", async (t) => {
  const f = await fixture(t, false);
  for (const body of [
    { operation: "waiter", message: "PRIVATE_ARBITRARY_QUESTION" },
    { operation: "waiter", tableId: "private-table-id" },
    { operation: "recommendations", latitude: 0 },
    { operation: "shared-tables" },
    { operation: ["enable"] },
    { operation: ["waiter"] },
    { operation: "enable", token: TOKEN },
  ])
    assert.equal((await f.verify(body)).status, 400);
  assert.equal((await f.verify({ operation: "x".repeat(200) })).status, 413);
  assert.equal(f.calls.length, 0);
  assert.equal(
    f.sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM service_quotas WHERE scope LIKE 'verification:%'",
      )
      .get()!.n,
    0,
  );
  assert.equal((await f.verify({ operation: "enable" })).status, 200);
  assert.deepEqual(await readBudget(f.db), {
    initialized: true,
    attempts: 0,
    reservedCents: 0,
  });
});

test("concurrent machine verification permits one fixed solo request, never reads shared records and becomes absent after secret removal", async (t) => {
  const f = await fixture(t);
  const db = {
    ...f.db,
    prepare(sql: string) {
      assert.doesNotMatch(sql, /shared_tables|shared_members/);
      return f.db.prepare(sql);
    },
  };
  const [first, second] = await Promise.all([
    f.verify({ operation: "waiter" }, { db, identity: MEMBER }),
    f.verify({ operation: "waiter" }, { db, identity: MEMBER }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 429]);
  assert.equal(
    f.calls.filter((call) => call.url.pathname === "/v1/messages").length,
    1,
  );
  const paid = f.calls.find(
    (call) => call.url.pathname === "/v1/messages",
  )!.body!;
  assert.doesNotMatch(
    JSON.stringify(paid),
    /PRIVATE_|private-member|private-owner|tableId|latitude|longitude/,
  );
  assert.match(JSON.stringify(paid), /mapped restaurant/);
  assert.match(JSON.stringify(paid), /Synthetic Mapped Cafe/);
  assert.equal((await readBudget(f.db)).reservedCents, 5);
  const scopes = f.sqlite
    .prepare(
      "SELECT scope FROM service_quotas WHERE scope LIKE 'verification:%'",
    )
    .all();
  assert.equal(scopes.length, 1);
  assert.equal(String(scopes[0].scope).includes(TOKEN), false);
  assert.equal(
    (await f.verify({ operation: "waiter" }, { verificationSecret: undefined }))
      .status,
    404,
  );
});

test("one signed anonymous visitor shares five daily requests across guidance and ranking while status checks are free", async (t) => {
  const f = await fixture(t);
  const status = await f.call("/api/waiter/status", undefined, { identity: null });
  assert.equal(status.status, 200);
  assert.equal(status.body.mode, "live");
  const cookie = status.headers.get("set-cookie")!.split(";")[0];
  assert.match(cookie, /^__Host-ct-ai=v1\./);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM service_quotas").get()!.n, 0);
  for (let i = 0; i < 5; i++) {
    const result = i % 2 === 0
      ? await f.call("/api/waiter/reply", { message: "One useful next step, please.", context: waiterContext }, { identity: null }, { Cookie: cookie })
      : await f.call("/api/recommendations", f.input, { identity: null }, { Cookie: cookie });
    assert.equal(result.status, 200);
  }
  const count = f.calls.length;
  assert.equal((await f.call("/api/waiter/status", undefined, { identity: null }, { Cookie: cookie })).body.mode, "live");
  assert.equal((await f.call("/api/recommendations", f.input, { identity: null }, { Cookie: cookie })).status, 429);
  assert.equal((await f.call("/api/waiter/reply", { message: "Another next step.", context: waiterContext }, { identity: null }, { Cookie: cookie })).status, 429);
  assert.equal(f.calls.length, count);
  assert.equal(f.calls.filter(call => call.url.pathname === "/v1/messages").length, 5);
  assert.deepEqual(await readBudget(f.db), { initialized: true, attempts: 5, reservedCents: 25 });
  const visitors = f.sqlite.prepare("SELECT scope,count FROM service_quotas WHERE scope LIKE 'public-ai:visitor:%'").all();
  assert.equal(visitors.length, 1);
  assert.equal(visitors[0].count, 5);
  assert.match(String(visitors[0].scope), /^public-ai:visitor:ai:[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(visitors), /PRIVATE_|private-owner|public-ai-test-secret|__Host-ct-ai|v1\./);
});

test("the public burst guard permits six different visitors in one minute and rejects the seventh before generation", async (t) => {
  t.mock.method(Date, "now", () => Date.UTC(2026, 10, 2, 12, 0, 10));
  const f = await fixture(t);
  for (let i = 0; i < 6; i++) {
    const identity = { userId: `synthetic-signed-user-${i}`, displayName: `PRIVATE_VISITOR_${i}`, email: `private-visitor-${i}@example.invalid` };
    assert.equal((await f.call("/api/waiter/reply", { message: "One useful next step.", context: waiterContext }, { identity })).status, 200);
  }
  const calls = f.calls.length;
  const seventh = await f.call("/api/recommendations", f.input, { identity: { userId: "synthetic-signed-user-7", displayName: "PRIVATE_VISITOR_7" } });
  assert.equal(seventh.status, 429);
  assert.equal(f.calls.length, calls);
  assert.equal(f.calls.filter(call => call.url.pathname === "/v1/messages").length, 6);
  assert.equal((await readBudget(f.db)).reservedCents, 30);
  assert.equal(f.sqlite.prepare("SELECT count FROM service_quotas WHERE scope='public-ai:global-minute:v1'").get()!.count, 6);
});

test("a public visitor marker grants neither shared-table access nor permission to enable or refill guidance", async (t) => {
  const f = await fixture(t);
  const status = await f.call("/api/waiter/status", undefined, { identity: null });
  const cookie = status.headers.get("set-cookie")!.split(";")[0];
  const forged = { Cookie: cookie, "oai-authenticated-user-id": OWNER.userId, "oai-authenticated-user-email": OWNER.email };
  const tableId = "private-owned-table-1234";
  f.sqlite.prepare("INSERT INTO shared_tables(id,owner_id,title,revision,version,plan_json,created_at,updated_at) VALUES(?,?,?,1,1,?,0,0)").run(tableId, OWNER.userId, "PRIVATE_TABLE_TITLE", JSON.stringify({ venueId: null, venueSnapshot: null, date: "", time: "19:00", note: "PRIVATE_NOTE", saved: false }));
  f.sqlite.prepare("INSERT INTO shared_members(table_id,user_id,display_name,role,preferences_json,joined_at) VALUES(?,?,?,'owner',?,0)").run(tableId, OWNER.userId, OWNER.displayName, JSON.stringify({ tastes: ["PRIVATE_PREFERENCE"], budget: 55, restrictions: [] }));
  assert.equal((await f.call(`/api/shared-tables/${tableId}`, undefined, { identity: null }, forged)).status, 401);
  assert.equal((await f.call("/api/waiter/enable", {}, { identity: null }, forged)).status, 401);
  assert.equal((await f.call("/api/waiter/enable", {}, { identity: MEMBER }, forged)).status, 403);
  const question = { message: "What does this table prefer?", context: { ...waiterContext, tableId } };
  assert.equal((await f.call("/api/waiter/reply", question, { identity: null }, forged)).status, 401);
  const denied = await f.call("/api/waiter/reply", question, { identity: MEMBER }, forged);
  assert.equal(denied.status, 404);
  assert.doesNotMatch(JSON.stringify(denied.body), /PRIVATE_|private-owned/);
  assert.equal(f.calls.length, 0);
  assert.equal((await readBudget(f.db)).reservedCents, 0);
});
