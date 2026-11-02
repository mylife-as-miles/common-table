import { expect, type Page } from "@playwright/test";
import type { AppState } from "../../src/domain/types.ts";

export const DEVICE_DATABASE = "common-table";
export const LEGACY_APP_KEY = "common-table.demo.v1";
export const APP_STORE = "app";
export const APP_KEY = "main";
export interface StoredRecord<T = unknown> {
  schema: 1;
  value: T;
  revision: number;
  updatedAt: number;
  writerId: string;
  persistent: boolean;
}

/** A read-only inspection: never creates or upgrades the application's database. */
export async function readDeviceRecord<T = unknown>(
  page: Page,
  store: string,
  key: string,
): Promise<StoredRecord<T> | null> {
  return page.evaluate(
    async ({ database, store, key }) => {
      if (
        typeof indexedDB.databases === "function" &&
        !(await indexedDB.databases()).some((info) => info.name === database)
      )
        return null;
      return new Promise<StoredRecord<T> | null>((resolve, reject) => {
        const request = indexedDB.open(database);
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onerror = () =>
          reject(new Error("Device record could not be inspected."));
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(store)) {
            db.close();
            resolve(null);
            return;
          }
          const transaction = db.transaction(store, "readonly");
          const get = transaction.objectStore(store).get(key);
          get.onsuccess = () => {
            const value = get.result ?? null;
            db.close();
            resolve(value);
          };
          get.onerror = () => {
            db.close();
            reject(new Error("Device record could not be read."));
          };
        };
      });
    },
    { database: DEVICE_DATABASE, store, key },
  );
}

export async function readSerializedApp(page: Page): Promise<string | null> {
  const record = await readDeviceRecord(page, APP_STORE, APP_KEY);
  return record?.schema === 1 && typeof record.value === "string"
    ? record.value
    : null;
}
export async function persistedApp(page: Page): Promise<string> {
  await expect
    .poll(() => readSerializedApp(page), {
      message: "The application state commits to IndexedDB.",
    })
    .not.toBeNull();
  return (await readSerializedApp(page))!;
}
export async function persistedState(page: Page): Promise<AppState> {
  return (JSON.parse(await persistedApp(page)) as { state: AppState }).state;
}

/** Count actual app-store mutations; reading metadata must not count as a save. */
export async function watchAppWrites(page: Page) {
  const before = await persistedApp(page);
  await page.evaluate(() => {
    (window as unknown as { __appWriteCalls: number }).__appWriteCalls = 0;
    const prototype = IDBObjectStore.prototype as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    for (const operation of ["put", "add", "delete", "clear"]) {
      const original = prototype[operation];
      prototype[operation] = function (
        this: IDBObjectStore,
        ...args: unknown[]
      ) {
        if (this.name === "app")
          (window as unknown as { __appWriteCalls: number }).__appWriteCalls++;
        return Reflect.apply(original, this, args);
      };
    }
  });
  return async () => {
    expect(await readSerializedApp(page)).toBe(before);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __appWriteCalls: number }).__appWriteCalls,
      ),
    ).toBe(0);
  };
}
