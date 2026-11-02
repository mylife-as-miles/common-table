# Service integration verification

Published version 18 uses Claude Sonnet 5.5 for both The Waiter and restaurant selection/ranking. The previous recommendation integration and its server key are removed. Product UI uses only the companion and discovery names. Native Sites stores the model credential as a masked server secret; it is never sent to the browser or IndexedDB.

The published source is `bae4438b77050530a38a6545802b2a2d1de7bed0`. Actual production checks returned HTTP 200 for a sample Waiter answer, a cold-cache real-restaurant answer, eight model-ranked real nearby places, and weather. See `claude-only-live.json` for exact versions, responses, failed initial attempts, the final deployment and the spending ledger. The weather check predates the backend-only ranking fix; its implementation was unchanged.

Restaurant facts come from documented, bounded OpenStreetMap sources: Photon for nearby named dining places and the official read API for exact canonical IDs, with one transient Overpass fallback. Claude controls candidate selection and order. Structured output constrains IDs; the server still rejects unknown/duplicate IDs, extra fields and incomplete output. Comparison labels use verified source categories/cuisine. Exact prices, menus, ratings, travel times, opening hours, availability and dietary safety remain unknown and require direct confirmation. No source name alone establishes a taste or budget fit.

The latest complete unit run passed 220/220 checks. App/server type checks, targeted lint and production build passed. The complete browser batch passed 96/96, with 26 automated accessibility scans and no retries, skips or flaky results. Its client build is identified in `../fullapp-qa/osm-summary.json`; the later backend-only compact-ranking contract was covered by unit tests and a separate live production call. Browser model responses are explicitly labelled fixtures. Earlier corrected test assumptions and an aborted stale-preview environment run remain separate historical reports.

The global test ledger still has its original 500-cent ceiling. Four generation attempts, including one rejected ranking response, reserved 20 cents irrevocably. This is a reservation ledger, not exact provider billing or an account balance. There is no top-up, automatic retry, refill or auto-reload. Live intelligence is enabled only for the configured authenticated owner during this bounded test phase.

Temporary fixed-operation verification access is disabled: both the formerly valid capability and anonymous requests now return 404. No visitor was impersonated and no private shared records were read by those checks. A failed hosting lifecycle transition was repaired by republishing; final publication succeeded. The native secret-removal update did not disable the route on its own, so the capability setting was explicitly replaced with an invalid disabled value and verified in production.

Real invitations and collaboration use authenticated D1 records, one-time hashed invitation tokens, membership enforcement, optimistic concurrency, durable idempotency and revision-bound approvals. Separate multi-user service fixtures and local UI fixtures pass; a two-person production sign-in journey remains unverified. No invitation was emailed or sent externally during testing.

Reservations remain explicit handoffs to a venue-supplied booking page or website. An in-app booking transaction and confirmed reservation require an authorized booking provider. A saved plan is never represented as a reservation.

IndexedDB preserves the connected venue and dinner plan, including archived older records without silently refreshing their authority. It stores no credentials. Hardware-rendered full 3D mapping remains a separate verification gap after the software renderer stalled; the low-power fallback passed. The last visual critique was 8.5/10; no 9/10 claim is made.

Historical version 15 reports and screenshots remain adjacent. Downloadable screenshots are in `common-table-screenshots.zip`; their visual layout is unchanged by this server-side intelligence update.
