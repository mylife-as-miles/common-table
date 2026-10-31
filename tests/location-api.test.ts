import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppServer } from "../server/index.ts";
import { createApiHandler, type ApiOptions } from "../server/location-api.ts";

const PHOTON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        osm_id: 9691750,
        osm_type: "R",
        name: "Brooklyn",
        city: "New York",
        state: "New York",
        country: "United States",
      },
      geometry: { type: "Point", coordinates: [-73.9497211, 40.6526006] },
    },
  ],
};
const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function serverFor(
  t: TestContext,
  options: ApiOptions & { distDir?: string } = {},
) {
  const server = createAppServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test address");
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  return `http://127.0.0.1:${address.port}`;
}

test("city search uses Photon and sanitizes real OpenStreetMap features", async (t) => {
  let upstream: URL | undefined;
  const base = await serverFor(t, {
    fetch: async (input, init) => {
      assert.equal(init?.redirect, "error");
      upstream = new URL(String(input));
      return jsonResponse(PHOTON);
    },
  });
  const response = await fetch(`${base}/api/geocode?q=Brooklyn`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(upstream?.origin, "https://photon.komoot.io");
  assert.equal(upstream?.pathname, "/api/");
  assert.equal(upstream?.searchParams.get("q"), "Brooklyn");
  assert.equal(upstream?.searchParams.get("limit"), "5");
  assert.deepEqual(body, {
    source: "photon",
    results: [
      {
        id: "photon-R-9691750",
        label: "Brooklyn, New York, United States",
        latitude: 40.6526006,
        longitude: -73.9497211,
      },
    ],
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("search input cannot select an upstream host and malformed geographic features are excluded", async (t) => {
  let upstream: URL | undefined;
  const base = await serverFor(t, {
    fetch: async (input) => {
      upstream = new URL(String(input));
      return jsonResponse({
        features: [
          ...PHOTON.features,
          {
            ...PHOTON.features[0],
            geometry: { type: "Point", coordinates: [181, 40] },
          },
          {
            ...PHOTON.features[0],
            geometry: { type: "Point", coordinates: [0, -91] },
          },
          {
            ...PHOTON.features[0],
            geometry: { type: "Point", coordinates: ["0", 10] },
          },
          {
            ...PHOTON.features[0],
            geometry: { type: "LineString", coordinates: [0, 10] },
          },
        ],
      });
    },
  });
  const query = "https://attacker.invalid/internal?q=private";
  const body = await (
    await fetch(`${base}/api/geocode?q=${encodeURIComponent(query)}`)
  ).json();
  assert.equal(upstream?.origin, "https://photon.komoot.io");
  assert.equal(upstream?.searchParams.get("q"), query);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].latitude, 40.6526006);
});

test("provider quota, outage and malformed-payload failures use safe unavailable responses", async (t) => {
  for (const status of [429, 500]) {
    const base = await serverFor(t, {
      fetch: async () =>
        jsonResponse({ message: "private provider diagnostics" }, status),
    });
    const response = await fetch(`${base}/api/geocode?q=Brooklyn`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, "upstream_unavailable");
    assert.ok(!JSON.stringify(body).includes("private provider diagnostics"));
  }
  const malformed = await serverFor(t, {
    fetch: async () => jsonResponse({ features: {} }),
  });
  assert.equal(
    (await fetch(`${malformed}/api/geocode?q=Brooklyn`)).status,
    503,
  );
});

test("place requests abort at the configured timeout without exposing thrown errors", async (t) => {
  let aborted = false;
  const base = await serverFor(t, {
    timeoutMs: 20,
    fetch: async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("private transport details"));
          },
          { once: true },
        );
      }),
  });
  const response = await fetch(`${base}/api/geocode?q=Brooklyn`);
  assert.equal(response.status, 503);
  assert.equal(aborted, true);
  assert.ok(!(await response.text()).includes("private transport details"));
});

test("place queries validate before fetching, missing matches are empty results, and provider outage is not an empty success", async (t) => {
  let calls = 0;
  const base = await serverFor(t, {
    fetch: async () => {
      calls++;
      return jsonResponse({ features: [] });
    },
    geocodeIntervalMs: 0,
  });
  for (const query of [
    "",
    "?q=",
    "?q=A",
    "?q=Brook%00lyn",
    "?q=Brook%0Alyn",
    `?q=${"a".repeat(121)}`,
    "?q=Paris&q=London",
  ]) {
    assert.equal((await fetch(`${base}/api/geocode${query}`)).status, 400);
  }
  assert.equal(calls, 0);
  const empty = await (await fetch(`${base}/api/geocode?q=NoSuchPlace`)).json();
  assert.deepEqual(empty, { source: "photon", results: [] });
  const failed = await serverFor(t, {
    fetch: async () => {
      throw new Error("internal-only");
    },
  });
  const response = await fetch(`${failed}/api/geocode?q=Brooklyn`);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "upstream_unavailable");
});

test("city search cache coalesces repeated calls, lasts fifteen minutes and rate-limits different rapid searches", async (t) => {
  let now = 10_000;
  let calls = 0;
  const base = await serverFor(t, {
    now: () => now,
    fetch: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return jsonResponse(PHOTON);
    },
  });
  const responses = await Promise.all([
    fetch(`${base}/api/geocode?q=Brooklyn`),
    fetch(`${base}/api/geocode?q=brooklyn`),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200],
  );
  assert.equal(calls, 1);
  assert.equal((await fetch(`${base}/api/geocode?q=Brooklyn`)).status, 200);
  assert.equal(calls, 1);
  const tooFast = await fetch(`${base}/api/geocode?q=Queens`);
  assert.equal(tooFast.status, 429);
  assert.equal(tooFast.headers.get("retry-after"), "1");
  now += 15 * 60 * 1000 + 1;
  assert.equal((await fetch(`${base}/api/geocode?q=Brooklyn`)).status, 200);
  assert.equal(calls, 2);
});

test("API methods are read-only, HEAD has no body, unknown API paths do not return SPA HTML", async (t) => {
  const base = await serverFor(t, { fetch: async () => jsonResponse(PHOTON) });
  const response = await fetch(`${base}/api/geocode?q=Brooklyn`, {
    method: "POST",
  });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
  const head = await fetch(`${base}/api/geocode?q=Brooklyn`, {
    method: "HEAD",
  });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const unknown = await fetch(`${base}/api/nope`);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).code, "not_found");
});

test("standalone server serves built SPA/assets but cannot expose traversal, secret files or escaping symlinks", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "common-table-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dist = join(directory, "dist");
  await mkdir(dist);
  await writeFile(join(dist, "index.html"), "<h1>Common Table</h1>");
  await writeFile(join(dist, "app.js"), 'console.log("ok")');
  await writeFile(
    join(dist, ".env.local"),
    "PRIVATE_CONFIG=accidental-dist-secret",
  );
  await writeFile(join(directory, ".env.local"), "PRIVATE_CONFIG=private-key");
  await symlink(join(directory, ".env.local"), join(dist, "leak.txt"));
  const base = await serverFor(t, { distDir: dist });
  const route = await fetch(`${base}/dinner/tonight`);
  assert.equal(route.status, 200);
  assert.ok((await route.text()).includes("Common Table"));
  const script = await fetch(`${base}/app.js`);
  assert.equal(script.status, 200);
  assert.ok(script.headers.get("content-type")?.includes("javascript"));
  assert.equal((await fetch(`${base}/not-found.js`)).status, 404);
  assert.equal((await fetch(`${base}/leak.txt`)).status, 403);
  const dotfile = await fetch(`${base}/.env.local`);
  assert.equal(dotfile.status, 403);
  assert.ok(!(await dotfile.text()).includes("accidental-dist-secret"));
  for (const path of ["/%2e%2e%2f.env.local", "/%2e%2e%5c.env.local", "/%00"]) {
    const response = await fetch(`${base}${path}`);
    assert.ok(response.status >= 400);
    assert.ok(!(await response.text()).includes("private-key"));
  }
  const head = await fetch(`${base}/app.js`, { method: "HEAD" });
  assert.equal(await head.text(), "");
});

test("middleware passes non-API requests through without starting a second server", async () => {
  let nextCalls = 0;
  const handler = createApiHandler();
  const handled = await handler(
    { url: "/menu", method: "GET" } as never,
    {} as never,
    () => {
      nextCalls++;
    },
  );
  assert.equal(handled, false);
  assert.equal(nextCalls, 1);
});
