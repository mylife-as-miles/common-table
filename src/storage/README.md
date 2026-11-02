# Device persistence

`common-table`, IndexedDB version 1, contains `app`, `location`, `settings`, `cache`, and `meta` object stores. Values are revisioned envelopes (`schema`, `value`, `revision`, `updatedAt`, `writerId`, `persistent`). This is local device persistence, not authenticated collaboration.

- `get<T>(store,key,options?)` returns the value, or `undefined`.
- `put`, `update`, and `deleteValue` serialize writes. `update` executes a synchronous callback atomically inside a read/write transaction, including across tabs.
- `expectedRevision` enables compare-and-swap. A mismatch throws `StorageConflictError`; it never silently replaces the newer copy.
- `{persist:false}` reads/writes memory only. Use it for weather/cache data derived from unbookmarked device GPS.
- `initializeStorage`, `getStorageStatus`, and `subscribeStorageStatus` expose loading, ready, and session-only states. Quota, denial, incompatible versions, and corruption degrade to memory with a user-safe error. Existing corrupt disk records are protected.
- `flushStorage` waits for operations already enqueued. Tests should poll the relevant committed record after a React action, since a hook's persistence effect may not have enqueued it yet.

`app/main` contains the existing serialized version-1 domain snapshot, including real venue snapshots when present. The app hook replays actions issued before asynchronous hydration over the loaded state. It never writes the empty initial render. `storageReady` is hydration readiness; `storageSaving` reports pending device changes; `storageAvailable` is the storage capability. Product copy should show a pending state until saving finishes. A device-tab conflict preserves the local draft and requires explicit `resolveStorageConflict('reload'|'keep-local')`.

`location/context` persists the chosen searched/saved area and explicitly kept map points. Current device GPS, temporary search results, and inspected-but-unkept points are session-only. Bookmarked point coordinates are retained because that action is explicit. A later GPS session does not replace the previous stored searched area.

`useBooleanSetting('lowPower',false)` returns `[value,setValue,{ready,error}]`; early user changes win over the asynchronous read. Legacy `common-table-low-power` migrates here. A remembered sound preference must not create/resume audio without a fresh explicit browser gesture.

Legacy `common-table.demo.v1` and low-power preference migrate once in one transaction, with `meta/migration:local-storage:v1`. The legacy source is removed only after the commit. A newer IndexedDB copy wins; failed migration preserves the source and a usable session copy.

Never persist API keys, authentication/invitation tokens, credentials, or passwords. Common credential fields and keys are rejected; callers must also avoid embedding secrets in arbitrary text. Server secrets remain server-side. `storage/drafts` provides explicit-retry offline collaboration drafts, not an automatic outbound queue.

Run `npm run test:storage` for transaction, migration, failure, race, privacy, and hydration coverage using fake-indexeddb. Browser integration tests own the native-browser assertions.
