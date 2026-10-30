# Common Table UI handoff

**Latest visual revision:** see [cinematic/HANDOFF.md](cinematic/HANDOFF.md) for the restaurant room, hinged folio, table settings, working letterpress, current screenshots and recorded interactions. Older screenshots below document earlier iterations.

**Current OpenStreetMap experience:** see [location/HANDOFF.md](location/HANDOFF.md) for the real map, city/device location, interactive mapped places, current screenshots and validation. The sections below record the earlier immersive dining-demo revision.

Built on `feat/immersive-common-table`, from the repository's initial README. No public push or deployment, no private Kitchen Studio code, and no prototype ZIP was needed.

## Preview

Local workspace server: http://localhost:4174. Start it with `npm run dev -- --port 4174`. No externally hosted preview has been published.

## Final screenshots

- [Desktop menu](01-menu-desktop.png)
- [Expanded neighborhood map](02-map-desktop.png)
- [Mobile menu](03-menu-mobile.png)
- [Mobile place page](04-place-mobile.png)
- [Three-person table](05-table-desktop.png)
- [Mobile taste collection](06-table-mobile.png)
- [Mobile agreed plan](07-plan-mobile.png)
- [Desktop saved receipt](08-plan-desktop.png)
- [Atlas in evening light](09-map-evening-desktop.png)
- [The Waiter's service pad](10-waiter-desktop.png)
- [The Waiter's fit reasoning](11-waiter-reasoning-desktop.png)
- [Mobile atlas](12-map-mobile.png)
- [Mobile Waiter](13-waiter-mobile.png)
- [Actual interaction recording](immersive/interaction-demo.mp4)

Run `npm run screenshots` against the preview to reproduce all thirteen screenshots using actual UI actions. The video records real map dragging, selection, light change, the shared photo/title flight into the menu, service bell interactions, typed local intent, shortlist updates, and arrival at the table.

## Immersive atlas and companion revision

The atlas is now the entry view, with authored river/bridge/park geometry, raised brownstones, photo tokens, paper folds, drag/keyboard camera control, bounded zoom, reset, flat mode, and evening lighting. A restaurant index provides an equivalent list. Token focus brings the place into view without hidden-canvas scrolling. Its geography and the line to the table are explicitly schematic.

The same selected photo and title travel into the menu through a finite shared-object transition. `#explore` and `#menu` distinguish atlas and menu; browser Back restores the previous object/view and heading focus. Reduced motion, low power, and browsers without the View Transition API use immediate transitions.

The Waiter is an original interactive brass service bell with a linen service counter and ring-bound pad. It can explain the actual table fit, cycle through all eligible alternatives, keep contenders, show group constraints, and guide the remaining plan steps. Typed requests use a limited local intent vocabulary with explicit unsupported-action fallbacks. The companion has an inline counter on all viewport sizes and cannot cover controls.

The new review started afresh at approximately 8.5 desktop / 7.8 mobile for the atlas. Iterations addressed contrast, orientation, a distinctive bridge landmark, mobile hierarchy, disclosure, and an independently reproduced bell/bookmark overlap. The final independent judgment was **about 9/10 for the unified interactive demo**, with no P1 design issue. The score remains subjective; it does not claim production integrations are complete. Reference research, access limitations, and Proofline's read-only review are in [DESIGN_REFERENCES.md](../DESIGN_REFERENCES.md).

## Independent review

Three implementation agents owned the domain, physical menu, and table/plan UI. A separate design critic reviewed actual desktop/mobile screenshots and an additional QA agent wrote and ran browser tests.

The first review scored desktop 8.2 and mobile 7.2. It identified tiny core text, a long stacked mobile book, repetitive mobile introductions, and weak chosen-venue continuity. Revisions introduced one-page mobile book tabs, larger menu copy, clearer material lighting, a compact mobile map strip, tastes-first mobile layout, chosen-place summaries, and explicit local agreement. Browser testing also caught and resolved decorative book layers intercepting pointer clicks.

The final independent review judged the demo UI at the **9/10 bar**: coherent cover/page-stack/gutter/curl/contact shadows, consistent editorial identity, usable mobile hierarchy, connected venue state, and clearly labeled simulated agreement. The critic reported no remaining P1 visual issue. This is a subjective UI review, not a production readiness score.

Minor polish remains: small desktop tertiary type, schematic map label cropping, repeated desktop section headings, and opportunities for more detailed map artwork.

## Validation

- Production build and TypeScript: pass.
- Domain tests: **33 pass**.
- Browser tests: **30 pass** in the final combined run, including ten desktop/mobile WCAG A/AA automated scans (atlas, menu, table, plan, and Waiter) with no violations or suppressed rules. Machine-readable results: [browser-test-results.json](immersive/browser-test-results.json).
- Actual pointer clicks, repeated shortlist/veto/undo, exhausted results, guest cancel/Escape/focus, group constraints, local approvals, plan invalidation/reload, clipboard and download, blocked storage, browser Back, low-power and reduced motion are covered.
- Additional layout checks at 320, 620, 768, 1024, and 1920 pixels found no horizontal overflow in Explore, Table, or Plan.
- Fonts reduced from about 1.6 MB to 184 KB including licenses; local photographs total about 1.2 MB. Initial production JS is about 101 KB gzip, CSS about 21 KB gzip. No WebGL or perpetual animation loop.

Automated accessibility scans do not establish full WCAG conformance; assistive technology and real-device testing remain valuable.

## Integration gaps

**Qloo is not connected.** Candidate retrieval/ranking is deterministic local demo logic behind a provider interface. Meaningful Qloo entity retrieval, server-side credentials, source-backed ranking, and real response/failure validation remain.

All restaurants, menus, dietary tags, ratings, walking times, and prices are illustrative. They must be replaced with verified venue information. Confirm ingredients and allergy safety with restaurants.

Guests and approvals are simulations edited by one person. Real invitation delivery, authentication, group permissions, live synchronization, and individual responses need a backend. No booking, invitation, or location sharing occurs.

Sharing currently copies/downloads text; hosted revocable plan links remain unimplemented. The Waiter is contextual deterministic guidance, not a connected language model.
