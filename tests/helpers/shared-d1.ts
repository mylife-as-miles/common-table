import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import type { SharedDatabase, SharedStatement } from "../../server/shared-tables/index.ts";

/** Real SQLite executes generated schema + SQL; only the D1 transport is mocked. */
export function createSharedD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON;");
  const directory = new URL("../../drizzle/", import.meta.url);
  for (const file of readdirSync(directory).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file, directory), "utf8"));
  class Statement implements SharedStatement {
    values: unknown[] = [];
    constructor(readonly sql: string) {}
    bind(...values: unknown[]) { this.values = values; return this; }
    async first<T>() { return (sqlite.prepare(this.sql).get(...this.values as []) ?? null) as T | null; }
    async all<T>() { return { results: sqlite.prepare(this.sql).all(...this.values as []) as T[] }; }
    async run() { return sqlite.prepare(this.sql).run(...this.values as []); }
  }
  const db: SharedDatabase = {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try { const results = (statements as Statement[]).map(s => sqlite.prepare(s.sql).run(...s.values as [])); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return { db, sqlite, close: () => sqlite.close() };
}
