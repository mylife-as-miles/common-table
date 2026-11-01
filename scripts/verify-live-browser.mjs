import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Run: node scripts/verify-live-browser.mjs (no API response fixtures or credentials).
// Uses real deployed responses. The sole route intervention blocks automated OSM raster tiles.
const BASE = process.env.LIVE_APP_URL || 'https://common-table-design-20261029.myles4miles.chatgpt.site';
const OUT = resolve(process.env.LIVE_BROWSER_OUTPUT || 'artifacts/live-api-check/browser-after');
const proxyUrl = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;
const proxy = proxyUrl ? { server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port || '80'}`, bypass: 'localhost,127.0.0.1' } : undefined;
if (proxyUrl?.username) proxy.username = decodeURIComponent(proxyUrl.username);
if (proxyUrl?.password) proxy.password = decodeURIComponent(proxyUrl.password);
const redact = value => String(value).replace(/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED]').replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]');
const safeUrl = value => { try { const u = new URL(value); return `${u.origin}${u.pathname}`; } catch { return '[invalid URL]'; } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
await mkdir(OUT, { recursive: true });
const report = {
  target: BASE, startedAt: new Date().toISOString(), transport: proxy ? 'Chromium through inherited HTTPS_PROXY; normal TLS verification' : 'Chromium default network transport; normal TLS verification',
  interventions: ['Only tile.openstreetmap.org raster requests are blocked.', 'Desktop transport latency is temporarily set to600ms to exercise native cancellation and repeated submission; no response is mocked.'],
  scope: 'Public deployment, actual assets and mock Waiter HTTP. Synthetic local demo state only.', scenarios: [],
};
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', proxy, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-quic', '--enable-unsafe-swiftshader'] });

async function runScenario(mobile) {
  const id = mobile ? 'mobile' : 'desktop';
  const result = { id, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, steps: [], pageErrors: [], failedRequests: [], badSiteResponses: [], siteAssetResponses: [], apiResponses: [], externalHosts: {}, rasterBlocked: 0, providerRequests: 0, screenshots: [] };
  report.scenarios.push(result);
  const context = await browser.newContext({ viewport: result.viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: mobile ? 'reduce' : 'no-preference', acceptDownloads: true, serviceWorkers: 'block' });
  const cancelled = new Set();
  await context.route('https://tile.openstreetmap.org/**', route => { result.rasterBlocked++; return route.abort('blockedbyclient'); });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => result.pageErrors.push(redact(error.message)));
  page.on('request', request => { const u = new URL(request.url()); if (/anthropic\.com$/.test(u.hostname)) result.providerRequests++; });
  page.on('requestfailed', request => {
    const u = new URL(request.url());
    if (u.hostname === 'tile.openstreetmap.org') return;
    result.failedRequests.push({ url: safeUrl(request.url()), error: redact(request.failure()?.errorText || ''), expectedCancellation: cancelled.has(request) });
  });
  page.on('response', response => {
    const u = new URL(response.url()), item = { path: u.pathname, status: response.status(), type: response.request().resourceType() };
    if (u.origin === BASE) {
      if (u.pathname.startsWith('/api/')) result.apiResponses.push(item);
      else if (response.status() >= 400) result.badSiteResponses.push(item);
      else if (['document', 'stylesheet', 'script', 'image', 'font'].includes(item.type)) result.siteAssetResponses.push(item);
    } else {
      const bucket = result.externalHosts[u.hostname] ??= { responses: 0, badStatuses: [] };
      bucket.responses++; if (response.status() >= 400) bucket.badStatuses.push(response.status());
    }
  });
  const nav = name => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: new RegExp(name) });
  const press = () => page.getByRole('group', { name: 'Dinner plan printing press' });
  const waiter = () => page.getByRole('dialog', { name: 'The Waiter, at your service' });
  const launcher = () => page.getByRole('button', { name: 'A little guidance', exact: true });
  async function shot(name) { const filename = `${id}-${name}.png`; await page.screenshot({ path: join(OUT, filename), fullPage: false }); result.screenshots.push(filename); }
  async function step(name, action, nonfatal = false) {
    const began = Date.now();
    try { const details = await action(); result.steps.push({ name, status: 'pass', elapsedMs: Date.now() - began, ...(details === undefined ? {} : { details }) }); }
    catch (error) { result.steps.push({ name, status: 'fail', elapsedMs: Date.now() - began, error: redact(error.message).slice(0, 1800) }); await shot(`${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 50)}-failed`).catch(() => {}); if (!nonfatal) throw error; }
  }
  const guest = `Demo Casey ${id}`;
  const note = `Live-site verification: ${id} local demo only.`;
  try {
    await step('load_actual_deployment', async () => {
      const response = await page.goto(`${BASE}/${mobile ? '#menu' : '#nearby'}`, { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('main')).toBeVisible();
      return { documentStatus: response.status(), title: await page.title() };
    });
    if (!mobile) {
      await step('actual_vector_map_and_mapped_place', async () => {
        const map = page.locator('.geographic-map'); await expect(map).toBeVisible();
        await page.waitForFunction(() => ['ready', 'error'].includes(document.querySelector('.geographic-map')?.getAttribute('data-map-status')), undefined, { timeout: 20000 });
        const state = await map.evaluate(el => ({ renderer: el.dataset.renderer, status: el.dataset.mapStatus, poiCount: el.dataset.poiCount }));
        result.mapObserved = state;
        expect(state.renderer).toBe('maplibre'); expect(state.status).toBe('ready');
        const pins = page.locator('.geo-poi-marker'); await expect(pins.first()).toBeVisible({ timeout: 15000 });
        const pinLabel = await pins.first().getAttribute('aria-label'); await pins.first().click();
        await expect(page.getByRole('complementary', { name: 'Map field notes' }).locator('h3')).toBeVisible();
        const mappedName = await page.getByRole('complementary', { name: 'Map field notes' }).locator('h3').innerText();
        await shot('01-actual-vector-map');
        return { ...state, clickedLabel: pinLabel, mappedName, noGeocodeOrDeviceLocationRequested: true };
      }, true);
      await step('native_map_to_demo_book', async () => {
        await page.getByRole('button', { name: 'Open demo atlas', exact: true }).click();
        await page.getByRole('button', { name: 'Open the menu', exact: true }).click();
        await expect(page.locator('.book-restaurant-title')).toContainText('Juniper & Rye');
      });
    }
    await step('choose_initial_demo_venue', async () => {
      await expect(page.locator('.book-restaurant-title')).toContainText('Juniper & Rye');
      await shot('02-demo-menu');
      await page.getByRole('button', { name: 'Bring this to the table', exact: true }).click();
      await expect(page).toHaveURL(/#table$/); await expect(page.locator('.tp-chosen-venue')).toContainText('Juniper & Rye');
    });
    await step('guest_budget_restrictions_update_table', async () => {
      await page.getByRole('button', { name: 'Add a demo guest', exact: true }).click();
      await page.getByLabel('Guest’s name').fill(guest); await page.getByRole('button', { name: 'Set their place', exact: true }).click();
      await page.getByRole('button', { name: 'Vegan', exact: true }).click();
      await page.getByRole('button', { name: 'Gluten-free', exact: true }).click();
      const budget = page.getByRole('slider', { name: /Comfortable spend/ }); await budget.focus(); await page.keyboard.press('Home');
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
      await expect(budget).toHaveValue('40'); await expect(page.locator('.tp-seat')).toHaveCount(2);
      await expect(page.locator('.tp-shortlist-header')).toContainText('1 places fit this table');
      const rendered = await page.locator('.ct-table-render').evaluate(img => ({ complete: img.complete, width: img.naturalWidth, height: img.naturalHeight }));
      expect(rendered.complete).toBe(true); expect(rendered.width).toBeGreaterThan(0);
      await shot('03-synthetic-table');
      return { syntheticGuest: guest, budget: 40, restrictions: ['Vegan', 'Gluten-free'], fitCount: 1, tableRender: rendered, invitationsSent: false };
    });
    await step('revised_eligible_menu_and_shared_plan', async () => {
      await page.getByRole('button', { name: 'Back to exploring', exact: true }).click();
      await expect(page.locator('.book-restaurant-title')).toContainText('Casa Nopal');
      await page.getByRole('button', { name: 'Bring this to the table', exact: true }).click();
      await expect(page.locator('.tp-chosen-venue')).toContainText('Casa Nopal');
      await nav('Dinner plan').click();
      await expect(press().getByRole('article', { name: 'Dinner plan summary' })).toContainText('Casa Nopal');
      await expect(page.getByRole('checkbox')).toHaveCount(2);
    });
    await step('approve_save_and_actual_finite_press', async () => {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      await page.getByLabel('Day', { exact: true }).fill(tomorrow);
      await page.getByLabel('Time', { exact: true }).fill('19:15');
      await page.getByLabel('A note for the evening').fill(note);
      await expect(page.getByRole('button', { name: 'Save this dinner plan', exact: true })).toBeDisabled();
      for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
      const start = Date.now(); await page.getByRole('button', { name: 'Save this dinner plan', exact: true }).click();
      await expect(press()).toHaveAttribute('data-phase', 'printed', { timeout: 10000 });
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('common-table.demo.v1')).state.plan);
      expect(saved.saved).toBe(true); expect(saved.venueId).toBe('casa'); expect(saved.approvals).toHaveLength(2);
      await shot('04-saved-pressed-plan');
      return { venueId: saved.venueId, savedInThisBrowser: saved.saved, approvals: saved.approvals.length, observedPrintMs: Date.now() - start, staticReducedMotion: mobile };
    });
    await step('tear_and_reprint_are_visual_only', async () => {
      const before = await page.evaluate(() => localStorage.getItem('common-table.demo.v1'));
      const tear = press().getByRole('button', { name: 'Tear off dinner plan', exact: true });
      if (mobile) await tear.tap(); else { await tear.focus(); await page.keyboard.press('Space'); }
      await expect(press()).toHaveAttribute('data-paper', 'detached');
      await shot('05-torn-plan');
      expect(await page.evaluate(() => localStorage.getItem('common-table.demo.v1'))).toBe(before);
      await press().getByRole('button', { name: 'Reprint dinner plan', exact: true }).click();
      await expect(press()).toHaveAttribute('data-phase', 'printed', { timeout: 10000 });
      await expect(press()).toHaveAttribute('data-paper', 'attached');
      expect(await page.evaluate(() => localStorage.getItem('common-table.demo.v1'))).toBe(before);
      return { receiptArticles: await press().getByRole('article', { name: 'Dinner plan summary' }).count(), domainStateChanged: false, automaticExports: false };
    });
    await step('reload_preserves_local_plan_and_explicit_export', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: 'Saved for a good evening', exact: true })).toBeVisible();
      await expect(page.getByLabel('A note for the evening')).toHaveValue(note);
      await expect(page.getByLabel('Time', { exact: true })).toHaveValue('19:15');
      for (const checkbox of await page.getByRole('checkbox').all()) await expect(checkbox).toBeChecked();
      await expect(press()).toHaveAttribute('data-phase', 'printed'); await expect(press()).toHaveAttribute('data-paper', 'attached');
      const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download', exact: true }).click();
      const download = await downloadPromise; const filename = `${id}-dinner-plan.txt`; await download.saveAs(join(OUT, filename));
      const text = await readFile(join(OUT, filename), 'utf8');
      expect(text).toContain('Casa Nopal'); expect(text).toContain(guest); expect(text).toContain(note); expect(text).toContain('19:15');
      await shot('06-reloaded-local-plan');
      return { suggestedFilename: download.suggestedFilename(), artifact: filename, bytes: Buffer.byteLength(text), persistedLocally: true, serverSharedPlanVerified: false };
    });
    await step('actual_waiter_mock_api_and_generic_labels', async () => {
      const statusPromise = page.waitForResponse(r => new URL(r.url()).pathname === '/api/waiter/status');
      await launcher().click(); await expect(waiter()).toBeVisible();
      const status = await statusPromise; expect(status.status()).toBe(200); expect(await status.json()).toEqual({ mode: 'mock' });
      const guidance = waiter().getByRole('radio', { name: /^Thoughtful guidance\b/ });
      await expect(guidance).toHaveAccessibleName(/offline demo/); await guidance.check();
      await expect(waiter().locator('.cw-provider-note')).toContainText('No live AI service is called.');
      const field = waiter().getByLabel('Or leave a small request');
      let session;
      if (!mobile) {
        session = await context.newCDPSession(page); await session.send('Network.enable');
        await session.send('Network.emulateNetworkConditions', { offline: false, latency: 600, downloadThroughput: -1, uploadThroughput: -1 });
        const requestPromise = page.waitForRequest(r => new URL(r.url()).pathname === '/api/waiter/reply' && r.method() === 'POST');
        await field.fill('An explicitly cancelled demo question.'); await waiter().getByRole('button', { name: 'Ask The Waiter', exact: true }).click();
        const request = await requestPromise; cancelled.add(request);
        await waiter().getByRole('button', { name: 'Cancel request', exact: true }).click();
        await expect(field).toBeFocused(); await expect(waiter().locator('.cw-request-pending')).toHaveCount(0);
        await expect(waiter().locator('.cw-guidance-result')).toHaveCount(0);
        result.waiterCancellation = { nativeCancel: true, focusRestored: true, responseMocked: false, serverCompletionUnknown: true };
        await sleep(1200);
      }
      const actual = page.waitForResponse(r => new URL(r.url()).pathname === '/api/waiter/reply' && r.request().method() === 'POST');
      let postCount = 0; const counter = r => { if (new URL(r.url()).pathname === '/api/waiter/reply' && r.method() === 'POST') postCount++; }; page.on('request', counter);
      await field.fill('What should we check in this fictional dinner plan?');
      await field.press('Enter'); if (!mobile) { await field.press('Enter'); await field.press('Enter'); }
      const reply = await actual; expect(reply.status()).toBe(200); const body = await reply.json(); expect(body.source).toBe('mock');
      const submitted = reply.request().postDataJSON();
      await expect(waiter().locator('.cw-guidance-result')).toBeVisible();
      await expect(waiter().locator('.cw-guidance-label')).toHaveText('OFFLINE DEMO · SAMPLE GUIDANCE');
      expect(await page.locator('body').innerText()).not.toMatch(/claude|anthropic|sonnet/i);
      expect(postCount).toBe(1); page.off('request', counter);
      result.waiter = { status: reply.status(), source: body.source, text: redact(body.text).slice(0, 1600), submittedContext: submitted.context, repeatedSubmitsProducedPosts: postCount };
      if (session) { await session.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await session.detach(); }
      await shot('07-actual-waiter-response');
      return { statusStatus: status.status(), statusMode: 'mock', replyStatus: reply.status(), replySource: body.source, genericLabel: true, noLiveModelCall: true };
    });
    await step('waiter_still_describes_current_plan_after_reload', async () => {
      expect(result.waiter.submittedContext.view).toBe('plan'); expect(result.waiter.submittedContext.planVenueId).toBe('casa'); expect(result.waiter.submittedContext.planSaved).toBe(true);
      expect(result.waiter.text).toContain('Casa Nopal');
    }, true);
    await step('local_tips_use_saved_plan_after_reload', async () => {
      await waiter().getByRole('radio', { name: 'Local tips', exact: true }).check();
      await waiter().getByLabel('Or leave a small request').fill('help finish tonight');
      await waiter().getByRole('button', { name: 'Ask The Waiter', exact: true }).click();
      await expect(waiter().locator('.cw-response')).toContainText('Casa Nopal');
      expect(await page.locator('body').innerText()).not.toMatch(/claude|anthropic|sonnet/i);
    }, true);
    await step('native_waiter_exit_back_and_focus', async () => {
      await waiter().getByRole('button', { name: 'Back to the evening', exact: true }).click(); await expect(waiter()).not.toBeVisible(); await expect(launcher()).toBeFocused();
      await nav('Your table').click(); await expect(page).toHaveURL(/#table$/); await page.goBack(); await expect(page).toHaveURL(/#plan$/);
      await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
      await expect(page.getByRole('button', { name: 'Saved for a good evening', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
    await step('editing_invalidates_approvals_then_explicit_resave_works', async () => {
      await page.getByLabel('A note for the evening').fill(`${note} Revised explicitly.`);
      for (const checkbox of await page.getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked();
      await expect(page.getByRole('button', { name: 'Save this dinner plan', exact: true })).toBeDisabled();
      for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
      await page.getByRole('button', { name: 'Save this dinner plan', exact: true }).click(); await expect(press()).toHaveAttribute('data-phase', 'printed', { timeout: 10000 });
      expect((await page.evaluate(() => JSON.parse(localStorage.getItem('common-table.demo.v1')).state.plan)).saved).toBe(true);
    });
  } catch { /* A failed prerequisite is already recorded; continue with the independent viewport. */ }
  finally {
    result.providerRequestsExpectedZero = result.providerRequests === 0;
    result.finishedAt = new Date().toISOString();
    await context.close();
    await writeFile(join(OUT, `${id}-result.json`), JSON.stringify(result, null, 2));
  }
}

try { await runScenario(false); await sleep(1200); await runScenario(true); }
finally {
  await browser.close(); report.finishedAt = new Date().toISOString();
  report.summary = { passedSteps: report.scenarios.flatMap(s => s.steps).filter(s => s.status === 'pass').length, failedSteps: report.scenarios.flatMap(s => s.steps).filter(s => s.status === 'fail').length, pageErrors: report.scenarios.reduce((sum, s) => sum + s.pageErrors.length, 0), failedSiteResponses: report.scenarios.reduce((sum, s) => sum + s.badSiteResponses.length, 0), providerRequests: report.scenarios.reduce((sum, s) => sum + s.providerRequests, 0) };
  await writeFile(join(OUT, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary));
  if (report.summary.failedSteps || report.summary.pageErrors || report.summary.failedSiteResponses || report.summary.providerRequests) process.exitCode = 1;
}
