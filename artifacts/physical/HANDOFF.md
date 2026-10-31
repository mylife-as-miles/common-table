# Common Table: soft paper, physical table, tearable plan

Local work on `feat/immersive-common-table`; nothing pushed or publicly deployed.

## What changed

- **Proofline-style paper:** the same MIT StPageFlip soft-leaf solver used by Proofline replaces the previous rigid overlay. Printed paper bends under a native corner drag with a reverse face, moving fold shadow and the real adjacent venue beneath it. Short drags return; completed turns commit the restaurant once. Both directions, queued controls, Escape, pointer cancellation, resize, closed-cover focus, keyboard recovery and navigation teardown are covered. Motion fallbacks select immediately. The vendored engine has a documented manual-render lifecycle patch and retained upstream license; it schedules no idle loop.
- **Physical table:** original Cycles-rendered wood, linen, porcelain, silver, glass, chairs and contact shadows replace the CSS illustration. Six arrangements match the actual local participant count. Live native seat controls and names are projected onto the exact rendered plate/tent-card coordinates. The table is larger and the taste editor sits on a separate paper sheet in the shared room. Lighting and geometry are baked stills with event-driven pointer depth; this is not a real-time AAA renderer. Materials retain a stylized still-life character, especially the glass highlights.
- **Tearable receipt:** a visible folded grip, nearby instruction, advancing ragged seam and retained stub explain the interaction. Short pulls spring back; a deliberate pull detaches the same live saved plan and lets it settle on the table. Tap, Enter and Space perform the same action. Reprinting resets the paper without saving or exporting again. The receipt, venue and participant state remain connected.

No private Kitchen Studio source or assets were copied or modified. Its earlier user-authorized read-only inspection supplied behavioral reference only. The table generator, scene assets, press and app integration are original; the soft-leaf solver is credited separately in `src/components/book/`.

## Actual captured evidence

- [Open book](01-open-book.png)
- [Held soft-paper curl](02-held-paper-curl.png)
- [Completed turn](03-completed-page-turn.png)
- [Mobile book](04-mobile-book.png) and [held mobile curl](04b-mobile-held-curl.png)
- [Table for three](05-table-three.png) and [mobile table](06-mobile-table.png)
- [Printed current plan](07-printed-plan.png)
- [Held perforation](08-held-perforation.png) and [detached receipt](09-detached-plan.png)
- [Table for six](10-table-six.png), [solo table](11-table-solo.png), and [mobile table for six](12-mobile-table-six.png)
- [Recorded native interactions](book-table-tear.mp4)
- [Capture metadata](capture-results.json)
- [Final asset and projection fingerprints](table-assets.json)
- [All-six-layout clearance checks](geometry-validation.txt)
- [Deterministic queued-turn regression](queue-gap-results.json)
- [Independent review](../../docs/CINEMATIC_DESIGN_REVIEW.md)

These are captures of the running production application and real pointer actions. Held-curl shots use the viewport directly so screenshot resizing cannot cancel the gesture. Mobile captures use separate contexts seeded from the same current browser-local state. The dining venues and local guest approvals remain explicitly fictional/demo data.

## Verification

The strict frontend/server TypeScript checks and production build pass. **42/42 domain/API tests and 78/78 production browser cases pass**, with zero skips, failures or flakes. The complete browser run includes **23 automated WCAG A/AA scans**, all with zero violations. The [authoritative browser report](browser-test-results.json) uses the final build and all six corrected assets; it includes actual image loading, plate and projected-paper clicks, and mobile editor/focus checks.

Verification found and corrected two dark-room text colors, a closed-cover focus edge and a dropped queued turn during the deferred-frame handoff. The queued-turn regression now pauses at that exact gap and uses native buttons to prove every action is preserved. The eight general-view accessibility scans wait for actual finite entrance animations before measuring final colors, retaining every contrast assertion. Captures are also taken after transient notices clear and from a normal top scroll position for full-page mobile views.

The complete suite exercises all earlier map/menu/table/plan flows plus real short/long/reverse curls, paint-copy accessibility, idle-frame teardown, closed-cover resize/blur, one/three/six-person native targets, loaded image containment, mobile focus and repeated tear/print behavior. Automated accessibility checks supplement manual review and do not establish complete conformance.

The initial application JavaScript is about **139 KB gzip**, with CSS about **43 KB gzip**. MapLibre remains lazy-loaded. Table images are local compressed WebPs; only the current arrangement and the next possible arrangement are loaded. This is a bundle/rendering design observation, not a measured frame-rate guarantee.

The generator's analytic preflight checks all six layouts for card/plate/glass clearance, card feet within the table and linen clearance above the wood. Raw diagnostic/failed captures are not handoff evidence.

## Preview and reproduction

`npm run build && npm start` serves http://localhost:4173. `npm run test:e2e` runs against development; `PLAYWRIGHT_BASE_URL=http://localhost:4173 npm run test:e2e` checks an already running production preview. `node scripts/capture-physical.mjs` captures the interactions and records WebM; MP4 conversion uses ffmpeg.

`python3 scripts/table-only/build_assets.py` reproduces the six images with Blender and Pillow. Normal application builds use the checked-in images and do not require Blender. See `scripts/table-only/README.md` and the engine's `src/components/book/README.md` for provenance and lifecycle details.

## Integration gaps

Qloo retrieval/ranking, verified real restaurant menus/prices/hours, actual invitations/collaboration, bookings and hosted sharing remain unintegrated. The real OSM map and clearly fictional dining demo keep their existing boundary. The Waiter remains contextual local guidance. No invitations or locations are sent to other people.
