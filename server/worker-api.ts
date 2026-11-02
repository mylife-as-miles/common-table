import { mockWaiterReply, parseWaiterContext } from "./waiter-context.ts";

/** Public-demo API using only Web APIs: no provider client, key, ledger or Node runtime. */
export interface WorkerApiOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  timeoutMs?: number;
  geocodeIntervalMs?: number;
  waiterIntervalMs?: number;
}

type JsonObject = Record<string, unknown>;
interface PlaceResult { id: string; label: string; latitude: number; longitude: number }
interface GeocodeResult { results: PlaceResult[]; source: "photon" }
const MAX_BODY_BYTES = 4096;
const MAX_UPSTREAM_BYTES = 256 * 1024;
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 250;
const CLIENT_ID = "CommonTable/0.1 (https://github.com/mylife-as-miles/common-table)";
const messages = {
  invalid_request: "Provide a valid message and supported table context.",
  body_too_large: "The Waiter request must be at most 4 KiB.",
  unsupported_media_type: "Use uncompressed application/json for this request.",
  origin_rejected: "This request must come from the same Common Table origin.",
  csrf_rejected: "The Common Table request header is required.",
  method_not_allowed: "Use the method supported by this API route.",
  busy: "The Waiter is already handling a request. Please wait.",
  rate_limited: "Please wait a moment before asking The Waiter again.",
  timeout: "The Waiter request timed out. No automatic retry was made.",
  cancelled: "The Waiter request was cancelled.",
  unavailable: "The Waiter could not complete this request. No automatic retry was made.",
  not_found: "API route not found.",
} as const;
type ErrorCode = keyof typeof messages;
class ApiError extends Error {
  constructor(readonly code: ErrorCode, readonly status: number) { super(messages[code]); }
}

function json(request: Request, status: number, payload: unknown, headers: Record<string, string> = {}) {
  return new Response(request.method === "HEAD" ? null : JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      ...headers,
    },
  });
}
function failure(request: Request, code: ErrorCode, status: number, headers: Record<string, string> = {}) {
  return json(request, status, { status: "error", code, message: messages[code] }, headers);
}
function canonicalOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username && !url.password && value === url.origin ? url.origin : null;
  } catch { return null; }
}
function enforceOrigin(request: Request, requireOrigin: boolean) {
  // Request.url is the public HTTPS URL in Workers. Never trust forwarded headers.
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (!canonicalOrigin(expected) || (requireOrigin && origin === null) ||
    (origin !== null && canonicalOrigin(origin) !== expected) ||
    (site !== null && site !== "same-origin" && site !== "none") ||
    request.headers.get("sec-fetch-mode") === "navigate") {
    throw new ApiError("origin_rejected", 403);
  }
}

/** Read incrementally; declared size alone does not protect against streamed bodies. */
async function readJson(body: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal) {
  if (!body) throw new ApiError("invalid_request", 400);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) throw signal.reason;
    while (true) {
      const part = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => undefined);
        throw new ApiError("body_too_large", 413);
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new ApiError("invalid_request", 400); }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

const record = (value: unknown): JsonObject => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const text = (value: unknown, limit = 100): string => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit) : "";
const finite = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
function parsePhoton(value: unknown): PlaceResult[] | null {
  const data = record(value);
  if (!Array.isArray(data.features)) return null;
  const places: PlaceResult[] = [];
  for (const feature of data.features.slice(0, 5)) {
    const item = record(feature);
    const properties = record(item.properties);
    const geometry = record(item.geometry);
    const position = geometry.coordinates;
    if (geometry.type !== "Point" || !Array.isArray(position) || !finite(position[0], -180, 180) || !finite(position[1], -90, 90)) continue;
    const label = [...new Set([properties.name, properties.city, properties.state, properties.country].map(value => text(value)).filter(Boolean))].join(", ").slice(0, 220);
    if (!label) continue;
    const id = text(String(properties.osm_id ?? `${position[1]}-${position[0]}`), 80);
    places.push({ id: `photon-${text(properties.osm_type, 1)}-${id}`, label, latitude: position[1], longitude: position[0] });
  }
  return places;
}

/** State is per isolate, suitable for a bounded public demo, not a global quota. */
export function createWorkerApiHandler(options: WorkerApiOptions = {}) {
  // Resolve the platform fetch inside each request and preserve its receiver.
  // Capturing an unbound Worker/Vinext fetch at module initialization can retain
  // a request-scoped shim or fail with an illegal invocation in production.
  const fetcher: typeof globalThis.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 8000;
  const geocodeIntervalMs = options.geocodeIntervalMs ?? 1000;
  const waiterIntervalMs = options.waiterIntervalMs ?? 1000;
  if (typeof fetcher !== "function" || typeof now !== "function" || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 ||
    [geocodeIntervalMs, waiterIntervalMs].some(value => !Number.isFinite(value) || value < 0 || value > 60_000)) throw new Error("Invalid public-demo API options.");
  const cache = new Map<string, { expires: number; data: GeocodeResult }>();
  const inflight = new Map<string, Promise<GeocodeResult | null>>();
  let lastGeocodeStarted = -Infinity;
  let lastWaiterAccepted = -Infinity;
  let waiterActive = false;

  async function fetchGeocode(query: string): Promise<GeocodeResult | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = new URL("https://photon.komoot.io/api/");
      url.search = new URLSearchParams({ q: query, limit: "5" }).toString();
      const response = await fetcher(url, {
        signal: controller.signal,
        // Workers supports manual/follow, not the Fetch-standard error mode.
        // Manual plus the non-2xx rejection below never follows provider redirects.
        redirect: "manual",
        headers: { Accept: "application/json", "User-Agent": CLIENT_ID },
      });
      if (!response.ok) {
        console.warn("Common Table geocode unavailable", { reason: "upstream_http", status: response.status });
        void response.body?.cancel().catch(() => undefined); return null;
      }
      const results = parsePhoton(await readJson(response.body, MAX_UPSTREAM_BYTES, controller.signal));
      return results ? { results, source: "photon" } : null;
    } catch (error) {
      // Log only a fixed diagnostic category, never raw errors, queries or headers.
      const message = error instanceof Error ? error.message : "";
      const reason = controller.signal.aborted ? "timeout" :
        /illegal invocation|incorrect.*this|receiver/i.test(message) ? "fetch_receiver" :
        /different request|outside.*request|request.*context/i.test(message) ? "request_context" :
        /fetch failed|network|DNS|connect/i.test(message) ? "network" :
        error instanceof ApiError ? "invalid_upstream_payload" : "upstream_exception";
      console.warn("Common Table geocode unavailable", { reason });
      return null;
    }
    finally { clearTimeout(timer); }
  }

  async function geocode(request: Request, url: URL) {
    if (request.method !== "GET" && request.method !== "HEAD") return failure(request, "method_not_allowed", 405, { Allow: "GET, HEAD" });
    const rawQuery = url.searchParams.get("q") ?? "";
    const query = rawQuery.trim().replace(/\s+/g, " ");
    if (query.length < 2 || query.length > 120 || /[\u0000-\u001f\u007f]/.test(rawQuery) || url.searchParams.getAll("q").length !== 1) {
      return json(request, 400, { status: "error", code: "invalid_query", message: "Enter a city or neighborhood between 2 and 120 characters." });
    }
    const timestamp = now();
    if (!Number.isFinite(timestamp)) return failure(request, "unavailable", 503);
    const key = query.toLocaleLowerCase("en-US");
    const existing = cache.get(key);
    let data = existing && existing.expires > timestamp ? existing.data : undefined;
    if (existing && !data) cache.delete(key);
    if (!data) {
      let pending = inflight.get(key);
      if (!pending) {
        if (timestamp - lastGeocodeStarted < geocodeIntervalMs) return json(request, 429, { status: "unavailable", code: "rate_limited", message: "Please wait a moment before searching for another place." }, { "Retry-After": "1" });
        lastGeocodeStarted = timestamp;
        pending = fetchGeocode(query);
        inflight.set(key, pending);
      }
      try {
        const result = await pending;
        if (result) {
          data = result;
          for (const [entry, value] of cache) if (value.expires <= now()) cache.delete(entry);
          if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
          cache.set(key, { expires: now() + CACHE_TTL_MS, data });
        }
      } finally { if (inflight.get(key) === pending) inflight.delete(key); }
    }
    return json(request, data ? 200 : 503, data ?? { status: "unavailable", code: "upstream_unavailable", message: "Place search is temporarily unavailable. Try again later or use your device location." });
  }

  async function waiter(request: Request, url: URL) {
    const isStatus = url.pathname === "/api/waiter/status";
    if (url.search || url.hash) return failure(request, "invalid_request", 400);
    if (request.method !== (isStatus ? "GET" : "POST")) return failure(request, "method_not_allowed", 405, { Allow: isStatus ? "GET" : "POST" });
    enforceOrigin(request, !isStatus);
    if (isStatus) return json(request, 200, { mode: "mock" });
    if (request.headers.get("x-common-table-request") !== "waiter") throw new ApiError("csrf_rejected", 403);
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(request.headers.get("content-type") ?? "") || request.headers.has("content-encoding")) throw new ApiError("unsupported_media_type", 415);
    const length = request.headers.get("content-length");
    if (length !== null && !/^\d+$/.test(length)) throw new ApiError("invalid_request", 400);
    if (length !== null && Number(length) > MAX_BODY_BYTES) throw new ApiError("body_too_large", 413);
    if (waiterActive) return failure(request, "busy", 429, { "Retry-After": "1" });
    waiterActive = true;
    const controller = new AbortController();
    const cancelled = () => controller.abort(new ApiError("cancelled", 499));
    request.signal.addEventListener("abort", cancelled, { once: true });
    const timer = setTimeout(() => controller.abort(new ApiError("timeout", 504)), timeoutMs);
    try {
      if (request.signal.aborted) cancelled();
      const value = await readJson(request.body, MAX_BODY_BYTES, controller.signal);
      const body = record(value);
      if (Object.keys(body).length !== 2 || !Object.hasOwn(body, "message") || !Object.hasOwn(body, "context") || typeof body.message !== "string" || !body.message.trim() || body.message.length > 600 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body.message)) throw new ApiError("invalid_request", 400);
      const context = parseWaiterContext(body.context);
      if (!context) throw new ApiError("invalid_request", 400);
      const timestamp = now();
      if (!Number.isFinite(timestamp)) throw new ApiError("unavailable", 502);
      if (timestamp - lastWaiterAccepted < waiterIntervalMs) return failure(request, "rate_limited", 429, { "Retry-After": String(Math.max(1, Math.ceil(waiterIntervalMs / 1000))) });
      lastWaiterAccepted = timestamp;
      if (controller.signal.aborted) throw controller.signal.reason;
      // The only reply path is a deterministic, labelled local function. No paid transport exists.
      return json(request, 200, { source: "mock", text: mockWaiterReply(body.message.trim(), context) });
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", cancelled);
      waiterActive = false;
    }
  }

  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/geocode") return await geocode(request, url);
      if (url.pathname === "/api/waiter/status" || url.pathname === "/api/waiter/reply") return await waiter(request, url);
      return failure(request, "not_found", 404);
    } catch (error) {
      const safe = error instanceof ApiError ? error : new ApiError("unavailable", 502);
      return failure(request, safe.code, safe.status);
    }
  };
}

export const handleApiRequest = createWorkerApiHandler();
