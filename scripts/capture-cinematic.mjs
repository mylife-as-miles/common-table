import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const destination = "artifacts/cinematic/final";
await mkdir(destination, { recursive: true });
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
await context.route("https://tile.openstreetmap.org/**", (route) =>
  route.abort(),
);
context.setDefaultTimeout(20000);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const base = process.env.PREVIEW_URL || "http://localhost:4173";
const nav = (name) =>
  page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: new RegExp(name) });
await page.addInitScript(() => {
  if (document.startViewTransition) {
    const original = document.startViewTransition.bind(document);
    document.startViewTransition = (...args) => {
      const transition = original(...args);
      window.captureTransitionFinished = transition.finished.catch(() => {});
      return transition;
    };
  }
});
async function settle() {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.evaluate(() => document.fonts.ready);
  await page
    .locator("img")
    .evaluateAll((images) =>
      Promise.all(images.map((img) => img.decode().catch(() => {}))),
    );
  await page.evaluate(async () => {
    await window.captureTransitionFinished;
  });
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running"),
  );
  await page.waitForFunction(() => {
    const folio = document.querySelector(".menu-book-scene");
    if (!folio || folio.getAttribute("data-folio-open") !== "true") return true;
    const board = folio.querySelector(".folio-front-board");
    const leaf = folio.querySelector(".folio-turn-sheet");
    return (
      (!board || getComputedStyle(board).visibility === "hidden") &&
      (!leaf || Number(getComputedStyle(leaf).opacity) < 0.01)
    );
  });
}
async function shot(name, { fullPage = true, settled = true } = {}) {
  if (settled) await settle();
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: `${destination}/${name}.png`, fullPage });
}
try {
  await page.goto(`${base}/#nearby`);
  await page
    .locator(
      '.geographic-map[data-renderer="maplibre"][data-map-status="ready"]',
    )
    .waitFor({ timeout: 45000 });
  await page.locator(".geo-poi-marker").first().waitFor({ timeout: 20000 });
  await shot("01-real-atlas-room");
  await page.goto(`${base}/#menu`);
  await shot("02-open-folio");
  await page.getByRole("button", { name: "Close folio", exact: true }).click();
  await shot("03-closed-folio");
  await page.getByRole("button", { name: "Open folio", exact: true }).click();
  await settle();
  await page
    .getByRole("button", { name: "Turn this page", exact: true })
    .click();
  await page.waitForTimeout(230);
  await shot("04-turning-paper", { settled: false });
  await settle();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("tablist", { name: "Restaurant book pages" })
    .waitFor({ state: "visible" });
  await shot("05-folio-mobile");
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page
    .getByRole("button", { name: "Bring this to the table", exact: true })
    .click();
  for (const name of ["Maya", "Alex"]) {
    await page
      .getByRole("button", { name: "Add a demo guest", exact: true })
      .click();
    await page.getByLabel("Guest’s name").fill(name);
    await page
      .getByRole("button", { name: "Set their place", exact: true })
      .click();
  }
  await shot("06-table-for-three");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("07-table-mobile");
  await page.setViewportSize({ width: 1440, height: 1080 });
  await nav("Dinner plan").click();
  await page
    .getByLabel("A note for the evening")
    .fill("A long dinner, no rushing. A little walk after.");
  for (const checkbox of await page.getByRole("checkbox").all())
    await checkbox.check();
  await page
    .getByRole("button", { name: "Operate dinner plan press", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Dinner plan printing press" })
    .waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector(".printing-press")?.dataset.phase === "printed",
  );
  await shot("08-printed-plan");
  await page
    .getByRole("button", { name: "Tear off dinner plan", exact: true })
    .click();
  await shot("11-detached-plan");
  await page
    .getByRole("button", { name: "Reprint dinner plan", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".printing-press")?.dataset.phase === "printed",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("09-printed-plan-mobile");
  await page
    .getByRole("button", { name: "A little guidance", exact: true })
    .click();
  await shot("10-waiter-mobile", { fullPage: false });
  await writeFile(
    `${destination}/live-capture-results.json`,
    JSON.stringify(
      {
        source:
          "production application; actual OpenFreeMap geography; fictional dining demo clearly labelled",
        errors,
        desktop: { width: 1440, height: 1080 },
        mobile: { width: 390, height: 844 },
      },
      null,
      2,
    ) + "\n",
  );
  if (errors.length) throw Error(errors.join("\n"));
  console.log(`Captured eleven production views in ${destination}`);
} finally {
  await browser.close();
}
