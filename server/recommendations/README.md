# Restaurant discovery

`handleRecommendations(request, { apiKey, fetcher?, signal? })` is a pure Web API service. The dispatcher must enforce authentication, same-origin mutation intent and per-user request limits before invoking it. Supply the server environment's `QLOO_API_KEY`; never expose it to client bundles, IndexedDB, responses or logs.

The adapter uses the current official standard REST host `https://api.qloo.com`:

- `/v2/tags?filter.query=...&take=8` resolves up to six unique tastes, selected across seats in round-robin order. Both documented `tag_id` and entity-tag `id` are recognized. Tags must be food/place/restaurant related.
- `/v2/insights/` requests Places, filters the restaurant genre, an 8 km radius around `POINT(longitude latitude)`, the group's lowest coarse price tier and veto IDs. Resolved taste tags and trusted saved-place seed IDs influence affinity. The returned order is retained, without presenting a made-up match probability.
- `/entities?entity_ids=UUID` re-resolves trusted venue details for the server Waiter/booking context. Browser catalog snapshots never substitute for server provider evidence.

At most seven upstream calls occur on an uncached search, with no retries. Tags and verified public place records have short bounded in-memory caches. Fixed request paths, HTTPS origin, redirect rejection, timeouts, byte caps and structural validation apply. Provider error bodies are discarded.

Every real result has a stable `qloo:<UUID>` catalog ID and actual latitude/longitude. Invalid coordinates and out-of-area candidates are rejected. Real candidates join the same state, shortlist, menu book, table and plan as the sample flow. Refresh preserves existing plans and historical venue snapshots. IndexedDB persistence is handled by the shared app state layer, not by this service.

Price levels are only coarse discovery filters; no exact per-person price is invented. Menus, walking times and dietary/allergy safety are absent until separately verified. The real plan UI requires explicit acknowledgment of missing details before saving. A provider website or Resy link permits navigation; it is never a booking confirmation or authorization to reserve.

No live provider verification is claimed. Unit tests use mocked fetch responses. A valid server secret and actual account entitlement are still required to validate production transport and data coverage.

Official contracts consulted:

- https://github.com/qloo/docs-public/blob/main/reference/get-tags.md
- https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md
- https://github.com/qloo/docs-public/blob/main/reference/get-entities.md
- https://github.com/qloo/docs-public/blob/main/reference/taste-analysis.md
- https://www.qloo.com/capabilities (restaurant genre identifier)
