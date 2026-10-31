import type { IncomingMessage, ServerResponse } from "node:http";

type JsonObject = Record<string, unknown>;
export interface PlaceResult {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
}
interface GeocodeResult {
  results: PlaceResult[];
  source: "photon";
}
export interface ApiOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  timeoutMs?: number;
  geocodeIntervalMs?: number;
}

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
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 8000;
  const geocodeIntervalMs = options.geocodeIntervalMs ?? 1000;
  const geocodeCache = new Map<
    string,
    { expires: number; data: GeocodeResult }
  >();
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
      // Never forward provider errors or internal request details.
      return await response.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
  async function fetchGeocode(query: string): Promise<GeocodeResult | null> {
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
    if (url.pathname === "/api/geocode") {
      const rawQuery = url.searchParams.get("q") ?? "";
      const query = rawQuery.trim().replace(/\s+/g, " ");
      if (
        query.length < 2 ||
        query.length > 120 ||
        /[\u0000-\u001f\u007f]/.test(rawQuery) ||
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
