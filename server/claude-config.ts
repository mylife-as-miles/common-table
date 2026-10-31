import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CLAUDE_MODEL = "claude-sonnet-5-5" as const;
export const CLAUDE_API_VERSION = "2026-10-21" as const;
export const CLAUDE_TEST_BUDGET_USD = 5;
export const CLAUDE_ATTEMPT_RESERVATION_USD = 1;

export interface ClaudeConfig {
  mode: "mock" | "live" | "disabled";
  apiKey?: string;
  model: typeof CLAUDE_MODEL;
  expectedOrgName: string;
  expectedOrgId?: string;
  ledgerPath: string;
}

export class ClaudeConfigError extends Error {
  constructor(public readonly code: string) {
    super(`Claude server configuration is invalid (${code}).`);
    this.name = "ClaudeConfigError";
  }
}

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

/** Server-only configuration. Never include this module in a browser import. */
export function readClaudeConfig(
  env: Record<string, string | undefined> = process.env,
  root: string = projectRoot,
): ClaudeConfig {
  for (const [name, value] of Object.entries(env)) {
    if (
      value &&
      /^VITE_.*(?:ANTHROPIC|CLAUDE).*(?:KEY|TOKEN|SECRET)$/i.test(name)
    )
      throw new ClaudeConfigError("client_secret_prohibited");
  }
  if (env.ANTHROPIC_BASE_URL?.trim())
    throw new ClaudeConfigError("endpoint_override_prohibited");
  if (env.ANTHROPIC_LEDGER_PATH?.trim())
    throw new ClaudeConfigError("ledger_override_prohibited");
  if (env.ANTHROPIC_BUDGET_USD?.trim())
    throw new ClaudeConfigError("budget_override_prohibited");

  const mode = env.ANTHROPIC_MODE?.trim() || "mock";
  if (mode !== "mock" && mode !== "live" && mode !== "disabled")
    throw new ClaudeConfigError("invalid_mode");
  const model = env.ANTHROPIC_MODEL?.trim() || CLAUDE_MODEL;
  if (model !== CLAUDE_MODEL)
    throw new ClaudeConfigError("model_not_authorized");

  const rawKey = env.ANTHROPIC_API_KEY;
  const apiKey = rawKey?.trim() || undefined;
  if (
    apiKey &&
    (apiKey.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(apiKey))
  )
    throw new ClaudeConfigError("invalid_api_key");
  if (mode === "live" && !apiKey)
    throw new ClaudeConfigError("missing_api_key");

  const expectedOrgName = env.ANTHROPIC_EXPECTED_ORG_NAME?.trim() || "Startrz";
  if (
    expectedOrgName.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(expectedOrgName)
  )
    throw new ClaudeConfigError("invalid_organization");
  const expectedOrgId = env.ANTHROPIC_EXPECTED_ORG_ID?.trim() || undefined;
  if (expectedOrgId && !/^[a-zA-Z0-9_-]{8,128}$/.test(expectedOrgId))
    throw new ClaudeConfigError("invalid_organization_id");

  return Object.freeze({
    mode,
    apiKey,
    model: CLAUDE_MODEL,
    expectedOrgName,
    expectedOrgId,
    ledgerPath: resolve(root, ".local", "claude-budget.sqlite"),
  });
}
