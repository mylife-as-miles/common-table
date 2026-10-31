# Immersive OpenStreetMap experience

The real map is the initial `/` view and `#nearby`. The authored fictional dining atlas remains at `#explore` and its tactile book at `#menu`. All work remains on `feat/immersive-common-table`; no public push or deployment.

## What works

- Real OpenStreetMap streets, parks, water, building footprints and supplied building heights via OpenFreeMap/MapLibre. Original paper, olive and terracotta materials connect the map to the menu and dinner receipt.
- Actual named places become tactile plate, cup, leaf and landmark objects. Select a map object or list entry to focus the same place and open paper field notes. Mobile selection reveals a compact named peek with a keyboard-accessible Read notes action.
- Everything, Food, Coffee and Outdoors lenses use supplied map classifications. Visible map objects and the index update together after camera changes. No restaurant is invented to populate an empty area.
- Keep/unkeep real places for the current session, revisit a kept place after changing area, and retain the same selection through a demo/table/back detour. Kept places are not written to browser storage, invitation text or dinner plans.
- The Waiter follows the actual mapped place and can keep it in the same collection. Typed keep requests are idempotent. It distinguishes real geography from the separate fictional dining table and never invents a menu, price or dietary fit.
- Explicit city/neighborhood search uses a server-side Photon/OSM geocoder with validation, bounded responses, caching, request coalescing, throttling and safe provider failures. Live Brooklyn and Paris verification used actual provider responses.
- Device location requires pressing Use my location. Denial, cancellation, timeout and late callbacks preserve newer choices. No passive tracking or automatic location persistence.
- Daylight/supper light is an explicit visual setting. Unfold map gives the inline world more room; Escape folds it and restores focus.
- Low-power, reduced-motion or unavailable WebGL uses real Leaflet/OpenStreetMap raster geography. That lightweight mode has camera/keyboard controls and attribution, without the vector place index.

OpenWeather code, UI, credentials and endpoints were removed after the user's correction. **No map API key is required.**

## Evidence

- [Real Brooklyn map](01-real-map-desktop.png)
- [Mobile real map](02-real-map-mobile.png)
- [Live searched Paris](03-searched-paris.png)
- [Real place and its field notes](04-real-place-field-notes.png)
- [Supper light](05-supper-map.png)
- [Mobile selected place](06-real-place-mobile.png)
- [The Waiter and the selected real place](10-waiter-real-place.png)
- [Mobile Waiter](11-waiter-real-place-mobile.png)
- [Live provider verification](live-smoke-results.json)
- [Complete browser test report](browser-test-results.json)

Automated tests intercept external map tiles/styles and use deterministic local fixtures; they do not sweep public raster tile servers. Live screenshots use actual OpenFreeMap vectors, with raster requests blocked. No real personal location was collected for screenshots.

The independent critic reviewed actual desktop/mobile screenshots. Its first review identified zero initial mobile place objects and selected notes below the screen. Both were corrected and reviewed again. No remaining P1 visual issue was found. Its subjective craft assessment was around 8.8–9.0, with small secondary text and incidental places under Everything remaining polish opportunities. This is not a production integration rating.

## Verification

- Production build and strict frontend/server TypeScript checks pass.
- **42/42 domain and backend tests pass**, including nine geocoding/static-server cases.
- **48/48 browser checks pass**, with zero failures, skips or flakes. They include eighteen location/map cases and fifteen automated WCAG A/AA scans across the complete demo, selected real-place notes, and both Waiter contexts.
- Real-provider screenshots and the standalone production API smoke confirm actual Brooklyn/Paris geography, Photon search, and removed weather/config endpoints returning 404. The map needs no API key.
- MapLibre is lazy loaded (about 304 KB gzip plus its separate worker); Leaflet is about 44 KB gzip. Initial app JavaScript is about 116 KB gzip. Low-power and reduced-motion modes retain a usable geographic map.

## Preview and gaps

Run `npm run build` then `npm start` for http://localhost:4173, or `npm run dev -- --port 4174`. Node 24.5+ supports the inherited environment proxy. No public preview was published.

OSM place names/categories may be incomplete or outdated. Menus, hours, prices, dietary suitability, real restaurant candidate retrieval and Qloo ranking still need dedicated verified integrations. Real invitations, collaboration, bookings and hosted sharing remain unavailable. The fictional dining journey and local plan/approval flows stay intact and clearly labelled.
