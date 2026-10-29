# Common Table

An immersive food discovery and dinner-planning app: illustrated neighborhood → tactile menu book → shared table → dinner plan. Built independently from the initial README; no Kitchen Studio code was accessed or copied. Local feature branch only, no public push or deployment.

**Demo boundaries:** all six restaurants, menus, prices, ratings, dietary tags, and walking times are fictional or illustrative. Photography is atmosphere inspiration. Qloo, real invitations, live collaboration, venue verification, and bookings are **not integrated**. No location is collected or shared. No messages are sent.

## Run

Node 22 or later:

```sh
npm ci
npm run dev -- --port 4174
```

Open http://localhost:4174. `npm run build` typechecks and creates the production bundle; `npm run preview -- --port 4174` serves it.

## Working experience

- Explore through the connected map and physical menu. Mobile presents one page at a time with accessible page tabs.
- Bookmark contenders, veto a venue, see revised candidates, and undo any veto. Exhausted results never silently reintroduce a rejected venue.
- Start solo or add up to five local demo guests. Edit tastes, moods, budgets, and dietary needs. Every person's budget and all restrictions are hard constraints; taste overlap ranks eligible candidates.
- Choose a venue, set the date/time/note, collect each participant's **simulated local approval**, and save. People or plan changes clear approvals and require saving again. Browsing other venues preserves the existing plan.
- Copy/download the suggested plan as text. This does not create a hosted sharing link or send an invitation.
- The Waiter offers deterministic contextual guidance. It has no model/API connection or permission to book, invite, or share location.
- Browser-local persistence validates stored data and recovers safely from obsolete or malformed snapshots. Storage failures are disclosed; session-only plans can still be exported.

## Accessibility and performance

Semantic controls, labeled forms, native modal focus handling, mobile tab arrow-key navigation, focus restoration after guest cancel/remove, live feedback, and visible focus indicators. Honors reduced motion and offers a low-power setting. Depth uses CSS; finite page turns use Web Animations with cancellation. No WebGL, continuous render loop, or third-party requests are required. Fonts and photos are local.

## Verify

```sh
npm test
npm run test:e2e
npm run screenshots
```

Browser tests use system Chromium (`/usr/bin/chromium`); set `CHROMIUM_PATH` for another path. Tests cover actual pointer actions, connected selection, repeated shortlist/veto/undo, exhausted results, guest cancel/Escape/focus, approvals and invalidation, persistence, copy/download, Back navigation, mobile overflow, motion fallbacks, and automated WCAG A/AA scans. Automated checks supplement manual review and do not establish full accessibility conformance.

Screenshots are in `artifacts/`. Capture requires the dev server on port 4174 (or set `PREVIEW_URL`).

## Structure

- `src/domain/`: typed demo data, reducer, ranking, validation, persistence, and future recommendation provider interface.
- `src/components/`: menu book, schematic map, shared table, and plan receipt.
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
