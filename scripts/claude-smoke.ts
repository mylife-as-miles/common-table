import {
  readClaudeConfig,
  ClaudeConfigError,
  CLAUDE_TEST_BUDGET_USD,
  CLAUDE_ATTEMPT_RESERVATION_USD,
} from "../server/claude-config.ts";
import {
  createClaudeClient,
  ClaudeError,
  type ClaudeClient,
} from "../server/claude-client.ts";

const marker = "COMMON_TABLE_CLAUDE_OK";
let client: ClaudeClient | undefined;
let generationRequested = false;

try {
  const args = process.argv.slice(2);
  if (
    args.length > 1 ||
    args.some((arg) => arg !== "--live" && arg !== "--preflight")
  )
    throw new Error("invalid_arguments");
  const live = args.includes("--live");
  const preflightOnly = args.includes("--preflight");
  const config = readClaudeConfig();
  if (config.mode === "disabled") throw new ClaudeError("disabled", 503);
  if (live && config.mode !== "live") throw new Error("live_mode_not_enabled");
  if ((live || preflightOnly) && !config.apiKey)
    throw new Error("missing_api_key");

  // Presence of a key or a live env setting never makes a default invocation spend.
  client = createClaudeClient({
    ...config,
    mode: live || preflightOnly ? "live" : "mock",
  });
  if (preflightOnly) {
    const result = await client.preflight();
    console.log(
      JSON.stringify(
        {
          status: "preflight_verified",
          model: result.model,
          organizationVerified: result.verified,
          generationCallsMade: 0,
          note: "Read-only organization/model check. No generation or billing settings were changed.",
        },
        null,
        2,
      ),
    );
  } else if (!live) {
    const result = await client.reply("Offline integration smoke test.");
    if (result.source !== "mock") throw new Error("unexpected_source");
    console.log(
      JSON.stringify(
        {
          status: "mock_only",
          source: result.source,
          model: result.model,
          generationCallsMade: 0,
          approvedTestBudgetUsd: CLAUDE_TEST_BUDGET_USD,
          note: "Offline mock succeeded. Live API access and credits have not been tested.",
        },
        null,
        2,
      ),
    );
  } else {
    const checked = await client.preflight();
    if (!checked.verified) throw new Error("preflight_not_verified");
    generationRequested = true;
    const result = await client.reply(
      `This is a bounded API connectivity test. Reply with exactly ${marker} and nothing else.`,
      "Return the requested test marker as plain text. No tools, external data or user information are needed.",
    );
    if (result.source !== "anthropic" || result.text.trim() !== marker)
      throw new Error("unexpected_smoke_reply");
    console.log(
      JSON.stringify(
        {
          status: "live_smoke_passed",
          source: result.source,
          model: result.model,
          organizationVerified: checked.verified,
          generationCallsMade: 1,
          usage: result.usage,
          reservedForAttemptUsd: CLAUDE_ATTEMPT_RESERVATION_USD,
          approvedTestBudgetUsd: CLAUDE_TEST_BUDGET_USD,
          note: "Token cost is an estimate, not the provider balance. No retry, top-up or billing-setting change was made.",
        },
        null,
        2,
      ),
    );
  }
} catch (error) {
  const localCodes = new Set([
    "invalid_arguments",
    "live_mode_not_enabled",
    "missing_api_key",
    "unexpected_source",
    "preflight_not_verified",
    "unexpected_smoke_reply",
  ]);
  const code =
    error instanceof ClaudeError || error instanceof ClaudeConfigError
      ? error.code
      : error instanceof Error && localCodes.has(error.message)
        ? error.message
        : "smoke_test_failed";
  console.error(
    JSON.stringify({
      status: "blocked",
      code,
      generationRequested,
      automaticRetry: false,
    }),
  );
  process.exitCode = 1;
} finally {
  try {
    client?.close();
  } catch {
    console.error(
      JSON.stringify({ status: "blocked", code: "budget_close_failed" }),
    );
    process.exitCode = 1;
  }
}
