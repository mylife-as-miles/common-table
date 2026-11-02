# Live Waiter service

`handleGuidance(request, options)` is the Worker-safe service used by the request-scoped dispatcher. It uses only Web APIs and the supplied D1 binding; it does not import the older Node/SQLite transport. All verification tests use injected mocked fetch responses. No live provider request or account-credit check has been performed in this implementation.

## Secure setup

Enter secrets only in the site's server-side secret/environment settings:

- `ANTHROPIC_API_KEY`: a valid key for the already authorized Startrz organization.
- `APP_OWNER_EMAIL`: the exact email of the authenticated owner allowed to use the bounded test allowance.
- `QLOO_API_KEY`: required when the question references a real discovered restaurant, so its facts can be re-resolved on the server.

Apply the generated D1 migrations through `0004` before enabling guidance. Never use browser-prefixed environment variables, paste keys into chat, write keys into source or IndexedDB, or pass secrets through the client. The authenticated wrapper supplies `identity`; request JSON and headers cannot choose an identity or owner.

The current application routes supply these options:

```ts
handleGuidance(request, {
  apiKey, db,
  identity: { userId, displayName, email }, // or null
  ownerEmail,
  qlooApiKey,
  fetcher, // optional test/server transport
});
```

## Status and explicit enable

`GET /api/waiter/status` makes no provider call. Missing server configuration returns `{mode:'disabled',canEnable:false}`. An anonymous viewer of a configured service gets `sign_in`; a different signed-in account gets `disabled`. Only the configured owner can receive `live` or `canEnable:true`.

The owner's **Enable guidance** action sends `POST /api/waiter/enable` with JSON `{}`, the same public Origin and `X-Common-Table-Request: waiter`. It atomically writes a durable initialization marker and the original fixed allowance. Setup does not call a provider or generate text. Repeating setup does not refill any spending. A missing/inconsistent initialized ledger fails closed, including if a row is deleted; neither status nor reply repairs it.

## Bounded requests and credit guard

The fixed `global-test-v1` allowance is 500 cents, with an irrevocable five-cent reservation for each paid attempt, capped at 100 attempts across owners, requests and application restarts. Each reservation and receipt is one guarded D1 batch. Failed, rejected, timed-out and cancelled paid attempts are never released. There is no refill, auto-reload, model fallback or automatic paid retry.

Before every paid request, the service verifies the normalized organization name against `Startrz` using `GET https://api.anthropic.com/v1/organizations/me`, and verifies the exact authorized model using `GET /v1/models/claude-sonnet-5-5`. A mismatch never reaches generation or reserves paid credit. Requests use Bearer authentication and version `2026-10-21`.

Generation is fixed to `claude-sonnet-5-5`, 512 output tokens, `standard_only`, `thinking:{type:'between_tools'}`, and low effort. User text plus the complete server system context is limited to 16 KiB. There are no tools. Requests use manual redirect handling with non-success rejection, a ten-second overall transport timeout, strict response parsing, and a 64 KiB response cap. Reported usage must fit the output limit and the five-cent reservation at the authorized model's configured token rates. No real billing reconciliation or available-credit claim is made by these mocked tests.

## Context and privacy

`POST /api/waiter/reply` accepts `{message,context}`. The browser summary allows only the current view/mode, canonical venue IDs, aggregate tastes/budget/restrictions/count, reported plan state and optional `tableId`. Unknown fields, names, coordinates, client prompts and arbitrary venue snapshots are rejected. JSON bodies are bounded to 4 KiB and streamed reads support cancellation.

A shared table ID requires authenticated membership before any provider call. Preferences, member count, approval count and plan state are then derived from D1. The model receives aggregate preferences and minimal trusted public restaurant facts. It receives no member names, user IDs, email, table title, invite tokens, plan note, map query, neighborhood, coordinates or restaurant website. The user's explicitly typed question is forwarded as user text, with the authenticated person's exact known display name/email removed if pasted into it.

Sample venues are explicitly fictional. Real venue facts are re-resolved through the fixed-host restaurant provider client. Menus, exact prices, travel times, availability and allergy safety are never invented. The companion can suggest controls; it cannot book, send invitations, share location, approve or mutate app state.

Only text blocks are returned; thinking blocks are discarded, unsupported tools are rejected, and credential echoes fail closed. Product text removes infrastructure/provider labels. A successful reply is `{source:'live',text}`. Errors contain fixed generic `{code,message}` values with no upstream body, key, private account detail or model name.

## Verification

`node --import tsx --test tests/guidance*.test.ts` covers owner authorization, explicit one-time setup, the full fixed allowance, marker/no-refill behavior, preflight order, request limits, paid failures, timeouts/cancellation, malformed output, key echoes, thinking suppression, private shared-state aggregation and trusted real-venue context. Network access is replaced by mocked transports in every test.

Production readiness still requires securely configured secrets, authenticated owner email, applied D1 schema, explicit setup and a separately authorized live end-to-end request. Until those are present, the service honestly remains disabled.
