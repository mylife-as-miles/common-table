import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";
const destination = "artifacts/cinematic/final";
await mkdir(`${destination}/raw`, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: {
    dir: `${destination}/raw`,
    size: { width: 1440, height: 1000 },
  },
});
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);
try {
  await page.goto(
    `${process.env.PREVIEW_URL || "http://localhost:4173"}/#menu`,
  );
  await page.evaluate(() => document.fonts.ready);
  await pause(700);
  await page.getByRole("button", { name: "Close folio", exact: true }).click();
  await pause(900);
  await page.locator(".menu-book-scene").scrollIntoViewIfNeeded();
  await pause(600);
  await page.getByRole("button", { name: "Open folio", exact: true }).click();
  await pause(900);
  await page
    .getByRole("button", { name: "Turn this page", exact: true })
    .click();
  await pause(1000);
  await page
    .getByRole("button", { name: "Bring this to the table", exact: true })
    .click();
  await pause(650);
  await page
    .getByRole("button", { name: "Add a demo guest", exact: true })
    .click();
  await page.getByLabel("Guest’s name").fill("Maya");
  await page
    .getByRole("button", { name: "Set their place", exact: true })
    .click();
  await page.locator(".ct-table-stage").scrollIntoViewIfNeeded();
  await pause(1200);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /Dinner plan/ })
    .click();
  await pause(600);
  for (const checkbox of await page.getByRole("checkbox").all())
    await checkbox.check();
  await page.locator(".pp-machine").scrollIntoViewIfNeeded();
  await pause(500);
  await page
    .getByRole("button", { name: "Operate dinner plan press", exact: true })
    .click();
  await pause(2200);
  await page
    .getByRole("button", { name: "Operate dinner plan press", exact: true })
    .click();
  await pause(2200);
  const handle = page.getByRole("button", {
    name: "Tear off dinner plan",
    exact: true,
  });
  await handle.scrollIntoViewIfNeeded();
  for (const distance of [40, 115]) {
    const box = await handle.boundingBox();
    if (!box) throw Error("Tear handle missing");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2,
      box.y + box.height / 2 + distance,
      { steps: 12 },
    );
    await pause(300);
    await page.mouse.up();
    await pause(750);
  }
} finally {
  await context.close();
  await page.video().saveAs(`${destination}/interactive-evening.webm`);
  await browser.close();
  await rm(`${destination}/raw`, { recursive: true, force: true });
}
console.log(
  `Recorded actual folio, table and letterpress interactions in ${destination}/interactive-evening.webm`,
);
