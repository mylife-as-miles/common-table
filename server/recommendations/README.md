# Factual restaurant discovery, ranked by the companion

`handleRecommendations(request,{apiKey,db,identity,ownerEmail,fetcher?})` is authenticated owner-only. The existing test allowance must already be explicitly enabled. Ranking shares the same 500-cent D1 cap and irrevocable five-cent reservations as The Waiter; there is no second allowance or top-up.

## Working public map source

Discovery first uses the fixed `https://photon.komoot.io/reverse` endpoint with coordinates rounded to three decimal places, radius 1.8 km, limit 40, and exactly two principal-tag filters: `amenity:restaurant` and `amenity:cafe`. Photon explicitly documents tag-filtered reverse search for nearby POIs. Its public demo permits reasonable project usage; the app applies the existing persistent quotas, a bounded 15-minute cache and coalesced cell lookups. It performs no Nominatim search or systematic area sweep.

Source references:

- https://github.com/komoot/photon/blob/master/docs/api-v1.md
- https://github.com/komoot/photon/blob/master/README.md

Each record must be a named dining `Point` with a canonical OSM node/way/relation ID, valid actual coordinates, and a matching `osm_key`/`osm_value`. Out-of-area, unnamed, non-dining and malformed records are dropped; duplicate IDs are collapsed. Cuisine and website fields are accepted only from actual extra source tags. Names never establish cuisine. A missing cuisine remains a generic Restaurant/Café, and unsafe websites are discarded.

Only on transient network/timeout/406/429/5xx failure, one fixed Overpass endpoint (`https://overpass-api.de/api/interpreter`) may answer the same bounded factual search. Authorization errors, redirects and malformed payloads never trigger another source. Both free attempts share one 18-second deadline, at most eight seconds each, including streamed reads. Manual redirects, a one-megabyte response cap and strict parsing apply. No URL supplied by a browser or place record is fetched.

## Trusted cold-cache details

`resolveVenue(id,{fetcher?,signal?})` accepts only canonical positive OSM IDs. Cached verified records last 15 minutes. On a cold cache it uses the official fixed `https://api.openstreetmap.org/api/0.6/` individual-element read service: node `/<id>.json`, way/relation `/<id>/full.json`. It never performs a bounding-box download. A way/relation center is derived only from complete valid referenced-node bounds; incomplete or unsupported nested geometry yields no invented coordinates. Exact reads are capped at one megabyte and 5,000 elements, with the same deadline and one transient Overpass fallback.

Official read contracts: https://wiki.openstreetmap.org/wiki/API_0.6 and https://wiki.openstreetmap.org/wiki/OSM_JSON.

## One intelligence path

The companion's model performs all taste interpretation and restaurant ordering. It receives aggregate tastes, budgets, restrictions, current candidate keeps and trusted candidate names/categories/cuisine labels. It receives no coordinates, map query, group names, identity or contributor metadata. Vetoed places are removed before inference.

The existing Worker-safe generation service verifies the authorized organization and exact model before reserving shared credit and making one bounded generation request. There are no tools, paid retries or model fallback. The model must return only a compact JSON object containing `orderedIds`. The official structured-output format constrains each string to a server-generated enum of trusted candidate IDs; the schema is included in the bounded prompt budget. The server still enforces at most eight unique IDs and rejects extra fields, fenced/truncated JSON, prose or invented venue facts. Public comparison labels are derived from known source cuisine/category, never generated taste or budget claims. Returned venues are the original source records, never generated venue objects.

Success is `{source:'osm',venues,orderedIds,rationales,retrievedAt}`. Menus, exact prices, ratings, travel times, hours, reservation availability and allergy safety remain unknown unless separately verified. Place imagery uses an explicitly illustrative placeholder.

## Verification

Mocked module and service integration tests cover source contracts, coordinate rounding, mixed invalid/unnamed/non-dining/out-of-area records, duplicates, unsafe websites, factual cold-cache geometry, authorization, the shared immutable budget, one paid ranking, malformed model output and preservation of connected plans.

Initial Overpass-only probes failed (406/502/timeouts), motivating the source change. A real Photon tagged reverse probe at the fixed Brooklyn test point returned HTTP 200 and 40 actual dining records in about one second. Official individual node and full-way reads also returned HTTP 200 in under one second. Sanitized actual-helper proof is saved under `artifacts/live-services/osm-photon-free-proof.json`; no credentials or paid requests are used by that probe. Live production model ranking still requires root's separate bounded end-to-end verification.

Ranking diagnostics log only fixed rejection categories and numeric reply-byte/candidate/result counts. They never log model text, prompts, IDs, places, coordinates, identities or credentials. Compact IDs-only structured output reduces completion size while preserving the model’s sole control of venue selection and order. Official contract: https://platform.claude.com/docs/en/build-with-claude/structured-outputs.
