import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir("artifacts/location", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
  ...(process.env.HTTPS_PROXY
    ? {
        proxy: {
          server: process.env.HTTPS_PROXY,
          bypass: "localhost,127.0.0.1",
        },
      }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
});
// Raster-provider automated tile sweeps are not permitted; this live smoke uses
// OpenFreeMap vectors only. Automated fallback tests use local PNG fixtures.
await context.route("https://tile.openstreetmap.org/**", (route) =>
  route.abort(),
);
const page = await context.newPage();
const errors = [];
const captures = [];
const responses = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (response.url().startsWith("https://tiles.openfreemap.org/"))
    responses.push({
      status: response.status(),
      kind: response.url().endsWith(".pbf") ? "vector-data" : "map-resource",
    });
});
async function capture(name, fullPage = true) {
  await page
    .locator(
      '.geographic-map[data-renderer="maplibre"][data-map-status="ready"]',
    )
    .waitFor({ timeout: 40000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1400);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  captures.push({
    name,
    fieldNotes: await page.locator(".field-note-detail h3").innerText(),
  });
  await page.screenshot({
    path: `artifacts/location/${name}.png`,
    fullPage,
  });
}
try {
  await page.goto(process.env.PREVIEW_URL || "http://localhost:4174");
  await capture("01-real-map-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("02-real-map-mobile");
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.locator(".geo-poi-marker").first().waitFor({ timeout: 15000 });
  await page.locator(".geo-poi-marker").first().click();
  await page
    .getByRole("button", { name: "Keep this place", exact: true })
    .click();
  await capture("04-real-place-field-notes");
  await page.getByRole("button", { name: /Set supper light$/ }).click();
  await capture("05-supper-map");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("06-real-place-mobile");
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByRole("button", { name: /^Ask The Waiter about/ }).click();
  await capture("10-waiter-real-place", false);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^Ask The Waiter about/ }).click();
  await capture("11-waiter-real-place-mobile", false);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByRole("button", { name: /Set daylight$/ }).click();
  await page
    .getByRole("searchbox", { name: "Search a city or neighborhood" })
    .fill("Paris, France");
  await page
    .getByRole("button", { name: "Search places", exact: true })
    .click();
  const result = page
    .getByRole("list", { name: "Place search results" })
    .getByRole("button")
    .first();
  await result.waitFor({ timeout: 20000 });
  await result.click();
  await page.locator(".geo-poi-marker").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1800);
  await capture("03-searched-paris");
  await writeFile(
    "artifacts/location/live-smoke-results.json",
    JSON.stringify(
      {
        renderer: await page
          .locator(".geographic-map")
          .getAttribute("data-renderer"),
        selectedArea: await page.locator(".chosen-area-paper h3").innerText(),
        mappedPlaces: await page.locator(".geo-poi-marker").count(),
        keptPlaces: await page
          .getByRole("group", { name: "Map place collection" })
          .getByRole("button", { name: /^Kept/ })
          .innerText(),
        screenshots: captures,
        errors,
        openFreeMapResponses: responses,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Captured real OSM geography, mapped place selection, kept collection, supper light and live Paris search.",
  );
} finally {
  await browser.close();
}
