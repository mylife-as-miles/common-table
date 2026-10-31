import type { IncomingMessage, ServerResponse } from "node:http";
import { CLAUDE_MODEL, type ClaudeConfig } from "./claude-config.ts";
import type { ClaudeClient } from "./claude-client.ts";
import {
  OFFLINE_WAITER_LABEL,
  mockWaiterReply,
  parseWaiterContext,
  trustedWaiterContext,
  type WaiterContext,
} from "./waiter-context.ts";

export const MAX_WAITER_BODY_BYTES = 4096;
export const MAX_WAITER_MESSAGE_CHARS = 600;
export const DEFAULT_WAITER_INTERVAL_MS = 1000;
export const DEFAULT_WAITER_TIMEOUT_MS = 10_000;
const MAX_WAITER_REPLY_CHARS = 8000;

export interface WaiterApiOptions {
  /** Server test seam only. Browser live access cannot be enabled through it. */
  client?: Pick<ClaudeClient, "reply">;
  now?: () => number;
  expectedOrigin?: string;
  intervalMs?: number;
  timeoutMs?: number;
}
export interface WaiterApiHandler {
  (req: IncomingMessage, res: ServerResponse, next?: () => void): Promise<boolean>;
  close(): void;
}

type ErrorCode = "invalid_request" | "body_too_large" | "unsupported_media_type" |
  "origin_rejected" | "csrf_rejected" | "disabled" | "method_not_allowed" |
  "busy" | "rate_limited" | "timeout" | "cancelled" | "closed" | "unavailable";
const messages: Record<ErrorCode, string> = {
  invalid_request: "Provide a valid message and supported table context.",
  body_too_large: "The Waiter request must be at most 4 KiB.",
  unsupported_media_type: "Use uncompressed application/json for this request.",
  origin_rejected: "This request must come from the same Common Table origin.",
  csrf_rejected: "The Common Table request header is required.",
  disabled: "Browser Claude access is disabled. Live testing is available only through the separately guarded server CLI.",
  method_not_allowed: "Use the method supported by this Waiter route.",
  busy: "The Waiter is already handling a request. Please wait.",
  rate_limited: "Please wait a moment before asking The Waiter again.",
  timeout: "The Waiter request timed out. No automatic retry was made.",
  cancelled: "The Waiter request was cancelled.",
  closed: "The Waiter service has been closed.",
  unavailable: "The Waiter could not complete this request. No automatic retry was made.",
};
class WaiterHttpError extends Error {
  constructor(readonly code: ErrorCode, readonly status: number) { super(messages[code]); }
}

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, payload: unknown) {
  if (res.destroyed || res.writableEnded) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.end(req.method === "HEAD" ? undefined : JSON.stringify(payload));
}

function canonicalOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash &&
      value === url.origin ? url.origin : null;
  } catch { return null; }
}

function enforceOrigin(req: IncomingMessage, expectedOrigin: string | undefined, requireOrigin: boolean) {
  // Forwarded headers are intentionally ignored: a proxy must pin expectedOrigin.
  const scheme = "encrypted" in req.socket && req.socket.encrypted ? "https" : "http";
  const hostOrigin = typeof req.headers.host === "string" ? canonicalOrigin(`${scheme}://${req.headers.host}`) : null;
  const origin = req.headers.origin;
  const site = req.headers["sec-fetch-site"];
  if (!hostOrigin ||
    (requireOrigin && typeof origin !== "string") ||
    (origin !== undefined && (typeof origin !== "string" || canonicalOrigin(origin) !== (expectedOrigin ?? hostOrigin))) ||
    (site !== undefined && site !== "same-origin" && site !== "none") ||
    req.headers["sec-fetch-mode"] === "navigate") {
    throw new WaiterHttpError("origin_rejected", 403);
  }
}

function readBody(req: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  const rawLength = req.headers["content-length"];
  if (rawLength !== undefined && (typeof rawLength !== "string" || !/^\d+$/.test(rawLength)))
    return Promise.reject(new WaiterHttpError("invalid_request", 400));
  if (rawLength !== undefined && Number(rawLength) > MAX_WAITER_BODY_BYTES)
    return Promise.reject(new WaiterHttpError("body_too_large", 413));
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let settled = false;
    const cleanup = () => {
      req.off("data", onData); req.off("end", onEnd); req.off("error", onError); req.off("aborted", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (error?: unknown, value?: unknown) => {
      if (settled) return;
      settled = true; cleanup();
      if (error) { chunks.length = 0; req.resume(); reject(error); }
      else resolve(value);
    };
    const onData = (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > MAX_WAITER_BODY_BYTES) finish(new WaiterHttpError("body_too_large", 413));
      else chunks.push(bytes);
    };
    const onEnd = () => {
      try {
        const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
        finish(undefined, JSON.parse(body));
      } catch { finish(new WaiterHttpError("invalid_request", 400)); }
    };
    const onError = () => finish(new WaiterHttpError("cancelled", 499));
    const onAbort = () => finish(signal.reason instanceof WaiterHttpError ? signal.reason : new WaiterHttpError("cancelled", 499));
    req.on("data", onData); req.once("end", onEnd); req.once("error", onError); req.once("aborted", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function parseRequest(value: unknown): { message: string; context: WaiterContext } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WaiterHttpError("invalid_request", 400);
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 2 || !Object.hasOwn(body, "message") || !Object.hasOwn(body, "context") ||
    typeof body.message !== "string" || !body.message.trim() || body.message.length > MAX_WAITER_MESSAGE_CHARS ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body.message)) throw new WaiterHttpError("invalid_request", 400);
  const context = parseWaiterContext(body.context);
  if (!context) throw new WaiterHttpError("invalid_request", 400);
  return { message: body.message.trim(), context };
}

/** Mock-only HTTP adapter. No environment flag or request field can enable paid web access. */
export function createWaiterApiHandler(config: ClaudeConfig, options: WaiterApiOptions = {}): WaiterApiHandler {
  const mode = config?.mode === "mock" ? "mock" : "disabled";
  const apiKey = config?.apiKey;
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? DEFAULT_WAITER_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAITER_TIMEOUT_MS;
  const expectedOrigin = options.expectedOrigin;
  if (typeof now !== "function" || !Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > 60_000 ||
    !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 ||
    (expectedOrigin !== undefined && !canonicalOrigin(expectedOrigin)) ||
    (options.client !== undefined && typeof options.client.reply !== "function")) throw new Error("Invalid Waiter server options.");
  let closed = false;
  let active: AbortController | null = null;
  let lastAccepted = -Infinity;
  const handler = async (req: IncomingMessage, res: ServerResponse, next?: () => void): Promise<boolean> => {
    let url: URL;
    try { url = new URL(req.url ?? "/", "http://common-table.local"); }
    catch { next?.(); return false; }
    const isStatus = url.pathname === "/api/waiter/status";
    const isReply = url.pathname === "/api/waiter/reply";
    if (!isStatus && !isReply) { next?.(); return false; }
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onDisconnect = () => controller?.abort(new WaiterHttpError("cancelled", 499));
    try {
      if (closed) throw new WaiterHttpError("closed", 503);
      if (req.url !== url.pathname) throw new WaiterHttpError("invalid_request", 400);
      if ((isStatus && req.method !== "GET") || (isReply && req.method !== "POST")) {
        res.setHeader("Allow", isStatus ? "GET" : "POST");
        throw new WaiterHttpError("method_not_allowed", 405);
      }
      enforceOrigin(req, expectedOrigin, isReply);
      if (isStatus) { sendJson(req, res, 200, { mode }); return true; }
      if (req.headers["x-common-table-request"] !== "waiter") throw new WaiterHttpError("csrf_rejected", 403);
      if (mode !== "mock") throw new WaiterHttpError("disabled", 503);
      if (typeof req.headers["content-type"] !== "string" || !/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(req.headers["content-type"]) || req.headers["content-encoding"] !== undefined)
        throw new WaiterHttpError("unsupported_media_type", 415);
      if (active) { res.setHeader("Retry-After", "1"); throw new WaiterHttpError("busy", 429); }
      controller = new AbortController(); active = controller;
      req.once("aborted", onDisconnect); res.once("close", onDisconnect);
      timer = setTimeout(() => controller?.abort(new WaiterHttpError("timeout", 504)), timeoutMs);
      if (req.aborted || res.destroyed) controller.abort(new WaiterHttpError("cancelled", 499));
      const { message, context } = parseRequest(await readBody(req, controller.signal));
      const timestamp = now();
      if (!Number.isFinite(timestamp)) throw new WaiterHttpError("unavailable", 502);
      if (timestamp - lastAccepted < intervalMs) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil(intervalMs / 1000))));
        throw new WaiterHttpError("rate_limited", 429);
      }
      lastAccepted = timestamp;
      let text: string;
      let model: string | undefined;
      if (options.client) {
        let removeAbortListener: (() => void) | undefined;
        const abort = new Promise<never>((_, reject) => {
          const cancelled = () => reject(controller!.signal.reason instanceof WaiterHttpError ? controller!.signal.reason : new WaiterHttpError("cancelled", 499));
          controller!.signal.addEventListener("abort", cancelled, { once: true });
          removeAbortListener = () => controller!.signal.removeEventListener("abort", cancelled);
          if (controller!.signal.aborted) cancelled();
        });
        let result;
        try {
          // Attach both race branches before invoking injected code: it may
          // synchronously abort/throw, just like a real transport can.
          const pending = Promise.resolve().then(() => {
            if (controller!.signal.aborted) throw controller!.signal.reason;
            return options.client!.reply(message, trustedWaiterContext(context), controller!.signal);
          });
          result = await Promise.race([pending, abort]);
        } finally { removeAbortListener?.(); }
        if (result?.source !== "mock" || typeof result.text !== "string" || !result.text.trim() || result.text.length > MAX_WAITER_REPLY_CHARS ||
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result.text) ||
          (result.model !== undefined && result.model !== CLAUDE_MODEL)) throw new WaiterHttpError("unavailable", 502);
        text = result.text.startsWith(OFFLINE_WAITER_LABEL) ? result.text : `${OFFLINE_WAITER_LABEL}\n\n${result.text}`;
        model = result.model;
      } else text = mockWaiterReply(message, context);
      if (text.length > MAX_WAITER_REPLY_CHARS || (apiKey && text.includes(apiKey))) throw new WaiterHttpError("unavailable", 502);
      if (controller.signal.aborted) throw controller.signal.reason;
      sendJson(req, res, 200, { source: "mock", text, ...(model ? { model } : {}) });
    } catch (error) {
      const safe = error instanceof WaiterHttpError ? error : new WaiterHttpError("unavailable", 502);
      // An early rejection can leave a declared body incomplete. Do not let an
      // HTTP agent reuse that socket and have its next request read as body data.
      if (!req.complete && !res.headersSent) res.setHeader("Connection", "close");
      sendJson(req, res, safe.status, { status: "error", code: safe.code, message: safe.message });
    } finally {
      if (timer) clearTimeout(timer);
      req.off("aborted", onDisconnect); res.off("close", onDisconnect);
      if (active === controller) active = null;
    }
    return true;
  };
  return Object.assign(handler, { close() { closed = true; active?.abort(new WaiterHttpError("closed", 503)); } });
}
