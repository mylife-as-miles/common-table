# Cinematic Common Table: independent design direction

The requested elevation should come from a coherent restaurant workbench, substantial physical objects, readable lighting and mechanisms that perform useful work. It should remain quick to use. The direction below was proposed before implementation; observed review evidence is recorded at the end.

## Reference evidence and limits

- The initial public search did not identify the intended **Kitchen Studio printing press** confidently; those results were unrelated kitchen businesses and cooking demos. The user subsequently authorized inspection of the app's code. The root agent performed a read-only reference inspection and reported these observed behaviors: the compact head opens, the motor advances a rigid sheet and its content together with short grips/pauses, and a resistant pull can tear at a perforation while an incomplete pull returns. This supplies behavioral reference evidence; the independent critic did not conduct that private-code inspection. No private snippets, repository URLs, assets or implementation constants are reproduced here. Common Table's press remains an original implementation, and the reference repository was not modified.
- [Lusion: My Little Storybook](https://lusion.co/projects/my_little_story_book/) describes original 3D assets combined with hand-drawn material in a cinematic WebGL world. Relevant principle: one authored visual world connects the book and its surroundings. Do not copy its assets or imply it was tested hands-on.
- [Choo-Choo World](https://choochooworld.com/), produced by [Lusion](https://lusion.co/projects/choo_choo_world/), documents camera controls, editor/viewer modes and playback controls that start, stop and return the actual train. Relevant principle: a recognizable mechanism acts on the object the visitor is already manipulating.
- [Bruno Simon's portfolio](https://bruno-simon.com/) documents direct world interaction, camera input, quality controls and recovery actions. Relevant principle: consistent spatial scale and interaction, with an accessible way to recover or reduce effects. A restaurant planning app should not inherit driving, achievements or game HUDs.
- [Halftones case study](https://adamculpepper.net/projects/halftones) documents controls that change the actual print output and export. Relevant principle: printing is a consequential transformation, rather than an unrelated machine animation. This is a process reference, not the unidentified Kitchen Studio reference.

These findings come from public pages and documented controls. They do not establish a hands-on evaluation of every reference's rendering, motion or device performance.

The later Kitchen Studio behavior evidence is separately attributed above to the user's authorized read-only inspection. It does not change the limits of the public web research or authorize copying private implementation material.

## One evening workbench

The atlas, restaurant book, guest place cards and dinner receipt belong to the same work surface. Use a dark walnut or espresso base, cream paper, restrained olive cloth, brass mechanisms and terracotta selection accents. A warm upper-left key light should produce coherent edge highlights, gutter shading and contact shadows. Keep useful writing light and legible.

The primary object should occupy most of the working area. Navigation chooses an object to inspect; a brief camera/object movement explains the change. Supporting objects remain recognizable origins or destinations without becoming competing miniature dashboards. The real OSM map and fictional dining demo must retain their explicit source boundary.

## Priorities

1. **Stage and hierarchy:** reduce repeated headlines and large outer panels. Show the workbench and one substantial object rather than adding more ornament around the existing layout.
2. **Object continuity:** the chosen real place remains identical across its map token, field notes and Waiter. The fictional selected restaurant remains identical across its book, table and plan. Preserve state when moving between objects or back through browser history.
3. **Physical actions:** page turning reveals the next restaurant; selecting a place setting edits that person's actual tastes; a press handle produces the current approved dinner receipt. Motion should explain those changes.
4. **Receipt press:** include a legible input tray, rollers/platen, handle and output paper. A valid action saves the real current plan and presents its actual venue, date, time, people and note. Validation stays beside the mechanism. Repeated actions remain safe; an edit must invalidate or visibly supersede the previous output. Download and browser printing require their own explicit actions.
5. **Cinematic restraint:** use finite anticipation, contact, feed and settle motion. Avoid continuous camera drift, decorative particles, blinking badges, invented game counters or mandatory travel sequences.
6. **Mobile and fallbacks:** use one focused object with accessible controls. Retain touch scrolling, visible attribution, keyboard operation and focus restoration. Reduced-motion and low-power views show the same results with immediate or minimal transitions.

## Material failure risks

- A dark global color change can reduce readability without creating any actual sense of space.
- A larger book or press inside another flat beige card does not establish a shared physical world.
- Separate perspective angles or incompatible shadows make the atlas, book and press look pasted together.
- A beautiful press that prints stale details, saves an invalid plan or bypasses agreement fails the central interaction.
- Overlong transitions, gesture-only handles or decorative hit areas can make repeated use frustrating.
- Real map POIs must never gain invented menus, budgets, dietary fit or Qloo ranking because the new world looks more convincing.

## Independent review evidence required

Review actual desktop and mobile captures of the map, open book, shared table and press before/after saving. Include the same selected venue across those states. Inspect a real press cycle or recorded intermediate frames, not only its resting image. Verify repeated press actions, draft edits, invalid schedules, agreement changes, Back/Escape, keyboard focus, reduced motion and low-power behavior. No previous numeric design score carries into this revision.

## Observed review evidence

- The early book/shell review found real horizontal overflow: an independent Chromium inspection measured a 1505px document at a 1440px viewport and 412px at a 390px viewport. Decorative folio light and mobile navigation were implicated. Implementers subsequently constrained those layers; the final regression run owns the authoritative checks.
- Initial mobile room joinery crossed the main headline. The root implementation removed the top trim and faded the table plane beneath the intro.
- The initial plan page still framed the press and details as a large dashboard panel. The root implementation removed the outer panel and repeated section headline so the original machine, actual receipt and taped details sheet could occupy the work surface.
- Actual `press-cycle-early.png` and `press-cycle-late.png` show different machine/paper states and the delayed stamp on a dedicated paper stub. The stub does not cover receipt content. A discoverable lever instruction was added after review.
- Verified live book frames revealed that opacity animation flattened the 3D faces. The implementer corrected the hinge/face rendering. The inspected `book-leaf-reverse-v5.png` shows the current venue's photograph/story in readable orientation; `book-cover-reverse-v5.png` shows the inner board. Earlier diagnostic frames are not final evidence.
- Resting machine/book screenshots alone were not treated as evidence of working motion. Full-scene final captures and final interaction/accessibility results still determine handoff readiness; no numerical score is inherited from an earlier revision.
- After the user-authorized reference inspection, press behavior was revised toward a finite head/feed/grip sequence and a separate resistant pull/tear interaction with a keyboard alternative. These changes require fresh cycle and partial-pull evidence; earlier press frames do not establish the later behavior's correctness.
- Fresh jaw/feed/torn captures show the revised mechanism and the same receipt content. An independent Chromium interaction with the revised dev build selected a venue, approved and saved the plan, then detached the paper through its button action. The detached live sheet ended 119px above the status text in that desktop check, resolving the overlap seen in an earlier diagnostic capture. The implementer's separate short-pull, pointer-cancel, keyboard and reprint checks remain attributed test evidence.

## Final handoff review

The fresh production captures in `artifacts/cinematic/final/` were reviewed independently after the later press and mobile fixes. The mobile folio's earlier transient band is absent. The open folio, table for three, saved receipt and detached receipt consistently show Sunday People. The press and taped editor sit directly in the restaurant set, and the detached paper has visible separation and clear space above its status controls. No material visual issue was found in those final captures.

Sampled frames from the actual 17.88-second `interactive-evening.mp4` recording show the folio close/open sequence, changed restaurant, guest placement, finite paper-feed stages and attached/detached paper states. This is recorded interaction evidence rather than a rendered promotional mockup. The final browser report records 68 passes, no failures, no skips and no flakes; root also reports 21 full-page accessibility scans, 42 domain/API tests and a passing production build.

This review does not claim an AAA-game rendering benchmark or production restaurant integrations. It assesses the authored web experience and its demonstrated mechanisms. Qloo, live shared invitations and verified real restaurant menus remain outside the current demo's claims.

## Later fidelity revision: Proofline, table materials and a visible tear

The user rejected the preceding flip fidelity and requested a more realistic dining table. The earlier handoff establishes functional stability and legible resting layouts; it does **not** establish that the book matches Proofline or that the table meets this later material-realism requirement. The old `04-turning-paper.png` is effectively a settled spread and cannot prove a flexible page turn. This revision requires new evidence and carries forward no numeric score.

The user-owned Proofline reference was inspected read-only at `/workspace/reference-proofline`. Its flip component uses `react-pageflip` with soft leaves, pointer interaction, corner preview, swipe support and dynamic turn shadows. The existing Common Table implementation instead commits the next venue and rotates a separate rigid rectangular overlay. Its mobile rotation stops short of crossing the gutter and then hides; the underlying venue photograph also fades independently. Those are structural differences, not deficiencies that additional grain or a longer easing curve will resolve. Proofline's text, page contents and styling need not be copied to use the same publicly available flip engine.

The first priority is continuous, pointer-controlled fold geometry: hold a real corner at roughly 30–60% progress and verify the fold, visible front/back print, changing shadow and uncovered next leaf together. A short drag must return to the same venue; a completed turn must settle to the correct adjacent restaurant. Previous direction, fast repeated actions, closed cover, mobile single-page mode and buttons inside the leaves must remain coherent. Native vertical scrolling and the explicit keyboard controls must remain usable.

The preceding table screenshot still looks like a CSS illustration inside nested panels. Its oval rim, linen, cutlery and glass are mostly planar shapes rather than objects with consistent volume and contact. A materially stronger dining scene needs believable ceramic lips, linen thickness, glass stems/bases, chair scale, candle/brass highlights and shadows from a common light source. The rendered table should be the primary object, with live participant controls accurately projected onto its place cards and a readable supporting preferences sheet. Review one, three and six settings at desktop and mobile sizes. Any pre-rendered Cycles imagery must be described honestly as a rendered asset, distinct from real-time 3D interaction.

The preceding receipt can detach through a resistant pointer pull or a keyboard/click alternative, and its actual content remains together. However, detachment currently releases the whole straight edge at once; the repeated sawtooth border is a static outcome rather than evidence of a progressing tear. The refinement should visibly separate along the perforation, retain a small stub at the machine and settle the same current receipt onto the work surface. Require actual partial-pull/return and intermediate-tear evidence. Tearing must not repeat persistence, export, booking or sharing actions, and the handle must not consume ordinary scrolling on the receipt body.

The first fresh interaction evidence now establishes a real improvement. `artifacts/page-curl/1440-held-v4.png` and `390-held-v4.png` show an actual pointer-held diagonal soft fold, readable reverse print, ridge/contact shadow and part of the next leaf. These supersede the earlier held-v1 capture, which only showed resting paper and accidental native text selection. The new book uses the same underlying StPageFlip soft-leaf solver as Proofline, while retaining Common Table's own content and editorial treatment. The implementer reports completed and cancelled turns separately; the final regression run remains authoritative for their state behavior.

The new tear captures in `artifacts/tear-demo/` show a narrow separation progressing across the perforation with a retained attached region and short fibres, followed by the same receipt settling below the retained stub. Sampled frames from its actual recording also show the interaction, although that diagnostic recording includes viewport changes and is not a clean final presentation clip. The physical handle still has a modest button-like appearance; retaining a readable 44px target is a reasonable accessibility compromise.

The first Cycles table render is substantially more dimensional than the preceding CSS illustration. Independent review caught an early cloth/table intersection that produced brown holes through the runner, along with overly regular orange grain. The corrected four-seat render resolves those material failures. Read-only one-, three- and six-seat geometry diagnostics also show inward-facing chairs and card feet separated from the dishes/glass bases. A corrected live one-seat stage shows the actual DOM name projected onto its rendered paper face at desktop and phone scale. The phone's physically projected type is small, so the existing guest selector and preferences controls remain the readable alternative. The glass still has stylized, high-contrast reflections; this is an original rendered still-life with live controls, not a claim of photoreal or real-time game rendering.

Full-quality live three- and six-seat stages were subsequently reviewed at desktop, 390px and 320px widths. Names and the selected underline fit the actual paper faces, and the cards, dishes and glass bases remain visibly separate. No further material or geometry blocker was found in those stages. The very small phone-scale card names make the separate readable guest selectors particularly important.

## Observed handoff for the fidelity revision

The actual production captures in `artifacts/physical/` were inspected independently, including the held desktop/mobile curl, full mobile book, three-/six-seat scenes, full mobile guest editor, intermediate perforation and detached plan. The initial mobile full-page capture included an off-viewport fixed skip link because it was taken at a nonzero scroll position; ordinary scrolling to the top corrected that capture artifact without hiding the accessible link. The initial desktop table capture also included a transient toast; the clean later capture leaves the table instruction visible.

The refreshed full mobile book is legible and has clear page controls and drag instructions. The full mobile table keeps readable native guest selectors beside the actual preference editor, complementing the small names on the physical cards. The same Sunday People identity continues from the completed turn into the table and saved three-person receipt. The revised desktop press shows separation advancing across the perforation, and the detached sheet clears its controls and status copy.

Sampled frames from the actual combined `book-table-tear.mp4` show the pointer-controlled fold growing from the corner, printed reverse passing across the gutter, the adjacent venue settling, original rendered table settings changing with the guest count, finite paper feed, partial pull/return and full detachment. The recording also contains a capture-induced viewport change around the full-page detached screenshot; it is interaction evidence, not a claim of an edited cinematic trailer.

No material visual or layout blocker remains in the reviewed captures. This is a concrete improvement in the specific behavior the user requested, with no inherited numeric score. The table lighting is baked into original Cycles-rendered assets while names, selection, guest editing and plan state remain live browser controls. It should be described that way; this review makes no photoreal, real-time 3D or AAA-game benchmark claim. The authoritative final browser/accessibility report and domain/API checks are maintained separately by implementation QA.
