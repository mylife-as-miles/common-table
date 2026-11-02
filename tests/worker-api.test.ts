import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApiHandler, handleApiRequest } from "../server/worker-api.ts";

const origin = "https://common-table.example";
const context = () => ({ view: "explore", mode: "book", venueId: "juniper", participantCount: 2, budget: 35, restrictions: ["Vegetarian"], planSaved: false });
const payload = () => ({ message: "Help with the budget", context: context() });
const noNetwork: typeof fetch = async () => { throw new Error("Network is forbidden in mock Waiter tests."); };
function post(body: unknown = payload(), headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/waiter/reply`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "X-Common-Table-Request": "waiter", ...headers }, body: JSON.stringify(body) });
}
async function error(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.code, code);
  assert.equal(typeof body.message, "string");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.ok(!JSON.stringify(body).includes("PRIVATE_ERROR_CANARY"));
}
const photon = (name = "Paris") => ({ features: [{ type: "Feature", geometry: { type: "Point", coordinates: [2.35, 48.86] }, properties: { name, country: "France", osm_id: 123, osm_type: "N" } }] });

test("public HTTPS status and reply retain mock-only shape and disclosures", async () => {
  const api = createWorkerApiHandler({ fetch: noNetwork });
  const status = await api(new Request(`${origin}/api/waiter/status`));
  assert.deepEqual(await status.json(), { mode: "mock" });
  const response = await api(post());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, "mock");
  assert.match(body.text, /^Offline demo · sample guidance\./);
  assert.doesNotMatch(body.text, /claude|anthropic|sonnet/i);
  assert.match(body.text, /illustrative \$48/);
  assert.deepEqual(Object.keys(body).sort(), ["source", "text"]);
  assert.equal((await handleApiRequest(new Request(`${origin}/api/waiter/status`))).status, 200);
});

test("reloaded real-map mode follows the active saved-plan or table context while explore stays geographic", async () => {
  const api = createWorkerApiHandler({ fetch: noNetwork, waiterIntervalMs: 0 });
  const ask = async (message: string, view = "plan") => {
    const response = await api(post({
      message,
      context: {
        ...context(), mode: "real", view, venueId: "juniper", planVenueId: "casa",
        planSaved: true, participantCount: 3, budget: 35, restrictions: ["Vegan"],
      },
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source, "mock");
    return body.text as string;
  };
  const plan = await ask("Help me finish this plan");
  assert.match(plan, /saved fictional dinner plan at Casa Nopal/);
  assert.doesNotMatch(plan, /Juniper|OpenStreetMap/);
  const budget = await ask("Does the budget work?");
  assert.match(budget, /Casa Nopal.*\$32-per-person/);
  assert.match(budget, /within.*\$35/);
  assert.doesNotMatch(budget, /Juniper|\$48|OpenStreetMap/);
  const dietary = await ask("What about vegan dietary needs?");
  assert.match(dietary, /Vegan/);
  assert.match(dietary, /Casa Nopal.*with those listed demo labels/);
  assert.doesNotMatch(dietary, /Juniper|missing these demo labels|OpenStreetMap/);
  const table = await ask("What should we do next?", "table");
  assert.match(table, /demo table has 3 seats/);
  assert.match(table, /\$35 per-person budget/);
  assert.doesNotMatch(table, /OpenStreetMap/);
  const explore = await ask("Help me finish this plan", "explore");
  assert.match(explore, /OpenStreetMap/);
  assert.match(explore, /not verified/);
  assert.doesNotMatch(explore, /Casa Nopal|Juniper|\$32|\$48/);
});

test("waiter rejects absent, malformed, cross-origin and hostile fetch contexts", async () => {
  const api = createWorkerApiHandler({ fetch: noNetwork, waiterIntervalMs: 0 });
  for (const supplied of ["https://evil.example", "null", `${origin}/`, `${origin}, https://evil.example`, "http://common-table.example"]) {
    await error(await api(post(payload(), { Origin: supplied })), 403, "origin_rejected");
  }
  const missing = post(); missing.headers.delete("origin");
  await error(await api(missing), 403, "origin_rejected");
  await error(await api(post(payload(), { "Sec-Fetch-Site": "cross-site" })), 403, "origin_rejected");
  await error(await api(post(payload(), { "Sec-Fetch-Mode": "navigate" })), 403, "origin_rejected");
  await error(await api(post(payload(), { "X-Common-Table-Request": "" })), 403, "csrf_rejected");
  assert.equal((await api(post(payload(), { "X-Forwarded-Host": "evil.example", "X-Forwarded-Proto": "http" }))).status, 200);
});

test("waiter method and route handling never enables CORS or arbitrary endpoints", async () => {
  const api = createWorkerApiHandler({ fetch: noNetwork });
  for (const method of ["GET", "OPTIONS", "PUT"]) {
    const response = await api(new Request(`${origin}/api/waiter/reply`, { method }));
    assert.equal(response.headers.get("allow"), "POST");
    await error(response, 405, "method_not_allowed");
  }
  await error(await api(new Request(`${origin}/api/waiter/status?live=true`)), 400, "invalid_request");
  await error(await api(new Request(`${origin}/api/arbitrary`)), 404, "not_found");
  await error(await api(new Request(`${origin}/api/waiter/status`, { headers: { Origin: "https://evil.example" } })), 403, "origin_rejected");
});

test("waiter validates JSON encoding, size, allowed fields and trusted context", async () => {
  const api = createWorkerApiHandler({ fetch: noNetwork, waiterIntervalMs: 0 });
  const unsupportedHeaders: Record<string, string>[] = [{ "Content-Type": "text/plain" }, { "Content-Encoding": "gzip" }];
  for (const headers of unsupportedHeaders) await error(await api(post(payload(), headers)), 415, "unsupported_media_type");
  await error(await api(post(payload(), { "Content-Length": "9000" })), 413, "body_too_large");
  await error(await api(post(payload(), { "Content-Length": "-1" })), 400, "invalid_request");
  await error(await api(post({ ...payload(), padding: "x".repeat(5000) })), 413, "body_too_large");
  const invalid = [null, [], {}, { ...payload(), message: "" }, { ...payload(), message: "x".repeat(601) }, { ...payload(), message: "bad\u0000message" }, { ...payload(), live: true }, { ...payload(), context: { ...context(), venueId: "real-restaurant" } }, { ...payload(), context: { ...context(), coordinates: [1, 2] } }, { ...payload(), context: { ...context(), planSaved: true } }];
  for (const body of invalid) await error(await api(post(body)), 400, "invalid_request");
  const malformed = new Request(`${origin}/api/waiter/reply`, { method: "POST", headers: post().headers, body: "{" });
  await error(await api(malformed), 400, "invalid_request");
  const invalidUtf8 = new Request(`${origin}/api/waiter/reply`, { method: "POST", headers: post().headers, body: new Uint8Array([0xff, 0xfe]) });
  await error(await api(invalidUtf8), 400, "invalid_request");
});

test("waiter stream bounds do not rely on content-length", async () => {
  const api = createWorkerApiHandler({ fetch: noNetwork });
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(3000)); controller.enqueue(new Uint8Array(3000)); controller.close(); } });
  const request = new Request(`${origin}/api/waiter/reply`, { method: "POST", headers: post().headers, body: stream, duplex: "half" } as RequestInit);
  await error(await api(request), 413, "body_too_large");
});

test("waiter rate limit and cancellation leave subsequent requests usable", async () => {
  let time = 1000;
  const api = createWorkerApiHandler({ fetch: noNetwork, now: () => time });
  assert.equal((await api(post())).status, 200);
  await error(await api(post()), 429, "rate_limited");
  time += 1000;
  const controller = new AbortController(); controller.abort();
  const request = new Request(post(), { signal: controller.signal });
  await error(await api(request), 499, "cancelled");
  assert.equal((await api(post())).status, 200);
});

test("stalled waiter body times out; concurrent request is rejected and later requests recover", async () => {
  const api = createWorkerApiHandler({ fetch: noNetwork, timeoutMs: 20, waiterIntervalMs: 0 });
  const stream = new ReadableStream<Uint8Array>({ start() {} });
  const request = new Request(`${origin}/api/waiter/reply`, { method: "POST", headers: post().headers, body: stream, duplex: "half" } as RequestInit);
  const pending = api(request);
  await error(await api(post()), 429, "busy");
  await error(await pending, 504, "timeout");
  assert.equal((await api(post())).status, 200);
});

test("geocode calls only the fixed Photon HTTPS origin and bounds returned facts", async () => {
  let calls = 0;
  const api = createWorkerApiHandler({ fetch: async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, "https://photon.komoot.io");
    assert.equal(url.pathname, "/api/");
    assert.equal(url.searchParams.get("q"), "Paris");
    assert.equal(url.searchParams.get("limit"), "5");
    assert.equal(init?.redirect, "manual");
    const data = photon("Pa\u0000ris");
    data.features.push({ ...data.features[0], geometry: { type: "Point", coordinates: [999, 999] } });
    return Response.json(data);
  } });
  const response = await api(new Request(`${origin}/api/geocode?q=Paris&url=https://evil.example`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { source: "photon", results: [{ id: "photon-N-123", label: "Paris, France", latitude: 48.86, longitude: 2.35 }] });
  const head = await api(new Request(`${origin}/api/geocode?q=paris`, { method: "HEAD" }));
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
  assert.equal(calls, 1);
});

test("geocode validates input and HTTP methods before any network request", async () => {
  const api = createWorkerApiHandler({ fetch: noNetwork });
  for (const query of ["", "q=a", "q=Paris&q=Berlin", "q=bad%00query", `q=${"x".repeat(121)}`]) await error(await api(new Request(`${origin}/api/geocode?${query}`)), 400, "invalid_query");
  const response = await api(new Request(`${origin}/api/geocode?q=Paris`, { method: "POST" }));
  assert.equal(response.headers.get("allow"), "GET, HEAD");
  await error(response, 405, "method_not_allowed");
});

test("geocode coalesces identical in-flight requests and throttles other searches", async () => {
  let complete!: (response: Response) => void;
  let calls = 0;
  let time = 0;
  const api = createWorkerApiHandler({ now: () => time, fetch: () => { calls++; return new Promise(resolve => { complete = resolve; }); } });
  const first = api(new Request(`${origin}/api/geocode?q=Paris`));
  const second = api(new Request(`${origin}/api/geocode?q=Paris`));
  await error(await api(new Request(`${origin}/api/geocode?q=Berlin`)), 429, "rate_limited");
  complete(Response.json(photon()));
  assert.equal((await first).status, 200); assert.equal((await second).status, 200); assert.equal(calls, 1);
  time = 15 * 60 * 1000 + 1;
  const expired = api(new Request(`${origin}/api/geocode?q=Paris`));
  complete(Response.json(photon()));
  assert.equal((await expired).status, 200); assert.equal(calls, 2);
});

test("geocode sanitizes failures, invalid data, oversized payloads and upstream timeout", async () => {
  for (const fetcher of [
    async () => { throw new Error("PRIVATE_ERROR_CANARY"); },
    async () => new Response("PRIVATE_ERROR_CANARY", { status: 500 }),
    async () => Response.json({ wrong: true }),
    async () => new Response("x".repeat(300_000)),
    async (_: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("PRIVATE_ERROR_CANARY")), { once: true })),
  ]) {
    const api = createWorkerApiHandler({ fetch: fetcher as typeof fetch, timeoutMs: 20 });
    await error(await api(new Request(`${origin}/api/geocode?q=Paris`)), 503, "upstream_unavailable");
  }
});


test("default fetch resolves the current platform method with its receiver", async () => {
  const original = globalThis.fetch;
  try {
    const api = createWorkerApiHandler();
    globalThis.fetch = async function(this: unknown, input: URL | RequestInfo) {
      assert.equal(this, globalThis);
      assert.equal(new URL(String(input)).origin, "https://photon.komoot.io");
      return Response.json(photon());
    };
    const response = await api(new Request(`${origin}/api/geocode?q=Paris`));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).results[0].label, "Paris, France");
  } finally { globalThis.fetch = original; }
});


test("Worker-compatible manual redirect policy rejects redirects without following them", async () => {
  let calls = 0;
  const api = createWorkerApiHandler({ fetch: async (_input, init) => {
    calls++;
    assert.equal(init?.redirect, "manual");
    return new Response(null, { status: 302, headers: { Location: "https://unexpected.example/" } });
  } });
  await error(await api(new Request(`${origin}/api/geocode?q=London`)), 503, "upstream_unavailable");
  assert.equal(calls, 1);
});
