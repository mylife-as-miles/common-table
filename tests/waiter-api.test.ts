import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaudeReply } from "../server/claude-client.ts";
import { readClaudeConfig } from "../server/claude-config.ts";

const actualFetch = globalThis.fetch;
let forbiddenNetworkAttempts = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    forbiddenNetworkAttempts++;
    throw new Error("External network is forbidden in Waiter tests.");
  }
  return actualFetch(input, init);
};
after(() => {
  globalThis.fetch = actualFetch;
  assert.equal(forbiddenNetworkAttempts, 0);
});
const {
  createWaiterApiHandler,
  MAX_WAITER_BODY_BYTES,
  MAX_WAITER_MESSAGE_CHARS,
} = await import("../server/waiter-api.ts");
type Options = import("../server/waiter-api.ts").WaiterApiOptions;
const {
  trustedWaiterContext,
  parseWaiterContext,
  WAITER_VENUE_IDS,
  WAITER_RESTRICTIONS,
} = await import("../server/waiter-context.ts");
const KEY = "dummy-waiter-key-NEVER-LIVE";
const PRIVATE = "PRIVATE_WAITER_DIAGNOSTIC_CANARY";
const mockReply = (text: string): ClaudeReply => ({
  source: "mock",
  model: "claude-sonnet-5-5",
  text,
});
const context = (changes: Record<string, unknown> = {}) => ({
  view: "explore",
  mode: "book",
  venueId: "juniper",
  participantCount: 2,
  budget: 35,
  restrictions: ["Vegetarian"],
  planSaved: false,
  ...changes,
});
const payload = (changes: Record<string, unknown> = {}) => ({
  message: "Help with the budget",
  context: context(),
  ...changes,
});

async function mount(
  t: TestContext,
  options: Options = {},
  mode: "mock" | "live" | "disabled" = "mock",
  integrated = false,
) {
  const root = await mkdtemp(join(tmpdir(), "common-table-waiter-http-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = readClaudeConfig(
    { ANTHROPIC_MODE: mode, ANTHROPIC_API_KEY: KEY },
    root,
  );
  const opts = { intervalMs: 0, ...options };
  const handler = createWaiterApiHandler(config, opts);
  let server: Server;
  if (integrated) {
    const { createAppServer } = await import("../server/index.ts");
    server = createAppServer({ claudeConfig: config, waiter: opts });
  } else {
    server = createServer((req, res) => {
      void handler(req, res)
        .then((handled) => {
          if (!handled) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end('{"code":"not_found"}');
          }
        })
        .catch(() => {
          if (!res.headersSent) res.writeHead(500);
          res.end("Test adapter failed safely.");
        });
    });
  }
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    handler.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = {
    Origin: base,
    "Content-Type": "application/json",
    "X-Common-Table-Request": "waiter",
  };
  const post = (
    body: unknown = payload(),
    extra: Record<string, string> = {},
  ) =>
    fetch(`${base}/api/waiter/reply`, {
      method: "POST",
      headers: { ...headers, ...extra },
      body: JSON.stringify(body),
    });
  return { base, handler, config, headers, post };
}
async function errorBody(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.status, "error");
  assert.equal(body.code, code);
  assert.equal(typeof body.message, "string");
  assert.deepEqual(Object.keys(body).sort(), ["code", "message", "status"]);
  assert.ok(!JSON.stringify(body).includes(KEY));
  assert.ok(!JSON.stringify(body).includes(PRIVATE));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  return body;
}
async function noLedger(path: string) {
  await assert.rejects(access(path), { code: "ENOENT" });
}
function raw(
  base: string,
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: string | Buffer,
  finish = true,
) {
  return new Promise<{
    status: number;
    headers: import("node:http").IncomingHttpHeaders;
    text: string;
  }>((resolve, reject) => {
    const url = new URL(base);
    const req = httpRequest(
      { hostname: url.hostname, port: url.port, path, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          });
          req.destroy();
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.setTimeout(2000, () =>
      req.destroy(new Error("Local HTTP fixture timed out.")),
    );
    if (body !== undefined) req.write(body);
    if (finish) req.end();
  });
}

test("real standalone routing serves only an explicit offline reply and exposes safe status without a provider or ledger", async (t) => {
  const f = await mount(t, {}, "mock", true);
  const status = await fetch(`${f.base}/api/waiter/status`);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { mode: "mock" });
  const response = await f.post();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, "mock");
  assert.match(body.text, /^Offline demo · sample guidance\./);
  assert.doesNotMatch(body.text, /claude|anthropic|sonnet/i);
  assert.match(body.text, /Juniper & Rye/);
  assert.match(body.text, /\$48/);
  assert.match(body.text, /\$35/);
  assert.ok(
    Object.keys(body).every((key) => ["source", "text", "model"].includes(key)),
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    response.headers.get("cross-origin-resource-policy"),
    "same-origin",
  );
  await noLedger(f.config.ledgerPath);
});

test("live and disabled browser modes cannot invoke even an injected client or expose key/configuration", async (t) => {
  for (const mode of ["live", "disabled"] as const) {
    let calls = 0;
    const f = await mount(
      t,
      {
        client: {
          async reply() {
            calls++;
            return {
              source: "anthropic",
              text: PRIVATE,
              model: "claude-sonnet-5-5",
            };
          },
        },
      },
      mode,
    );
    assert.deepEqual(
      await (await fetch(`${f.base}/api/waiter/status`)).json(),
      { mode: "disabled" },
    );
    await errorBody(await f.post(), 503, "disabled");
    assert.equal(calls, 0);
    await noLedger(f.config.ledgerPath);
  }
});

test("a mock client receives trimmed text, trusted server rules and only the context allowlist", async (t) => {
  const calls: { message: string; context?: string; signal?: AbortSignal }[] =
    [];
  const f = await mount(t, {
    client: {
      async reply(message, summary, signal) {
        calls.push({ message, context: summary, signal });
        return {
          source: "mock",
          model: "claude-sonnet-5-5",
          text: "Review the table before choosing.",
        };
      },
    },
  });
  const response = await f.post(
    payload({
      message: "  ¿Cena para dos? 🌿  ",
      context: context({
        view: "plan",
        planVenueId: "olive",
        planSaved: true,
        restrictions: ["Vegan", "Nut-free"],
      }),
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, "mock");
  assert.match(body.text, /^Offline demo/);
  assert.equal(body.model, "claude-sonnet-5-5");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message, "¿Cena para dos? 🌿");
  assert.ok(calls[0].signal instanceof AbortSignal);
  const summary = calls[0].context!;
  assert.match(summary, /fictional demo data/);
  assert.match(summary, /cannot take actions/);
  assert.match(summary, /"planVenueId":"olive"/);
  assert.match(summary, /"budget":35/);
  assert.ok(!summary.includes(KEY));
  await noLedger(f.config.ledgerPath);
});

test("server catalogue ids, names, prices and dietary labels stay aligned with the app catalogue", async () => {
  const sourceUrl = new URL("../src/domain/data.ts", import.meta.url).href;
  const { venues, restrictionOptions } = await import(sourceUrl);
  assert.deepEqual(
    [...WAITER_VENUE_IDS].sort(),
    venues.map((venue: { id: string }) => venue.id).sort(),
  );
  assert.deepEqual(
    [...WAITER_RESTRICTIONS].sort(),
    [...restrictionOptions].sort(),
  );
  const trusted = trustedWaiterContext(parseWaiterContext(context())!);
  const line = trusted
    .split("\n")
    .find((value) => value.startsWith("Fictional catalogue: "))!;
  const facts = JSON.parse(line.slice("Fictional catalogue: ".length));
  const project = (venue: {
    id: string;
    name: string;
    price: number;
    dietary: string[];
  }) => ({
    id: venue.id,
    name: venue.name,
    price: venue.price,
    dietary: [...venue.dietary].sort(),
  });
  assert.deepEqual(
    facts
      .map(project)
      .sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)),
    venues
      .map(project)
      .sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)),
  );
});

test("real map replies cannot pass off fictional demo restaurants as mapped facts", async (t) => {
  const f = await mount(t);
  const body = await (
    await f.post(payload({ context: context({ mode: "real" }) }))
  ).json();
  assert.equal(body.source, "mock");
  assert.match(body.text, /OpenStreetMap/);
  assert.match(body.text, /not verified/);
  assert.match(body.text, /stay separate/);
  for (const name of [
    "Juniper & Rye",
    "Olive & Ember",
    "Momo House",
    "Casa Nopal",
    "Sunday People",
    "Bomi",
  ])
    assert.ok(!body.text.includes(name));
});

test("reloaded real-map mode follows the active saved-plan or table context while explore stays geographic", async (t) => {
  const f = await mount(t);
  const ask = async (message: string, view = "plan") => {
    const response = await f.post(payload({
      message,
      context: context({
        mode: "real", view, venueId: "juniper", planVenueId: "casa",
        planSaved: true, participantCount: 3, budget: 35, restrictions: ["Vegan"],
      }),
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
  await noLedger(f.config.ledgerPath);
});

test("foreign/missing origins, forged proxy headers and browser navigation cannot bypass the CSRF boundary", async (t) => {
  let calls = 0;
  const f = await mount(t, {
    client: {
      async reply() {
        calls++;
        return mockReply("safe");
      },
    },
  });
  const variants: Record<string, string>[] = [
    { Origin: "http://foreign.invalid" },
    { Origin: "null" },
    { Origin: `${f.base}/` },
    {
      Origin: "http://foreign.invalid",
      "X-Forwarded-Host": "foreign.invalid",
      "X-Forwarded-Proto": "http",
    },
    { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "same-site" },
    { "Sec-Fetch-Mode": "navigate" },
  ];
  for (const changes of variants) {
    const result = await raw(
      f.base,
      "/api/waiter/reply",
      "POST",
      { ...f.headers, ...changes },
      JSON.stringify(payload()),
    );
    assert.equal(result.status, 403);
    assert.equal(JSON.parse(result.text).code, "origin_rejected");
  }
  const missing = { ...f.headers };
  delete (missing as Partial<typeof missing>).Origin;
  const absent = await raw(
    f.base,
    "/api/waiter/reply",
    "POST",
    missing,
    JSON.stringify(payload()),
  );
  assert.equal(absent.status, 403);
  assert.equal(JSON.parse(absent.text).code, "origin_rejected");
  const csrf = { ...f.headers };
  delete (csrf as Partial<typeof csrf>)["X-Common-Table-Request"];
  const result = await raw(
    f.base,
    "/api/waiter/reply",
    "POST",
    csrf,
    JSON.stringify(payload()),
  );
  assert.equal(result.status, 403);
  assert.equal(JSON.parse(result.text).code, "csrf_rejected");
  await errorBody(
    await fetch(`${f.base}/api/waiter/status`, {
      headers: { Origin: "http://foreign.invalid" },
    }),
    403,
    "origin_rejected",
  );
  assert.equal(calls, 0);
});

test("an explicit public origin works through TLS termination while forwarded headers alone grant nothing", async (t) => {
  const f = await mount(t, { expectedOrigin: "https://common-table.example" });
  const accepted = await raw(
    f.base,
    "/api/waiter/reply",
    "POST",
    { ...f.headers, Origin: "https://common-table.example" },
    JSON.stringify(payload()),
  );
  assert.equal(accepted.status, 200);
  assert.equal(JSON.parse(accepted.text).source, "mock");
  const rejected = await raw(
    f.base,
    "/api/waiter/reply",
    "POST",
    {
      ...f.headers,
      Origin: "https://attacker.invalid",
      "X-Forwarded-Host": "common-table.example",
      "X-Forwarded-Proto": "https",
    },
    JSON.stringify(payload()),
  );
  assert.equal(rejected.status, 403);
});

test("route methods, raw path normalization and media type are strict and never produce a paid request", async (t) => {
  let calls = 0;
  const f = await mount(t, {
    client: {
      async reply() {
        calls++;
        return mockReply("safe");
      },
    },
  });
  for (const [path, method, allow] of [
    ["/api/waiter/status", "POST", "GET"],
    ["/api/waiter/status", "HEAD", "GET"],
    ["/api/waiter/reply", "GET", "POST"],
    ["/api/waiter/reply", "OPTIONS", "POST"],
  ]) {
    const result = await raw(f.base, path, method, f.headers);
    assert.equal(result.status, 405);
    assert.equal(result.headers.allow, allow);
    assert.equal(result.headers["access-control-allow-origin"], undefined);
  }
  for (const path of [
    "/api/waiter/reply?mode=live",
    "/api/waiter/reply#fragment",
    "/api/other/../waiter/reply",
    "//api/waiter/reply",
  ]) {
    const result = await raw(
      f.base,
      path,
      "POST",
      f.headers,
      JSON.stringify(payload()),
    );
    assert.ok([400, 404].includes(result.status));
  }
  const mediaHeaders: Record<string, string>[] = [
    { "Content-Type": "text/plain" },
    { "Content-Type": "application/x-www-form-urlencoded" },
    { "Content-Type": "application/json; charset=latin1" },
    { "Content-Encoding": "gzip" },
    { "Content-Encoding": "identity" },
  ];
  for (const changes of mediaHeaders)
    await errorBody(
      await f.post(payload(), changes),
      415,
      "unsupported_media_type",
    );
  assert.equal((await fetch(`${f.base}/api/waiter/unknown`)).status, 404);
  assert.equal(calls, 0);
});

test("unsupported context values, extra private fields and caller model/provider controls are rejected before the client", async (t) => {
  let calls = 0;
  const f = await mount(t, {
    client: {
      async reply() {
        calls++;
        return mockReply("safe");
      },
    },
  });
  const contexts = [
    null,
    [],
    {},
    context({ view: "unknown" }),
    context({ mode: ["book"] }),
    context({ venueId: "not-a-demo-venue" }),
    context({ participantCount: 0 }),
    context({ participantCount: 7 }),
    context({ participantCount: 1.5 }),
    context({ budget: 0 }),
    context({ budget: 1001 }),
    context({ budget: "35" }),
    context({ restrictions: ["Vegan", "Vegan"] }),
    context({ restrictions: ["Shellfish-free"] }),
    context({ restrictions: "Vegan" }),
    context({ planSaved: "false" }),
    context({ planSaved: true }),
    context({ planVenueId: null }),
    context({ planVenueId: "unknown" }),
    context({ guestNames: [PRIVATE] }),
    context({ latitude: 40.7, longitude: -73.9 }),
    context({ location: PRIVATE }),
    context({ instructions: PRIVATE }),
    context({ apiKey: KEY }),
  ];
  for (const value of contexts)
    await errorBody(
      await f.post(payload({ context: value })),
      400,
      "invalid_request",
    );
  for (const value of [
    null,
    [],
    { ...payload(), source: "anthropic" },
    { ...payload(), model: "other" },
    { ...payload(), apiKey: KEY },
    { ...payload(), endpoint: "https://attacker.invalid" },
    { ...payload(), mode: "live" },
    payload({ message: "" }),
    payload({ message: "   " }),
    payload({ message: 123 }),
    payload({ message: `bad\u0000${PRIVATE}` }),
    payload({ message: "x".repeat(601) }),
  ])
    await errorBody(await f.post(value), 400, "invalid_request");
  assert.equal(MAX_WAITER_MESSAGE_CHARS, 600);
  assert.equal(calls, 0);
  await noLedger(f.config.ledgerPath);
});

test("declared and chunked payloads are bounded by UTF8 bytes and malformed JSON/UTF8 is safe", async (t) => {
  let calls = 0;
  const f = await mount(t, {
    client: {
      async reply() {
        calls++;
        return mockReply("safe");
      },
    },
  });
  assert.equal(MAX_WAITER_BODY_BYTES, 4096);
  const declared = await raw(
    f.base,
    "/api/waiter/reply",
    "POST",
    { ...f.headers, "Content-Length": "999999" },
    "{}",
  );
  assert.equal(declared.status, 413);
  assert.equal(JSON.parse(declared.text).code, "body_too_large");
  assert.equal(declared.headers.connection, "close");
  const afterDeclared = await raw(
    f.base,
    "/api/waiter/reply",
    "POST",
    f.headers,
    JSON.stringify(payload()),
  );
  assert.equal(afterDeclared.status, 200);
  const streamed = await raw(
    f.base,
    "/api/waiter/reply",
    "POST",
    f.headers,
    JSON.stringify(payload({ message: "🫒".repeat(1100) })),
  );
  assert.equal(streamed.status, 413);
  assert.equal(JSON.parse(streamed.text).code, "body_too_large");
  for (const body of [
    `not-json ${PRIVATE}`,
    Buffer.from([123, 34, 0xff, 34, 125]),
  ]) {
    const response = await raw(
      f.base,
      "/api/waiter/reply",
      "POST",
      f.headers,
      body,
    );
    assert.equal(response.status, 400);
    assert.equal(JSON.parse(response.text).code, "invalid_request");
    assert.ok(!response.text.includes(PRIVATE));
  }
  assert.equal(calls, 1);
});

test("only bounded mock source and the pinned optional model may cross the HTTP boundary", async (t) => {
  for (const result of [
    { source: "anthropic", text: PRIVATE },
    { source: "unknown", text: "safe" },
    { source: "mock", text: "" },
    { source: "mock", text: "x".repeat(8000) },
    { source: "mock", text: `echo ${KEY}` },
    { source: "mock", text: "safe", model: "other-model" },
    { source: "mock", text: "bad\u0000text" },
  ]) {
    const f = await mount(t, {
      client: {
        async reply() {
          return result as ClaudeReply;
        },
      },
    });
    await errorBody(await f.post(), 502, "unavailable");
    await noLedger(f.config.ledgerPath);
  }
  const f = await mount(t, {
    client: {
      async reply() {
        throw new Error(`${PRIVATE} ${KEY}`);
      },
    },
  });
  await errorBody(await f.post(), 502, "unavailable");
});

test("busy requests are not coalesced and the per-adapter interval is enforced without automatic resubmission", async (t) => {
  let finish!: (value: ClaudeReply) => void,
    calls = 0,
    time = 0;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const f = await mount(t, {
    now: () => time,
    intervalMs: 1000,
    client: {
      reply() {
        calls++;
        return calls === 1
          ? new Promise((resolve) => {
              finish = resolve;
              started();
            })
          : Promise.resolve(mockReply("safe"));
      },
    },
  });
  const pending = f.post();
  await Promise.race([
    ready,
    pending.then(() => {
      throw new Error("Expected the mock adapter to stay pending.");
    }),
  ]);
  await errorBody(await f.post(), 429, "busy");
  assert.equal(calls, 1);
  finish(mockReply("first"));
  assert.equal((await pending).status, 200);
  await errorBody(await f.post(), 429, "rate_limited");
  assert.equal(calls, 1);
  time = 1000;
  assert.equal((await f.post()).status, 200);
  assert.equal(calls, 2);
});

test(
  "timeout bounds both a slow request body and an unresponsive mock adapter",
  { timeout: 3000 },
  async (t) => {
    const body = await mount(t, { timeoutMs: 20 });
    const partial = await raw(
      body.base,
      "/api/waiter/reply",
      "POST",
      body.headers,
      '{"message":',
      false,
    );
    assert.equal(partial.status, 504);
    assert.equal(JSON.parse(partial.text).code, "timeout");
    let aborted = false,
      calls = 0;
    const client = await mount(t, {
      timeoutMs: 20,
      client: {
        reply(_message, _context, signal) {
          calls++;
          signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
            },
            { once: true },
          );
          return new Promise(() => {});
        },
      },
    });
    await errorBody(await client.post(), 504, "timeout");
    assert.equal(aborted, true);
    assert.equal(calls, 1);
  },
);

test(
  "disconnect cancels the in-flight adapter and releases busy state for a later explicit request",
  { timeout: 3000 },
  async (t) => {
    let started!: () => void,
      cancelled!: () => void,
      calls = 0;
    const ready = new Promise<void>((resolve) => {
        started = resolve;
      }),
      stopped = new Promise<void>((resolve) => {
        cancelled = resolve;
      });
    const f = await mount(t, {
      client: {
        reply(_message, _context, signal) {
          calls++;
          if (calls > 1) return Promise.resolve(mockReply("new request"));
          return new Promise((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => {
                cancelled();
                reject(new Error(PRIVATE));
              },
              { once: true },
            );
            started();
          });
        },
      },
    });
    const controller = new AbortController();
    const pending = fetch(`${f.base}/api/waiter/reply`, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify(payload()),
      signal: controller.signal,
    });
    await ready;
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    await stopped;
    const subsequent = await f.post();
    assert.equal(subsequent.status, 200);
    assert.equal(calls, 2);
  },
);

test("closing the handler aborts pending work safely and does not close a caller-owned client", async (t) => {
  let started!: () => void,
    aborted = false,
    closes = 0;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const client = {
    reply(
      _message: string,
      _context?: string,
      signal?: AbortSignal,
    ): Promise<ClaudeReply> {
      signal?.addEventListener(
        "abort",
        () => {
          aborted = true;
        },
        { once: true },
      );
      started();
      return new Promise(() => {});
    },
    close() {
      closes++;
    },
  };
  const f = await mount(t, { client });
  const pending = f.post();
  await ready;
  f.handler.close();
  await errorBody(await pending, 503, "closed");
  assert.equal(aborted, true);
  assert.equal(closes, 0);
  await errorBody(await f.post(), 503, "closed");
});
