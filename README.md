# Common Table

An immersive food discovery and dinner-planning app. Start with real location-based geography, or enter the illustrated demo neighborhood → tactile menu book → shared table → dinner plan. Built independently from the initial README; no Kitchen Studio code was accessed or copied. Local feature branch only, no public push or deployment.

**Capability boundaries:** the real map uses OpenStreetMap geography, OpenFreeMap vector data and actual building heights where available. City search is connected. Device location is requested only after pressing **Use my location** and is kept in memory for this session; map/place-search services receive the chosen area, but coordinates are not put in guest invitations or dinner plans. No API key is required. Real named places from the loaded OSM vector tiles can be inspected and kept in a session-only collection; these map labels are not personalized or verified restaurant recommendations. All six dining-demo restaurants, menus, prices, ratings, dietary tags, and walking times remain fictional or illustrative. They are never moved onto your real map as nearby venues. Qloo, real restaurant recommendations, invitations, live collaboration, and bookings are **not integrated**. No messages are sent.

## Run

Node 24.5 or later (the scripts support inherited HTTP proxies with Node's environment-proxy option):

```sh
npm ci
npm run dev -- --port 4174
```

Open http://localhost:4174. `npm run build` typechecks and creates the production bundle. `npm start` serves both the built app and its API on port 4173; `PORT` and `HOST` can override that. Vite development/preview also provide the same API middleware.

## OpenStreetMap and place search

The map uses real OpenStreetMap geography via OpenFreeMap vector tiles. Place search uses Photon through the same-origin `GET /api/geocode?q=...` endpoint. There is no weather integration or API-key setup. The server validates and bounds results, caches queries for fifteen minutes, coalesces duplicate requests, limits upstream query frequency, and sanitizes failures.

Named places already present in loaded map tiles become original tactile map objects. Select one to focus the map and open its paper field notes. The map and list share selection; Food, Coffee and Outdoors lenses use supplied geographic categories. Keep places for this browser session, revisit them, or remove them. A user-controlled day/supper light changes the map palette; it makes no live environmental claim. An Unfold map action gives the inline map more space; Escape folds it back with focus restored.

Only OSM-provided names, categories and coordinates are displayed. Place data varies by area/zoom and can be incomplete. Menus, prices, hours and dietary suitability have not been verified. The lightweight raster fallback retains real streets and camera controls without a place index.

## Working experience

- The default real map starts in a clearly labeled Brooklyn **starting view**, not an inferred user location. Search a city/neighborhood or explicitly request device location. Denial, cancellation, timeout and late results preserve the current area. Location is not persisted on reload.
- Real-map rendering uses lazy-loaded MapLibre/OpenFreeMap with geographic buildings, visible attribution, camera controls and a chosen-area marker. Low-power mode or missing WebGL uses a standard Leaflet/OpenStreetMap map. It never falls back to invented geography while claiming to be real.
- Enter through an authored Brooklyn supper atlas: raised brownstones, a riverfront and suspension bridge, park paths, folded paper, physical photo tokens, and a connection to your shared table. Drag, pan with arrow keys, zoom, reset, change the light, or flatten the city. An equivalent restaurant index supports list navigation.
- Opening a restaurant carries the same photo and title into its physical menu through a finite shared-object transition. Map and book have distinct URLs (`#explore`, `#menu`), so browser Back restores the previous view. Mobile presents one paper page at a time with accessible tabs.
- Bookmark contenders, veto a venue, see revised candidates, and undo any veto. Exhausted results never silently reintroduce a rejected venue.
- Start solo or add up to five local demo guests. Edit tastes, moods, budgets, and dietary needs. Every person's budget and all restrictions are hard constraints; taste overlap ranks eligible candidates.
- Choose a venue, set the date/time/note, collect each participant's **simulated local approval**, and save. People or plan changes clear approvals and require saving again. Browsing other venues preserves the existing plan.
- Copy/download the suggested plan as text. This does not create a hosted sharing link or send an invitation.
- The Waiter is a tangible brass service bell and ring-bound service pad. On the real map it follows the selected mapped place and can keep that same place; it explicitly distinguishes the fictional dining plan. Ring the character for a contextual tip, ask why a place fits, cycle through eligible alternatives, keep a contender, or work through the steps to finish tonight. Typed requests recognize a limited local set of intents and give an honest fallback. It has no model/API connection or permission to book, invite, or share location.
- Browser-local persistence validates stored data and recovers safely from obsolete or malformed snapshots. Storage failures are disclosed; session-only plans can still be exported.

## Accessibility and performance

Semantic controls, labeled forms, native modal focus handling, mobile tab arrow-key navigation, focus restoration after guest cancel/remove, live feedback, and visible focus indicators. Tab-focusing an offscreen demo-map token brings it into view without scrolling the hidden canvas. The service counter stays in document flow and never covers map controls. Honors reduced motion and offers a low-power setting. The real map lazily loads WebGL-based MapLibre or a lighter Leaflet 2D renderer. The authored demo uses SVG/CSS and can run without third-party requests. Finite page turns use Web Animations with cancellation; shared photo/title motion uses the View Transition API with an immediate fallback. No perpetual animation loop is used. Fonts and illustrative dining photos are local; live map/geocode data requires provider connectivity.

## Verify

```sh
npm test
npm run test:e2e
npm run screenshots
```

Current verification: **42 domain/backend tests and 48 browser checks pass**, including fifteen automated WCAG A/AA scans.

Browser tests use system Chromium (`/usr/bin/chromium`); set `CHROMIUM_PATH` for another path. Tests cover actual pointer actions, connected selection, repeated shortlist/veto/undo, exhausted results, guest cancel/Escape/focus, approvals and invalidation, persistence, copy/download, Back navigation, mobile overflow, motion fallbacks, and automated WCAG A/AA scans. Automated checks supplement manual review and do not establish full accessibility conformance.

Thirteen final screenshots are in `artifacts/`, including the atlas on desktop/mobile, evening light, the Waiter's pad, and the connected book/table/plan. Capture requires the dev server on port 4174 (or set `PREVIEW_URL`). An actual recorded interaction is in `artifacts/immersive/interaction-demo.mp4`; `scripts/record-demo.mjs` reproduces a WebM recording after `npx playwright install ffmpeg`.

Current real-map screenshots and live-provider evidence are in `artifacts/location/`. `node scripts/capture-location.mjs` captures the real vector map in Brooklyn and a live searched Paris area; all shown names and geography come from the live map providers. Automated browser tests mock external tile/style requests and do not sweep public raster tile servers.

## Structure

- `src/domain/`: typed demo data, reducer, ranking, validation, persistence, and future recommendation provider interface.
- `src/components/`: physical atlas, menu book, shared table, plan receipt, and embodied Waiter.
- `src/location/`: session-only chosen area, explicit geolocation, search cancellation, and session-only mapped-place state.
- `server/`: Photon/OSM geocoding middleware and a standalone static/API server.
- `src/App.tsx`: connected navigation, The Waiter, and demo disclosure.
- `tests/`: domain and browser tests; `scripts/capture.mjs`: reproducible screenshot journey.

## Integration gaps

1. **Qloo:** implement `RecommendationProvider` via a server endpoint with server-side credentials. Resolve real entities/location constraints, retrieve taste-relevant candidates, then rank with source evidence while enforcing all budgets, restrictions, and vetoes. Test actual responses and degraded states. The current provider reports `source: 'demo'`; no scores claim to be Qloo results.
2. **Real restaurants:** verified IDs, geography, hours, menus, prices, availability, and ingredient/allergy information. Illustrative dietary tags are not an allergy safety assurance.
3. **Invitations and agreement:** authenticated invitation links, membership/permissions, backend persistence, individual votes, conflicts, and synchronization. Current guest profiles and approvals are operated by one person in one browser.
4. **Hosted sharing:** authorized persisted snapshots and revocable links with defined privacy/retention behavior. Current sharing is user-triggered text copy/download.
5. **Optional assistant:** a server-backed companion with explicit tool permissions and consent boundaries.

## Assets

Cormorant Garamond and DM Sans from Google Fonts, subset and served locally (SIL Open Font License; `public/fonts/OFL-*.txt`). Illustrative photography from Unsplash; URLs in `public/images/SOURCES.txt`. The original schematic map is not a navigation service.

Live provider references: [OpenFreeMap quick start](https://openfreemap.org/quick_start/), [MapLibre](https://maplibre.org/maplibre-gl-js/docs/), [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/), [Photon](https://github.com/komoot/photon). Credits stay visible on the map. The public services offer no app-specific availability guarantee; configurable/self-hosted providers remain an option for production scale.

Reference research and the limits of accessible sources are documented in [DESIGN_REFERENCES.md](DESIGN_REFERENCES.md). Bump informed spatial presence; Proofline informed physical origin and return. The atlas, character, UI, geometry, and behavior are original implementations.
