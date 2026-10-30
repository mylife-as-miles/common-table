# Claude Sonnet 5.5: Waiter adapter and bounded tests

Common Table's Waiter now has local tips and an optional Claude service option connected to a server adapter. The browser path currently returns clearly labelled, contextual **offline demo answers**. It never calls Claude, even when the server is configured for live CLI testing. No Kitchen Studio source has been modified or copied.

No real API key, organization preflight or paid generation has been tested. All provider responses used by tests are mocked. No credits have been spent, billing settings changed, top-up requested, public push made or deployment performed. Revoke any key disclosed in chat and configure its replacement through the private editor or secret store.

## Waiter browser flow

Open The Waiter, select **Claude · offline demo**, enter a small request and submit. A source stamp explicitly says **OFFLINE DEMO · CLAUDE NOT CALLED**. Local tips keep the existing deterministic actions; generated/sample answers never dispatch venue, table or plan changes.

`GET /api/waiter/status` reports only availability. `POST /api/waiter/reply` requires same-origin JSON with a custom request header and a bounded, allowlisted context. The browser supplies the selected fictional venue ID, seat count, minimum budget, listed dietary needs, pad view and whether the plan was saved. Guest names, real map names/coordinates, plan notes and dates are excluded from that context. Free text remains user supplied, so do not include secrets in a question.

The server constructs its own trusted guidance. Caller-supplied prompts, endpoints, keys, models and extra fields are rejected. Replies render as plain text. Duplicate submissions are locked; cancellation, closing, navigation or a changed venue/table/plan invalidate pending replies. Requests are not automatically retried and no reply changes the plan.

**Paid browser access is blocked in this test phase.** A live server configuration reports the browser service as disabled and rejects a browser generation request before creating a client or spending a reservation. The CLI commands below are the only live-test path. Removing that block requires a separately tested session/authentication design, not a public environment toggle.

## Enter the key securely

Use the cloud environment's server secret configuration for `ANTHROPIC_API_KEY`, or open the already prepared **`.env.local` in the workspace editor** and fill that one value. Never paste a key into chat, an issue, a source file, a screenshot or a command argument. Keep `ANTHROPIC_MODE=mock` while preparing the integration.

The local file has mode `0600` (owner read/write only), is ignored by Git and is excluded from Git-based handoff archives. `.env.example` contains empty placeholders only. In a new checkout, create an owner-only `.env.local` from that example without overwriting existing secrets. Do not use any `VITE_*` secret name; those are browser-facing variables.

Use a normal workspace-scoped API key from the **Startrz Anthropic organization**, not an admin key or a personal billing account. Optionally set `ANTHROPIC_EXPECTED_ORG_ID` to the non-secret organization ID for an additional exact match. The adapter checks the authenticated organization and exact model before generation. The authorized organization name is Startrz; another account fails closed.

If Startrz is a separate API gateway, provide its public documentation first. Alternate endpoints are deliberately rejected; the key is sent only to `https://api.anthropic.com`. A gateway's authentication, pricing and credit rules have not been established.

Before any live run, verify in the correct provider account that the existing credits are available and auto-reload is disabled. A local adapter cannot inspect or change all provider billing settings. The user's authorization is already recorded as up to $5 of existing Startrz credits; another approval to spend within that limit is not needed, but the correct account and billing facts must be established.

## Commands

```sh
npm run claude:check
npm run test:claude
npm run claude:smoke
```

`claude:check` prints presence/status only, never the key. The default smoke test is offline, even if a live mode or key is present. The npm smoke command always runs the mocked suite first.

With the correct key securely configured, this explicitly performs only read-only provider verification:

```sh
npm run claude:smoke -- --preflight
```

Only after the account/credit facts above are verified, an approved bounded live smoke test is:

```sh
ANTHROPIC_MODE=live npm run claude:smoke -- --live
```

This requests one fixed test marker using synthetic text, with no personal data, tools, invitations, bookings or location sharing. It reports semantic success, model, token usage and estimated cost; it never prints the model's raw reply or secret. Errors are sanitized and never automatically retried. A truncated/unexpected reply is a failed test, not a reason to retry automatically or substitute another model.

## Spend guard

- Model is pinned to `claude-sonnet-5-5`; API version is `2026-10-21`.
- At most 16 KiB of plain text and 512 generated tokens per request; low effort, `between_tools` thinking and standard-only service. No tools, images, prompt caching, fast mode or model fallback are requested.
- A fixed $5 local allowance reserves **$1 before each generation attempt**, conservatively allowing at most five attempts. Successful token cost is normally much lower; reservations are not presented as actual spend.
- Reservations persist across processes/restarts in `.local/claude-budget.sqlite`. Errors, aborts, timeouts and uncertain outcomes never refund them. An initialized marker, schema checks and atomic transactions make missing/corrupt state fail closed.
- **Never delete the ledger, its marker, lock or SQLite companion files to refresh the allowance.** There is no automatic reset, top-up or auto-reload command.
- This bounds this adapter's local test attempts. It does not control other users' activity, provider account policy or a separate gateway's pricing. A provider workspace spend limit is an additional protection when available.

The ledger stores counters/attempt metadata, not keys, prompts or replies. The entire `.local/` directory is ignored by Git. The model's published standard rates used for usage estimates are $2 per million input tokens and $10 per million output tokens; billed charges and credit balances must still be checked with the provider.

## Test and security evidence

Tests use injected dummy credentials, blocked external transport, loopback HTTP fixtures and temporary databases. They cover the exact host/model/account, sanitized failures, UTF-8/body bounds, cancellation, no retries, CLI defaults, and nine independent processes competing for five persistent reservations. Waiter HTTP tests also cover origin/CSRF validation, paid-web blocking, catalogue consistency, oversized and incomplete uploads, rate limits and disconnects. An early-error keep-alive issue found by the independent tests was fixed by closing incomplete request connections; a later valid request succeeds. Real access or account credit behavior cannot be established from mocks.

Current checks: **30/30 Claude-specific tests, 15/15 Waiter HTTP tests and 87/87 total unit/API tests pass**; strict frontend/server TypeScript and the production build pass. The full **86/86 browser suite passes with no failures, skips or flaky tests**, including the 8 new Waiter cases: duplicate submissions, cancellation, stale replies, privacy, plain-text rendering, disabled fallback, mobile focus return and desktop/mobile accessibility scans. A synthetic server-key canary was absent from all 15 scanned browser artifacts. [Verification summary](../artifacts/claude-waiter/verification.json), [complete unit/API output](../artifacts/claude-waiter/unit-results.tap), [browser report](../artifacts/claude-waiter/browser-results.json), [build output](../artifacts/claude-waiter/build-results.txt) and [screenshots/review](../artifacts/claude-waiter/HANDOFF.md) are retained.

The browser imports no provider client, key, server configuration or ledger. The mock-only Waiter HTTP route works in Vite and the local production server. Paid access is not exposed through the current web preview.

## Primary references

- [Sonnet 5.5 model, rates and supported thinking settings](https://platform.claude.com/docs/en/models/sonnet-5-5/overview)
- [Messages API: request fields, version and authentication](https://platform.claude.com/docs/en/api/messages/create)
- [Authenticated organization lookup](https://platform.claude.com/docs/en/api/http/beta/organization/retrieve)
- [Provider credits and auto-reload](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage)
