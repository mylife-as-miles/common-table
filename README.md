# Common Table

An immersive restaurant discovery and dinner-planning app: real geography, a tactile menu book, a shared table and a printable dinner plan. Sample Brooklyn venues remain clearly labelled. The same venue and plan state connects the views.

## Run locally

Requires Node 24.5+.

```sh
npm ci
npm run dev -- --port 4174
```

This repository uses Vinext with Cloudflare Workers and D1, matching the published Sites app. Local sign-in is a development fixture; it does not establish production identity. See the starter's local migration commands in `scripts` and generated schema in `drizzle/`. Apply pending migrations once to the same local D1 persistence directory before testing collaboration.

For a hosted release, commit and push the source, build it, then run `node scripts/package-release.mjs /absolute/path/release.tar`. The archive must include the root `drizzle/` SQL and journal as well as the Worker, client assets and hosting metadata. Verify the deployed database tables after publication; a successful Worker upload alone does not verify schema readiness.

```sh
npm test
npm run typecheck:app
npm run build
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4174 npm run test:e2e
```

## Runtime configuration

Provider keys are **server secrets**. Enter them in the Site's runtime environment-variable settings, marked secret, and redeploy. For local work use an ignored `.dev.vars` file. Never put a key in chat, source control, browser settings, IndexedDB or a `VITE_*` variable.

| Secret | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Live Waiter guidance |
| `QLOO_API_KEY` | Real restaurant retrieval and ranking |
| `APP_OWNER_EMAIL` | Site owner permitted to enable and test paid guidance |

The live Waiter uses `claude-sonnet-5-5`. It verifies the authorized Startrz organization and model before a paid request. An authenticated owner enables the one-time test allowance. Its persistent D1 ledger reserves five cents per attempt, up to 100 attempts and a hard total of $5. Reservations are never refunded after failed or uncertain network outcomes; there is no retry, top-up or automatic reload. A durable initialization marker prevents a missing ledger from silently reopening the allowance. The browser never receives provider credentials or model metadata. Configuration alone is not evidence of a successful live request.

Qloo discovery is an explicit authenticated action. It uses the group's tastes, lowest budget tier, geography and vetoes, preserves provider candidate order, and returns real venue coordinates. Missing menus, exact costs and dietary guarantees remain unknown and require acknowledgement. There is no silent sample fallback after service failures. Persistent daily request limits bound discovery across Worker instances.

Weather uses a real keyless Open-Meteo forecast with coarse coordinates, local timezone, dinner date/hour, bounded caching and explicit stale/unavailable states. Device GPS remains session-only unless a user explicitly bookmarks a place. Legal source attribution is linked from the product.

## Shared tables and invitations

Sites supplies authenticated identity. Server-side membership checks protect every table read and write. Each member edits and approves their own seat. Hosts control the plan and private single-use seven-day invitation links. The database stores invitation hashes, never the raw link token. Links are created only by an explicit host action; no email is claimed or sent.

Content changes invalidate previous approvals. Version checks and idempotency keys protect concurrent updates. Visible tabs poll with ETags; offline changes stay in separate IndexedDB drafts and require explicit retry/review. Every member must approve the current plan before the host can save it.

IndexedDB stores local plans, preferences, venue snapshots, searched areas, bookmarked points, settings and per-account shared-table drafts. Migration preserves existing browser data, hydration replays early edits, and unavailable/quota-limited storage degrades honestly to session memory. GPS and credentials are excluded. Cross-tab conflicts require an explicit choice.

## Reservations

The app offers a venue's published booking page or website as an explicit external handoff. The user completes and confirms the reservation with the restaurant. **An in-app confirmed reservation is not implemented**: it requires an authorized reservation-provider account, availability integration and booking transaction. No booking is fabricated, and saved plans are not reservations.

## Verification boundaries

Mocked provider tests verify transport, privacy, cancellation, spending limits and failures; they do not prove a live AI or discovery credential works. Local multi-user service fixtures verify collaboration authorization and concurrency; they do not replace a two-person production sign-in test. Weather has a separate limited live smoke. Reports under `artifacts/` distinguish live evidence from fixtures and list remaining activation gaps.

The old standalone Node transport is retained for compatibility tests and is not the published app's handler. Its separate test ledger is not used for web generation. No private Kitchen Studio source was copied or modified.
