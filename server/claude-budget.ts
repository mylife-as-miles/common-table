import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  lstatSync,
  chmodSync,
  rmdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";

export const CLAUDE_BUDGET_CAP_USD = 5;
export const CLAUDE_RESERVATION_USD = 1;
export const CLAUDE_MAX_ATTEMPTS = 5;

export type ClaudeBudgetErrorCode =
  "invalid_ledger" | "budget_unavailable" | "budget_exhausted";
export class ClaudeBudgetError extends Error {
  constructor(public readonly code: ClaudeBudgetErrorCode) {
    super(
      code === "budget_exhausted"
        ? "The local Claude test allowance has been exhausted."
        : "The local Claude budget is unavailable.",
    );
    this.name = "ClaudeBudgetError";
  }
}
export interface ClaudeReservation {
  id: string;
  reservationUsd: number;
  attempt: number;
  remainingUsd: number;
}
export interface ClaudeBudgetSnapshot {
  capUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  attempts: number;
  maxAttempts: number;
}
export interface ClaudeBudget {
  reserve(): ClaudeReservation;
  snapshot(): ClaudeBudgetSnapshot;
  close(): void;
}

/** Append-only, non-refundable reservations. No provider balance or other users' spend is inferred. */
export function createClaudeBudget(ledgerPath: string): ClaudeBudget {
  if (
    typeof ledgerPath !== "string" ||
    !isAbsolute(ledgerPath) ||
    ledgerPath.includes("\0") ||
    ledgerPath.startsWith("file:")
  ) {
    throw new ClaudeBudgetError("invalid_ledger");
  }
  let database: DatabaseSync | undefined;
  let closed = false;
  const initializationLock = `${ledgerPath}.init-lock`;
  const markerPath = `${ledgerPath}.initialized`;
  const markerContents = "common-table-claude-budget-v1\n";
  let ownsInitializationLock = false;
  try {
    mkdirSync(dirname(ledgerPath), { recursive: true, mode: 0o700 });
    const deadline = performance.now() + 5000;
    while (!ownsInitializationLock) {
      try {
        mkdirSync(initializationLock, { mode: 0o700 });
        ownsInitializationLock = true;
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "EEXIST" ||
          performance.now() >= deadline
        )
          throw error;
        // Startup only. A crashed initializer stays fail-closed; never clear its lock automatically.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    let existed = false;
    try {
      const info = lstatSync(ledgerPath);
      if (info.isSymbolicLink() || !info.isFile())
        throw new ClaudeBudgetError("budget_unavailable");
      existed = true;
    } catch (error) {
      if (
        error instanceof ClaudeBudgetError ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      )
        throw error;
    }
    let marked = false;
    try {
      const marker = lstatSync(markerPath);
      if (
        !marker.isFile() ||
        marker.isSymbolicLink() ||
        marker.size !== Buffer.byteLength(markerContents) ||
        readFileSync(markerPath, "utf8") !== markerContents
      )
        throw new ClaudeBudgetError("budget_unavailable");
      marked = true;
    } catch (error) {
      if (
        error instanceof ClaudeBudgetError ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      )
        throw error;
    }
    // A deleted database, lost marker, or interrupted first initialization cannot refill the cap.
    if (existed !== marked) throw new ClaudeBudgetError("budget_unavailable");
    if (!existed)
      writeFileSync(markerPath, markerContents, { flag: "wx", mode: 0o600 });
    database = new DatabaseSync(ledgerPath);
    database.exec(
      "PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;",
    );
    if (!existed)
      database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE claude_budget_state (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        version INTEGER NOT NULL CHECK(version = 1),
        cap_cents INTEGER NOT NULL CHECK(cap_cents = 500),
        reserved_cents INTEGER NOT NULL CHECK(reserved_cents BETWEEN 0 AND 500),
        attempts INTEGER NOT NULL CHECK(attempts BETWEEN 0 AND 5)
      );
      CREATE TABLE claude_budget_attempts (
        id TEXT PRIMARY KEY,
        attempt INTEGER NOT NULL UNIQUE CHECK(attempt BETWEEN 1 AND 5),
        reservation_cents INTEGER NOT NULL CHECK(reservation_cents = 100),
        created_at TEXT NOT NULL
      );
      INSERT INTO claude_budget_state(id,version,cap_cents,reserved_cents,attempts) VALUES(1,1,500,0,0);
      COMMIT;`);
    if (!existed) chmodSync(ledgerPath, 0o600);
  } catch {
    try {
      database?.exec("ROLLBACK");
    } catch {
      /* no transaction */
    }
    try {
      database?.close();
    } catch {
      /* fail closed */
    }
    throw new ClaudeBudgetError("budget_unavailable");
  } finally {
    if (ownsInitializationLock) {
      try {
        rmdirSync(initializationLock);
      } catch {
        /* the next open must fail closed */
      }
    }
  }
  const db = database;
  function state(): { attempts: number; reserved: number } {
    if (closed) throw new ClaudeBudgetError("budget_unavailable");
    const row = db
      .prepare(
        "SELECT version,cap_cents,reserved_cents,attempts FROM claude_budget_state WHERE id=1",
      )
      .get();
    const history = db
      .prepare(
        "SELECT COUNT(*) AS attempts, COALESCE(SUM(reservation_cents),0) AS reserved FROM claude_budget_attempts",
      )
      .get();
    if (
      !row ||
      !history ||
      row.version !== 1 ||
      row.cap_cents !== 500 ||
      typeof row.attempts !== "number" ||
      !Number.isInteger(row.attempts) ||
      row.attempts < 0 ||
      row.attempts > 5 ||
      row.reserved_cents !== row.attempts * 100 ||
      history.attempts !== row.attempts ||
      history.reserved !== row.reserved_cents
    ) {
      throw new ClaudeBudgetError("budget_unavailable");
    }
    return { attempts: row.attempts, reserved: row.attempts * 100 };
  }
  function transaction<T>(write: boolean, action: () => T): T {
    if (closed) throw new ClaudeBudgetError("budget_unavailable");
    try {
      db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
      const value = action();
      db.exec("COMMIT");
      return value;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* no refundable reservation */
      }
      if (error instanceof ClaudeBudgetError) throw error;
      throw new ClaudeBudgetError("budget_unavailable");
    }
  }
  // Validate an existing ledger immediately; never replace corrupt state with zeros.
  try {
    transaction(false, state);
  } catch (error) {
    try {
      db.close();
    } catch {
      /* retain the sanitized budget error */
    }
    closed = true;
    throw error;
  }
  return {
    reserve() {
      return transaction(true, () => {
        const current = state();
        if (current.attempts >= CLAUDE_MAX_ATTEMPTS || current.reserved >= 500)
          throw new ClaudeBudgetError("budget_exhausted");
        const id = randomUUID();
        const attempt = current.attempts + 1;
        db.prepare(
          "INSERT INTO claude_budget_attempts(id,attempt,reservation_cents,created_at) VALUES(?,?,100,?)",
        ).run(id, attempt, new Date().toISOString());
        const updated = db
          .prepare(
            "UPDATE claude_budget_state SET attempts=?,reserved_cents=? WHERE id=1 AND attempts=? AND reserved_cents=? AND cap_cents=500 AND version=1",
          )
          .run(attempt, attempt * 100, current.attempts, current.reserved);
        if (updated.changes !== 1)
          throw new ClaudeBudgetError("budget_unavailable");
        return {
          id,
          attempt,
          reservationUsd: CLAUDE_RESERVATION_USD,
          remainingUsd: CLAUDE_BUDGET_CAP_USD - attempt,
        };
      });
    },
    snapshot() {
      return transaction(false, () => {
        const current = state();
        return {
          capUsd: CLAUDE_BUDGET_CAP_USD,
          reservedUsd: current.reserved / 100,
          remainingUsd: (500 - current.reserved) / 100,
          attempts: current.attempts,
          maxAttempts: CLAUDE_MAX_ATTEMPTS,
        };
      });
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        db.close();
      } catch {
        throw new ClaudeBudgetError("budget_unavailable");
      }
    },
  };
}
