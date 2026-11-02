# Service integration verification

This phase replaces the published app's scripted Waiter route with a real server transport, adds restaurant discovery, real current/dinner weather, authenticated shared tables and one-time invitation links, and moves device persistence to IndexedDB. Provider and model names are excluded from product UI.

The unit report includes mocked provider calls and local SQLite/D1 fixtures. They verify authorization, spending guards, privacy, concurrency, failure recovery and state transitions; they are not proof of successful live model or ranking access. The old standalone Node compatibility tests are included in the full unit suite but are not the published handler.

The guidance allowance is owner-limited for the previously approved verification budget: one persistent global $5 ceiling, irreversible five-cent reservations, no more than 100 attempts, no automatic retry or refill. No paid calls were made during implementation. No keys were copied from chat into runtime configuration.

Published version 15 returned HTTP 200 for actual current conditions and the selected dinner forecast, with America/New_York timezone. Primary forecast rate limiting was observed; a bounded alternate forecast adapter was implemented and tested with truthful unknown values. Local workerd's earlier network-egress error and the first hosted rate-limit failures remain recorded in the historical reports.

Private invitation links and shared-table operations are implemented. Local single-account browser fixtures and separate multi-user service fixtures do not establish a two-person production sign-in journey. No invitation was emailed or sent to an external recipient.

Reservations are explicit handoffs to the venue's supplied booking page or website. An in-app booking transaction and confirmed reservation are not implemented without an authorized booking-provider account. A saved plan is never represented as a reservation.

The final published schema was verified to contain all eight user tables. Public ingress rejected forged reserved identity headers and denied anonymous table-list reads. The production guidance-attempt table was empty: zero paid calls, zero spend. AI and discovery secrets are still unconfigured; their actual provider integrations are not verified live.

The visual review was 8.5/10 before the last mobile readability pass; no 9/10 claim is made. Real 3D rendering with the public full map style stalled in this environment's software renderer, despite successful asset/style delivery. Synthetic/minimal map fixtures and low-power flows passed. Hardware 3D and two-person production collaboration remain separate verification gaps.

See the adjacent live API/browser reports and screenshots for the deployment actually tested. Previous reports in artifacts/live-api-check describe the earlier mock-only version and remain historical evidence.
