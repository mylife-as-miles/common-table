import type { WeatherConditions, WeatherFailure, WeatherReport } from "../src/weather/types.ts";
import { weatherCodes } from "../src/weather/types.ts";
import { fetchMetForecast, MetWeatherError } from "./weather-met.ts";

export interface WeatherHandlerOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  timeoutMs?: number;
  intervalMs?: number;
  onDiagnostic?: (diagnostic: WeatherDiagnostic) => void;
}
export interface WeatherDiagnostic {
  reason: "upstream_http" | "upstream_timeout" | "invalid_units" | "invalid_timezone" | "invalid_current" | "stale_current" | "invalid_hourly" | "invalid_horizon" | "body_too_large" | "invalid_json" | "fetch_receiver" | "fetch_context" | "network" | "unexpected";
  upstreamStatus?: number;
}
const FRESH_MS = 20 * 60_000;
const STALE_MS = 2 * 60 * 60_000;
const MAX_BYTES = 192 * 1024;
const MAX_CACHE = 128;
const MAX_ACTIVE = 8;
const fields = "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day";
const messages: Record<WeatherFailure["code"], string> = {
  invalid_query: "Choose a valid area, dinner date and hour.",
  method_not_allowed: "Use GET to check the weather.",
  origin_rejected: "Weather requests must come from this Common Table origin.",
  busy: "Weather is busy. Please try again in a moment.",
  rate_limited: "Wait a moment before checking a different area.",
  timeout: "The weather check timed out. Try again when you’re ready.",
  cancelled: "Weather check cancelled.",
  unavailable: "Weather is unavailable right now. Please try again later.",
};
class WeatherError extends Error {
  constructor(readonly code: WeatherFailure["code"], readonly status: number, readonly diagnostic?: WeatherDiagnostic) { super(messages[code]); }
}
export interface WeatherForecast {
  timezone: string;
  utcOffsetSeconds: number;
  current: WeatherConditions;
  hours: Map<string, WeatherConditions>;
  start: string;
  end: string;
  fetchedAt: number;
  refreshNotBefore?: number;
}
type Forecast = WeatherForecast;
interface Job { controller: AbortController; promise: Promise<Forecast>; waiters: number; done: boolean }
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const localTime = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) && validDate(value.slice(0,10));
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function areaHour(timestamp: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(timestamp);
  const part = (name: string) => parts.find(item => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:00`;
}
function parseQuery(url: URL, timestamp: number) {
  const keys = ["latitude", "longitude", "date", "hour"];
  if (url.search.length > 300 || [...url.searchParams.keys()].some(key => !keys.includes(key)) || keys.some(key => url.searchParams.getAll(key).length !== 1)) throw new WeatherError("invalid_query", 400);
  const latitudeText = url.searchParams.get("latitude")!;
  const longitudeText = url.searchParams.get("longitude")!;
  const date = url.searchParams.get("date")!;
  const hourText = url.searchParams.get("hour")!;
  const coordinate = /^-?\d{1,3}(?:\.\d{1,8})?$/;
  const latitude = Number(latitudeText), longitude = Number(longitudeText), hour = Number(hourText);
  const dateDistance = Date.parse(`${date}T00:00:00Z`) - timestamp;
  if (!coordinate.test(latitudeText) || !coordinate.test(longitudeText) || !finite(latitude, -90, 90) || !finite(longitude, -180, 180) || !validDate(date) || Math.abs(dateDistance) > 367 * 86400_000 || !/^\d{1,2}$/.test(hourText) || !Number.isInteger(hour) || hour < 0 || hour > 23) throw new WeatherError("invalid_query", 400);
  return { latitude: Number(latitude.toFixed(2)) || 0, longitude: Number(longitude.toFixed(2)) || 0, date, hour };
}
function conditions(value: Record<string, unknown>, probability: unknown = null): WeatherConditions | null {
  if (!localTime(value.time) || !finite(value.temperature_2m, -100, 75) || !finite(value.apparent_temperature, -120, 90) || !finite(value.precipitation, 0, 1000) || !finite(value.wind_speed_10m, 0, 450) || !finite(value.weather_code, 0, 99) || !weatherCodes.has(value.weather_code) || (value.is_day !== 0 && value.is_day !== 1) || (probability !== null && !finite(probability, 0, 100))) return null;
  return { time: value.time, temperatureC: value.temperature_2m, feelsLikeC: value.apparent_temperature, precipitationMm: value.precipitation, precipitationProbability: probability as number | null, windKmh: value.wind_speed_10m, weatherCode: value.weather_code, isDay: value.is_day === 1 };
}
function parseForecast(value: unknown, fetchedAt: number): Forecast {
  const data = record(value), currentUnits = record(data.current_units), hourUnits = record(data.hourly_units);
  if ([currentUnits, hourUnits].some(units => units.temperature_2m !== "°C" || units.apparent_temperature !== "°C" || units.precipitation !== "mm" || units.wind_speed_10m !== "km/h") || hourUnits.precipitation_probability !== "%") throw new WeatherError("unavailable", 503, {reason:"invalid_units"});
  const current = conditions(record(data.current));
  const timezone = typeof data.timezone === "string" && data.timezone.length < 90 ? data.timezone : "";
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { throw new WeatherError("unavailable", 503, {reason:"invalid_timezone"}); }
  if (!current || !timezone || !finite(data.utc_offset_seconds, -50400, 50400)) throw new WeatherError("unavailable", 503, {reason:"invalid_current"});
  const currentUtc = Date.parse(`${current.time}Z`) - data.utc_offset_seconds * 1000;
  if (Math.abs(currentUtc - fetchedAt) > 3 * 60 * 60_000) throw new WeatherError("unavailable", 503, {reason:"stale_current"});
  const hourly = record(data.hourly), times = hourly.time;
  if (!Array.isArray(times) || times.length < 1 || times.length > 384 || times.some(time => !localTime(time))) throw new WeatherError("unavailable", 503, {reason:"invalid_hourly"});
  const day = areaHour(fetchedAt, timezone).slice(0, 10);
  const endDay = new Date(Date.parse(`${day}T00:00:00Z`) + 15 * 86400_000).toISOString().slice(0, 10);
  if (times.some(time => time.slice(0, 10) < day || time.slice(0, 10) > endDay)) throw new WeatherError("unavailable", 503, {reason:"invalid_horizon"});
  const names = [...fields.split(","), "precipitation_probability"];
  if (names.some(name => !Array.isArray(hourly[name]) || (hourly[name] as unknown[]).length !== times.length)) throw new WeatherError("unavailable", 503, {reason:"invalid_hourly"});
  const hours = new Map<string, WeatherConditions>();
  times.forEach((time, index) => {
    const item: Record<string, unknown> = { time };
    for (const name of names) item[name] = (hourly[name] as unknown[])[index];
    const hour = conditions(item, item.precipitation_probability);
    if (hour) hours.set(time, hour);
  });
  const sorted = [...times].sort();
  return { timezone, utcOffsetSeconds: data.utc_offset_seconds, current, hours, start: sorted[0], end: sorted.at(-1)!, fetchedAt };
}
async function readJson(response: Response, signal: AbortSignal) {
  const declared = response.headers.get("content-length");
  if ((declared && Number(declared) > MAX_BYTES) || !response.body) {
    void response.body?.cancel().catch(() => undefined); throw new WeatherError("unavailable", 503, {reason:"body_too_large"});
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const chunk = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) { void reader.cancel().catch(() => undefined); throw new WeatherError("unavailable", 503, {reason:"body_too_large"}); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new WeatherError("unavailable", 503, {reason:"invalid_json"}); }
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
function json(request: Request, status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", ...headers } });
}

/** Worker-safe, bounded public forecast adapter. No Node APIs, secrets or paid calls. */
export function createWeatherHandler(options: WeatherHandlerOptions = {}) {
  const fetcher: typeof globalThis.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? Date.now, timeoutMs = options.timeoutMs ?? 8000, intervalMs = options.intervalMs ?? 1000;
  if (typeof fetcher !== "function" || typeof now !== "function" || !finite(timeoutMs, 1, 30_000) || !finite(intervalMs, 0, 60_000)) throw new Error("Invalid weather service options.");
  const cache = new Map<string, Forecast>(), jobs = new Map<string, Job>();
  const metRefreshLimits = new Map<string, number>();
  let lastStarted = -Infinity;
  const diagnostic = options.onDiagnostic ?? ((value: WeatherDiagnostic) => console.warn("Common Table weather unavailable", value));
  function reportDiagnostic(error: unknown) {
    if (error instanceof WeatherError && error.code === "cancelled") return;
    const message = error instanceof Error ? error.message : "";
    const value: WeatherDiagnostic = error instanceof MetWeatherError ? {reason:error.reason,...(error.upstreamStatus ? {upstreamStatus:error.upstreamStatus} : {})} : error instanceof WeatherError && error.diagnostic ? error.diagnostic :
      error instanceof WeatherError && error.code === "timeout" ? {reason:"upstream_timeout"} :
      /illegal invocation|incorrect.*this|receiver/i.test(message) ? {reason:"fetch_receiver"} :
      /different request|outside.*request|request.*context/i.test(message) ? {reason:"fetch_context"} :
      /fetch failed|network|DNS|connect/i.test(message) ? {reason:"network"} : {reason:"unexpected"};
    // Fixed categories and numeric status only: never log URLs, coordinates,
    // request headers, raw exception strings or provider response bodies.
    try { diagnostic(value); } catch { /* Diagnostics cannot affect the response. */ }
  }

  function start(key: string, latitude: number, longitude: number, timestamp: number): Job {
    if (jobs.size >= MAX_ACTIVE) throw new WeatherError("busy", 503);
    if (timestamp - lastStarted < intervalMs) throw new WeatherError("rate_limited", 429);
    lastStarted = timestamp;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new WeatherError("timeout", 504)), timeoutMs);
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), current: fields, hourly: `${fields},precipitation_probability`, timezone: "auto", forecast_days: "16", temperature_unit: "celsius", wind_speed_unit: "kmh", precipitation_unit: "mm" }).toString();
    let rejectAbort!: (reason: unknown) => void;
    const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const abort = () => rejectAbort(controller.signal.reason ?? new WeatherError("cancelled", 499));
    controller.signal.addEventListener("abort", abort, { once: true });
    const job: Job = { controller, waiters: 0, done: false, promise: Promise.resolve(null as unknown as Forecast) };
    const network = (async () => {
      let response: Response;
      try { response = await fetcher(url, { signal: controller.signal, redirect: "manual", headers: { Accept: "application/json" } }); }
      catch (error) {
        if (controller.signal.aborted) throw error;
        // A transport outage may use the alternate source, but invalid payloads,
        // authentication errors and application validation never trigger it.
        if (!/fetch failed|network|DNS|connect/i.test(error instanceof Error ? error.message : "")) throw error;
        return fallback();
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        if (response.status === 429 || response.status >= 500) return fallback();
        throw new WeatherError("unavailable", 503, {reason:"upstream_http",upstreamStatus:response.status});
      }
      return parseForecast(await readJson(response, controller.signal), timestamp);
    })();
    async function fallback() {
      if (controller.signal.aborted) throw controller.signal.reason;
      if ((metRefreshLimits.get(key) ?? 0) > timestamp) throw new WeatherError("unavailable", 503);
      const forecast = await fetchMetForecast({ latitude, longitude, fetchedAt: timestamp, fetcher, signal: controller.signal, readJson });
      if (forecast.refreshNotBefore) {
        metRefreshLimits.delete(key); metRefreshLimits.set(key, forecast.refreshNotBefore);
        while (metRefreshLimits.size > MAX_CACHE) metRefreshLimits.delete(metRefreshLimits.keys().next().value!);
      }
      return forecast;
    }
    job.promise = Promise.race([network, interrupted]).then(forecast => {
      if (controller.signal.aborted) throw controller.signal.reason;
      cache.delete(key); cache.set(key, forecast);
      while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
      return forecast;
    }).catch(error => { reportDiagnostic(error); throw error; }).finally(() => {
      job.done = true; clearTimeout(timer); controller.signal.removeEventListener("abort", abort); jobs.delete(key);
    });
    jobs.set(key, job);
    return job;
  }
  async function join(job: Job, signal: AbortSignal) {
    job.waiters++;
    let cancel!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => { cancel = () => reject(new WeatherError("cancelled", 499)); });
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    try { return await Promise.race([job.promise, cancelled]); }
    finally {
      signal.removeEventListener("abort", cancel); job.waiters--;
      if (job.waiters === 0 && !job.done) job.controller.abort(new WeatherError("cancelled", 499));
    }
  }
  return async function handleWeather(request: Request): Promise<Response> {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") throw new WeatherError("method_not_allowed", 405);
      const url = new URL(request.url), origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
      if ((origin !== null && origin !== url.origin) || (site !== null && site !== "same-origin" && site !== "none")) throw new WeatherError("origin_rejected", 403);
      const timestamp = now(); if (!Number.isFinite(timestamp)) throw new WeatherError("unavailable", 503);
      const { latitude, longitude, date, hour } = parseQuery(url, timestamp);
      if (request.signal.aborted) throw new WeatherError("cancelled", 499);
      const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
      for (const [entryKey, item] of cache) if (item.fetchedAt + STALE_MS <= timestamp) cache.delete(entryKey);
      const existing = cache.get(key); let forecast: Forecast; let stale = false;
      if (existing && existing.fetchedAt + FRESH_MS > timestamp) forecast = existing;
      else if (existing && (existing.refreshNotBefore ?? 0) > timestamp) { forecast = existing; stale = true; }
      else {
        try { forecast = await join(jobs.get(key) ?? start(key, latitude, longitude, timestamp), request.signal); }
        catch (error) {
          if (request.signal.aborted || (error instanceof WeatherError && error.code === "cancelled")) throw new WeatherError("cancelled", 499);
          if (!existing || existing.fetchedAt + STALE_MS <= timestamp) throw error;
          forecast = existing; stale = true;
        }
      }
      const target = `${date}T${String(hour).padStart(2, "0")}:00`;
      const currentHour = areaHour(now(), forecast.timezone);
      const dinnerStatus = target < currentHour ? "past" : target > forecast.end || target < forecast.start ? "outside_forecast" : forecast.hours.has(target) ? "forecast" : "unavailable";
      const report: WeatherReport = { status: "ok", area: { latitude, longitude }, requested: { date, hour }, timezone: forecast.timezone, utcOffsetSeconds: forecast.utcOffsetSeconds, fetchedAt: new Date(forecast.fetchedAt).toISOString(), freshUntil: new Date(forecast.fetchedAt + FRESH_MS).toISOString(), staleUntil: new Date(forecast.fetchedAt + STALE_MS).toISOString(), stale, current: forecast.current, dinner: dinnerStatus === "forecast" ? forecast.hours.get(target)! : null, dinnerStatus };
      return json(request, 200, report);
    } catch (error) {
      const failure = error instanceof WeatherError ? error : new WeatherError("unavailable", 503);
      return json(request, failure.status, { status: "error", code: failure.code, message: failure.message } satisfies WeatherFailure, failure.status === 405 ? { Allow: "GET, HEAD" } : failure.status === 429 ? { "Retry-After": "1" } : {});
    }
  };
}

export const handleWeatherRequest = createWeatherHandler();
