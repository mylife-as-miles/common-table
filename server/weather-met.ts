import tzLookup from "tz-lookup";
import type { WeatherConditions } from "../src/weather/types.ts";
import type { WeatherForecast, WeatherDiagnostic } from "./weather.ts";

const USER_AGENT = "CommonTable/0.1 (https://github.com/mylife-as-miles/common-table)";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

export class MetWeatherError extends Error {
  constructor(readonly reason: WeatherDiagnostic["reason"], readonly upstreamStatus?: number) { super("Alternate weather source is unavailable."); }
}
// Explicit equivalents of MET's documented English legend. Mixed sleet symbols
// are deliberately omitted rather than mislabeled as rain, snow or freezing rain.
// https://github.com/metno/weathericons/blob/main/weather/legend.csv
const SYMBOL_CODES: Record<string, number> = {
  clearsky: 0, fair: 1, partlycloudy: 2, cloudy: 3, fog: 45,
  lightrain: 61, rain: 63, heavyrain: 65,
  lightrainshowers: 80, rainshowers: 81, heavyrainshowers: 82,
  lightsnow: 71, snow: 73, heavysnow: 75,
  lightsnowshowers: 85, snowshowers: 86, heavysnowshowers: 86,
  lightrainandthunder: 95, rainandthunder: 95, heavyrainandthunder: 95,
  lightrainshowersandthunder: 95, rainshowersandthunder: 95, heavyrainshowersandthunder: 95,
  lightsnowandthunder: 95, snowandthunder: 95, heavysnowandthunder: 95,
  lightssnowshowersandthunder: 95, snowshowersandthunder: 95, heavysnowshowersandthunder: 95,
};
function utcTime(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/.test(value)) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace(".000Z", "Z") !== value.replace(".000Z", "Z")) return null;
  return time;
}
function localStamp(time: number, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(time);
  const part = (name: string) => parts.find(item => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export function parseMetForecast(value: unknown, latitude: number, longitude: number, fetchedAt: number): WeatherForecast {
  const root = record(value), geometry = record(root.geometry), properties = record(root.properties), meta = record(properties.meta), units = record(meta.units);
  const point = geometry.coordinates;
  if (root.type !== "Feature" || geometry.type !== "Point" || !Array.isArray(point) || !finite(point[0], -180, 180) || !finite(point[1], -90, 90) || Math.abs(point[0] - longitude) > .02 || Math.abs(point[1] - latitude) > .02) throw new MetWeatherError("invalid_current");
  if (units.air_temperature !== "celsius" || units.wind_speed !== "m/s") throw new MetWeatherError("invalid_units");
  const issued = utcTime(meta.updated_at);
  if (issued === null || issued > fetchedAt + 60 * 60_000 || fetchedAt - issued > 12 * 60 * 60_000) throw new MetWeatherError("stale_current");
  let timezone: string;
  try { timezone = tzLookup(latitude, longitude); new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); }
  catch { throw new MetWeatherError("invalid_timezone"); }
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (!Array.isArray(properties.timeseries) || properties.timeseries.length < 1 || properties.timeseries.length > 300) throw new MetWeatherError("invalid_hourly");
  const available: { utc: number; condition: WeatherConditions }[] = [];
  for (const raw of properties.timeseries) {
    const entry = record(raw), time = utcTime(entry.time), data = record(entry.data), instant = record(record(data.instant).details);
    if (time === null || time < fetchedAt - 3 * 60 * 60_000 || time > fetchedAt + 10 * 86400_000 || !finite(instant.air_temperature, -100, 75) || !finite(instant.wind_speed, 0, 125)) continue;
    const one = record(data.next_1_hours);
    const period = Object.keys(one).length ? one : record(data.next_6_hours);
    const symbol = record(period.summary).symbol_code;
    if (typeof symbol !== "string") continue;
    const base = symbol.replace(/_(?:day|night|polartwilight)$/, "");
    const weatherCode = SYMBOL_CODES[base];
    if (weatherCode === undefined) continue;
    const oneDetails = record(one.details);
    const amount = units.precipitation_amount === "mm" && finite(oneDetails.precipitation_amount, 0, 1000) ? oneDetails.precipitation_amount : null;
    const probability = units.probability_of_precipitation === "%" && finite(oneDetails.probability_of_precipitation, 0, 100) ? oneDetails.probability_of_precipitation : null;
    available.push({ utc: time, condition: {
      time: localStamp(time, formatter), temperatureC: instant.air_temperature,
      feelsLikeC: null, precipitationMm: amount, precipitationProbability: probability,
      windKmh: Math.round(instant.wind_speed * 36) / 10, weatherCode,
      isDay: /_day$/.test(symbol) ? true : /_night$/.test(symbol) ? false : null,
    } });
  }
  available.sort((a, b) => a.utc - b.utc);
  const closest = available.filter(item => Math.abs(item.utc - fetchedAt) <= 90 * 60_000).sort((a, b) => Math.abs(a.utc - fetchedAt) - Math.abs(b.utc - fetchedAt))[0];
  if (!closest) throw new MetWeatherError("invalid_current");
  const hours = new Map<string, WeatherConditions>();
  for (const item of available) if (!hours.has(item.condition.time)) hours.set(item.condition.time, item.condition);
  const wall = localStamp(closest.utc, formatter);
  const offset = (Date.parse(`${wall}Z`) - closest.utc) / 1000;
  return { timezone, utcOffsetSeconds: offset, current: closest.condition, hours, start: available[0].condition.time, end: available.at(-1)!.condition.time, fetchedAt };
}

export async function fetchMetForecast(options: {
  latitude: number; longitude: number; fetchedAt: number; signal: AbortSignal;
  fetcher: typeof globalThis.fetch;
  readJson: (response: Response, signal: AbortSignal) => Promise<unknown>;
}): Promise<WeatherForecast> {
  const latitude = Number(options.latitude.toFixed(2)), longitude = Number(options.longitude.toFixed(2));
  const url = new URL("https://api.met.no/weatherapi/locationforecast/2.0/compact");
  url.search = new URLSearchParams({ lat: latitude.toFixed(2), lon: longitude.toFixed(2) }).toString();
  const response = await options.fetcher(url, { signal: options.signal, redirect: "manual", headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new MetWeatherError("upstream_http", response.status); }
  const forecast = parseMetForecast(await options.readJson(response, options.signal), latitude, longitude, options.fetchedAt);
  const expires = Date.parse(response.headers.get("expires") ?? "");
  // Keep the provider's no-refresh-before boundary separate from the app's
  // shorter freshness window. An older cached report remains explicitly stale.
  if (Number.isFinite(expires) && expires > options.fetchedAt) forecast.refreshNotBefore = expires;
  return forecast;
}
