import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const dummyKey = "dummy-cli-key-not-a-real-credential";

function invoke(mode: string, args: string[]) {
  const temporary = mkdtempSync(join(tmpdir(), "common-table-claude-cli-"));
  const marker = join(temporary, "network-attempted");
  const guard = join(temporary, "block-network.mjs");
  writeFileSync(
    guard,
    `import {writeFileSync} from 'node:fs';
globalThis.fetch=()=>{writeFileSync(${JSON.stringify(marker)},'blocked');throw new Error('TEST_NETWORK_DISABLED');};\n`,
  );
  try {
    // No --env-file flag: tests never load the user's private credentials.
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--import",
        guard,
        "scripts/claude-smoke.ts",
        ...args,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          ANTHROPIC_MODE: mode,
          ANTHROPIC_API_KEY: dummyKey,
          ANTHROPIC_MODEL: "claude-sonnet-5-5",
          ANTHROPIC_EXPECTED_ORG_NAME: "Startrz",
          ANTHROPIC_EXPECTED_ORG_ID: "",
          ANTHROPIC_BASE_URL: "",
          ANTHROPIC_LEDGER_PATH: "",
          ANTHROPIC_BUDGET_USD: "",
          VITE_ANTHROPIC_API_KEY: "",
        },
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    const output = result.stdout + result.stderr;
    assert.ok(
      !output.includes(dummyKey),
      "CLI never prints even a dummy credential",
    );
    assert.equal(
      existsSync(marker),
      false,
      "No provider transport is attempted",
    );
    return result;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

test("default smoke remains offline even with a key and live environment mode", () => {
  const result = invoke("live", []);
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "mock_only");
  assert.equal(report.source, "mock");
  assert.equal(report.generationCallsMade, 0);
});

test("live smoke requires an explicit live mode and disabled mode blocks preflight", () => {
  const blocked = invoke("mock", ["--live"]);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /live_mode_not_enabled/);
  const disabled = invoke("disabled", ["--preflight"]);
  assert.equal(disabled.status, 1);
  assert.match(disabled.stderr, /disabled/);
});

test("unknown CLI arguments fail without echoing them or contacting the provider", () => {
  const result = invoke("mock", [dummyKey]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid_arguments/);
});
