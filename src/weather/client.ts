import type { WeatherConditions, WeatherReport } from "./types";
import { weatherCodes } from "./types";

export interface WeatherQuery { latitude: number; longitude: number; date: string; hour: number }
const finite = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const dateOnly = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

export function weatherQuery(latitude: number, longitude: number, date: string, time: string): WeatherQuery | null {
  if (!finite(latitude, -90, 90) || !finite(longitude, -180, 180) || !dateOnly(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return { latitude: Number(latitude.toFixed(2)) || 0, longitude: Number(longitude.toFixed(2)) || 0, date, hour: Number(time.slice(0, 2)) };
}
export function weatherCacheKey(query: WeatherQuery) {
  return `weather:v1:${query.latitude.toFixed(2)}:${query.longitude.toFixed(2)}:${query.date}:${query.hour}`;
}
function condition(value: unknown): value is WeatherConditions {
  const item = object(value);
  return typeof item.time === "string" && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.time) && dateOnly(item.time.slice(0, 10)) && finite(item.temperatureC, -100, 75) && (item.feelsLikeC === null || finite(item.feelsLikeC, -120, 90)) && (item.precipitationMm === null || finite(item.precipitationMm, 0, 1000)) && (item.precipitationProbability === null || finite(item.precipitationProbability, 0, 100)) && finite(item.windKmh, 0, 450) && (item.isDay === null || typeof item.isDay === "boolean") && finite(item.weatherCode, 0, 99) && weatherCodes.has(item.weatherCode);
}
/** Validate both network responses and persisted data before showing a forecast. */
export function parseWeatherReport(value: unknown, query: WeatherQuery, timestamp = Date.now()): WeatherReport | null {
  const data = object(value), area = object(data.area), requested = object(data.requested);
  if (data.status !== "ok" || area.latitude !== query.latitude || area.longitude !== query.longitude || requested.date !== query.date || requested.hour !== query.hour || typeof data.stale !== "boolean" || typeof data.timezone !== "string" || !finite(data.utcOffsetSeconds, -50400, 50400) || !condition(data.current)) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: data.timezone }).format(); } catch { return null; }
  if (typeof data.fetchedAt !== "string" || typeof data.freshUntil !== "string" || typeof data.staleUntil !== "string") return null;
  const fetched = Date.parse(data.fetchedAt), fresh = Date.parse(data.freshUntil), stale = Date.parse(data.staleUntil);
  if (![fetched, fresh, stale].every(Number.isFinite) || fetched > timestamp + 60_000 || stale <= timestamp || fresh < fetched || fresh - fetched > 20 * 60_000 || stale < fresh || stale - fetched > 2 * 60 * 60_000) return null;
  if (!["forecast", "outside_forecast", "past", "unavailable"].includes(String(data.dinnerStatus))) return null;
  if (data.dinnerStatus === "forecast") {
    if (!condition(data.dinner) || data.dinner.time !== `${query.date}T${String(query.hour).padStart(2, "0")}:00`) return null;
  } else if (data.dinner !== null) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: data.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(timestamp);
  const part = (name: string) => parts.find(item => item.type === name)?.value ?? "";
  const nowHour = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:00`;
  const targetHour = `${query.date}T${String(query.hour).padStart(2, "0")}:00`;
  if (data.dinnerStatus === "forecast" && targetHour < nowHour) return { ...value as WeatherReport, dinner: null, dinnerStatus: "past" };
  return value as WeatherReport;
}
export function weatherDescription(code: number, isDay: boolean | null) {
  if (code === 0) return isDay === null ? "Clear sky" : isDay ? "Clear skies" : "Clear night";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Foggy";
  if ([51, 53, 55].includes(code)) return "Drizzle";
  if ([56, 57, 66, 67].includes(code)) return "Freezing rain";
  if ([61, 63, 65].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([80, 81, 82].includes(code)) return "Rain showers";
  if ([95, 96, 99].includes(code)) return "Thunderstorms";
  return "Conditions unavailable";
}
