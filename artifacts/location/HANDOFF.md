# Real location map and OpenWeather handoff

The default entry view is now real geography. The authored dining demo remains at `#explore`, its book at `#menu`, and the real map at `#nearby` (or the initial `/` URL).

## Verified working

- Real OpenStreetMap/OpenFreeMap streets, water, parks, and geographic building footprints/heights through MapLibre. Inherited paper palette, visible attribution, actual camera controls, and a selected-area marker.
- Explicit city/neighborhood search through a server endpoint. Live verification moved from Brooklyn to Paris using Photon results and actual vector data. No fictional restaurant pin was relocated.
- User-triggered device location, permission denial, cancellation, timeout, late-response protection, and no location persistence after reload.
- Real Leaflet/OpenStreetMap 2D fallback for low-power or unavailable WebGL; permanent attribution and explicit loading/failure/retry states.
- Server-only OpenWeather integration with validated inputs, sanitized responses, request coalescing, caching, timeout/quota handling, and safe error states.
- The Waiter acknowledges the selected real area and the absence of connected nearby restaurant recommendations. Existing demo guests/plans stay unchanged.

## OpenWeather setup still required

No OpenWeather key is configured in this environment. **Live weather has not been verified with real credentials.** The UI correctly says “Weather not connected.” Weather success/error cases are tested with explicit API fixtures; screenshots do not simulate weather.

Set `OPENWEATHER_API_KEY` in the ignored `.env.local` file or server environment and restart. See `.env.example`. Never expose it through a `VITE_` variable. The real map and keyless Photon search already work independently.

## Evidence

- [Real Brooklyn map](01-real-map-desktop.png)
- [Mobile real map](02-real-map-mobile.png)
- [Live searched Paris](03-searched-paris.png)
- [Live provider verification](live-smoke-results.json): MapLibre ready, Paris selected, no JavaScript errors; actual OpenFreeMap responses succeeded. Public raster tile requests were blocked during automated live capture; renderer used vectors.
- [Browser test report](browser-test-results.json): **42 passed**, zero skipped, failed or flaky; includes the prior 30 scenarios and 12 new location/weather scenarios, with 12 desktop/mobile WCAG A/AA scans overall.
- **47 domain/backend tests pass**, including 14 API/static-server tests.
- Production build and TypeScript pass. MapLibre is a lazy chunk (about 304 KB gzip plus a separate worker); Leaflet fallback is about 44 KB gzip. Initial app JS is about 111 KB gzip.

The critic reviewed these actual new screenshots afresh and found no remaining P1 visual issue; the real-map surface assessed around 8.8–9.0 without carrying forward the previous score.

Production preview: `npm run build && npm start`, port 4173. Node 24.5+ is required by the environment-proxy-aware scripts. Provider documentation and attribution links are in the repository README.

Real restaurant candidate retrieval, Qloo ranking, verified menus/budgets/restrictions, live invitations, and hosted sharing remain separate integrations. Map-provider place labels are geography, not verified Common Table recommendations.
