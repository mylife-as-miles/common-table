import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readClaudeConfig,
  ClaudeConfigError,
} from "../server/claude-config.ts";

async function rootFor(t: TestContext) {
  const root = await mkdtemp(resolve(tmpdir(), "common-table-claude-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const canary = "test-only-secret-canary-never-live";
const invalid = (
  env: Record<string, string | undefined>,
  code: string,
  root: string,
) => {
  assert.throws(
    () => readClaudeConfig(env, root),
    (error: unknown) => {
      assert.ok(error instanceof ClaudeConfigError);
      assert.equal(error.code, code);
      assert.ok(!String(error).includes(canary));
      assert.ok(!JSON.stringify(error).includes(canary));
      return true;
    },
  );
};

test("Claude configuration defaults to mock with a fixed model, organization and local ledger without creating one", async (t) => {
  const root = await rootFor(t);
  const config = readClaudeConfig({}, root);
  assert.deepEqual(config, {
    mode: "mock",
    apiKey: undefined,
    model: "claude-sonnet-5-5",
    expectedOrgName: "Startrz",
    expectedOrgId: undefined,
    ledgerPath: resolve(root, ".local/claude-budget.sqlite"),
  });
  assert.equal(Object.isFrozen(config), true);
  await assert.rejects(access(resolve(root, ".local")), { code: "ENOENT" });
  assert.equal(
    readClaudeConfig({}).ledgerPath,
    fileURLToPath(new URL("../.local/claude-budget.sqlite", import.meta.url)),
  );
});

test("live config requires an explicit server key while mock and disabled require no key", async (t) => {
  const root = await rootFor(t);
  assert.equal(
    readClaudeConfig({ ANTHROPIC_MODE: "disabled" }, root).mode,
    "disabled",
  );
  assert.equal(
    readClaudeConfig({ ANTHROPIC_API_KEY: canary }, root).mode,
    "mock",
  );
  invalid({ ANTHROPIC_MODE: "live" }, "missing_api_key", root);
  const env = {
    ANTHROPIC_MODE: "live",
    ANTHROPIC_API_KEY: canary,
    ANTHROPIC_EXPECTED_ORG_NAME: " Startrz ",
    ANTHROPIC_EXPECTED_ORG_ID: "org_startrz_test",
  };
  const config = readClaudeConfig(env, root);
  assert.equal(config.apiKey, canary);
  assert.equal(config.expectedOrgName, "Startrz");
  assert.equal(config.expectedOrgId, "org_startrz_test");
  env.ANTHROPIC_API_KEY = "changed-test-key";
  assert.equal(config.apiKey, canary);
});

test("only the authorized model is accepted and configuration errors never echo supplied values", async (t) => {
  const root = await rootFor(t);
  for (const model of [
    "claude-opus-4",
    "claude-sonnet-4-5",
    `claude-sonnet-5-5-${canary}`,
  ])
    invalid({ ANTHROPIC_MODEL: model }, "model_not_authorized", root);
  invalid({ ANTHROPIC_MODE: canary }, "invalid_mode", root);
  for (const apiKey of [
    `${canary}\r\nX-Injected: yes`,
    `before\u0000${canary}`,
    `${canary}\tkey`,
    "x".repeat(4097),
  ])
    invalid({ ANTHROPIC_API_KEY: apiKey }, "invalid_api_key", root);
  invalid(
    { ANTHROPIC_EXPECTED_ORG_NAME: `${canary}\nother` },
    "invalid_organization",
    root,
  );
  invalid(
    { ANTHROPIC_EXPECTED_ORG_ID: `bad id ${canary}` },
    "invalid_organization_id",
    root,
  );
});

test("browser-secret names and endpoint, ledger or budget overrides are rejected even in mock mode", async (t) => {
  const root = await rootFor(t);
  for (const name of [
    "VITE_ANTHROPIC_API_KEY",
    "VITE_CLAUDE_API_KEY",
    "VITE_ANTHROPIC_TOKEN",
    "VITE_CLAUDE_SECRET",
  ])
    invalid({ [name]: canary }, "client_secret_prohibited", root);
  invalid(
    { ANTHROPIC_BASE_URL: `https://${canary}.invalid` },
    "endpoint_override_prohibited",
    root,
  );
  invalid(
    { ANTHROPIC_LEDGER_PATH: `/tmp/${canary}.sqlite` },
    "ledger_override_prohibited",
    root,
  );
  invalid({ ANTHROPIC_BUDGET_USD: "500" }, "budget_override_prohibited", root);
});
