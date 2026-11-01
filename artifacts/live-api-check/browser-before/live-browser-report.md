# Deployed Common Table browser baseline

Target: https://common-table-design-20261029.myles4miles.chatgpt.site (version11 per deployment handoff).
Observed: 2026-11-01T21:55:44.668Z to 2026-11-01T21:56:15.062Z.

Chromium used the inherited HTTPS proxy with TLS verification enabled. No API responses were mocked. Only automated OpenStreetMap raster tile requests were blocked; the actual desktop vector map loaded successfully. Desktop transport latency was temporarily increased to exercise native cancellation and duplicate submission, with actual HTTP responses retained.

## Observations

- Both desktop and mobile completed menu choice, synthetic demo guest creation, $40 budget plus Vegan/Gluten-free filtering to Casa Nopal, simulated approvals, local save/press, visual tear/reprint, reload, explicit text export, back/focus, and edit/reapproval/resave.
- Desktop real map rendered with MapLibre and12 visible mapped points. Selecting a real mapped point opened its field notes.20 actual OpenFreeMap responses were observed, all successful; no city search or device geolocation was requested.
- Actual Waiter status and reply returned200 with mode/source mock on both viewports. The generic offline badge appeared; repeated desktop Enter sent one POST. Native Cancel restored input focus and produced one expected aborted request.
- Saved plan persistence is browser-local. Exports contain only synthetic demo data. No invitations, bookings, messages to others, or location sharing were performed.

## Current defect

After reloading #plan, opening Tonight in The Waiter and explicitly submitting Thoughtful guidance sends view:"plan" with mode:"real", planVenueId:"casa" and planSaved:true. The actual mock reply discusses the real map and omits the saved Casa Nopal plan. Reproduced on desktop and mobile. Local tips were not submitted in this reproduction.

Question: "What should we check in this fictional dinner plan?"

```json
{
  "view": "plan",
  "mode": "real",
  "venueId": "casa",
  "participantCount": 2,
  "budget": 40,
  "restrictions": [
    "Vegan",
    "Gluten-free"
  ],
  "planVenueId": "casa",
  "planSaved": true
}
```

Actual reply:

Offline demo · sample guidance.

The real map shows OpenStreetMap places, but their menus, prices, hours and dietary suitability are not verified here. Open a mapped place to inspect its available details. Your fictional demo table and dinner plan stay separate.

## Counts and evidence

- 22 step checks passed;2 failed checks are the same context defect in two viewports.
- 0 page errors,0 failed site/asset responses,0 browser provider requests.
- desktop-dinner-plan.txt and mobile-dinner-plan.txt are actual explicit browser downloads.
- results.json and per-viewport JSON preserve actual endpoint statuses and asset observations; screenshots include map, book, table, saved/pressed paper, torn paper, reload and the failing Waiter response.

## Limits

City search was not queried by this script because the parent API verifier was testing it. Parent separately observed production geocode503/upstream521; see its API report. Qloo, a live model, real invitations/consent, shared server-side plans, real restaurant availability, bookings and device-location permissions were not verified. Mock guidance is an offline sample, not a paid model integration. This baseline is not a full-production readiness claim.

Reproduce with `node /workspace/scratch/common-table-live-browser/check-live.mjs` using existing Playwright dependencies and inherited HTTPS_PROXY. No repository files are changed.
