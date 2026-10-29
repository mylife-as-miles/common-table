import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
});
const page = await context.newPage();
await mkdir("artifacts", { recursive: true });
async function capture(name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  await page
    .locator("img")
    .evaluateAll((images) =>
      Promise.all(images.map((img) => img.decode().catch(() => {}))),
    );
  await page.waitForTimeout(700);
  await page.screenshot({ path: `artifacts/${name}.png`, fullPage: true });
}
try {
  await page.goto(process.env.PREVIEW_URL || "http://localhost:4174");
  await capture("01-menu-desktop");
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await capture("02-map-desktop");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("03-menu-mobile");
  await page.getByRole("tab", { name: "The place", exact: true }).click();
  await capture("04-place-mobile");
  await page.getByRole("tab", { name: "The menu", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByRole("button", { name: "Bring this to the table" }).click();
  await page.waitForURL("**/#table");
  for (const name of ["Maya", "Alex"]) {
    await page.getByRole("button", { name: "Add a demo guest" }).click();
    await page.getByLabel("Guest’s name").fill(name);
    await page.getByRole("button", { name: "Set their place" }).click();
  }
  await page.getByRole("button", { name: "Edit You's tastes" }).click();
  await page.waitForTimeout(4600);
  await capture("05-table-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("06-table-mobile");
  await page
    .getByRole("button", { name: "Dinner plan", exact: false })
    .first()
    .click();
  await page.waitForURL("**/#plan");
  await page
    .getByLabel("A note for the evening")
    .fill("A long dinner, no rushing. A little walk after.");
  for (const checkbox of await page.getByRole("checkbox").all())
    await checkbox.check();
  await page.getByRole("button", { name: "Save this dinner plan" }).click();
  await capture("07-plan-mobile");
  await page.setViewportSize({ width: 1440, height: 1080 });
  await capture("08-plan-desktop");
  console.log("Saved eight screenshots to artifacts/.");
} finally {
  await browser.close();
}
