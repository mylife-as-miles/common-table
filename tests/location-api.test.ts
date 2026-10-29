import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppServer } from "../server/index.ts";
import { createApiHandler, type ApiOptions } from "../server/location-api.ts";

const WEATHER = {
  name: "Brooklyn",
  coord: { lat: 40.69, lon: -73.98 },
  main: { temp: 18.4, feels_like: 17.2 },
  wind: { speed: 3.6 },
  weather: [{ id: 801, description: "few clouds", icon: "02d" }],
  dt: 1793296800,
};
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
  const server = createAppServer({ apiKey: "", ...options });
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

test("configuration exposes only a boolean and missing weather credentials never make an upstream request", async (t) => {
  let calls = 0;
  const base = await serverFor(t, {
    fetch: async () => {
      calls++;
      throw new Error("should not fetch");
    },
  });
  const configured = await fetch(`${base}/api/location-config`);
  assert.deepEqual(await configured.json(), { weatherConfigured: false });
  const response = await fetch(`${base}/api/weather?lat=40.69&lon=-73.98`);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "not_configured");
  assert.equal(calls, 0);
});

test("weather rejects missing, blank, non-finite, duplicate and out-of-range coordinates before fetching", async (t) => {
  let calls = 0;
  const base = await serverFor(t, {
    apiKey: "server-only-secret",
    fetch: async () => {
      calls++;
      return jsonResponse(WEATHER);
    },
  });
  const invalid = [
    "",
    "?lat=&lon=",
    "?lat=40",
    "?lat=NaN&lon=10",
    "?lat=91&lon=0",
    "?lat=0&lon=-181",
    "?lat=Infinity&lon=0",
    "?lat=0&lat=2&lon=0",
  ];
  for (const query of invalid) {
    const response = await fetch(`${base}/api/weather${query}`);
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).code, "invalid_coordinates");
  }
  assert.equal(calls, 0);
});

test("weather maps only safe fields from OpenWeather, uses metric fixed-host requests and keeps credentials server-side", async (t) => {
  let upstream: URL | undefined;
  const base = await serverFor(t, {
    apiKey: "server-only-secret",
    fetch: async (input, init) => {
      upstream = new URL(String(input));
      assert.equal(init?.redirect, "error");
      return jsonResponse({
        ...WEATHER,
        secret: "never-forward",
        message: "unsafe upstream body",
      });
    },
  });
  const response = await fetch(
    `${base}/api/weather?lat=40.691234&lon=-73.981234`,
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(upstream?.origin, "https://api.openweathermap.org");
  assert.equal(upstream?.pathname, "/data/2.5/weather");
  assert.equal(upstream?.searchParams.get("appid"), "server-only-secret");
  assert.equal(upstream?.searchParams.get("units"), "metric");
  assert.deepEqual(body, {
    source: "openweather",
    status: "ready",
    latitude: 40.69,
    longitude: -73.98,
    placeName: "Brooklyn",
    temperatureC: 18.4,
    feelsLikeC: 17.2,
    description: "few clouds",
    condition: "clouds",
    isDay: true,
    observedAt: new Date(WEATHER.dt * 1000).toISOString(),
    windMps: 3.6,
  });
  assert.ok(!JSON.stringify(body).includes("server-only-secret"));
  assert.ok(!JSON.stringify(body).includes("unsafe upstream"));
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("rounded-coordinate weather cache coalesces concurrent calls and expires after ten minutes", async (t) => {
  let now = 1_000_000;
  let calls = 0;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const base = await serverFor(t, {
    apiKey: "key",
    now: () => now,
    fetch: async () => {
      calls++;
      await wait;
      return jsonResponse(WEATHER);
    },
  });
  const first = fetch(`${base}/api/weather?lat=40.691&lon=-73.981`);
  const second = fetch(`${base}/api/weather?lat=40.692&lon=-73.982`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  assert.deepEqual(
    (await Promise.all([first, second])).map((response) => response.status),
    [200, 200],
  );
  assert.equal(calls, 1);
  assert.equal(
    (await fetch(`${base}/api/weather?lat=40.69&lon=-73.98`)).status,
    200,
  );
  assert.equal(calls, 1);
  now += 10 * 60 * 1000 + 1;
  assert.equal(
    (await fetch(`${base}/api/weather?lat=40.69&lon=-73.98`)).status,
    200,
  );
  assert.equal(calls, 2);
});

test("OpenWeather authorization, quota and malformed-payload errors are friendly and sanitized", async (t) => {
  for (const status of [401, 429, 500]) {
    const base = await serverFor(t, {
      apiKey: "never-leak-me",
      fetch: async () =>
        jsonResponse(
          {
            message: "https://upstream/?appid=never-leak-me",
            secret: "raw-provider-error",
          },
          status,
        ),
    });
    const response = await fetch(`${base}/api/weather?lat=0&lon=0`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, "upstream_unavailable");
    assert.ok(!JSON.stringify(body).includes("never-leak-me"));
    assert.ok(!JSON.stringify(body).includes("raw-provider-error"));
  }
  const malformed = await serverFor(t, {
    apiKey: "key",
    fetch: async () =>
      jsonResponse({ ...WEATHER, main: { temp: "hot", feels_like: 17 } }),
  });
  assert.equal(
    (await fetch(`${malformed}/api/weather?lat=0&lon=0`)).status,
    503,
  );
});

test("provider requests abort at the configured timeout without leaking thrown errors", async (t) => {
  let aborted = false;
  const base = await serverFor(t, {
    apiKey: "secret-key",
    timeoutMs: 20,
    fetch: async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("unsafe secret-key"));
          },
          { once: true },
        );
      }),
  });
  const response = await fetch(`${base}/api/weather?lat=0&lon=0`);
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.equal(aborted, true);
  assert.ok(!body.includes("secret-key"));
});

test("condition groups and night icon become usable map atmosphere fields", async (t) => {
  for (const [id, condition] of [
    [200, "storm"],
    [301, "rain"],
    [501, "rain"],
    [601, "snow"],
    [741, "fog"],
    [800, "clear"],
    [804, "clouds"],
  ] as const) {
    const base = await serverFor(t, {
      apiKey: "key",
      fetch: async () =>
        jsonResponse({
          ...WEATHER,
          weather: [{ id, icon: "01n", description: condition }],
        }),
    });
    const body = await (await fetch(`${base}/api/weather?lat=0&lon=0`)).json();
    assert.equal(body.condition, condition);
    assert.equal(body.isDay, false);
  }
});

test("keyless city search uses Photon and sanitizes real geographic features", async (t) => {
  let upstream: URL | undefined;
  const base = await serverFor(t, {
    fetch: async (input) => {
      upstream = new URL(String(input));
      return jsonResponse(PHOTON);
    },
  });
  const response = await fetch(`${base}/api/geocode?q=Brooklyn`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(upstream?.origin, "https://photon.komoot.io");
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
});

test("configured geocoding uses OpenWeather and falls back to Photon when its credentials fail", async (t) => {
  const sources: string[] = [];
  const configured = await serverFor(t, {
    apiKey: "key",
    fetch: async (input) => {
      sources.push(new URL(String(input)).origin);
      return jsonResponse([
        {
          name: "Paris",
          state: "Île-de-France",
          country: "FR",
          lat: 48.85,
          lon: 2.35,
        },
      ]);
    },
  });
  assert.equal(
    (await (await fetch(`${configured}/api/geocode?q=Paris`)).json()).source,
    "openweather",
  );
  const fallback = await serverFor(t, {
    apiKey: "rejected-key",
    fetch: async (input) => {
      const url = new URL(String(input));
      sources.push(url.origin);
      return url.hostname === "api.openweathermap.org"
        ? jsonResponse({ message: "unsafe rejected-key" }, 401)
        : jsonResponse(PHOTON);
    },
  });
  const body = await (await fetch(`${fallback}/api/geocode?q=Brooklyn`)).json();
  assert.equal(body.source, "photon");
  assert.ok(!JSON.stringify(body).includes("rejected-key"));
  assert.deepEqual(sources, [
    "https://api.openweathermap.org",
    "https://api.openweathermap.org",
    "https://photon.komoot.io",
  ]);
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
  const base = await serverFor(t);
  const response = await fetch(`${base}/api/location-config`, {
    method: "POST",
  });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
  const head = await fetch(`${base}/api/location-config`, { method: "HEAD" });
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
    "OPENWEATHER_API_KEY=accidental-dist-secret",
  );
  await writeFile(
    join(directory, ".env.local"),
    "OPENWEATHER_API_KEY=private-key",
  );
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
  const handler = createApiHandler({ apiKey: "" });
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
