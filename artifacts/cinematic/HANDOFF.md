# Common Table: the interactive evening room

Current source is on `feat/immersive-common-table`. Work is local; nothing has been pushed publicly or deployed to a public site.

## Experience

- A single original restaurant set connects the real atlas, physical folio, guest place settings, service bell and dinner-plan press. Warm pendant light, wood, olive cloth, brass, paper edges and contact shadows replace the earlier flat framing. The press and taped order sheet sit directly on the workbench.
- The folio has a native Close/Open control, a hinged embossed cover, visible inner board, actual two-sided turning paper, and a physical page corner that selects the next restaurant. Pointer light/depth is optional; touch and keyboard controls perform the same work.
- The table shows the actual people as place settings with porcelain, folded linen, cutlery, glasses and handwritten cards. Adding a guest produces a finite arrival. On mobile, selecting a card or name chip reveals and focuses that person's existing taste editor.
- The original Common Table press saves a valid approved plan immediately, then opens its jaw and feeds the whole current receipt in five short motor steps. Paper and content move together; a stamp marks the same approved plan.
- The finished perforation is a real native control. Click/Enter/Space tears the receipt onto the table. A downward pull resists, a short pull returns, and a longer pull detaches. Escape/touch cancellation preserve attachment. Reprint resets the visual sheet without a second save, download or browser print. Edits and navigation cancel stale presentation and preserve the existing domain rules.
- The geographic map offers a finite Look around camera move. Stop, Escape, direct camera input and navigation cancel it. No location request is made by the camera move.
- Optional sound is off by default. A user gesture enables generated local paper, bell, seat and press cues. There is no ambient loop or network sound dependency. Reduced-motion and low-power settings retain immediate, functional results.

## Reference boundary

After the user explicitly asked to inspect the app code, Kitchen Studio's press UI was reviewed read-only through the connected repository tools. Its opening head, stepped rigid-paper feed, resistant pull and perforation behavior informed this adaptation. No private implementation or assets were copied, imported, stored in this repository, or modified. Common Table's mechanism, rendering, timings, gesture handling and state integration are original web code. This is not a claim of pixel matching the native app.

## Current evidence

- [Real geographic atlas in the room](final/01-real-atlas-room.png)
- [Open physical folio](final/02-open-folio.png)
- [Closed embossed cover](final/03-closed-folio.png)
- [Actual turning paper](final/04-turning-paper.png)
- [Mobile folio](final/05-folio-mobile.png)
- [Table for three](final/06-table-for-three.png)
- [Mobile table](final/07-table-mobile.png)
- [Printed approved plan](final/08-printed-plan.png)
- [Mobile printed plan](final/09-printed-plan-mobile.png)
- [Mobile Waiter](final/10-waiter-mobile.png)
- [Detached current plan](final/11-detached-plan.png)
- [Recorded real interactions](final/interactive-evening.mp4)
- [Live capture results](final/live-capture-results.json)
- [Complete browser report](browser-test-results.json)
- [Independent design review](../../docs/CINEMATIC_DESIGN_REVIEW.md)

The recording performs actual folio, page-corner, guest, lever, reprint and tear actions. It is not a generated animation or edited simulation. Live geographic captures use OpenFreeMap vectors; public raster requests are blocked during automated capture. Automated browser checks use local map fixtures.

## Verification

The final production build and strict frontend/server TypeScript checks pass. **42/42 domain/backend tests and 68/68 browser checks pass**, with zero skips, failures or flakes. The browser suite includes **21 automated WCAG A/AA scans**, including printed and detached receipts on 320px and 390px viewports. These checks supplement manual review and do not establish complete accessibility conformance.

The added interaction coverage verifies immediate persistence, bounded motor motion, repeated saves/reprints, no extra storage/export/browser-print calls, current receipt identity, resisted pull, springback, Escape/native touch cancellation, stale edit/navigation cleanup, detached-sheet clearance, gesture focus, mobile person-editor reveal, camera cancellation, sound opt-in, and motion fallbacks. Existing ranking, veto, budgets/restrictions, local agreement, export and real-location tests remain intact.

## Preview and reproduction

`npm run build` then `npm start` serves the app/API at http://localhost:4173. Development uses `npm run dev -- --port 4174`. With the production preview running, use `node scripts/capture-cinematic.mjs` and `node scripts/record-cinematic.mjs`. The latter produces WebM; convert to MP4 with ffmpeg if desired.

No extra graphics runtime or remote media was introduced. Initial app JavaScript is about 124 KB gzip and app CSS about 43 KB gzip; MapLibre remains a separate lazy chunk at about 304 KB gzip plus its worker. Static room materials and finite/event-driven movement avoid an idle animation loop. These bundle figures and functional checks are not a measured frame-rate guarantee.

## Remaining integrations

Qloo retrieval/ranking, verified real restaurant menus/prices/hours/dietary suitability, real guest invitations/collaboration, bookings and hosted sharing remain separate work. The real map never places the fictional dining-demo restaurants in a user's area. The Waiter remains contextual local guidance. Plan approvals and guest profiles are local simulations; no messages or locations are sent to other people.
