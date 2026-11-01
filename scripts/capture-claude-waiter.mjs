import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const destination = "artifacts/waiter-guidance";
const origin = process.env.PREVIEW_URL || "http://localhost:4174";
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const results = [];
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1100 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
    await page.goto(`${origin}/#explore`);
    await page.getByRole("button", { name: "A little guidance", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "The Waiter, at your service" });
    await modal.getByRole("radio", { name: /^Thoughtful guidance/ }).check();
    await modal.getByText("Try a sample answer.", { exact: false }).waitFor();
    await modal.getByLabel("Or leave a small request").fill("Does this fit our budget?");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1100);
    const response = page.waitForResponse((item) =>
      new URL(item.url()).pathname === "/api/waiter/reply",
    );
    await modal.getByRole("button", { name: "Ask The Waiter", exact: true }).click();
    const api = await response;
    const body = await api.json();
    if (api.status() !== 200 || body.source !== "mock")
      throw new Error("Expected the mock-only Waiter response.");
    await modal.locator(".cw-guidance-result").waitFor();
    await modal.locator(".cw-guidance-result").scrollIntoViewIfNeeded();
    const screenshot = `${mobile ? "02-mobile" : "01-desktop"}.png`;
    await page.screenshot({ path: `${destination}/${screenshot}` });
    let returnFocus;
    if (mobile) {
      const back = modal.getByRole("button", { name: "Back to the evening", exact: true });
      await back.scrollIntoViewIfNeeded();
      await back.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await page.screenshot({ path: `${destination}/03-mobile-request-and-exit.png` });
      await back.click();
      returnFocus = await page.getByRole("button", { name: "A little guidance", exact: true })
        .evaluate((element) => document.activeElement === element);
      if (!returnFocus) throw new Error("Waiter exit did not restore opener focus.");
    }
    results.push({
      mobile,
      screenshot,
      status: api.status(),
      source: body.source,
      errors,
      ...(mobile ? { returnFocus } : {}),
    });
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(`${destination}/capture-results.json`, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
