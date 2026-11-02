import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// ACTUAL production UI verification. No fixtures, storage seeding, user cookies,
// paid discovery/guidance, shared-table writes, invitations or bookings.
// Only public OSM raster tiles are blocked to respect automated tile-use policy.
// Run: LIVE_APP_URL=https://your-published-site node scripts/verify-live-browser.mjs
// Existing contracts: LIVE_BROWSER_OUTPUT, CHROMIUM_PATH, HTTPS_PROXY.
const target = new URL(process.env.LIVE_APP_URL || "https://common-table-design-20261029.myles4miles.chatgpt.site");
if (target.protocol !== "https:" || target.username || target.password || target.port || target.pathname !== "/" || target.search || target.hash || !target.hostname.includes(".") || /^(?:[\d.]+|\[.*\])$/.test(target.hostname) || /(?:^|\.)(?:localhost|local|internal)$/.test(target.hostname)) throw new Error("LIVE_APP_URL must be a public HTTPS deployment origin.");
const BASE = target.origin;
const viewportSelection = process.env.LIVE_BROWSER_VIEWPORT || "both";
if (!["desktop", "mobile", "both"].includes(viewportSelection)) throw new Error("LIVE_BROWSER_VIEWPORT must be desktop, mobile or both.");
const OUT = resolve(process.env.LIVE_BROWSER_OUTPUT || process.env.LIVE_VERIFICATION_OUTPUT || "artifacts/live-verification/browser");
const proxyUrl = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;
const proxy = proxyUrl ? { server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port || "80"}`, bypass: "localhost,127.0.0.1" } : undefined;
if (proxyUrl?.username) proxy.username = decodeURIComponent(proxyUrl.username);
if (proxyUrl?.password) proxy.password = decodeURIComponent(proxyUrl.password);
const redact = value => String(value).replace(/sk-ant-[A-Za-z0-9_-]+/g, "[REDACTED]").replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]").replace(/((?:api[_-]?key|token|secret|authorization)\s*[=:]\s*)[^\s,;"']+/gi, "$1[REDACTED]");
const safeUrl = value => { try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return "[invalid URL]"; } };
await mkdir(OUT, { recursive: true });
const report = { target: BASE, startedAt: new Date().toISOString(), historicalDefaultTargetUsed: !process.env.LIVE_APP_URL, transport: proxy ? "Inherited HTTPS proxy; normal TLS verification" : "Browser default network; normal TLS verification", scope: "Anonymous public production UI; actual geographic assets/weather and native fictional local dinner flow. Authenticated sharing, invitations, paid guidance/ranking and reservations remain unverified.", requestsMocked: false, interventions: ["Only tile.openstreetmap.org raster requests are blocked."], storageRead: "IndexedDB common-table / app / main; DeviceRecord.value is a serialized versioned app-state envelope. No LocalStorage read or state write is used.", scenarios: [] };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || process.env.BROWSER_EXECUTABLE || "/usr/bin/chromium", proxy, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-quic", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

async function runScenario(mobile) {
  const id = mobile ? "mobile" : "desktop";
  const result = { id, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, steps: [], pageErrors: [], failedRequests: [], badSiteAssets: [], apiResponses: [], externalHosts: {}, rasterBlocked: 0, forbiddenSubmissions: [], screenshots: [], authenticatedSharingVerified: false, liveRankingVerified: false, liveModelVerified: false, reservationsVerified: false };
  report.scenarios.push(result);
  const context = await browser.newContext({ viewport: result.viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: mobile ? "reduce" : "no-preference", acceptDownloads: true });
  await context.route("https://tile.openstreetmap.org/**", route => { result.rasterBlocked++; return route.abort("blockedbyclient"); });
  const page = await context.newPage();
  page.setDefaultTimeout(12_000); page.setDefaultNavigationTimeout(20_000);
  page.on("pageerror", error => result.pageErrors.push(redact(error.message).slice(0, 1800)));
  page.on("request", request => {
    const url = new URL(request.url());
    const paidOrShared = request.method() !== "GET" && request.method() !== "HEAD" && (/^\/api\/(?:waiter\/(?:reply|enable)|recommendations|shared-tables)(?:\/|$)/.test(url.pathname));
    const directProvider = /(?:^|\.)(?:anthropic\.com|qloo\.com)$/.test(url.hostname);
    if (paidOrShared || directProvider) result.forbiddenSubmissions.push({ path: url.pathname, method: request.method(), reason: directProvider ? "Direct provider request" : "Unexpected paid/shared mutation" });
  });
  page.on("requestfailed", request => {
    const url = new URL(request.url()); if (url.hostname === "tile.openstreetmap.org") return;
    result.failedRequests.push({ url: safeUrl(request.url()), type: request.resourceType(), error: redact(request.failure()?.errorText || "").slice(0, 120), possibleNavigationCancellation: /ABORT|CANCEL/i.test(request.failure()?.errorText || "") });
  });
  page.on("response", response => {
    const url = new URL(response.url());
    const item = { path: url.pathname, status: response.status(), type: response.request().resourceType() };
    if (url.origin === BASE) {
      if (url.pathname.startsWith("/api/")) result.apiResponses.push(item);
      else if (response.status() >= 400 && ["document", "script", "stylesheet", "font", "image"].includes(item.type)) result.badSiteAssets.push(item);
    } else {
      const bucket = result.externalHosts[url.hostname] ??= { responses: 0, badStatuses: [] };
      bucket.responses++; if (response.status() >= 400) bucket.badStatuses.push(response.status());
    }
  });
  const nav = name => page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: new RegExp(name) });
  const press = () => page.getByRole("group", { name: "Dinner plan printing press" });
  const waiter = () => page.getByRole("dialog", { name: "The Waiter, at your service" });
  const launcher = () => page.getByRole("button", { name: "A little guidance", exact: true });
  const started = Date.now();
  async function shot(name) { const filename = `${id}-${name}.png`; await page.screenshot({ path: join(OUT, filename), fullPage: false, timeout: 10_000 }); result.screenshots.push(filename); }
  async function step(name, action, optional = false) {
    if (Date.now() - started > 150_000) throw new Error("Scenario time budget exceeded.");
    const began = Date.now();
    try {
      const details = await action();
      result.steps.push({ name, status: details?.notVerified ? "not_verified" : "pass", elapsedMs: Date.now() - began, ...(details === undefined ? {} : { details }) });
    } catch (error) {
      result.steps.push({ name, status: "fail", elapsedMs: Date.now() - began, error: redact(error.message).slice(0, 1800) });
      await shot(`${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 55)}-failed`).catch(() => {});
      if (!optional) throw error;
    }
  }
  // Read ONLY. Missing DB/store/record is not repaired or seeded by verification.
  async function appRecord() {
    return page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
        const timer = setTimeout(() => finish(new Error("IndexedDB read timed out.")), 3500);
        const opening = indexedDB.open("common-table");
        opening.onupgradeneeded = () => { opening.transaction?.abort(); finish(new Error("App database does not exist yet.")); };
        opening.onerror = () => finish(new Error("Could not read app database."));
        opening.onblocked = () => finish(new Error("App database read is blocked."));
        opening.onsuccess = () => {
          const db = opening.result;
          if (settled) { db.close(); return; }
          if (!db.objectStoreNames.contains("app")) { db.close(); finish(new Error("App store is missing.")); return; }
          const tx = db.transaction("app", "readonly"), read = tx.objectStore("app").get("main");
          read.onerror = () => { db.close(); finish(new Error("App record read failed.")); };
          read.onsuccess = () => {
            try {
              const record = read.result;
              if (!record || record.schema !== 1 || typeof record.value !== "string") throw new Error("App record is not the native serialized DeviceRecord.");
              const envelope = JSON.parse(record.value);
              if (envelope.version !== 1 || !envelope.state || !Array.isArray(envelope.state.participants)) throw new Error("Invalid versioned app state.");
              finish(null, { schema: record.schema, revision: record.revision, persistent: record.persistent, value: record.value, state: envelope.state });
            } catch (error) { finish(error); }
            finally { db.close(); }
          };
        };
      });
    });
  }
  async function waitForStored(predicate) {
    await expect.poll(async () => { try { return predicate(await appRecord()); } catch { return false; } }, { timeout: 10_000 }).toBe(true);
    return appRecord();
  }
  const guest = `Local Casey ${id}`;
  const note = `Published-site verification: ${id} fictional local plan only.`;
  try {
    await step("actual_application_and_anonymous_session", async () => {
      const response = await page.goto(`${BASE}/#nearby`, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(200); await expect(page.getByRole("main")).toBeVisible();
      const session = await page.evaluate(async () => { const response = await fetch("/api/shared-tables/session", { cache: "no-store", signal: AbortSignal.timeout(12_000) }); const body = await response.json(); return { status: response.status, anonymous: body.identity === null, available: body.available }; });
      expect(session.status).toBe(200); expect(session.anonymous).toBe(true);
      await expect(page.getByText("Opening your saved evening…", { exact: true })).toHaveCount(0);
      return { documentStatus: response.status(), sessionAnonymous: true, databaseBindingReportedAvailable: session.available, authenticatedSharingVerified: false };
    });
    await step("actual_real_map_renderer", async () => {
      const map = page.locator(".geographic-map"); await expect(map).toBeVisible();
      await page.waitForFunction(() => ["ready", "error"].includes(document.querySelector(".geographic-map")?.getAttribute("data-map-status")), undefined, { timeout: 25_000 });
      const observed = await map.evaluate(element => ({ renderer: element.dataset.renderer, status: element.dataset.mapStatus, pointCount: Number(element.dataset.poiCount || 0), canvasWidth: element.querySelector("canvas")?.width || 0 }));
      await map.scrollIntoViewIfNeeded(); await shot("01-real-map");
      if (observed.renderer !== "maplibre" || observed.status !== "ready") return { ...observed, notVerified: true, reason: "Actual vector rendering unavailable. Raster fallback is deliberately blocked; no substitute image was supplied." };
      expect(observed.canvasWidth).toBeGreaterThan(100);
      return { ...observed, liveVectorRenderingVerified: true, liveRestaurantRankingVerified: false };
    }, true);
    await step("native_explicit_sample_atlas_then_menu", async () => {
      await page.getByRole("button", { name: "Open demo atlas", exact: true }).click();
      await page.getByRole("button", { name: "Open the menu", exact: true }).click();
      await expect(page.locator(".book-restaurant-title")).toContainText("Juniper & Rye");
      await page.locator(".book-restaurant-title").scrollIntoViewIfNeeded(); await shot("02-explicit-sample-menu");
      if (!mobile) {
        const corner = page.getByRole("button", { name: "Turn this page", exact: true });
        await corner.scrollIntoViewIfNeeded();
        const box = await corner.boundingBox(); expect(box).not.toBeNull();
        const start = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.7 };
        await page.mouse.move(start.x, start.y); await page.mouse.down();
        await page.mouse.move(start.x - 190, start.y - 85, { steps: 16 });
        await expect(page.locator(".folio-curl-stage")).toHaveAttribute("data-flip-state", "dragging");
        await shot("02b-held-native-leaf");
        await page.keyboard.press("Escape"); await page.mouse.up();
        await expect(page.locator(".folio-curl-stage")).toHaveAttribute("data-flip-state", "idle");
        await expect(page.locator(".book-restaurant-title")).toContainText("Juniper & Rye");
      }
      await page.getByRole("button", { name: "Next restaurant", exact: true }).click();
      await expect(page.locator(".book-restaurant-title")).not.toContainText("Juniper & Rye");
      await page.getByRole("button", { name: "Previous restaurant", exact: true }).click();
      await expect(page.locator(".book-restaurant-title")).toContainText("Juniper & Rye");
      await page.getByRole("button", { name: "Bring this to the table", exact: true }).click();
      await expect(page).toHaveURL(/#table$/); await expect(page.locator(".tp-chosen-venue")).toContainText("Juniper & Rye");
      return { fictionalVenueChosen: "Juniper & Rye", nextPreviousVenueVerified: true, heldNativeCurlAndEscapeVerified: !mobile, mobileStaticReducedMotion: mobile, paidDiscoveryRequested: false };
    });
    await step("native_guest_cancel_restores_focus", async () => {
      const add = page.getByRole("button", { name: "Add a demo guest", exact: true });
      await add.click(); const name = page.getByLabel("Guest’s name"); await expect(name).toBeFocused();
      await name.fill("Cancelled local guest"); await page.keyboard.press("Escape");
      await expect(name).toHaveCount(0); await expect(add).toBeFocused();
      const saved = await waitForStored(record => record.state.participants.length === 1);
      return { participants: saved.state.participants.length, cancelledGuestWasNotAdded: true, focusRestored: true };
    });
    await step("native_local_guest_tastes_budget_and_restrictions", async () => {
      await page.getByRole("button", { name: "Add a demo guest", exact: true }).click();
      await page.getByLabel("Guest’s name").fill(guest); await page.getByRole("button", { name: "Set their place", exact: true }).click();
      const seasonal = page.getByRole("button", { name: "Seasonal", exact: true }); await seasonal.click(); await expect(seasonal).toHaveAttribute("aria-pressed", "true");
      const vegetarian = page.getByRole("button", { name: "Vegetarian", exact: true }); await vegetarian.click(); await expect(vegetarian).toHaveAttribute("aria-pressed", "true");
      const budget = page.getByRole("slider", { name: /Comfortable spend/ });
      await waitForStored(record => record.state.plan.venueId === "juniper");
      result.planBudgetEvidence = [{ stage: "before_budget_change", plannedVenueId: "juniper" }];
      await budget.focus(); await page.keyboard.press("Home"); await expect(budget).toHaveValue("20");
      await waitForStored(record => record.state.plan.venueId === null && record.state.participants.some(person => person.name === guest && person.budget === 20));
      result.planBudgetEvidence.push({ stage: "budget_20_below_venue_cost", plannedVenueId: null });
      for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowRight");
      await expect(budget).toHaveValue("55");
      const saved = await waitForStored(record => record.state.participants.length === 2 && record.state.participants.some(person => person.name === guest && person.budget === 55 && person.tastes.includes("Seasonal") && person.restrictions.includes("Vegetarian")));
      expect(saved.state.plan.venueId).toBeNull();
      result.planBudgetEvidence.push({ stage: "budget_55_eligible_again", plannedVenueId: saved.state.plan.venueId });
      await page.getByRole("button", { name: "Explore the menu", exact: true }).click();
      for (let turn = 0; turn < 6 && !(await page.locator(".book-restaurant-title").innerText()).includes("Juniper & Rye"); turn++) {
        const previous = await page.locator(".book-restaurant-title").innerText();
        await page.getByRole("button", { name: "Next restaurant", exact: true }).click();
        await expect(page.locator(".book-restaurant-title")).not.toHaveText(previous);
      }
      await expect(page.locator(".book-restaurant-title")).toContainText("Juniper & Rye");
      await page.getByRole("button", { name: "Bring this to the table", exact: true }).click();
      await expect(page).toHaveURL(/#table$/);
      await waitForStored(record => record.state.plan.venueId === "juniper");
      result.planBudgetEvidence.push({ stage: "explicit_native_menu_rechoose", plannedVenueId: "juniper" });
      await expect(page.locator(".ct-physical-frame")).toHaveAttribute("data-image-loaded", "true", { timeout: 12_000 });
      const tableImage = await page.locator(".ct-table-render").evaluate(image => ({ complete: image.complete, naturalWidth: image.naturalWidth }));
      expect(tableImage.complete).toBe(true); expect(tableImage.naturalWidth).toBeGreaterThan(0);
      await page.locator(".tp-preferences").scrollIntoViewIfNeeded(); await shot("03-local-table");
      return { localGuestCount: saved.state.participants.length, changedBudget: 55, taste: "Seasonal", restriction: "Vegetarian", belowBudgetInvalidatedPlannedVenue: true, eligibilityRestorationDidNotAutoChoose: true, eligibleVenueExplicitlyChosenAgain: "juniper", invitationsSent: false, tableImage };
    });
    await step("native_plan_agreement_save_and_indexeddb_commit", async () => {
      await nav("Dinner plan").click();
      await expect(press().getByRole("article", { name: "Dinner plan summary" })).toContainText("Juniper & Rye");
      const tomorrow = await page.evaluate(() => { const date = new Date(); date.setDate(date.getDate() + 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; });
      await page.getByLabel("Day", { exact: true }).fill(tomorrow); await page.getByLabel("Time", { exact: true }).fill("19:15"); await page.getByLabel("A note for the evening").fill(note);
      const approvals = page.locator(".tp-approvals input[type=checkbox]"); await expect(approvals).toHaveCount(2);
      await expect(page.getByRole("button", { name: "Save this dinner plan", exact: true })).toBeDisabled();
      for (const checkbox of await approvals.all()) await checkbox.check();
      await page.getByRole("button", { name: "Save this dinner plan", exact: true }).click();
      await expect(press()).toHaveAttribute("data-phase", "printed", { timeout: 10_000 });
      const saved = await waitForStored(record => record.state.plan.saved === true && record.state.plan.venueId === "juniper" && record.state.plan.note === note && record.state.plan.approvals.length === 2);
      expect(saved.schema).toBe(1); expect(saved.persistent).toBe(true);
      await press().scrollIntoViewIfNeeded(); await shot("04-saved-plan");
      return { indexedDB: "common-table/app/main", schema: saved.schema, revision: saved.revision, serializedStringValue: true, saved: true, participantApprovals: 2, sharedServerPlanVerified: false };
    });
    await step("reload_reads_native_indexeddb_and_explicit_download", async () => {
      const before = await appRecord(); await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "Saved for a good evening", exact: true })).toBeVisible();
      await expect(page.getByLabel("A note for the evening")).toHaveValue(note); await expect(page.getByLabel("Time", { exact: true })).toHaveValue("19:15");
      for (const checkbox of await page.locator(".tp-approvals input[type=checkbox]").all()) await expect(checkbox).toBeChecked();
      const after = await appRecord(); expect(after.value).toBe(before.value);
      const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "Download", exact: true }).click();
      const download = await downloadPromise, filename = `${id}-local-dinner-plan.txt`; await download.saveAs(join(OUT, filename));
      const text = await readFile(join(OUT, filename), "utf8"); expect(text).toContain("Juniper & Rye"); expect(text).toContain("2 people"); expect(text).not.toContain(guest); expect(text).toContain(note); expect(text).toContain("19:15"); expect(text).toMatch(/not a reservation/i);
      await press().scrollIntoViewIfNeeded(); await shot("05-reloaded-local-plan");
      return { persistedAcrossReload: true, exportExplicitlyClicked: true, file: filename, suggestedFilename: download.suggestedFilename(), bytes: Buffer.byteLength(text), partySizeExported: 2, guestNamesExcluded: true, authenticatedSharingVerified: false };
    });
    await step("actual_weather_state_and_sample_booking_truth", async () => {
      const weather = page.locator(".evening-extras .weather-paper");
      await expect(weather).toBeVisible(); await expect.poll(() => weather.getAttribute("data-weather-state"), { timeout: 15_000 }).not.toBe("loading");
      const observed = await weather.getAttribute("data-weather-state");
      expect(["ready", "stale", "error", "cancelled"]).toContain(observed);
      const booking = page.locator(".booking-paper"); await expect(booking).toHaveAttribute("data-booking-state", "demo"); await expect(booking.getByRole("link")).toHaveCount(0);
      await expect(booking).toContainText("Sample plan");
      return { weatherState: observed, liveWeatherVerified: observed === "ready", notVerified: observed !== "ready", sampleBookingUnavailable: true, actualReservationVerified: false };
    }, true);
    await step("waiter_availability_and_local_tips_without_paid_post", async () => {
      const availabilityPromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/waiter/status", { timeout: 12_000 });
      await launcher().click(); await expect(waiter()).toBeVisible();
      const response = await availabilityPromise; const body = await response.json();
      const serviceUnavailable = response.status() === 503 && body?.code === "unavailable";
      if (!serviceUnavailable) { expect(response.status()).toBe(200); expect(["disabled", "sign_in"]).toContain(body.mode); }
      const thoughtful = waiter().getByRole("radio", { name: /^Thoughtful guidance\b/ }); await thoughtful.check();
      const field = waiter().getByLabel("Or leave a small request"); await field.fill("Check this local fictional plan");
      await expect(waiter().getByRole("button", { name: "Ask The Waiter", exact: true })).toBeDisabled();
      await waiter().getByRole("radio", { name: "Local tips", exact: true }).check();
      await field.fill("help finish tonight"); await waiter().getByRole("button", { name: "Ask The Waiter", exact: true }).click();
      await expect(waiter().locator(".cw-response")).toContainText("Juniper & Rye");
      await expect(waiter().locator(".cw-guidance-result")).toHaveCount(0);
      expect(await page.locator("body").innerText()).not.toMatch(/claude|anthropic|qloo/i);
      await waiter().locator(".cw-request").scrollIntoViewIfNeeded(); await shot("06-local-waiter");
      return { observedAvailability: body.mode ?? "unavailable", notVerified: serviceUnavailable, unavailableGuidanceCannotSubmit: true, localTipsVerified: true, liveModelVerified: false, paidQuestionSubmitted: false };
    });
    await step("waiter_exit_browser_back_and_keyboard_focus", async () => {
      await waiter().getByRole("button", { name: "Back to the evening", exact: true }).click(); await expect(waiter()).not.toBeVisible(); await expect(launcher()).toBeFocused();
      await nav("Your table").click(); await expect(page).toHaveURL(/#table$/); await page.goBack(); await expect(page).toHaveURL(/#plan$/);
      await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
      await expect(page.getByRole("button", { name: "Saved for a good evening", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      return { exitFocusRestored: true, browserBackRestoredSavedPlan: true, noHorizontalOverflow: true };
    });
    await step("plan_edit_resets_agreement_and_explicit_resave", async () => {
      await page.getByLabel("A note for the evening").fill(`${note} Revised explicitly.`);
      const approvals = page.locator(".tp-approvals input[type=checkbox]");
      for (const checkbox of await approvals.all()) await expect(checkbox).not.toBeChecked();
      await expect(page.getByRole("button", { name: "Save this dinner plan", exact: true })).toBeDisabled();
      for (const checkbox of await approvals.all()) await checkbox.check();
      await page.getByRole("button", { name: "Save this dinner plan", exact: true }).click();
      await waitForStored(record => record.state.plan.saved && record.state.plan.note.endsWith("Revised explicitly.") && record.state.plan.approvals.length === 2);
      return { agreementInvalidatedByEdit: true, resavedExplicitly: true };
    });
  } catch { /* Failed prerequisite is recorded; the next fresh viewport is independent. */ }
  finally {
    result.finishedAt = new Date().toISOString();
    result.noPaidOrSharedSubmissions = result.forbiddenSubmissions.length === 0;
    await context.close();
    await writeFile(join(OUT, `${id}-result.json`), `${JSON.stringify(result, null, 2)}\n`);
  }
}
try { if (viewportSelection !== "mobile") await runScenario(false); if (viewportSelection !== "desktop") await runScenario(true); }
finally {
  await browser.close(); report.finishedAt = new Date().toISOString();
  const steps = report.scenarios.flatMap(scenario => scenario.steps);
  report.summary = { passedSteps: steps.filter(step => step.status === "pass").length, failedSteps: steps.filter(step => step.status === "fail").length, notVerifiedSteps: steps.filter(step => step.status === "not_verified").length, pageErrors: report.scenarios.reduce((sum, scenario) => sum + scenario.pageErrors.length, 0), badSiteAssets: report.scenarios.reduce((sum, scenario) => sum + scenario.badSiteAssets.length, 0), unexpectedPaidOrSharedSubmissions: report.scenarios.reduce((sum, scenario) => sum + scenario.forbiddenSubmissions.length, 0), authenticatedInvitationsVerified: false, livePaidGuidanceVerified: false, livePaidRankingVerified: false, actualReservationVerified: false };
  await writeFile(join(OUT, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output: join(OUT, "results.json"), ...report.summary }));
  if (report.summary.failedSteps || report.summary.pageErrors || report.summary.badSiteAssets || report.summary.unexpectedPaidOrSharedSubmissions) process.exitCode = 1;
}
