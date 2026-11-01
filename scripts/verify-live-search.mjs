import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const origin = "https://common-table-design-20261029.myles4miles.chatgpt.site";
const output = "artifacts/live-api-check/search-browser";
const proxyUrl = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;
const proxy = proxyUrl ? {
  server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port || "80"}`,
  ...(proxyUrl.username ? { username: decodeURIComponent(proxyUrl.username) } : {}),
  ...(proxyUrl.password ? { password: decodeURIComponent(proxyUrl.password) } : {}),
} : undefined;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  proxy,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
// This smoke uses actual OpenFreeMap vectors, not automated public raster tiles.
await context.route("https://tile.openstreetmap.org/**", route => route.abort());
await mkdir(output, { recursive: true });
const result = { origin, checkedAt: new Date().toISOString(), requestsMocked: false, query: "Paris, France", passed: false };
try {
  await page.goto(`${origin}/#nearby`);
  await page.getByRole("searchbox", { name: "Search a city or neighborhood" }).fill(result.query);
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === "/api/geocode");
  await page.getByRole("button", { name: "Search places", exact: true }).click();
  const response = await pending;
  result.status = response.status();
  const body = await response.json();
  result.source = body.source;
  result.resultCount = body.results?.length || 0;
  expect(response.status()).toBe(200);
  expect(body.source).toBe("photon");
  const first = page.getByRole("list", { name: "Place search results" }).getByRole("button").first();
  await expect(first).toContainText("Paris");
  await first.click();
  await expect(page.locator(".chosen-area-paper h3")).toContainText("Paris");
  await expect(page.locator('.geographic-map[data-renderer="maplibre"][data-map-status="ready"]')).toBeVisible({ timeout: 25_000 });
  await page.evaluate(() => document.fonts.ready);
  result.selectedArea = await page.locator(".chosen-area-paper h3").innerText();
  result.renderer = await page.locator(".geographic-map").getAttribute("data-renderer");
  result.passed = errors.length === 0;
} catch {
  result.error = "The actual browser city-search flow did not complete; no response fixture or automatic retry was used.";
  process.exitCode = 1;
} finally {
  result.pageErrors = errors;
  await page.screenshot({ path: `${output}/paris.png` }).catch(() => {});
  await writeFile(`${output}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}
console.log(JSON.stringify(result));
if (!result.passed) process.exitCode = 1;
