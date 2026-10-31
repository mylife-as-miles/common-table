import { chromium } from "playwright";
import { mkdir, rm, writeFile } from "node:fs/promises";

const destination = process.env.CAPTURE_DIR || "artifacts/physical";
const base = process.env.PREVIEW_URL || "http://localhost:4173";
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
context.setDefaultTimeout(15000);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const pause = (ms) => page.waitForTimeout(ms);
const nav = (name) =>
  page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: new RegExp(name) });
async function settle() {
  await page.evaluate(() => document.fonts.ready);
  await page
    .locator("img")
    .evaluateAll((images) =>
      Promise.all(images.map((image) => image.decode().catch(() => {}))),
    );
  await pause(900);
}
async function shot(name, fullPage = false) {
  await page.screenshot({ path: `${destination}/${name}.png`, fullPage });
}
async function addGuest(name) {
  await page
    .getByRole("button", { name: "Add a demo guest", exact: true })
    .click();
  await page.getByLabel("Guest’s name").fill(name);
  await page
    .getByRole("button", { name: "Set their place", exact: true })
    .click();
}
async function mobileShot(name, view, stage, heldCurl = false) {
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: await context.storageState(),
    hasTouch: true,
  });
  try {
    const phone = await mobile.newPage();
    phone.on("pageerror", (error) => errors.push(error.message));
    await phone.goto(`${base}/#${view}`);
    await phone.evaluate(() => document.fonts.ready);
    await phone
      .locator("img")
      .evaluateAll((images) =>
        Promise.all(images.map((image) => image.decode().catch(() => {}))),
      );
    await phone.waitForTimeout(1000);
    await phone.locator(stage).scrollIntoViewIfNeeded();
    await phone.evaluate(() => {
      document.activeElement?.blur?.();
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    });
    await phone.waitForTimeout(200);
    await phone.screenshot({
      path: `${destination}/${name}.png`,
      fullPage: true,
    });
    if (heldCurl) {
      await phone.locator(".folio-curl-stage").scrollIntoViewIfNeeded();
      const control = await phone
        .getByRole("button", { name: "Turn this page", exact: true })
        .boundingBox();
      const paper = await phone.locator(".folio-curl-stage").boundingBox();
      if (!control || !paper) throw Error("Mobile paper grip missing");
      const x = control.x + control.width * 0.7,
        y = control.y + control.height * 0.7;
      await phone.mouse.move(x, y);
      await phone.mouse.down();
      await phone.mouse.move(x - paper.width * 0.45, y - paper.height * 0.13, {
        steps: 20,
      });
      await phone
        .locator('.menu-book-scene[data-flip-state="dragging"]')
        .waitFor();
      await phone.screenshot({
        path: `${destination}/04b-mobile-held-curl.png`,
      });
      await phone.mouse.up();
    }
  } finally {
    await mobile.close();
  }
}
try {
  await page.goto(`${base}/#menu`);
  await settle();
  await page.locator(".menu-book-scene").scrollIntoViewIfNeeded();
  await shot("01-open-book");
  const curl = page.locator(".folio-curl-stage");
  await curl.waitFor();
  await curl.scrollIntoViewIfNeeded();
  const box = await curl.boundingBox();
  if (!box) throw Error("Curl stage missing");
  const control = await page
    .getByRole("button", { name: "Turn this page", exact: true })
    .boundingBox();
  if (!control) throw Error("Native corner grip missing");
  const corner = {
    x: control.x + control.width * 0.7,
    y: control.y + control.height * 0.7,
  };
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(
    corner.x - box.width * 0.3,
    corner.y - box.height * 0.14,
    { steps: 20 },
  );
  await pause(220);
  if (
    (await page.locator(".menu-book-scene").getAttribute("data-flip-state")) !==
    "dragging"
  )
    throw Error("Held capture must show an actual active curl");
  await shot("02-held-paper-curl");
  await page.mouse.move(
    box.x + box.width * 0.19,
    corner.y - box.height * 0.06,
    { steps: 14 },
  );
  await page.mouse.up();
  await settle();
  await shot("03-completed-page-turn");
  await page
    .getByRole("button", { name: "Previous restaurant", exact: true })
    .click();
  await settle();
  await page
    .getByRole("button", { name: "Next restaurant", exact: true })
    .click();
  await settle();
  await mobileShot("04-mobile-book", "menu", ".menu-book-scene", true);
  await page
    .getByRole("button", { name: "Bring this to the table", exact: true })
    .click();
  await settle();
  await page.locator(".toast.visible").waitFor({ state: "detached" });
  await page.locator('.ct-physical-frame[data-image-loaded="true"]').waitFor();
  await page.locator(".ct-table-stage").scrollIntoViewIfNeeded();
  await shot("11-table-solo");
  await addGuest("Maya");
  await addGuest("Alex");
  await settle();
  await page.locator('.ct-physical-frame[data-image-loaded="true"]').waitFor();
  await page.locator(".ct-table-stage").scrollIntoViewIfNeeded();
  await shot("05-table-three");
  await mobileShot("06-mobile-table", "table", ".ct-table-stage");
  await nav("Dinner plan").click();
  await page
    .getByLabel("A note for the evening")
    .fill("A long dinner, no rushing. A little walk after.");
  for (const checkbox of await page.getByRole("checkbox").all())
    await checkbox.check();
  await page.locator(".pp-machine").scrollIntoViewIfNeeded();
  await page
    .getByRole("button", { name: "Operate dinner plan press", exact: true })
    .click();
  await page.locator('.printing-press[data-phase="printed"]').waitFor();
  const tear = page.getByRole("button", {
    name: "Tear off dinner plan",
    exact: true,
  });
  await tear.scrollIntoViewIfNeeded();
  await settle();
  await shot("07-printed-plan");
  let grip = await tear.boundingBox();
  if (!grip) throw Error("Tear grip missing");
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    grip.x + grip.width / 2,
    grip.y + grip.height / 2 + 60,
    { steps: 14 },
  );
  await pause(250);
  await page.locator('.printing-press[data-paper="pulling"]').waitFor();
  await shot("08-held-perforation");
  await page.mouse.up();
  await pause(650);
  await page.locator('.printing-press[data-paper="attached"]').waitFor();
  grip = await tear.boundingBox();
  if (!grip) throw Error("Returned tear grip missing");
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    grip.x + grip.width / 2,
    grip.y + grip.height / 2 + 120,
    { steps: 18 },
  );
  await pause(200);
  await page.mouse.up();
  await settle();
  await page.locator('.printing-press[data-paper="detached"]').waitFor();
  await shot("09-detached-plan", true);
  await nav("Your table").click();
  for (const name of ["Sam", "Jo", "Riley"]) await addGuest(name);
  await settle();
  await page.locator('.ct-physical-frame[data-image-loaded="true"]').waitFor();
  await page.locator(".ct-table-stage").scrollIntoViewIfNeeded();
  await shot("10-table-six");
  await mobileShot("12-mobile-table-six", "table", ".ct-table-stage");
  await writeFile(
    `${destination}/capture-results.json`,
    JSON.stringify(
      {
        source:
          "Actual local production UI and pointer gestures; original rendered table assets; fictional dining data",
        errors,
        desktop: { width: 1440, height: 1000 },
        mobile: { width: 390, height: 844 },
      },
      null,
      2,
    ) + "\n",
  );
  if (errors.length) throw Error(errors.join("\n"));
} finally {
  await context.close();
  await page.video().saveAs(`${destination}/book-table-tear.webm`);
  await browser.close();
  await rm(`${destination}/raw`, { recursive: true, force: true });
}
console.log(
  `Captured real book, table and tear interactions in ${destination}`,
);
