import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

// ACTUAL public deployment only. No fixtures, auth credentials, discovery calls,
// invitations, reservations, budget enablement or valid paid-guidance questions.
// Run: LIVE_APP_URL=https://your-published-site node --use-env-proxy scripts/verify-live-apis.mjs --services
// Modes: --mapping (two public city lookups), --waiter (anonymous gates), --services
// (weather + read-only shared-table gates). Missing service configuration is
// reported as not_verified, never passed off as a successful live integration.
const args = process.argv.slice(2);
if (args.length !== 1 || !["--mapping", "--waiter", "--services"].includes(args[0])) {
  console.error("Choose --mapping, --waiter or --services. Run phases sequentially.");
  process.exit(1);
}
const target = new URL(process.env.LIVE_APP_URL || "https://common-table-design-20261029.myles4miles.chatgpt.site");
if (target.protocol !== "https:" || target.username || target.password || target.port || target.pathname !== "/" || target.search || target.hash || !target.hostname.includes(".") || /^(?:[\d.]+|\[.*\])$/.test(target.hostname) || /(?:^|\.)(?:localhost|local|internal)$/.test(target.hostname)) throw new Error("LIVE_APP_URL must be a public HTTPS deployment origin.");
const origin = target.origin, phase = args[0].slice(2);
const OUT = resolve(process.env.LIVE_API_OUTPUT || process.env.LIVE_VERIFICATION_OUTPUT || "artifacts/live-verification/api");
const results = [];
const pause = () => new Promise(resolve => setTimeout(resolve, 1200));
const pass = details => ({ status: "pass", details });
const fail = details => ({ status: "fail", details });
const notVerified = details => ({ status: "not_verified", details });
const code = body => typeof body?.code === "string" ? body.code.slice(0, 70) : null;
async function readBounded(response) {
  if (!response.body) return "";
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 1024 * 1024) { await reader.cancel(); throw new Error("Response exceeds verification size limit."); } chunks.push(item.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder().decode(bytes);
  } finally { reader.releaseLock(); }
}
async function check(name, path, options, classify) {
  const began = performance.now();
  try {
    const response = await fetch(`${origin}${path}`, { ...options, redirect: "manual", signal: AbortSignal.timeout(15_000), credentials: "omit" });
    const text = await readBounded(response); let body = null;
    try { body = JSON.parse(text); } catch { /* HTML application is checked separately. */ }
    const classification = classify(response, body, text);
    const result = { name, method: options.method || "GET", path, httpStatus: response.status, elapsedMs: Math.round(performance.now() - began), ...classification };
    results.push(result); console.log(JSON.stringify(result));
    return { response, body, result };
  } catch {
    const result = { name, method: options.method || "GET", path, status: "fail", details: { reason: "Transport failed, exceeded the size limit or timed out. No retry was made." }, elapsedMs: Math.round(performance.now() - began) };
    results.push(result); console.log(JSON.stringify(result));
    return { body: null, result };
  }
}

await check("Published Common Table application", "/", {}, (response, _body, text) => response.status === 200 && /text\/html/.test(response.headers.get("content-type") || "") && /common table/i.test(text) ? pass({ actualHtml: true }) : fail({ reason: "The public application did not return the expected HTML." }));

if (phase === "mapping") {
  for (const city of ["Paris, France", "Lagos, Nigeria"]) {
    await pause();
    await check(`Actual public city lookup: ${city}`, `/api/geocode?q=${encodeURIComponent(city)}`, {}, (response, body) => {
      if (response.status === 503 && code(body) === "unavailable") return notVerified({ reason: "City search explicitly unavailable.", code: code(body), liveGeocodeVerified: false });
      const valid = response.status === 200 && body?.source === "photon" && Array.isArray(body.results) && body.results.length > 0 && body.results.every(item => typeof item.label === "string" && Number.isFinite(item.latitude) && Math.abs(item.latitude) <= 90 && Number.isFinite(item.longitude) && Math.abs(item.longitude) <= 180);
      return valid ? pass({ liveGeocodeVerified: true, resultCount: body.results.length, firstLabel: body.results[0].label.slice(0, 220) }) : fail({ code: code(body), reason: "No valid live geographic result or honest unavailable response." });
    });
  }
  await check("Invalid city query is rejected", "/api/geocode?q=x", {}, (response, body) => response.status === 400 && code(body) === "invalid_query" ? pass({ rejected: true }) : fail({ code: code(body) }));
} else if (phase === "waiter") {
  const status = await check("Anonymous Waiter availability", "/api/waiter/status", {}, (response, body) => {
    if (response.status === 503) return notVerified({ liveGuidanceVerified: false, reason: "Guidance status explicitly unavailable.", code: code(body) });
    if (response.status !== 200 || !["disabled", "sign_in"].includes(body?.mode) || body?.canEnable !== false) return fail({ mode: body?.mode ?? "unknown", reason: "Anonymous users must not receive enabled live or sample model service." });
    return pass({ mode: body.mode, canEnable: false, liveGuidanceVerified: false, reason: "Anonymous availability is honest; no model call was attempted." });
  });
  // Deliberately INVALID input can never reach a model, even if authentication
  // were regressed. A real successful completion is deliberately not tested.
  await check("Anonymous reply POST cannot invoke guidance", "/api/waiter/reply", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "X-Common-Table-Request": "waiter" }, body: JSON.stringify({ message: "", context: {} }) }, (response, body) => {
    if (response.status === 401 && code(body) === "authentication_required") return pass({ rejectedBeforeModel: true, validModelQuestionSent: false, observedMode: status.body?.mode ?? "unknown", liveGuidanceVerified: false });
    if (response.status === 503 && code(body) === "unavailable") return notVerified({ validModelQuestionSent: false, liveGuidanceVerified: false, reason: "Guidance unavailable; anonymous authorization not independently verified." });
    return fail({ code: code(body), reason: "Expected anonymous authentication rejection. The deliberately invalid request is incapable of a paid completion." });
  });
  await check("Guidance origin gate", "/api/waiter/reply", { method: "POST", headers: { Origin: "https://verification.example.invalid", "Content-Type": "application/json", "X-Common-Table-Request": "waiter" }, body: "{}" }, (response, body) => response.status === 403 && code(body) === "origin_rejected" ? pass({ rejected: true }) : fail({ code: code(body) }));
  await check("Guidance GET does not submit a question", "/api/waiter/reply", {}, (response, body) => response.status === 405 && code(body) === "method_not_allowed" ? pass({ rejected: true }) : fail({ code: code(body) }));
  results.push({ name: "Live guidance completion", status: "not_verified", details: { observedMode: status.body?.mode ?? "unavailable", liveGuidanceVerified: false, reason: "No valid model question or guidance enablement was submitted." } });
} else {
  const date = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  await check("Actual current and dinner weather", `/api/weather?latitude=40.692&longitude=-73.977&date=${date}&hour=19`, {}, (response, body) => {
    if ([429, 503, 504].includes(response.status) && ["unavailable", "timeout", "rate_limited", "busy"].includes(code(body))) return notVerified({ liveWeatherVerified: false, honestUnavailable: true, code: code(body) });
    const condition = value => value && typeof value.time === "string" && Number.isFinite(value.temperatureC) && value.temperatureC >= -100 && value.temperatureC <= 75 && Number.isFinite(value.weatherCode) && (typeof value.isDay === "boolean" || value.isDay === null);
    const valid = response.status === 200 && body?.status === "ok" && body?.area?.latitude === 40.69 && body?.area?.longitude === -73.98 && body?.requested?.date === date && body.requested.hour === 19 && typeof body.timezone === "string" && typeof body.stale === "boolean" && Number.isFinite(Date.parse(body.fetchedAt)) && Date.parse(body.staleUntil) > Date.now() && condition(body.current) && ["forecast", "unavailable", "outside_forecast", "past"].includes(body.dinnerStatus) && (body.dinnerStatus === "forecast" ? condition(body.dinner) && body.dinner.time === `${date}T19:00` : body.dinner === null);
    const details = valid ? { liveWeatherVerified: !body.stale, cachedWeatherOnly: body.stale, dinnerForecastVerified: !body.stale && body.dinnerStatus === "forecast", dinnerStatus: body.dinnerStatus, timezone: body.timezone, currentTemperatureC: body.current.temperatureC } : null;
    return details ? body.stale ? notVerified(details) : pass(details) : fail({ code: code(body), reason: "Weather response is neither a validated actual report nor explicit unavailability." });
  });
  await check("Weather rejects an invalid location", "/api/weather?latitude=91&longitude=0&date=2026-02-30&hour=25", {}, (response, body) => response.status === 400 && code(body) === "invalid_query" ? pass({ rejectedBeforeWeatherFetch: true }) : fail({ code: code(body) }));
  await check("Anonymous shared-table session", "/api/shared-tables/session", {}, (response, body) => response.status === 200 && body?.identity === null && typeof body.available === "boolean" ? pass({ anonymous: true, databaseBindingReportedAvailable: body.available, liveSharedMutationsVerified: false }) : fail({ reason: "Expected a public anonymous session without identity details." }));
  await check("Anonymous shared-table list is private", "/api/shared-tables", {}, (response, body) => response.status === 401 && code(body) === "authentication_required" ? pass({ anonymousReadRejected: true }) : fail({ code: code(body), reason: "Private table lists must reject anonymous users." }));
  const forged = { "oai-authenticated-user-id": "verification-forged-not-a-user", "oai-authenticated-user-email": "verification-not-a-user@example.invalid", "oai-authenticated-user-full-name": "Verification%20Canary", "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8" };
  await check("Public ingress ignores forged reserved identity headers", "/api/shared-tables/session", { headers: forged }, (response, body) => response.status === 200 && body?.identity === null ? pass({ forgedIdentityIgnored: true, trustedEdgeBoundaryOnly: true }) : fail({ forgedIdentityIgnored: false, reason: "Reserved client headers must not become authenticated identity." }));
  await check("Forged identity cannot read shared tables", "/api/shared-tables", { headers: forged }, (response, body) => response.status === 401 && code(body) === "authentication_required" ? pass({ forgedReadRejected: true }) : fail({ code: code(body) }));
  results.push({ name: "Live restaurant ranking, authenticated invitations and reservations", status: "not_verified", details: { reason: "No paid discovery, authenticated table mutation, invitation creation or reservation was attempted.", paidDiscoveryVerified: false, liveSharedMutationsVerified: false, reservationVerified: false } });
}
await check("Unknown service route is rejected", "/api/live-verification-not-a-route", {}, (response, body) => response.status === 404 && code(body) === "not_found" ? pass({ rejected: true }) : fail({ code: code(body) }));
const report = { origin, phase, checkedAt: new Date().toISOString(), historicalDefaultTargetUsed: !process.env.LIVE_APP_URL, requestsMocked: false, credentialsUsed: false, paidProviderCalls: 0, validGuidanceQuestionsSent: 0, sharedWrites: 0, invitationsCreated: 0, reservationRequests: 0, summary: { passed: results.filter(item => item.status === "pass").length, failed: results.filter(item => item.status === "fail").length, notVerified: results.filter(item => item.status === "not_verified").length }, results };
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, `${phase}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: join(OUT, `${phase}.json`), ...report.summary }));
if (report.summary.failed) process.exitCode = 1;
