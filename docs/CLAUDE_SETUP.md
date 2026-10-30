# Claude Sonnet 5.5: server preparation and bounded tests

The server adapter, private configuration, mocked tests and explicit smoke-test commands are prepared in Common Table. The existing Waiter UI still uses local guidance; no guessed Kitchen Studio integration or private Kitchen Studio source change has been made. The requested integration target and the meaning of “Startrz credits” need clarification before application wiring.

No real API key, organization preflight or paid generation has been tested. All provider responses used by tests are mocked. No credits have been spent, billing settings changed, top-up requested, public push made or deployment performed.

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

Tests use injected dummy credentials, globally blocked network transport and temporary databases. They cover the exact host/model/account, sanitized failures, UTF-8/body bounds, cancellation, no retries, CLI defaults, and nine independent processes competing for five persistent reservations. Real access or account credit behavior cannot be established from mocks.

Current checks: **30/30 Claude-specific tests and 72/72 total unit/API tests pass**; strict frontend/server TypeScript and the production build pass. A synthetic server-key canary was absent from all scanned browser artifacts. [Verification summary](../artifacts/claude/verification.json), [complete test output](../artifacts/claude/unit-results.tap) and [build output](../artifacts/claude/build-results.txt) are retained. No browser UI changed in this phase, and no new browser integration is claimed.

The implementation has no public HTTP Claude route or browser import. UI wiring is pending the integration-scope answer; paid access is not exposed through the current web preview.

## Primary references

- [Sonnet 5.5 model, rates and supported thinking settings](https://platform.claude.com/docs/en/models/sonnet-5-5/overview)
- [Messages API: request fields, version and authentication](https://platform.claude.com/docs/en/api/messages/create)
- [Authenticated organization lookup](https://platform.claude.com/docs/en/api/http/beta/organization/retrieve)
- [Provider credits and auto-reload](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage)
