import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import {
  readClaudeConfig,
  type ClaudeConfig,
} from "../server/claude-config.ts";
import {
  createClaudeBudget,
  ClaudeBudgetError,
  type ClaudeBudget,
} from "../server/claude-budget.ts";

// Even a client accidentally ignoring its injected transport cannot reach a provider.
const realFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("Network is forbidden in mocked Claude tests.");
};
after(() => {
  globalThis.fetch = realFetch;
});
const {
  createClaudeClient,
  ClaudeError,
  CLAUDE_MODEL,
  ANTHROPIC_API_ORIGIN,
  ANTHROPIC_VERSION,
  MAX_PROMPT_BYTES,
  MAX_OUTPUT_TOKENS,
  MAX_RESPONSE_BYTES,
} = await import("../server/claude-client.ts");

const KEY = "dummy-claude-test-key-NEVER-LIVE";
const PRIVATE = "PRIVATE_UPSTREAM_CANARY_NEVER_DISPLAY";
const ORG = "org_startrz_test";
type Call = { url: URL; init: RequestInit; body?: Record<string, unknown> };
type Override = (call: Call) => Response | Promise<Response> | undefined;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const success = (overrides: Record<string, unknown> = {}) => ({
  id: "msg_test_only",
  type: "message",
  role: "assistant",
  model: CLAUDE_MODEL,
  content: [{ type: "text", text: "A local suggestion for your table." }],
  stop_reason: "end_turn",
  usage: { input_tokens: 120, output_tokens: 24 },
  ...overrides,
});
const safeError = (code: string, status: number) => (error: unknown) => {
  assert.ok(error instanceof ClaudeError);
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  for (const value of [
    String(error),
    JSON.stringify(error),
    inspect(error, { depth: 5 }),
  ]) {
    assert.ok(!value.includes(KEY));
    assert.ok(!value.includes(PRIVATE));
  }
  return true;
};
async function fixture(
  t: TestContext,
  options: {
    mode?: "mock" | "live" | "disabled";
    override?: Override;
    timeoutMs?: number;
    budget?: ClaudeBudget;
    config?: Partial<ClaudeConfig>;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "common-table-claude-client-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = {
    ...readClaudeConfig(
      {
        ANTHROPIC_MODE: options.mode ?? "live",
        ANTHROPIC_API_KEY: KEY,
        ANTHROPIC_EXPECTED_ORG_ID: ORG,
      },
      root,
    ),
    ...options.config,
  };
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const call: Call = {
      url,
      init,
      ...(typeof init.body === "string" ? { body: JSON.parse(init.body) } : {}),
    };
    calls.push(call);
    const overridden = options.override?.(call);
    if (overridden !== undefined) return overridden;
    if (url.pathname === "/v1/organizations/me")
      return json({ type: "organization", id: ORG, name: "Startrz" });
    if (url.pathname === `/v1/models/${CLAUDE_MODEL}`)
      return json({
        id: CLAUDE_MODEL,
        type: "model",
        display_name: "Claude Sonnet 5.5",
      });
    if (url.pathname === "/v1/messages") return json(success());
    throw new Error("Unexpected mocked upstream endpoint.");
  };
  const client = createClaudeClient(config, {
    fetch: fetcher,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.budget ? { budget: options.budget } : {}),
  });
  t.after(() => client.close());
  return { client, config, calls, fetcher };
}
const posts = (calls: Call[]) =>
  calls.filter((call) => call.url.pathname === "/v1/messages");
async function noLedger(path: string) {
  await assert.rejects(access(path), { code: "ENOENT" });
}
function reservations(path: string) {
  const budget = createClaudeBudget(path);
  try {
    return budget.snapshot().attempts;
  } finally {
    budget.close();
  }
}

test("mock and disabled modes cannot call a provider or create a live-budget ledger", async (t) => {
  const mock = await fixture(t, { mode: "mock" });
  assert.deepEqual(await mock.client.preflight(), {
    source: "mock",
    model: CLAUDE_MODEL,
    verified: false,
  });
  const result = await mock.client.reply(
    "Find dinner",
    "Solo, under35 dollars.",
  );
  assert.equal(result.source, "mock");
  assert.equal(result.model, CLAUDE_MODEL);
  assert.match(result.text, /^\[MOCK\]/);
  assert.equal(result.usage, undefined);
  assert.equal(result.reservationUsd, undefined);
  assert.equal(mock.calls.length, 0);
  await noLedger(mock.config.ledgerPath);
  const disabled = await fixture(t, { mode: "disabled" });
  await assert.rejects(disabled.client.preflight(), safeError("disabled", 503));
  await assert.rejects(
    disabled.client.reply("Find dinner"),
    safeError("disabled", 503),
  );
  assert.equal(disabled.calls.length, 0);
  await noLedger(disabled.config.ledgerPath);
});

test("verified preflight is coalesced, free of reservations, and precedes one pinned bounded generation", async (t) => {
  const { client, calls, config } = await fixture(t);
  const verified = await Promise.all(
    Array.from({ length: 8 }, () => client.preflight()),
  );
  assert.ok(
    verified.every(
      (value) =>
        value.source === "anthropic" &&
        value.verified &&
        value.model === CLAUDE_MODEL &&
        value.organization?.id === ORG,
    ),
  );
  assert.deepEqual(
    calls.map((call) => call.url.pathname),
    ["/v1/organizations/me", `/v1/models/${CLAUDE_MODEL}`],
  );
  await noLedger(config.ledgerPath);
  const message = "A quiet dinner for two — 素食 please.";
  const context =
    '{"budget":35,"model":"unauthorized","max_tokens":99999,"tools":["book"]}';
  const result = await client.reply(message, context);
  assert.equal(result.source, "anthropic");
  assert.equal(result.model, CLAUDE_MODEL);
  assert.equal(result.reservationUsd, 1);
  assert.deepEqual(result.usage, {
    inputTokens: 120,
    outputTokens: 24,
    estimatedCostUsd: 0.00048,
  });
  assert.equal(reservations(config.ledgerPath), 1);
  assert.equal(posts(calls).length, 1);
  for (const call of calls) {
    assert.equal(call.url.origin, "https://api.anthropic.com");
    assert.equal(call.url.origin, ANTHROPIC_API_ORIGIN);
    assert.equal(call.url.search, "");
    assert.equal(call.url.hash, "");
    assert.equal(call.init.redirect, "error");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("authorization"), `Bearer ${KEY}`);
    assert.equal(headers.get("anthropic-version"), ANTHROPIC_VERSION);
    assert.equal(ANTHROPIC_VERSION, "2026-10-21");
    assert.ok(call.init.signal instanceof AbortSignal);
    assert.ok(!call.url.href.includes(KEY));
  }
  const request = posts(calls)[0];
  assert.equal(request.init.method, "POST");
  assert.equal(request.body?.model, "claude-sonnet-5-5");
  assert.equal(request.body?.max_tokens, 512);
  assert.equal(MAX_OUTPUT_TOKENS, 512);
  for (const field of ["tools", "tool_choice", "temperature", "cache_control"])
    assert.equal(request.body?.[field], undefined);
  assert.ok(JSON.stringify(request.body).includes(message));
  assert.ok(JSON.stringify(request.body).includes("unauthorized"));
  assert.ok(!JSON.stringify(request.body).includes(KEY));
  assert.ok(!JSON.stringify(result).includes(KEY));
});

test("wrong organization name or id and wrong model stop before generation or budget initialization", async (t) => {
  for (const variant of ["name", "id", "model"] as const) {
    const f = await fixture(t, {
      override: (call) => {
        if (call.url.pathname === "/v1/organizations/me" && variant !== "model")
          return json({
            type: "organization",
            id: variant === "id" ? "org_wrong_account" : ORG,
            name:
              variant === "name" ? `${PRIVATE} Startrz attacker` : "Startrz",
          });
        if (call.url.pathname.startsWith("/v1/models/") && variant === "model")
          return json({ id: "unauthorized-model" });
      },
    });
    await assert.rejects(
      f.client.reply("Find dinner"),
      safeError(
        variant === "model" ? "model_mismatch" : "organization_mismatch",
        403,
      ),
    );
    assert.equal(posts(f.calls).length, 0);
    await noLedger(f.config.ledgerPath);
  }
  const normalized = await fixture(t, {
    override: (call) =>
      call.url.pathname === "/v1/organizations/me"
        ? json({ type: "organization", id: ORG, name: "  sTaRtRz  " })
        : undefined,
  });
  assert.equal((await normalized.client.preflight()).verified, true);
  await noLedger(normalized.config.ledgerPath);
});

test("unconfigured or invalid factory config fails before any fetch or SQL side effect", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "common-table-claude-invalid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const base = readClaudeConfig({}, root);
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    throw new Error(PRIVATE);
  };
  assert.throws(
    () => createClaudeClient({ ...base, mode: "live" }, { fetch: fetcher }),
    safeError("not_configured", 503),
  );
  for (const change of [
    { model: "other-model" },
    { expectedOrgName: "Other organization" },
    { ledgerPath: "relative.sqlite" },
    { apiKey: `${KEY}\r\nInjected: yes` },
  ]) {
    assert.throws(
      () =>
        createClaudeClient({ ...base, ...change } as ClaudeConfig, {
          fetch: fetcher,
        }),
      safeError("invalid_config", 400),
    );
  }
  assert.equal(calls, 0);
  await noLedger(base.ledgerPath);
});

test("plain text validation and the combined16KiB UTF8 limit reject before preflight or reservation", async (t) => {
  const f = await fixture(t);
  for (const [message, context] of [
    ["", undefined],
    ["  ", undefined],
    [null, undefined],
    [123, undefined],
    ["hello", {}],
  ]) {
    await assert.rejects(
      f.client.reply(message as string, context as string),
      safeError("invalid_message", 400),
    );
  }
  assert.equal(MAX_PROMPT_BYTES, 16384);
  for (const [message, context] of [
    ["a".repeat(16385), ""],
    ["a".repeat(16380), "12345"],
    ["🫒".repeat(4097), ""],
    ["é".repeat(8192), "x"],
  ]) {
    await assert.rejects(
      f.client.reply(message, context),
      safeError("prompt_too_large", 413),
    );
  }
  assert.equal(f.calls.length, 0);
  await noLedger(f.config.ledgerPath);
  const mock = await fixture(t, { mode: "mock" });
  assert.equal((await mock.client.reply("🫒".repeat(4096))).source, "mock");
  assert.equal(mock.calls.length, 0);
  await noLedger(mock.config.ledgerPath);
});

test("all paid failures retain their reservation and401,429,5xx or thrown upstream errors never retry or leak details", async (t) => {
  for (const status of [401, 429, 500, 503, "throw"] as const) {
    const f = await fixture(t, {
      override: (call) => {
        if (call.url.pathname !== "/v1/messages") return;
        if (status === "throw") throw new Error(`${PRIVATE} ${KEY}`);
        return json({ error: { message: `${PRIVATE} ${KEY}` } }, status);
      },
    });
    await assert.rejects(
      f.client.reply("Find dinner"),
      safeError("upstream_unavailable", 502),
    );
    assert.equal(posts(f.calls).length, 1);
    assert.equal(f.calls.length, 3);
    f.client.close();
    assert.equal(reservations(f.config.ledgerPath), 1);
  }
});

test("preflight upstream failures are sanitized and never reach messages or initialize budget", async (t) => {
  for (const status of [401, 429, 503]) {
    const f = await fixture(t, {
      override: (call) =>
        call.url.pathname === "/v1/organizations/me"
          ? json({ error: `${PRIVATE} ${KEY}` }, status)
          : undefined,
    });
    await assert.rejects(
      f.client.reply("Find dinner"),
      safeError("upstream_unavailable", 502),
    );
    assert.equal(f.calls.length, 1);
    assert.equal(posts(f.calls).length, 0);
    await noLedger(f.config.ledgerPath);
  }
});

test("redirected successful responses and malformed JSON are rejected without forwarding provider diagnostics", async (t) => {
  for (const kind of ["redirect", "json"] as const) {
    const f = await fixture(t, {
      override: (call) => {
        if (call.url.pathname !== "/v1/messages") return;
        if (kind === "json") return new Response(`not-json ${PRIVATE} ${KEY}`);
        const response = json(success());
        Object.defineProperty(response, "redirected", { value: true });
        return response;
      },
    });
    await assert.rejects(
      f.client.reply("Find dinner"),
      safeError(
        kind === "redirect" ? "upstream_unavailable" : "invalid_response",
        502,
      ),
    );
    assert.equal(posts(f.calls).length, 1);
    assert.equal(reservations(f.config.ledgerPath), 1);
  }
});

test("invalid usage, empty text, tools and a wrong returned model never become successful replies or refund attempts", async (t) => {
  const invalidBodies = [
    success({ usage: undefined }),
    success({ usage: { input_tokens: -1, output_tokens: 1 } }),
    success({ usage: { input_tokens: 1.5, output_tokens: 1 } }),
    success({ usage: { input_tokens: "1", output_tokens: 1 } }),
    success({ usage: { input_tokens: 1, output_tokens: 513 } }),
    success({ usage: { input_tokens: 1e9, output_tokens: 1 } }),
    success({ content: [] }),
    success({ content: [{ type: "text", text: "  " }] }),
    success({ content: [{ type: "text", text: {} }] }),
    success({
      content: [{ type: "tool_use", id: "tool_test", name: "book", input: {} }],
    }),
    success({
      content: [
        { type: "text", text: "valid" },
        { type: "tool_use", id: "tool_test", name: "invite", input: {} },
      ],
    }),
    success({
      content: [{ type: "text", text: `An unsafe provider echo: ${KEY}` }],
    }),
  ];
  for (const body of invalidBodies) {
    const f = await fixture(t, {
      override: (call) =>
        call.url.pathname === "/v1/messages" ? json(body) : undefined,
    });
    await assert.rejects(
      f.client.reply("Find dinner"),
      safeError("invalid_response", 502),
    );
    assert.equal(posts(f.calls).length, 1);
    assert.equal(reservations(f.config.ledgerPath), 1);
  }
  const wrongModel = await fixture(t, {
    override: (call) =>
      call.url.pathname === "/v1/messages"
        ? json(success({ model: "different-model" }))
        : undefined,
  });
  await assert.rejects(
    wrongModel.client.reply("Find dinner"),
    safeError("model_mismatch", 403),
  );
  assert.equal(reservations(wrongModel.config.ledgerPath), 1);
});

test("text blocks are joined while private thinking blocks are excluded from returned text", async (t) => {
  const f = await fixture(t, {
    override: (call) =>
      call.url.pathname === "/v1/messages"
        ? json(
            success({
              content: [
                { type: "thinking", thinking: PRIVATE },
                { type: "text", text: "First." },
                { type: "redacted_thinking", data: PRIVATE },
                { type: "text", text: "Second." },
              ],
            }),
          )
        : undefined,
  });
  const result = await f.client.reply("Find dinner");
  assert.equal(result.text, "First.\nSecond.");
  assert.ok(!JSON.stringify(result).includes(PRIVATE));
});

test(
  "timeouts cover a transport ignoring abort and a stalled response body without retrying or refunding",
  { timeout: 3000 },
  async (t) => {
    for (const kind of ["fetch", "body", "late-fetch"] as const) {
      let aborted = false,
        cancelled = false;
      let finishLate: ((response: Response) => void) | undefined;
      const f = await fixture(t, {
        timeoutMs: 20,
        override: (call) => {
          if (call.url.pathname !== "/v1/messages") return;
          call.init.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
            },
            { once: true },
          );
          if (kind === "fetch") return new Promise<Response>(() => {});
          if (kind === "late-fetch")
            return new Promise<Response>((resolve) => {
              finishLate = resolve;
            });
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"incomplete":'));
              },
              cancel() {
                cancelled = true;
              },
            }),
          );
        },
      });
      await assert.rejects(
        f.client.reply("Find dinner"),
        safeError("timeout", 504),
      );
      assert.equal(aborted, true);
      assert.equal(posts(f.calls).length, 1);
      assert.equal(reservations(f.config.ledgerPath), 1);
      if (kind === "body") assert.equal(cancelled, true);
      if (kind === "late-fetch") {
        const response = new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true;
            },
          }),
        );
        let readers = 0;
        const original = response.body!.getReader.bind(response.body);
        Object.defineProperty(response.body, "getReader", {
          value: () => {
            readers++;
            return original();
          },
        });
        finishLate!(response);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(cancelled, true);
        assert.equal(readers, 0);
      }
    }
  },
);

test("oversized declared and streamed bodies are cancelled at the64KiB boundary", async (t) => {
  assert.equal(MAX_RESPONSE_BYTES, 65536);
  for (const declared of [true, false]) {
    let pulls = 0,
      cancelled = false;
    const f = await fixture(t, {
      override: (call) => {
        if (call.url.pathname !== "/v1/messages") return;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulls++;
              controller.enqueue(new Uint8Array(16384).fill(65));
            },
            cancel() {
              cancelled = true;
            },
          }),
          {
            headers: declared
              ? { "content-length": String(MAX_RESPONSE_BYTES + 1) }
              : {},
          },
        );
      },
    });
    await assert.rejects(
      f.client.reply("Find dinner"),
      safeError("response_too_large", 502),
    );
    assert.equal(cancelled, true);
    assert.ok(pulls <= 6);
    assert.equal(posts(f.calls).length, 1);
    assert.equal(reservations(f.config.ledgerPath), 1);
  }
});

test("pre-aborted input costs nothing while cancellation after POST keeps exactly one reservation", async (t) => {
  const before = await fixture(t);
  const early = new AbortController();
  early.abort();
  await assert.rejects(
    before.client.reply("Find dinner", undefined, early.signal),
    safeError("cancelled", 499),
  );
  assert.equal(before.calls.length, 0);
  await noLedger(before.config.ledgerPath);
  const controller = new AbortController();
  const afterPost = await fixture(t, {
    override: (call) => {
      if (call.url.pathname !== "/v1/messages") return;
      queueMicrotask(() => controller.abort());
      return new Promise<Response>(() => {});
    },
  });
  await assert.rejects(
    afterPost.client.reply("Find dinner", undefined, controller.signal),
    safeError("cancelled", 499),
  );
  assert.equal(posts(afterPost.calls).length, 1);
  assert.equal(reservations(afterPost.config.ledgerPath), 1);
});

test(
  "cancellation during preflight setup is not lost before the abort listener is attached",
  { timeout: 1000 },
  async (t) => {
    const controller = new AbortController();
    const f = await fixture(t, {
      timeoutMs: 20,
      override: (call) => {
        if (call.url.pathname !== "/v1/organizations/me") return;
        controller.abort();
        return new Promise<Response>(() => {});
      },
    });
    await assert.rejects(
      f.client.reply("Find dinner", undefined, controller.signal),
      safeError("cancelled", 499),
    );
    assert.equal(f.calls.length, 1);
    assert.equal(posts(f.calls).length, 0);
    await noLedger(f.config.ledgerPath);
  },
);

test("concurrent live callers and a restarted client cannot exceed five paid attempts", async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled(
    Array.from({ length: 16 }, () => f.client.reply("Find dinner")),
  );
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    5,
  );
  for (const result of results)
    if (result.status === "rejected")
      safeError("budget_exhausted", 429)(result.reason);
  assert.equal(posts(f.calls).length, 5);
  assert.equal(reservations(f.config.ledgerPath), 5);
  assert.equal(
    f.calls.filter((call) => call.url.pathname === "/v1/organizations/me")
      .length,
    1,
  );
  f.client.close();
  const restarted = createClaudeClient(f.config, { fetch: f.fetcher });
  t.after(() => restarted.close());
  await assert.rejects(
    restarted.reply("Try once more"),
    safeError("budget_exhausted", 429),
  );
  assert.equal(posts(f.calls).length, 5);
});

test("SQL reservation failure prevents generation and an injected budget remains caller-owned", async (t) => {
  let closes = 0;
  const budget: ClaudeBudget = {
    reserve() {
      throw new ClaudeBudgetError("budget_unavailable");
    },
    snapshot() {
      return {
        capUsd: 5,
        reservedUsd: 0,
        remainingUsd: 5,
        attempts: 0,
        maxAttempts: 5,
      };
    },
    close() {
      closes++;
    },
  };
  const f = await fixture(t, { budget });
  await assert.rejects(
    f.client.reply("Find dinner"),
    safeError("budget_unavailable", 503),
  );
  assert.equal(posts(f.calls).length, 0);
  f.client.close();
  f.client.close();
  assert.equal(closes, 0);
  await assert.rejects(f.client.reply("Find dinner"), safeError("closed", 503));
});

test("client close aborts in-flight work, retains the reservation and rejects later calls", async (t) => {
  let client: ReturnType<typeof createClaudeClient> | undefined;
  const f = await fixture(t, {
    override: (call) => {
      if (call.url.pathname !== "/v1/messages") return;
      queueMicrotask(() => client?.close());
      return new Promise<Response>(() => {});
    },
  });
  client = f.client;
  await assert.rejects(client.reply("Find dinner"), safeError("closed", 503));
  assert.equal(posts(f.calls).length, 1);
  assert.equal(reservations(f.config.ledgerPath), 1);
  await assert.rejects(client.preflight(), safeError("closed", 503));
});
