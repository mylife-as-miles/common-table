import type { IncomingMessage, ServerResponse } from "node:http";

type JsonObject = Record<string, unknown>;
export interface WeatherResult {
  source: "openweather";
  status: "ready";
  latitude: number;
  longitude: number;
  placeName: string;
  temperatureC: number;
  feelsLikeC: number;
  description: string;
  condition: "clear" | "clouds" | "rain" | "snow" | "storm" | "fog";
  isDay: boolean;
  observedAt: string;
  windMps: number;
}
export interface PlaceResult {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
}
interface GeocodeResult {
  results: PlaceResult[];
  source: "photon" | "openweather";
}
export interface ApiOptions {
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  timeoutMs?: number;
  geocodeIntervalMs?: number;
}

const TEN_MINUTES = 10 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 250;
const CLIENT_ID =
  "CommonTable/0.1 (https://github.com/mylife-as-miles/common-table)";
const object = (value: unknown): JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;
const text = (value: unknown, limit = 100): string =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, limit)
    : "";
const labels = (values: unknown[]) =>
  [...new Set(values.map((value) => text(value)).filter(Boolean))]
    .join(", ")
    .slice(0, 220);

function coordinates(
  params: URLSearchParams,
): { latitude: number; longitude: number } | null {
  const lat = params.get("lat");
  const lon = params.get("lon");
  // Number('') and Number(null) are zero; reject missing/empty values first.
  if (
    !lat?.trim() ||
    !lon?.trim() ||
    params.getAll("lat").length !== 1 ||
    params.getAll("lon").length !== 1
  )
    return null;
  const latitude = Number(lat);
  const longitude = Number(lon);
  return finite(latitude, -90, 90) && finite(longitude, -180, 180)
    ? { latitude, longitude }
    : null;
}

function conditionFor(id: number): WeatherResult["condition"] {
  if (id >= 200 && id < 300) return "storm";
  if ((id >= 300 && id < 400) || (id >= 500 && id < 600)) return "rain";
  if (id >= 600 && id < 700) return "snow";
  if (id >= 700 && id < 800) return "fog";
  return id === 800 ? "clear" : "clouds";
}

function parseWeather(
  value: unknown,
  latitude: number,
  longitude: number,
): WeatherResult | null {
  const payload = object(value);
  const main = object(payload.main);
  const wind = object(payload.wind);
  const weather = Array.isArray(payload.weather)
    ? object(payload.weather[0])
    : {};
  const sys = object(payload.sys);
  if (
    !finite(main.temp, -120, 100) ||
    !finite(main.feels_like, -150, 150) ||
    !finite(wind.speed, 0, 200) ||
    !finite(weather.id, 200, 804) ||
    !Number.isInteger(weather.id) ||
    !finite(payload.dt, 1, 100_000_000_000)
  )
    return null;
  const observedAt = new Date(payload.dt * 1000);
  if (Number.isNaN(observedAt.getTime())) return null;
  const icon = text(weather.icon, 3);
  const isDay = /^\d{2}[dn]$/.test(icon)
    ? icon.endsWith("d")
    : finite(sys.sunrise, 1, 100_000_000_000) &&
        finite(sys.sunset, 1, 100_000_000_000)
      ? payload.dt >= sys.sunrise && payload.dt < sys.sunset
      : true;
  const condition = conditionFor(weather.id);
  return {
    source: "openweather",
    status: "ready",
    latitude,
    longitude,
    placeName: text(payload.name) || "Selected area",
    temperatureC: main.temp,
    feelsLikeC: main.feels_like,
    description: text(weather.description, 120) || condition,
    condition,
    isDay,
    observedAt: observedAt.toISOString(),
    windMps: wind.speed,
  };
}

function parseOpenWeatherPlaces(value: unknown): PlaceResult[] | null {
  if (!Array.isArray(value)) return null;
  const places: PlaceResult[] = [];
  for (const item of value.slice(0, 5)) {
    const place = object(item);
    if (
      !finite(place.lat, -90, 90) ||
      !finite(place.lon, -180, 180) ||
      !text(place.name)
    )
      continue;
    places.push({
      id: `ow-${place.lat}-${place.lon}`,
      label: labels([place.name, place.state, place.country]),
      latitude: place.lat,
      longitude: place.lon,
    });
  }
  return places;
}

function parsePhotonPlaces(value: unknown): PlaceResult[] | null {
  const payload = object(value);
  if (!Array.isArray(payload.features)) return null;
  const places: PlaceResult[] = [];
  for (const feature of payload.features.slice(0, 5)) {
    const entry = object(feature);
    const properties = object(entry.properties);
    const geometry = object(entry.geometry);
    const position = geometry.coordinates;
    if (
      geometry.type !== "Point" ||
      !Array.isArray(position) ||
      !finite(position[0], -180, 180) ||
      !finite(position[1], -90, 90)
    )
      continue;
    const label = labels([
      properties.name,
      properties.city,
      properties.state,
      properties.country,
    ]);
    if (!label) continue;
    const id = text(
      String(properties.osm_id ?? `${position[1]}-${position[0]}`),
      80,
    );
    places.push({
      id: `photon-${text(properties.osm_type, 1)}-${id}`,
      label,
      latitude: position[1],
      longitude: position[0],
    });
  }
  return places;
}

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  payload: unknown,
) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const body = JSON.stringify(payload);
  res.end(req.method === "HEAD" ? undefined : body);
}

/** Node middleware. Returns false for non-API requests, and calls next if supplied. */
export function createApiHandler(options: ApiOptions = {}) {
  const apiKey = (
    options.apiKey ??
    process.env.OPENWEATHER_API_KEY ??
    ""
  ).trim();
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 8000;
  const geocodeIntervalMs = options.geocodeIntervalMs ?? 1000;
  const weatherCache = new Map<
    string,
    { expires: number; data: WeatherResult }
  >();
  const geocodeCache = new Map<
    string,
    { expires: number; data: GeocodeResult }
  >();
  const weatherInflight = new Map<string, Promise<WeatherResult | null>>();
  const geocodeInflight = new Map<string, Promise<GeocodeResult | null>>();
  let lastGeocodeStarted = -Infinity;

  function cacheSet<T>(
    cache: Map<string, { expires: number; data: T }>,
    key: string,
    data: T,
    ttl: number,
  ) {
    for (const [entry, cached] of cache)
      if (cached.expires <= now()) cache.delete(entry);
    if (cache.size >= MAX_CACHE_ENTRIES)
      cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: now() + ttl, data });
  }
  function cached<T>(
    cache: Map<string, { expires: number; data: T }>,
    key: string,
  ): T | undefined {
    const found = cache.get(key);
    if (found && found.expires > now()) return found.data;
    if (found) cache.delete(key);
    return undefined;
  }
  async function requestJson(url: URL): Promise<unknown | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, {
        signal: controller.signal,
        redirect: "error",
        headers: { Accept: "application/json", "User-Agent": CLIENT_ID },
      });
      if (!response.ok) return null;
      // Never forward provider errors, request URLs, or their credential-bearing query strings.
      return await response.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
  async function fetchWeather(
    latitude: number,
    longitude: number,
  ): Promise<WeatherResult | null> {
    const url = new URL("https://api.openweathermap.org/data/2.5/weather");
    url.search = new URLSearchParams({
      lat: String(latitude),
      lon: String(longitude),
      units: "metric",
      appid: apiKey,
    }).toString();
    return parseWeather(await requestJson(url), latitude, longitude);
  }
  async function fetchGeocode(query: string): Promise<GeocodeResult | null> {
    if (apiKey) {
      const url = new URL("https://api.openweathermap.org/geo/1.0/direct");
      url.search = new URLSearchParams({
        q: query,
        limit: "5",
        appid: apiKey,
      }).toString();
      const results = parseOpenWeatherPlaces(await requestJson(url));
      if (results) return { results, source: "openweather" };
    }
    // Photon permits reasonable public-demo usage. Only explicit searches reach
    // this endpoint; requests coalesce, cache for 15m and are limited to 1/s.
    // Primary usage policy: https://github.com/komoot/photon#demo-server
    const url = new URL("https://photon.komoot.io/api/");
    url.search = new URLSearchParams({ q: query, limit: "5" }).toString();
    const results = parsePhotonPlaces(await requestJson(url));
    return results ? { results, source: "photon" } : null;
  }

  return async function apiHandler(
    req: IncomingMessage,
    res: ServerResponse,
    next?: () => void,
  ): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://common-table.local");
    } catch {
      sendJson(req, res, 400, {
        status: "error",
        code: "invalid_request",
        message: "Invalid request.",
      });
      return true;
    }
    if (!url.pathname.startsWith("/api/")) {
      next?.();
      return false;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      sendJson(req, res, 405, {
        status: "error",
        code: "method_not_allowed",
        message: "Use a GET request.",
      });
      return true;
    }
    if (url.pathname === "/api/location-config") {
      sendJson(req, res, 200, { weatherConfigured: Boolean(apiKey) });
      return true;
    }
    if (url.pathname === "/api/weather") {
      const position = coordinates(url.searchParams);
      if (!position) {
        sendJson(req, res, 400, {
          status: "error",
          code: "invalid_coordinates",
          message:
            "Provide latitude from -90 to 90 and longitude from -180 to 180.",
        });
        return true;
      }
      if (!apiKey) {
        sendJson(req, res, 503, {
          status: "unavailable",
          code: "not_configured",
          message:
            "Live weather is not configured. Add a server-side OpenWeather API key to enable it.",
        });
        return true;
      }
      const latitude = Number(position.latitude.toFixed(2));
      const longitude = Number(position.longitude.toFixed(2));
      const key = `${latitude},${longitude}`;
      let data = cached(weatherCache, key);
      if (!data) {
        let pending = weatherInflight.get(key);
        if (!pending) {
          pending = fetchWeather(latitude, longitude);
          weatherInflight.set(key, pending);
        }
        try {
          const result = await pending;
          if (result) {
            data = result;
            cacheSet(weatherCache, key, result, TEN_MINUTES);
          }
        } finally {
          if (weatherInflight.get(key) === pending) weatherInflight.delete(key);
        }
      }
      sendJson(
        req,
        res,
        data ? 200 : 503,
        data ?? {
          status: "unavailable",
          code: "upstream_unavailable",
          message:
            "Live weather is temporarily unavailable. The map still works; try again later.",
        },
      );
      return true;
    }
    if (url.pathname === "/api/geocode") {
      const query =
        url.searchParams.get("q")?.trim().replace(/\s+/g, " ") ?? "";
      if (
        query.length < 2 ||
        query.length > 120 ||
        /[\u0000-\u001f\u007f]/.test(query) ||
        url.searchParams.getAll("q").length !== 1
      ) {
        sendJson(req, res, 400, {
          status: "error",
          code: "invalid_query",
          message: "Enter a city or neighborhood between 2 and 120 characters.",
        });
        return true;
      }
      const key = query.toLocaleLowerCase("en-US");
      let data = cached(geocodeCache, key);
      if (!data) {
        let pending = geocodeInflight.get(key);
        if (!pending) {
          if (now() - lastGeocodeStarted < geocodeIntervalMs) {
            res.setHeader("Retry-After", "1");
            sendJson(req, res, 429, {
              status: "unavailable",
              code: "rate_limited",
              message:
                "Please wait a moment before searching for another place.",
            });
            return true;
          }
          lastGeocodeStarted = now();
          pending = fetchGeocode(query);
          geocodeInflight.set(key, pending);
        }
        try {
          const result = await pending;
          if (result) {
            data = result;
            cacheSet(geocodeCache, key, result, FIFTEEN_MINUTES);
          }
        } finally {
          if (geocodeInflight.get(key) === pending) geocodeInflight.delete(key);
        }
      }
      sendJson(
        req,
        res,
        data ? 200 : 503,
        data ?? {
          status: "unavailable",
          code: "upstream_unavailable",
          message:
            "Place search is temporarily unavailable. Try again later or use your device location.",
        },
      );
      return true;
    }
    sendJson(req, res, 404, {
      status: "error",
      code: "not_found",
      message: "API route not found.",
    });
    return true;
  };
}
