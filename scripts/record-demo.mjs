import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";

const directory = "artifacts/immersive";
await mkdir(`${directory}/raw`, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: `${directory}/raw`, size: { width: 1440, height: 1000 } },
});
const page = await context.newPage();
const pause = () => page.waitForTimeout(1100);
try {
  await page.goto(
    `${process.env.PREVIEW_URL || "http://localhost:4174"}/#explore`,
  );
  await page.evaluate(() => document.fonts.ready);
  await pause();
  await page.locator(".immersive-atlas").scrollIntoViewIfNeeded();
  const map = await page.locator(".atlas-viewport").boundingBox();
  await page.mouse.move(map.x + 170, map.y + 230);
  await page.mouse.down();
  await page.mouse.move(map.x + 260, map.y + 270, { steps: 22 });
  await page.mouse.up();
  await pause();
  await page
    .locator(".atlas-photo-pin")
    .filter({ hasText: "Olive & Ember" })
    .click();
  await pause();
  await page.getByRole("button", { name: "Switch to evening light" }).click();
  await pause();
  await page
    .getByRole("button", { name: "Open the menu", exact: true })
    .click();
  await pause();
  await page.getByRole("button", { name: /A word with.*The Waiter/ }).click();
  await pause();
  await page.getByRole("button", { name: "Ring the service bell" }).click();
  await pause();
  await page
    .getByRole("button", { name: "Why this place?", exact: true })
    .click();
  await pause();
  await page.getByLabel("Or leave a small request").fill("another place");
  await page
    .getByRole("button", { name: "Ask The Waiter", exact: true })
    .click();
  await pause();
  await page.getByRole("button", { name: "Keep this possibility" }).click();
  await pause();
  await page
    .getByRole("button", { name: "Open this menu", exact: true })
    .click();
  await pause();
  await page.getByRole("button", { name: "Bring this to the table" }).click();
  await pause();
  await page.locator(".tp-table-layout").scrollIntoViewIfNeeded();
  await pause();
} finally {
  await context.close();
  await page.video().saveAs(`${directory}/interaction-demo.webm`);
  await browser.close();
  await rm(`${directory}/raw`, { recursive: true, force: true });
}
console.log(`Saved ${directory}/interaction-demo.webm`);
