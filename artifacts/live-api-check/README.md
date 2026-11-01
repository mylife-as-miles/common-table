# Deployed API verification

Target: <https://common-table-design-20261029.myles4miles.chatgpt.site>. Initial baseline: Sites version 11. Fixed and reverified deployment: **version 12**, source `1b2d4bb51c324cac868d6294d3582c1408730e7d`.

These checks contact the actual public Site. They use synthetic questions and browser-local demo guests; they do not use API response fixtures, provider credentials, paid generations, real invitations or bookings.

## Live mapping checks

The application and Waiter status return HTTP 200. The Waiter reports `mode: "mock"`.

Initial searches for **Paris, France** and **Lagos, Nigeria** both returned **HTTP 503 / `upstream_unavailable`**. Production logs recorded `upstream_http` with provider status **521** for both requests. An independent request from this workspace reached Photon with HTTP 200 and five results. **Both production searches recovered on the version-12 retest**, returning HTTP 200, source `photon` and five results. The geocoder code was not changed; this recovery must not be attributed to the separate Waiter context fix. The public map style endpoint also returned HTTP 200.

Invalid city queries return HTTP 400, and unknown API paths return HTTP 404. See [final mapping responses](mapping.json), [initial failures](mapping-before.json) and [sanitized production diagnostics](production-geocode-diagnostics.json). These smoke checks establish observed availability, not a provider uptime guarantee.

The actual browser search form also passed: entering Paris, France triggered an unmocked HTTP 200 Photon response with five results; selecting one updated the chosen area to Paris and the real MapLibre map became ready. See [browser search response](search-browser/result.json) and [screenshot](search-browser/paris.png).

## Browser flow and fixed defect

The initial live desktop/mobile baseline passed 22 steps and failed two checks: after a saved-plan reload, the Waiter received `view: "plan"`, `mode: "real"` and the correct saved venue, but answered about the map. [Baseline evidence](browser-before/live-browser-report.md) includes the exact actual request/reply and screenshots.

The fix makes the active table/plan pad take precedence over map browsing mode. Plan budget and dietary guidance now use the chosen plan venue, even when another venue is being browsed. Local tips also respect the plan pad after a reload. Three new transport regressions failed before the fix and passed afterward; the GitHub HTTP suite passes 16/16 and the hosted HTTP/Worker suites pass 30/30.

The corrected production build passed **26/26 actual desktop/mobile browser steps**, with zero page errors, failed site responses or browser provider calls. Checks cover real vector-map loading and named-place selection, fictional menu choice, synthetic guests, budget/dietary filtering, local approvals, saving/pressing/tearing/reprinting, reload, actual text-file downloads, both Waiter modes, cancellation/repeated submit, focus/back navigation, and edits requiring reapproval. [Final live browser evidence](browser-after/results.json) and [verification summary](verification.json) are retained.

All **11 final Waiter endpoint checks pass**, including saved-plan/table context and rejection of cross-origin, missing-header, extra-private-field and oversized requests. They verify the deployed **mock service**, not a live model connection. See [actual replies and statuses](waiter.json).

## Integration boundaries

| Capability | Current implementation |
| --- | --- |
| Geography | Real OpenFreeMap/OpenStreetMap data. Named places are read from loaded vector tiles; prices, menus and dietary safety are not verified. |
| City search | Real Photon request through the hosted Worker. Final checks pass; an upstream failure was observed in the initial baseline. |
| Recommendations | Local deterministic ranking over fictional venues; Qloo is not connected. See [ranking implementation](../../src/domain/ranking.ts). |
| Waiter | Hosted status/reply routes are mock-only. The separate Node provider client is a CLI test path, not the published browser service. |
| Guests and approvals | One browser controls synthetic guest profiles and local simulated approvals. No invitations or synchronization. |
| Saving and sharing | Browser localStorage, clipboard and text-file export; no shared backend plan database, hosted share link or booking API. |

Reduced-motion/low-power/WebGL fallback uses raster geography without a fresh named-place index. Kept real map points are session state and do not survive reload. Worker caching and throttling are per isolate, not durable global quotas.

The inspected core app modules matched GitHub application source merge `32ff79f629170b07792ebaf8cda1322ac283aa6f`. The subsequent context fix is applied to both source trees. The corrected hosted Worker and app are recorded by Sites source commit `1b2d4bb51c324cac868d6294d3582c1408730e7d`.

## Reproduce the endpoint checks

```sh
node --use-env-proxy scripts/verify-live-apis.mjs --mapping
node --use-env-proxy scripts/verify-live-apis.mjs --waiter
node scripts/verify-live-browser.mjs
node scripts/verify-live-search.mjs
```

Run the phases sequentially and avoid overlapping automated Waiter submissions. The verifiers make no automatic retries and write individual response summaries. Browser checks require Playwright and Chromium (`CHROMIUM_PATH` can select the executable); they preserve normal TLS verification and the inherited proxy when present. `LIVE_APP_URL` and `LIVE_BROWSER_OUTPUT` can select a local production preview and output directory for the full browser journey. A successful mock Waiter response does not establish live model integration. Paid API access remains unverified; the safe local configuration check reports no configured key. No paid provider calls, real invitations or bookings were made. Device-location permissions, real shared state and production-scale availability were not verified.
