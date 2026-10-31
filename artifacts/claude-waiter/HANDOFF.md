# Waiter server integration: offline verification

The Common Table browser now exercises a server-owned, mock-only Waiter adapter. The existing local intent actions remain the default. Selecting Claude explicitly displays its offline status before submission and stamps the answer **OFFLINE DEMO · CLAUDE NOT CALLED**. Answers never mutate venue, table or plan state.

The live Sonnet 5.5 adapter remains separately accessible only through the explicit server CLI smoke test and its persistent five-attempt/$5 guard. Live browser requests are blocked, including when the server is configured in live mode. No live key, organization preflight, generation or billing behavior was tested. **Credits spent: $0.**

No real credential was copied into the workspace or used during this phase. Enter credentials only in the ignored, owner-only `.env.local` or a server secret store. The configured account, existing Startrz credits and auto-reload status still need verification before a bounded live test. No top-up, billing change, public push or deployment was performed.

## Actual browser captures

- [Desktop reply](01-desktop.png)
- [Mobile reply](02-mobile.png)
- [Mobile request and keyboard exit](03-mobile-request-and-exit.png)
- [HTTP/source/error/focus capture results](capture-results.json)

Run `node scripts/capture-claude-waiter.mjs` against the local dev server on port 4174, or set `PREVIEW_URL` to a local preview. Final captures use the rebuilt production preview on port 4173 and actual offline HTTP responses, without a substituted browser response. Both viewports returned HTTP 200, source `mock` and no browser errors. The mobile footer exit returned focus to its opener.

## Independent review

The design critic reviewed the actual desktop and mobile captures. The offline source was clear, the existing paper character was preserved and the mobile form remained readable. The review found the original top close control scrolled out of reach when reading a long answer; a 44px footer exit resolved it. The final keyboard capture shows the focus ring and the capture checks focus return. No remaining material visual issue was found. This review did not evaluate live Claude behavior or establish an AAA/9-out-of-10 benchmark.

Remaining product integrations include live Claude browser authentication/session protection, verified provider access and billing, Qloo retrieval/ranking, verified restaurant data and real shared invitations. Kitchen Studio source was neither changed nor copied.

## Verification

- 87/87 unit/API tests pass, including 30 Claude tests and 15 Waiter HTTP tests: [TAP output](unit-results.tap).
- 8/8 focused Waiter browser cases pass: [focused report](targeted-browser-results.json).
- Full 86/86 browser suite passes against the production preview, with 0 failures, flaky tests or skips: [full browser report](browser-results.json).
- Strict frontend/server TypeScript and production build pass: [build output](build-results.txt).
- Synthetic server-key canary absent from all 15 scanned browser artifacts: [verification summary](verification.json).

The HTTP tests found and protected a connection regression: early rejection of an incomplete oversized upload now closes that connection, so a later request cannot be consumed as the unfinished body. The same-agent follow-up valid request succeeds, and chunked UTF-8 overflow receives a bounded 413 response. Browser tests check repeated Enter, cancellation, closing/context changes, late replies, aggregate-only context, literal HTML rendering, safe errors, disabled fallback and desktop/mobile accessibility.
