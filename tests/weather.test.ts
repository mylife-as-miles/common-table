import test from "node:test";
import assert from "node:assert/strict";
import { createWeatherHandler } from "../server/weather.ts";

const now = Date.parse("2026-11-02T17:00:00Z");
const request = (query = "latitude=40.692&longitude=-73.977&date=2026-11-02&hour=19", init?: RequestInit) => new Request(`https://common-table.example/api/weather?${query}`, init);
function fixture() {
  const time = ["2026-11-02T18:00", "2026-11-02T19:00", "2026-11-03T19:00"];
  return {
    timezone: "America/New_York", utc_offset_seconds: -18000,
    current_units: { temperature_2m: "°C", apparent_temperature: "°C", precipitation: "mm", wind_speed_10m: "km/h" },
    hourly_units: { temperature_2m: "°C", apparent_temperature: "°C", precipitation: "mm", precipitation_probability: "%", wind_speed_10m: "km/h" },
    current: { time: "2026-11-02T12:00", temperature_2m: 11.4, apparent_temperature: 9.2, precipitation: 0, weather_code: 2, wind_speed_10m: 12, is_day: 1 },
    hourly: { time, temperature_2m: [9, 8, 10], apparent_temperature: [7, 6, 8], precipitation: [0, 0.2, 0], precipitation_probability: [10, 25, 5], weather_code: [2, 61, 0], wind_speed_10m: [10, 11, 8], is_day: [0, 0, 0] },
  };
}
const options = (fetcher: typeof fetch, clock = () => now) => ({ fetch: fetcher, now: clock, intervalMs: 0, onDiagnostic: () => undefined });
const upstream: typeof fetch = async () => Response.json(fixture());

test("weather validates bounded single-coordinate and calendar queries before networking", async () => {
  let calls = 0;
  const handle = createWeatherHandler(options(async () => { calls++; return Response.json(fixture()); }));
  for (const query of ["", "latitude=91&longitude=0&date=2026-11-02&hour=19", "latitude=0&longitude=181&date=2026-11-02&hour=19", "latitude=0,1&longitude=0&date=2026-11-02&hour=19", "latitude=0&longitude=0&date=2026-02-30&hour=19", "latitude=0&longitude=0&date=2026-11-02&hour=24", "latitude=0&latitude=1&longitude=0&date=2026-11-02&hour=19", "latitude=0&longitude=0&date=2026-11-02&hour=19&url=https://example.com", "latitude=0&longitude=0&date=3026-11-02&hour=19"]) {
    assert.equal((await handle(request(query))).status, 400, query);
  }
  assert.equal(calls, 0);
});

test("weather fetches a fixed host with coarse coords, local timezone and bounded forecast; exposes actual selected hour", async () => {
  let target = new URL("https://example.com");
  const handle = createWeatherHandler(options(async (input, init) => {
    target = new URL(String(input));
    assert.equal(init?.redirect, "manual");
    assert.ok(init?.signal);
    return Response.json(fixture());
  }));
  const response = await handle(request()); const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(target.origin, "https://api.open-meteo.com");
  assert.equal(target.pathname, "/v1/forecast");
  assert.equal(target.searchParams.get("latitude"), "40.69");
  assert.equal(target.searchParams.get("longitude"), "-73.98");
  assert.equal(target.searchParams.get("timezone"), "auto");
  assert.equal(target.searchParams.get("forecast_days"), "16");
  assert.equal(body.current.temperatureC, 11.4);
  assert.equal(body.dinner.temperatureC, 8);
  assert.equal(body.dinner.precipitationProbability, 25);
  assert.equal(body.dinner.isDay, false);
  assert.equal(body.dinnerStatus, "forecast");
  assert.deepEqual(body.area, { latitude: 40.69, longitude: -73.98 });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("outside-horizon and past plans never receive invented forecasts", async () => {
  const handle = createWeatherHandler(options(upstream));
  for (const [date, hour, status] of [["2026-12-02", 19, "outside_forecast"], ["2026-11-01", 19, "past"], ["2026-11-02", 10, "past"], ["2026-11-02", 20, "unavailable"]] as const) {
    const body = await (await handle(request(`latitude=40.69&longitude=-73.98&date=${date}&hour=${hour}`))).json();
    assert.equal(body.dinnerStatus, status); assert.equal(body.dinner, null);
  }
});

test("cache shares coordinate forecast across hours and coalesces concurrent requests", async () => {
  let calls = 0; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const handle = createWeatherHandler(options(async () => { calls++; await gate; return Response.json(fixture()); }));
  const a = handle(request()); const b = handle(request("latitude=40.691&longitude=-73.979&date=2026-11-03&hour=19"));
  release(); const [first, second] = await Promise.all([a, b]);
  assert.equal(calls, 1); assert.equal((await first.json()).dinner.temperatureC, 8); assert.equal((await second.json()).dinner.temperatureC, 10);
  await handle(request()); assert.equal(calls, 1);
});

test("stale weather is explicit and expires; failed refresh never extends its lifetime", async () => {
  let clock = now; let calls = 0;
  const handle = createWeatherHandler(options(async () => { if(calls++) throw new Error("PRIVATE_CANARY"); return Response.json(fixture()); }, () => clock));
  const first = await (await handle(request())).json();
  clock += 21 * 60_000;
  const stale = await (await handle(request())).json();
  assert.equal(stale.stale, true); assert.equal(stale.fetchedAt, first.fetchedAt); assert.equal(stale.staleUntil, first.staleUntil);
  clock = now + 121 * 60_000;
  const failed = await handle(request()); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /PRIVATE_CANARY/);
});

test("one cancelled coalesced caller does not cancel another caller", async () => {
  let release!: () => void; let signal: AbortSignal | null = null;
  const handle = createWeatherHandler(options(async (_input, init) => { signal = init?.signal ?? null; await new Promise<void>(resolve => { release = resolve; }); return Response.json(fixture()); }));
  const controller = new AbortController();
  const a = handle(request(undefined, {signal:controller.signal})); const b = handle(request());
  controller.abort(); assert.equal((await a).status, 499); assert.equal(signal?.aborted, false);
  release(); assert.equal((await b).status, 200);
});

test("last cancelled caller aborts upstream and makes no stale response", async () => {
  let aborted = false;
  const handle = createWeatherHandler(options(async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {aborted = true; reject(new Error("cancel"));}, {once:true});
  })));
  const controller = new AbortController(); const pending = handle(request(undefined, {signal:controller.signal}));
  controller.abort(); assert.equal((await pending).status, 499);
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(aborted, true);
});

test("timeouts and oversized or invalid upstream data fail without raw diagnostics", async () => {
  const timeout = createWeatherHandler({...options(async () => new Promise<Response>(() => undefined)), timeoutMs:5});
  assert.equal((await timeout(request())).status, 504);
  for(const payload of ["x".repeat(200*1024), {...fixture(), timezone:"nonsense"}, {...fixture(), current:{...fixture().current,temperature_2m:null}}, {...fixture(), hourly_units:{temperature_2m:"°F"}}]) {
    const handle=createWeatherHandler(options(async () => typeof payload === "string" ? new Response(payload) : Response.json(payload)));
    const r=await handle(request()); assert.equal(r.status,503);
  }
});

test("missing hourly values are unavailable, never replaced with current weather", async () => {
  const data=fixture(); data.hourly.temperature_2m[1]=null as unknown as number;
  const handle=createWeatherHandler(options(async()=>Response.json(data)));
  const result=await (await handle(request())).json();
  assert.equal(result.current.temperatureC,11.4);assert.equal(result.dinner,null);assert.equal(result.dinnerStatus,"unavailable");
});

test("method, origin, rate and HEAD behavior stay bounded", async () => {
  const handle=createWeatherHandler({...options(upstream),intervalMs:1000});
  assert.equal((await handle(request(undefined,{method:"POST"}))).status,405);
  assert.equal((await handle(request(undefined,{headers:{origin:"https://evil.example"}}))).status,403);
  assert.equal((await handle(request(undefined,{method:"HEAD"}))).status,200);
  assert.equal((await handle(request("latitude=41&longitude=-74&date=2026-11-02&hour=19"))).status,429);
});

test("weather diagnostics expose fixed categories and numeric status, never raw upstream errors", async () => {
  const diagnostics: unknown[] = [];
  const network = createWeatherHandler({...options(async () => {throw new Error("fetch failed PRIVATE_ERROR_CANARY https://private.invalid/?secret=never-log");}),onDiagnostic:value=>diagnostics.push(value)});
  const response=await network(request());assert.equal(response.status,503);
  assert.deepEqual(diagnostics,[{reason:"network"}]);assert.doesNotMatch(await response.text(),/PRIVATE_ERROR_CANARY|private\.invalid|secret=/);
  const unavailable=createWeatherHandler({...options(async()=>new Response("PRIVATE_BODY_CANARY",{status:521})),onDiagnostic:value=>diagnostics.push(value)});
  await unavailable(request());assert.deepEqual(diagnostics[1],{reason:"upstream_http",upstreamStatus:521});
  assert.doesNotMatch(JSON.stringify(diagnostics),/PRIVATE|private\.invalid|secret=/);
});
