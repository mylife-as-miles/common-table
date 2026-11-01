import { mkdir, writeFile } from "node:fs/promises";

// Public, synthetic smoke checks. No credentials or paid provider calls are used.
// Run with Node's --use-env-proxy in the managed workspace.
const origin = "https://common-table-design-20261029.myles4miles.chatgpt.site";
const args = process.argv.slice(2);
if (args.length !== 1 || !["--mapping", "--waiter"].includes(args[0])) {
  console.error("Choose --mapping or --waiter. Run sequentially, without other automated Waiter submissions.");
  process.exit(1);
}
const phase = args[0].slice(2);
const results = [];
const pause = () => new Promise(resolve => setTimeout(resolve, 1200));

async function check(name, path, options, expected, summarize = () => ({})) {
  const start = performance.now();
  try {
    const response = await fetch(`${origin}${path}`, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const raw = await response.text();
    let body;
    try { body = JSON.parse(raw); } catch { body = null; }
    const passed = Boolean(expected(response, body, raw));
    const result = {
      name,
      method: options.method || "GET",
      path,
      status: response.status,
      passed,
      durationMs: Math.round(performance.now() - start),
      ...summarize(response, body),
    };
    results.push(result);
    console.log(JSON.stringify(result));
  } catch {
    const result = { name, path, passed: false, error: "Transport failed or timed out; no automatic retry was made." };
    results.push(result);
    console.log(JSON.stringify(result));
  }
}

await check("Published application", "/", {},
  (r, _body, raw) => r.status === 200 && /common table/i.test(raw) && /text\/html/.test(r.headers.get("content-type") || ""));
await check("Waiter service classification", "/api/waiter/status", {},
  (r, body) => r.status === 200 && body?.mode === "mock",
  (_r, body) => ({ mode: body?.mode ?? "unknown", liveModelVerified: false }));

if (phase === "mapping") {
  for (const query of ["Paris, France", "Lagos, Nigeria"]) {
    await pause();
    await check(`Actual city search: ${query}`, `/api/geocode?q=${encodeURIComponent(query)}`, {},
      (r, body) => r.status === 200 && body?.source === "photon" && Array.isArray(body.results) && body.results.length > 0 &&
        body.results.every(item => typeof item.label === "string" && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)),
      (_r, body) => ({ source: body?.source ?? null, resultCount: body?.results?.length ?? 0, firstLabel: body?.results?.[0]?.label ?? null, code: body?.code ?? null }));
  }
  await check("Invalid city query is rejected", "/api/geocode?q=x", {},
    (r, body) => r.status === 400 && body?.code === "invalid_query");
  await check("Unknown API is rejected", "/api/unknown-smoke-check", {},
    (r, body) => r.status === 404 && body?.code === "not_found");
} else {
  const context = { view: "explore", mode: "book", venueId: "juniper", participantCount: 2, budget: 65, restrictions: ["Vegetarian"], planSaved: false };
  const headers = { "Content-Type": "application/json", Origin: origin, "X-Common-Table-Request": "waiter" };
  const request = { method: "POST", headers, body: JSON.stringify({ message: "Does this fit our budget?", context }) };
  await pause();
  await check("Actual Waiter demo reply", "/api/waiter/reply", request,
    (r, body) => r.status === 200 && body?.source === "mock" && /Offline demo/.test(body.text) && /Juniper & Rye/.test(body.text),
    (_r, body) => ({ source: body?.source ?? null, demoLabelPresent: /Offline demo/.test(body?.text ?? ""), code: body?.code ?? null, liveModelVerified: false }));
  const planContext = { ...context, view: "plan", mode: "real", venueId: "juniper", planVenueId: "casa", planSaved: true };
  for (const [name, message, focusedContext, matches] of [
    ["Saved-plan context survives real-map reload", "Help finish this dinner plan", planContext, /saved.*Casa Nopal/],
    ["Plan budget uses planned venue rather than browsed venue", "What about the budget?", planContext, /Casa Nopal.*\$32/],
    ["Table pad keeps demo group context", "Help with our table", { ...context, view: "table", mode: "real" }, /demo table has 2 seats/],
  ]) {
    await pause();
    await check(name, "/api/waiter/reply", { ...request, body: JSON.stringify({ message, context: focusedContext }) },
      (r, body) => r.status === 200 && body?.source === "mock" && matches.test(body?.text ?? ""),
      (_r, body) => ({ source: body?.source ?? null, focusedContextCorrect: matches.test(body?.text ?? ""), code: body?.code ?? null }));
  }
  await check("Foreign-origin reply is rejected", "/api/waiter/reply", { ...request, headers: { ...headers, Origin: "https://example.invalid" } },
    (r, body) => r.status === 403 && body?.code === "origin_rejected");
  const { "X-Common-Table-Request": _omit, ...withoutRequestHeader } = headers;
  await check("Missing request header is rejected", "/api/waiter/reply", { ...request, headers: withoutRequestHeader },
    (r, body) => r.status === 403 && body?.code === "csrf_rejected");
  await check("Wrong reply method is rejected", "/api/waiter/reply", {},
    (r, body) => r.status === 405 && body?.code === "method_not_allowed");
  await check("Extra private context is rejected", "/api/waiter/reply", { ...request, body: JSON.stringify({ message: "Help choose", context: { ...context, latitude: 0, guestName: "Synthetic test" } }) },
    (r, body) => r.status === 400 && body?.code === "invalid_request");
  await check("Oversized request is rejected", "/api/waiter/reply", { ...request, body: JSON.stringify({ message: "x".repeat(5000), context }) },
    (r, body) => r.status === 413 && body?.code === "body_too_large");
}

const report = {
  origin,
  checkedAt: new Date().toISOString(),
  phase,
  requestsMocked: false,
  credentialsUsed: false,
  paidProviderCalls: 0,
  passed: results.filter(r => r.passed).length,
  failed: results.filter(r => !r.passed).length,
  results,
};
await mkdir("artifacts/live-api-check", { recursive: true });
await writeFile(`artifacts/live-api-check/${phase}.json`, `${JSON.stringify(report, null, 2)}\n`);
if (report.failed) process.exitCode = 1;
