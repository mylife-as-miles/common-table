# Common Table UI handoff

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

Run `npm run screenshots` against the preview to reproduce the journey using actual UI actions.

## Independent review

Three implementation agents owned the domain, physical menu, and table/plan UI. A separate design critic reviewed actual desktop/mobile screenshots and an additional QA agent wrote and ran browser tests.

The first review scored desktop 8.2 and mobile 7.2. It identified tiny core text, a long stacked mobile book, repetitive mobile introductions, and weak chosen-venue continuity. Revisions introduced one-page mobile book tabs, larger menu copy, clearer material lighting, a compact mobile map strip, tastes-first mobile layout, chosen-place summaries, and explicit local agreement. Browser testing also caught and resolved decorative book layers intercepting pointer clicks.

The final independent review judged the demo UI at the **9/10 bar**: coherent cover/page-stack/gutter/curl/contact shadows, consistent editorial identity, usable mobile hierarchy, connected venue state, and clearly labeled simulated agreement. The critic reported no remaining P1 visual issue. This is a subjective UI review, not a production readiness score.

Minor polish remains: small desktop tertiary type, schematic map label cropping, repeated desktop section headings, and opportunities for more detailed map artwork.

## Validation

- Production build and TypeScript: pass.
- Domain tests: **33 pass**.
- Browser tests: **16 pass**, including six desktop/mobile WCAG A/AA automated scans with no violations or suppressed rules.
- Actual pointer clicks, repeated shortlist/veto/undo, exhausted results, guest cancel/Escape/focus, group constraints, local approvals, plan invalidation/reload, clipboard and download, blocked storage, browser Back, low-power and reduced motion are covered.
- Additional layout checks at 320, 620, 768, 1024, and 1920 pixels found no horizontal overflow in Explore, Table, or Plan.
- Fonts reduced from about 1.6 MB to 184 KB including licenses; local photographs total about 1.2 MB. Initial production JS is about 89 KB gzip, CSS about 14 KB gzip. No WebGL or perpetual animation loop.

Automated accessibility scans do not establish full WCAG conformance; assistive technology and real-device testing remain valuable.

## Integration gaps

**Qloo is not connected.** Candidate retrieval/ranking is deterministic local demo logic behind a provider interface. Meaningful Qloo entity retrieval, server-side credentials, source-backed ranking, and real response/failure validation remain.

All restaurants, menus, dietary tags, ratings, walking times, and prices are illustrative. They must be replaced with verified venue information. Confirm ingredients and allergy safety with restaurants.

Guests and approvals are simulations edited by one person. Real invitation delivery, authentication, group permissions, live synchronization, and individual responses need a backend. No booking, invitation, or location sharing occurs.

Sharing currently copies/downloads text; hosted revocable plan links remain unimplemented. The Waiter is contextual deterministic guidance, not a connected language model.
