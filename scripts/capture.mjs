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
await page.addInitScript(() => {
  if (!document.startViewTransition) return;
  const start = document.startViewTransition.bind(document);
  document.startViewTransition = (...args) => {
    const transition = start(...args);
    window.captureTransitionFinished = transition.finished.catch(() => {});
    return transition;
  };
});
await mkdir("artifacts", { recursive: true });
async function capture(name) {
  await page.locator("h1").waitFor();
  await page.evaluate(async () => { await window.captureTransitionFinished; });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.evaluate(() => document.fonts.ready);
  await page
    .locator("img")
    .evaluateAll((images) =>
      Promise.all(images.map((img) => img.decode().catch(() => {}))),
    );
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== "running"));
  await page.waitForTimeout(120);
  await page.screenshot({
    path: `artifacts/${name}.png`,
    fullPage: !name.includes("waiter"),
  });
}
try {
  await page.goto(process.env.PREVIEW_URL || "http://localhost:4174");
  await capture("02-map-desktop");
  await page.getByRole("button", { name: "Switch to evening light" }).click();
  await capture("09-map-evening-desktop");
  await page.getByRole("button", { name: "Switch to daylight" }).click();
  await page
    .getByRole("button", { name: "A little guidance", exact: true })
    .click();
  await capture("10-waiter-desktop");
  await page
    .getByRole("button", { name: "Why this place?", exact: true })
    .click();
  await capture("11-waiter-reasoning-desktop");
  await page
    .getByRole("button", { name: "Close guidance", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("12-map-mobile");
  await page
    .getByRole("button", { name: "A little guidance", exact: true })
    .click();
  await capture("13-waiter-mobile");
  await page
    .getByRole("button", { name: "Close guidance", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page
    .getByRole("button", { name: "Open the menu", exact: true })
    .click();
  await capture("01-menu-desktop");
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
  console.log("Saved thirteen screenshots to artifacts/.");
} finally {
  await browser.close();
}
