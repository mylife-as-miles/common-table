import { isAbsolute } from "node:path";
import type { ClaudeConfig } from "./claude-config.ts";
import {
  createClaudeBudget,
  ClaudeBudgetError,
  type ClaudeBudget,
  type ClaudeReservation,
} from "./claude-budget.ts";

export const CLAUDE_MODEL = "claude-sonnet-5-5" as const;
export const ANTHROPIC_API_ORIGIN = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2026-10-21";
export const MAX_PROMPT_BYTES = 16 * 1024;
export const MAX_OUTPUT_TOKENS = 512;
export const MAX_RESPONSE_BYTES = 64 * 1024;
export const INPUT_USD_PER_MTOK = 2;
export const OUTPUT_USD_PER_MTOK = 10;
export const DEFAULT_CLAUDE_TIMEOUT_MS = 10_000;

export type ClaudeErrorCode =
  | "invalid_config"
  | "not_configured"
  | "disabled"
  | "invalid_message"
  | "prompt_too_large"
  | "organization_mismatch"
  | "model_mismatch"
  | "upstream_unavailable"
  | "invalid_response"
  | "response_too_large"
  | "timeout"
  | "cancelled"
  | "budget_exhausted"
  | "budget_unavailable"
  | "closed";
const errorMessages: Record<ClaudeErrorCode, string> = {
  invalid_config: "Claude server configuration is invalid.",
  not_configured: "Claude live access is not configured.",
  disabled: "Claude access is disabled.",
  invalid_message:
    "Provide a non-empty plain text message and optional plain text context.",
  prompt_too_large: "Message and context together must be at most 16 KiB.",
  organization_mismatch:
    "The API key could not be verified against the authorized organization.",
  model_mismatch: "The authorized Claude model could not be verified.",
  upstream_unavailable:
    "Claude is temporarily unavailable. No automatic retry was made.",
  invalid_response: "Claude returned an unsupported response.",
  response_too_large:
    "Claude returned a response larger than the allowed limit.",
  timeout: "The Claude request timed out. No automatic retry was made.",
  cancelled: "The Claude request was cancelled.",
  budget_exhausted:
    "The local five-attempt Claude test allowance has been exhausted.",
  budget_unavailable: "The local Claude budget could not be verified.",
  closed: "This Claude client has been closed.",
};
export class ClaudeError extends Error {
  constructor(
    public readonly code: ClaudeErrorCode,
    public readonly status: number,
  ) {
    super(errorMessages[code]);
    this.name = "ClaudeError";
  }
}
export interface ClaudeReply {
  source: "mock" | "anthropic";
  model: typeof CLAUDE_MODEL;
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
  reservationUsd?: number;
}
export interface ClaudePreflight {
  source: "mock" | "anthropic";
  model: typeof CLAUDE_MODEL;
  verified: boolean;
  organization?: { id: string; name: string };
}
export interface ClaudeClient {
  reply(
    message: string,
    context?: string,
    signal?: AbortSignal,
  ): Promise<ClaudeReply>;
  preflight(): Promise<ClaudePreflight>;
  close(): void;
}
export interface ClaudeClientOptions {
  fetch?: typeof globalThis.fetch;
  budget?: ClaudeBudget;
  timeoutMs?: number;
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const normalizeName = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const tokenCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function validatedConfig(input: ClaudeConfig): Readonly<ClaudeConfig> {
  try {
    if (
      !input ||
      !["mock", "live", "disabled"].includes(input.mode) ||
      input.model !== CLAUDE_MODEL ||
      typeof input.expectedOrgName !== "string" ||
      normalizeName(input.expectedOrgName) !== "startrz" ||
      typeof input.ledgerPath !== "string" ||
      !isAbsolute(input.ledgerPath) ||
      input.ledgerPath.includes("\0") ||
      (input.expectedOrgId !== undefined &&
        (typeof input.expectedOrgId !== "string" ||
          !/^[a-zA-Z0-9_-]{8,128}$/.test(input.expectedOrgId))) ||
      (input.apiKey !== undefined &&
        (typeof input.apiKey !== "string" ||
          input.apiKey.length > 4096 ||
          /[^\x21-\x7e]/.test(input.apiKey)))
    ) {
      throw new ClaudeError("invalid_config", 400);
    }
    if (input.mode === "live" && !input.apiKey)
      throw new ClaudeError("not_configured", 503);
    return Object.freeze({
      mode: input.mode,
      model: CLAUDE_MODEL,
      apiKey: input.apiKey,
      expectedOrgName: input.expectedOrgName,
      expectedOrgId: input.expectedOrgId,
      ledgerPath: input.ledgerPath,
    });
  } catch (error) {
    if (error instanceof ClaudeError) throw error;
    throw new ClaudeError("invalid_config", 400);
  }
}

/** Offline by default through explicit mock configuration. This module never reads env. */
export function createClaudeClient(
  input: ClaudeConfig,
  options: ClaudeClientOptions = {},
): ClaudeClient {
  const config = validatedConfig(input);
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLAUDE_TIMEOUT_MS;
  if (
    typeof fetcher !== "function" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30_000
  )
    throw new ClaudeError("invalid_config", 400);
  let closed = false;
  let budget: ClaudeBudget | undefined = options.budget;
  let ownsBudget = false;
  let preflightPromise: Promise<ClaudePreflight> | undefined;
  const controllers = new Set<AbortController>();

  function assertOpen() {
    if (closed) throw new ClaudeError("closed", 503);
    if (config.mode === "disabled") throw new ClaudeError("disabled", 503);
  }
  function assertSignal(signal?: AbortSignal) {
    if (signal?.aborted) throw new ClaudeError("cancelled", 499);
  }
  async function request(
    path: string,
    body?: unknown,
    external?: AbortSignal,
  ): Promise<unknown> {
    assertOpen();
    assertSignal(external);
    // No caller-controlled origin, redirects, query strings or alternate endpoints.
    const url = new URL(path, ANTHROPIC_API_ORIGIN);
    if (
      url.origin !== ANTHROPIC_API_ORIGIN ||
      ![
        "/v1/organizations/me",
        `/v1/models/${CLAUDE_MODEL}`,
        "/v1/messages",
      ].includes(url.pathname) ||
      url.search ||
      url.hash
    )
      throw new ClaudeError("invalid_config", 400);
    const controller = new AbortController();
    controllers.add(controller);
    let timedOut = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const forwardAbort = () => controller.abort();
    external?.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let onAbort: (() => void) | undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
      onAbort = () =>
        reject(
          new ClaudeError(
            timedOut ? "timeout" : closed ? "closed" : "cancelled",
            timedOut ? 504 : closed ? 503 : 499,
          ),
        );
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const operation = (async () => {
        const response = await fetcher(url, {
          method: body === undefined ? "GET" : "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "anthropic-version": ANTHROPIC_VERSION,
            Accept: "application/json",
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => {});
          throw new ClaudeError(
            timedOut ? "timeout" : closed ? "closed" : "cancelled",
            timedOut ? 504 : closed ? 503 : 499,
          );
        }
        if (!response.ok || response.redirected) {
          void response.body?.cancel().catch(() => {});
          throw new ClaudeError("upstream_unavailable", 502);
        }
        const declared = response.headers.get("content-length");
        if (
          declared !== null &&
          /^\d+$/.test(declared) &&
          Number(declared) > MAX_RESPONSE_BYTES
        ) {
          void response.body?.cancel().catch(() => {});
          throw new ClaudeError("response_too_large", 502);
        }
        if (!response.body) throw new ClaudeError("invalid_response", 502);
        reader = response.body.getReader();
        let bytes = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          bytes += result.value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) {
            void reader.cancel().catch(() => {});
            throw new ClaudeError("response_too_large", 502);
          }
          chunks.push(result.value);
        }
        const combined = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.byteLength;
        }
        try {
          return JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(combined),
          ) as unknown;
        } catch {
          throw new ClaudeError("invalid_response", 502);
        }
      })();
      return await Promise.race([operation, stopped]);
    } catch (error) {
      if (timedOut) throw new ClaudeError("timeout", 504);
      if (closed) throw new ClaudeError("closed", 503);
      if (external?.aborted) throw new ClaudeError("cancelled", 499);
      if (error instanceof ClaudeError) throw error;
      throw new ClaudeError("upstream_unavailable", 502);
    } finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", forwardAbort);
      if (onAbort) controller.signal.removeEventListener("abort", onAbort);
      if (controller.signal.aborted) void reader?.cancel().catch(() => {});
      try {
        reader?.releaseLock();
      } catch {
        /* an aborted reader may still be pending */
      }
      controllers.delete(controller);
    }
  }

  async function verify(): Promise<ClaudePreflight> {
    const organization = record(await request("/v1/organizations/me"));
    if (
      organization.type !== "organization" ||
      typeof organization.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,200}$/.test(organization.id) ||
      typeof organization.name !== "string" ||
      !organization.name ||
      organization.name.length > 200
    )
      throw new ClaudeError("invalid_response", 502);
    if (
      normalizeName(organization.name) !==
        normalizeName(config.expectedOrgName) ||
      (config.expectedOrgId !== undefined &&
        organization.id !== config.expectedOrgId)
    )
      throw new ClaudeError("organization_mismatch", 403);
    const model = record(await request(`/v1/models/${CLAUDE_MODEL}`));
    if (model.id !== CLAUDE_MODEL) throw new ClaudeError("model_mismatch", 403);
    if (
      config.apiKey &&
      (organization.id.includes(config.apiKey) ||
        organization.name.includes(config.apiKey))
    )
      throw new ClaudeError("invalid_response", 502);
    return {
      source: "anthropic",
      model: CLAUDE_MODEL,
      verified: true,
      organization: { id: organization.id, name: organization.name.trim() },
    };
  }
  function preflight(): Promise<ClaudePreflight> {
    try {
      assertOpen();
      if (config.mode === "mock")
        return Promise.resolve({
          source: "mock",
          model: CLAUDE_MODEL,
          verified: false,
        });
      preflightPromise ??= verify().catch((error) => {
        preflightPromise = undefined;
        throw error;
      });
      return preflightPromise;
    } catch (error) {
      return Promise.reject(error);
    }
  }
  async function awaitPreflight(signal?: AbortSignal) {
    assertSignal(signal);
    if (!signal) return preflight();
    let onAbort: (() => void) | undefined;
    try {
      const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new ClaudeError("cancelled", 499));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      // The listener must exist before preflight can invoke an injected transport.
      return await Promise.race([cancelled, preflight()]);
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }
  function reserve(): ClaudeReservation {
    try {
      if (!budget) {
        budget = createClaudeBudget(config.ledgerPath);
        ownsBudget = true;
      }
      const reservation = budget.reserve();
      if (
        !reservation ||
        reservation.reservationUsd !== 1 ||
        !Number.isInteger(reservation.attempt) ||
        reservation.attempt < 1 ||
        reservation.attempt > 5 ||
        reservation.remainingUsd !== 5 - reservation.attempt ||
        typeof reservation.id !== "string" ||
        !reservation.id
      )
        throw new ClaudeError("budget_unavailable", 503);
      return reservation;
    } catch (error) {
      if (error instanceof ClaudeError) throw error;
      if (
        error instanceof ClaudeBudgetError &&
        error.code === "budget_exhausted"
      )
        throw new ClaudeError("budget_exhausted", 429);
      throw new ClaudeError("budget_unavailable", 503);
    }
  }
  return {
    preflight,
    async reply(message, context, signal) {
      assertOpen();
      assertSignal(signal);
      if (
        typeof message !== "string" ||
        !message.trim() ||
        (context !== undefined && typeof context !== "string")
      )
        throw new ClaudeError("invalid_message", 400);
      if (
        Buffer.byteLength(message, "utf8") +
          Buffer.byteLength(context ?? "", "utf8") >
        MAX_PROMPT_BYTES
      )
        throw new ClaudeError("prompt_too_large", 413);
      if (config.mode === "mock")
        return {
          source: "mock",
          model: CLAUDE_MODEL,
          text: "[MOCK] Offline placeholder reply. Claude has not been called and no account credits were used.",
        };
      await awaitPreflight(signal);
      assertOpen();
      assertSignal(signal);
      const reservation = reserve();
      // Reservations are never released, including failed/aborted/unknown outcomes.
      const response = record(
        await request(
          "/v1/messages",
          {
            model: CLAUDE_MODEL,
            max_tokens: MAX_OUTPUT_TOKENS,
            thinking: { type: "between_tools" },
            output_config: { effort: "low" },
            service_tier: "standard_only",
            ...(context ? { system: context } : {}),
            messages: [{ role: "user", content: message }],
          },
          signal,
        ),
      );
      assertOpen();
      assertSignal(signal);
      if (response.model !== CLAUDE_MODEL)
        throw new ClaudeError("model_mismatch", 403);
      if (
        response.type !== "message" ||
        response.role !== "assistant" ||
        !Array.isArray(response.content) ||
        !response.content.length
      )
        throw new ClaudeError("invalid_response", 502);
      const texts: string[] = [];
      for (const value of response.content) {
        const block = record(value);
        if (block.type === "text" && typeof block.text === "string")
          texts.push(block.text);
        else if (
          block.type !== "thinking" &&
          block.type !== "redacted_thinking"
        )
          throw new ClaudeError("invalid_response", 502);
      }
      const text = texts.join("\n").trim();
      const usage = record(response.usage);
      if (
        !text ||
        (config.apiKey && text.includes(config.apiKey)) ||
        !tokenCount(usage.input_tokens) ||
        !tokenCount(usage.output_tokens) ||
        usage.output_tokens > MAX_OUTPUT_TOKENS
      )
        throw new ClaudeError("invalid_response", 502);
      const estimatedCostUsd =
        (usage.input_tokens * INPUT_USD_PER_MTOK +
          usage.output_tokens * OUTPUT_USD_PER_MTOK) /
        1_000_000;
      if (
        !Number.isFinite(estimatedCostUsd) ||
        estimatedCostUsd > reservation.reservationUsd
      )
        throw new ClaudeError("invalid_response", 502);
      return {
        source: "anthropic",
        model: CLAUDE_MODEL,
        text,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          estimatedCostUsd,
        },
        reservationUsd: reservation.reservationUsd,
      };
    },
    close() {
      if (closed) return;
      closed = true;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      if (ownsBudget) {
        try {
          budget?.close();
        } catch {
          throw new ClaudeError("budget_unavailable", 503);
        }
      }
    },
  };
}
