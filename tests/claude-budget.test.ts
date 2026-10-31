import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  createClaudeBudget,
  ClaudeBudgetError,
  CLAUDE_BUDGET_CAP_USD,
  CLAUDE_RESERVATION_USD,
  CLAUDE_MAX_ATTEMPTS,
} from "../server/claude-budget.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function ledgerFor(t: TestContext) {
  const directory = await mkdtemp(
    join(tmpdir(), "common-table-claude-budget-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "nested", "ledger.sqlite");
}

test("the persistent Claude ledger reserves one conservative dollar per attempt and has no automatic refill", async (t) => {
  const path = await ledgerFor(t);
  const ledger = createClaudeBudget(path);
  assert.equal(CLAUDE_BUDGET_CAP_USD, 5);
  assert.equal(CLAUDE_RESERVATION_USD, 1);
  assert.equal(CLAUDE_MAX_ATTEMPTS, 5);
  assert.deepEqual(ledger.snapshot(), {
    capUsd: 5,
    reservedUsd: 0,
    remainingUsd: 5,
    attempts: 0,
    maxAttempts: 5,
  });
  const ids = new Set<string>();
  for (let attempt = 1; attempt <= 5; attempt++) {
    const reservation = ledger.reserve();
    assert.equal(reservation.attempt, attempt);
    assert.equal(reservation.reservationUsd, 1);
    assert.equal(reservation.remainingUsd, 5 - attempt);
    assert.equal(typeof reservation.id, "string");
    assert.ok(reservation.id.length > 0);
    ids.add(reservation.id);
  }
  assert.equal(ids.size, 5);
  assert.throws(
    () => ledger.reserve(),
    (error: unknown) =>
      error instanceof ClaudeBudgetError && error.code === "budget_exhausted",
  );
  assert.deepEqual(ledger.snapshot(), {
    capUsd: 5,
    reservedUsd: 5,
    remainingUsd: 0,
    attempts: 5,
    maxAttempts: 5,
  });
  ledger.close();
  const restarted = createClaudeBudget(path);
  t.after(() => restarted.close());
  assert.equal(restarted.snapshot().remainingUsd, 0);
  assert.throws(
    () => restarted.reserve(),
    (error: unknown) =>
      error instanceof ClaudeBudgetError && error.code === "budget_exhausted",
  );
});

test("separate ledger instances share one cap without releasing earlier reservations", async (t) => {
  const path = await ledgerFor(t);
  const first = createClaudeBudget(path),
    second = createClaudeBudget(path);
  t.after(() => {
    first.close();
    second.close();
  });
  const results = await Promise.all(
    Array.from({ length: 12 }, async (_, index) => {
      try {
        return {
          ok: true,
          reservation: (index % 2 ? first : second).reserve(),
        };
      } catch (error) {
        assert.ok(error instanceof ClaudeBudgetError);
        assert.equal(error.code, "budget_exhausted");
        return { ok: false };
      }
    }),
  );
  assert.equal(results.filter((result) => result.ok).length, 5);
  assert.equal(first.snapshot().reservedUsd, 5);
  assert.deepEqual(second.snapshot(), first.snapshot());
});

test(
  "independent Node processes atomically share the five-attempt cap",
  { timeout: 20_000 },
  async (t) => {
    const path = await ledgerFor(t);
    const moduleUrl = pathToFileURL(
      join(repoRoot, "server/claude-budget.ts"),
    ).href;
    const program = `
    import {createClaudeBudget} from ${JSON.stringify(moduleUrl)};
    let ledger;
    try { ledger=createClaudeBudget(process.argv[1]); const r=ledger.reserve(); process.stdout.write(JSON.stringify({ok:true,attempt:r.attempt})); }
    catch(error) { process.stdout.write(JSON.stringify({ok:false,code:error.code})); }
    finally { ledger?.close(); }
  `;
    const run = () =>
      new Promise<{ ok: boolean; attempt?: number; code?: string }>(
        (resolveResult, reject) => {
          const child = spawn(
            process.execPath,
            ["--import", "tsx", "--input-type=module", "-e", program, path],
            { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
          );
          let output = "";
          child.stdout.on("data", (chunk) => {
            output += chunk;
          });
          child.stderr.resume();
          child.on("error", reject);
          child.on("close", (code) => {
            if (code !== 0)
              return reject(new Error("Budget test subprocess failed."));
            try {
              resolveResult(JSON.parse(output));
            } catch {
              reject(
                new Error("Budget test subprocess returned malformed output."),
              );
            }
          });
        },
      );
    const results = await Promise.all(Array.from({ length: 9 }, run));
    assert.deepEqual(
      results
        .filter((result) => result.ok)
        .map((result) => result.attempt)
        .sort(),
      [1, 2, 3, 4, 5],
    );
    assert.ok(
      results
        .filter((result) => !result.ok)
        .every((result) => result.code === "budget_exhausted"),
    );
    const restarted = createClaudeBudget(path);
    t.after(() => restarted.close());
    assert.equal(restarted.snapshot().reservedUsd, 5);
    assert.equal(restarted.snapshot().attempts, 5);
  },
);

test("invalid paths and unusable or corrupt SQL files fail closed with safe errors", async (t) => {
  for (const path of ["", "ledger.sqlite", "../ledger.sqlite"]) {
    assert.throws(
      () => createClaudeBudget(path),
      (error: unknown) =>
        error instanceof ClaudeBudgetError && error.code === "invalid_ledger",
    );
  }
  const path = await ledgerFor(t);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "NOT_SQLITE_private-canary-test-content");
  assert.throws(
    () => {
      const ledger = createClaudeBudget(path);
      try {
        ledger.reserve();
      } finally {
        ledger.close();
      }
    },
    (error: unknown) =>
      error instanceof ClaudeBudgetError &&
      error.code === "budget_unavailable" &&
      !String(error).includes("private-canary"),
  );
  const directory = `${path}-directory`;
  await mkdir(directory);
  assert.throws(
    () => {
      const ledger = createClaudeBudget(directory);
      try {
        ledger.reserve();
      } finally {
        ledger.close();
      }
    },
    (error: unknown) =>
      error instanceof ClaudeBudgetError && error.code === "budget_unavailable",
  );
});

test("an exhausted ledger with lost SQL schema fails closed instead of refilling on restart", async (t) => {
  const path = await ledgerFor(t);
  const ledger = createClaudeBudget(path);
  for (let attempt = 0; attempt < 5; attempt++) ledger.reserve();
  ledger.close();
  const damaged = new DatabaseSync(path);
  damaged.exec(
    "DROP TABLE claude_budget_attempts; DROP TABLE claude_budget_state;",
  );
  damaged.close();
  assert.throws(
    () => {
      const reopened = createClaudeBudget(path);
      try {
        reopened.reserve();
      } finally {
        reopened.close();
      }
    },
    (error: unknown) =>
      error instanceof ClaudeBudgetError && error.code === "budget_unavailable",
  );
});

test("deleting an exhausted main database does not automatically create a fresh allowance", async (t) => {
  const path = await ledgerFor(t);
  const ledger = createClaudeBudget(path);
  for (let attempt = 0; attempt < 5; attempt++) ledger.reserve();
  ledger.close();
  await unlink(path);
  assert.throws(
    () => {
      const reopened = createClaudeBudget(path);
      try {
        reopened.reserve();
      } finally {
        reopened.close();
      }
    },
    (error: unknown) =>
      error instanceof ClaudeBudgetError && error.code === "budget_unavailable",
  );
});
