import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { unavailableOptionalServices } from "./helpers/offline-services.ts";
import {
  persistedState,
  readDeviceRecord,
  readSerializedApp,
  watchAppWrites,
} from "./helpers/device-storage.ts";

const press = (page: Page) =>
  page.getByRole("group", { name: "Dinner plan printing press" });
const folio = (page: Page) => page.locator(".menu-book-scene");
const notes = (page: Page) => page.getByLabel("A note for the evening");
const nav = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: new RegExp(name) });
async function storedPlan(page: Page) {
  return (await persistedState(page)).plan;
}
async function approve(page: Page) {
  for (const checkbox of await page.getByRole("checkbox").all())
    await checkbox.check();
}
async function plan(page: Page, note = "A long dinner and a little walk.") {
  await page.goto("/#menu");
  await page
    .getByRole("button", { name: "Bring this to the table", exact: true })
    .click();
  await nav(page, "Dinner plan").click();
  await expect(press(page)).toBeVisible();
  await notes(page).fill(note);
  await approve(page);
}
async function aa(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  ).toEqual([]);
}
const tear = (page: Page) =>
  press(page).getByRole("button", {
    name: "Tear off dinner plan",
    exact: true,
  });
async function usableTearHandle(page: Page) {
  const handle = tear(page);
  await expect(handle).toHaveAccessibleDescription(/pull|drag|Enter/i);
  await handle.scrollIntoViewIfNeeded();
  const target = await handle.boundingBox();
  expect(target!.width).toBeGreaterThanOrEqual(44);
  expect(target!.height).toBeGreaterThanOrEqual(44);
  expect(
    await handle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (
        document
          .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          ?.closest("button") === el
      );
    }),
  ).toBe(true);
}
async function printedPlan(page: Page) {
  await plan(page);
  await page.clock.install();
  await page
    .getByRole("button", { name: "Save this dinner plan", exact: true })
    .click();
  await page.clock.fastForward(1800);
  await expect(press(page)).toHaveAttribute("data-phase", "printed");
  await expect(press(page)).toHaveAttribute("data-paper", "attached");
}
async function pullPaper(page: Page, distance: number) {
  const handle = tear(page);
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2,
    y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + distance, { steps: 8 });
  return { x, y };
}
async function watchVisualOnlyWrites(page: Page) {
  return watchAppWrites(page);
}
async function trackFrames(page: Page) {
  await page.addInitScript(() => {
    const pending = new Set<number>();
    (window as unknown as { __pendingFrames: Set<number> }).__pendingFrames =
      pending;
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      const id = request((time) => {
        pending.delete(id);
        callback(time);
      });
      pending.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      pending.delete(id);
      cancel(id);
    };
  });
}
const venueTitle = (page: Page) =>
  page.locator(".book-restaurant-title").getByRole("heading");
async function noFrames(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __pendingFrames: Set<number> })
            .__pendingFrames.size,
      ),
    )
    .toBe(0);
}
async function settledBook(page: Page) {
  await expect(folio(page)).toHaveAttribute("data-flip-state", "idle");
  await expect(page.locator(".folio-curl-engine")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Bring this to the table", exact: true }),
  ).toHaveCount(1);
}
async function beginLeafPull(
  page: Page,
  direction: "next" | "previous",
  fraction: number,
) {
  const handle = page.getByRole("button", {
    name: direction === "next" ? "Turn this page" : "Turn back a page",
    exact: true,
  });
  await handle.scrollIntoViewIfNeeded();
  const target = await handle.boundingBox();
  const paper = await page.locator(".book-pages").boundingBox();
  expect(target).not.toBeNull();
  expect(paper).not.toBeNull();
  const x = target!.x + target!.width / 2,
    y = target!.y + target!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(
    x + (direction === "next" ? -1 : 1) * paper!.width * fraction,
    y - Math.min(50, paper!.height * fraction),
    { steps: 12 },
  );
}
async function snapshotsArePaintOnly(page: Page) {
  const stage = page.locator(".folio-curl-stage");
  await expect(stage).toHaveAttribute("aria-hidden", "true");
  expect(await stage.locator(".folio-curl-leaf").count()).toBeGreaterThan(0);
  await expect(stage.locator("[id]")).toHaveCount(0);
  expect(
    await stage
      .locator("button,a[href],input,select,textarea,[tabindex]")
      .evaluateAll((elements) =>
        elements.every(
          (el) =>
            (el as HTMLElement).tabIndex < 0 && el.closest("[inert]") !== null,
        ),
      ),
  ).toBe(true);
  const duplicateIds = await page.locator("[id]").evaluateAll((elements) => {
    const seen = new Set<string>();
    return elements
      .map((el) => el.id)
      .filter((id) => {
        if (seen.has(id)) return true;
        seen.add(id);
        return false;
      });
  });
  expect(duplicateIds).toEqual([]);
  await expect(page.locator(".book-pages")).toHaveAttribute("inert", "");
  await expect(page.locator(".book-pages")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Bring this to the table", exact: true }),
  ).toHaveCount(0);
}
async function localMap(page: Page) {
  const tile = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNIrAr4DwAElgIrUm/6bwAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["localhost", "127.0.0.1"].includes(url.hostname))
      return route.fallback();
    if (
      url.hostname === "tiles.openfreemap.org" &&
      url.pathname.includes("/styles/")
    )
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 8,
          sources: {},
          layers: [
            {
              id: "qa-ground",
              type: "background",
              paint: { "background-color": "#eee8d6" },
            },
          ],
        }),
      });
    if (url.hostname.endsWith("tile.openstreetmap.org"))
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: tile,
      });
    return route.abort("blockedbyclient");
  });
}
const errors = new WeakMap<Page, string[]>();
const unexpectedDownloads = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  await unavailableOptionalServices(page);
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  const downloads: string[] = [];
  unexpectedDownloads.set(page, downloads);
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await page.addInitScript(() => {
    (window as unknown as { __systemPrintCalls: number }).__systemPrintCalls =
      0;
    window.print = () => {
      (window as unknown as { __systemPrintCalls: number })
        .__systemPrintCalls++;
    };
  });
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(unexpectedDownloads.get(page)).toEqual([]);
  if (!page.isClosed())
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __systemPrintCalls: number })
            .__systemPrintCalls,
      ),
    ).toBe(0);
});

test("saving persists immediately while the physical cycle remains finite and ignores repeated busy-lever presses", async ({
  page,
}) => {
  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await plan(page);
  await page.clock.install();
  await page
    .getByRole("button", { name: "Save this dinner plan", exact: true })
    .click();
  await expect(press(page)).toHaveAttribute("data-phase", "printing");
  await expect.poll(async () => (await storedPlan(page)).saved).toBe(true);
  await expect(
    page.getByRole("button", { name: "Saved for a good evening", exact: true }),
  ).toBeFocused();
  await expect(
    press(page).getByRole("button", {
      name: "Reprint dinner plan",
      exact: true,
    }),
  ).toBeDisabled();
  await page.clock.fastForward(1000);
  const lever = press(page).getByRole("button", {
    name: "Operate dinner plan press",
    exact: true,
  });
  await lever.scrollIntoViewIfNeeded();
  const box = await lever.boundingBox();
  expect(box).not.toBeNull();
  // Real pointer events exercise the busy guard even if aria-disabled retains focus.
  for (let i = 0; i < 3; i++)
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.clock.fastForward(800);
  await expect(press(page)).toHaveAttribute("data-phase", "printed");
  await expect(
    press(page).getByRole("article", { name: "Dinner plan summary" }),
  ).toHaveCount(1);
  expect(
    await press(page).evaluate(
      (el) =>
        el
          .getAnimations({ subtree: true })
          .filter((a) => a.effect?.getTiming().iterations === Infinity).length,
    ),
  ).toBe(0);
  expect(downloads).toEqual([]);
});

test("reprinting changes the physical impression without rewriting the saved plan or starting an export", async ({
  page,
}) => {
  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await plan(page);
  await page.clock.install();
  await page
    .getByRole("button", { name: "Save this dinner plan", exact: true })
    .click();
  await page.clock.fastForward(1800);
  await expect(press(page)).toHaveAttribute("data-phase", "printed");
  const unchanged = await watchAppWrites(page);
  for (let i = 0; i < 2; i++) {
    await press(page)
      .getByRole("button", { name: "Reprint dinner plan", exact: true })
      .click();
    await expect(press(page)).toHaveAttribute("data-phase", "printing");
    await page.clock.fastForward(1800);
    await expect(press(page)).toHaveAttribute("data-phase", "printed");
  }
  await unchanged();
  expect(downloads).toEqual([]);
});

test("editing during a press cancels stale paper and approvals, and a later cycle prints the revised draft", async ({
  page,
}) => {
  await plan(page, "The first proof.");
  await page.clock.install();
  await page
    .getByRole("button", { name: "Save this dinner plan", exact: true })
    .click();
  await expect(press(page)).toHaveAttribute("data-phase", "printing");
  await notes(page).fill("The revised evening, with room for a walk.");
  await expect(press(page)).toHaveAttribute("data-phase", "idle");
  for (const checkbox of await page.getByRole("checkbox").all())
    await expect(checkbox).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Save this dinner plan", exact: true }),
  ).toBeDisabled();
  await page.clock.fastForward(5000);
  expect((await storedPlan(page)).saved).toBe(false);
  await expect(
    press(page).getByRole("article", { name: "Dinner plan summary" }),
  ).toContainText("The revised evening, with room for a walk.");
  await expect(press(page)).not.toContainText("The first proof.");
  await expect(press(page).locator(".pp-agreement-stamp")).toHaveCount(0);
  await approve(page);
  await page
    .getByRole("button", { name: "Save this dinner plan", exact: true })
    .click();
  await page.clock.fastForward(1800);
  await expect(press(page)).toHaveAttribute("data-phase", "printed");
  expect((await storedPlan(page)).note).toBe(
    "The revised evening, with room for a walk.",
  );
  expect((await storedPlan(page)).saved).toBe(true);
});

test("leaving a running press tears down its presentation and cannot revive an invalidated plan on return", async ({
  page,
}) => {
  await plan(page);
  await page.clock.install();
  await page
    .getByRole("button", { name: "Save this dinner plan", exact: true })
    .click();
  await expect(press(page)).toHaveAttribute("data-phase", "printing");
  await nav(page, "Your table").click();
  await expect(page.locator(".printing-press")).toHaveCount(0);
  const budget = page.getByRole("slider", { name: /Comfortable spend/ });
  await budget.focus();
  await page.keyboard.press("ArrowRight");
  await nav(page, "Dinner plan").click();
  await expect(press(page)).toHaveAttribute("data-phase", "idle");
  await page.clock.fastForward(5000);
  await expect(press(page)).toHaveAttribute("data-phase", "idle");
  expect((await storedPlan(page)).saved).toBe(false);
  await expect(
    page.getByRole("button", { name: "Save this dinner plan", exact: true }),
  ).toBeDisabled();
});

test("the physical lever supports keyboard operation and retained focus through save and reprint", async ({
  page,
}) => {
  await plan(page);
  const lever = press(page).getByRole("button", {
    name: "Operate dinner plan press",
    exact: true,
  });
  await page
    .getByRole("checkbox", { name: "Works for me", exact: true })
    .uncheck();
  await expect(lever).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "Works for me", exact: true })
    .check();
  await expect(lever).toBeEnabled();
  await lever.focus();
  await page.keyboard.press("Space");
  await expect(press(page)).toHaveAttribute("data-phase", "printing");
  await expect(lever).toBeFocused();
  await expect(press(page)).toHaveAttribute("data-phase", "printed");
  await expect(lever).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(press(page)).toHaveAttribute("data-phase", "printing");
  await expect(press(page)).toHaveAttribute("data-phase", "printed");
  await expect(lever).toBeFocused();
  await expect
    .poll(() =>
      press(page).evaluate(
        (el) =>
          el
            .getAnimations({ subtree: true })
            .filter((a) => a.playState === "running").length,
      ),
    )
    .toBe(0);
  await aa(page);
});

for (const mode of ["reduced motion", "low power"] as const) {
  test(`${mode} keeps folio and press functional with immediate, static presentation`, async ({
    page,
  }) => {
    await trackFrames(page);
    if (mode === "reduced motion")
      await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#menu");
    if (mode === "low power") {
      await page
        .getByRole("button", { name: "Low-power view", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await readDeviceRecord<boolean>(page, "settings", "lowPower"))
              ?.value,
        )
        .toBe(true);
    }
    await page
      .getByRole("button", { name: "Close folio", exact: true })
      .click();
    await expect(folio(page)).toHaveAttribute("data-folio-open", "false");
    await page.getByRole("button", { name: "Open folio", exact: true }).click();
    await expect(folio(page)).toHaveAttribute("data-folio-open", "true");
    await page
      .getByRole("button", { name: "Turn this page", exact: true })
      .click();
    await settledBook(page);
    await noFrames(page);
    expect(
      await folio(page).evaluate(
        (el) =>
          el
            .getAnimations({ subtree: true })
            .filter((a) => a.playState === "running").length,
      ),
    ).toBe(0);
    await page
      .getByRole("button", { name: "Bring this to the table", exact: true })
      .click();
    await nav(page, "Dinner plan").click();
    await approve(page);
    await page
      .getByRole("button", { name: "Save this dinner plan", exact: true })
      .click();
    await expect(press(page)).toHaveAttribute("data-phase", "printed");
    expect(
      await press(page).evaluate(
        (el) =>
          el
            .getAnimations({ subtree: true })
            .filter((a) => a.playState === "running").length,
      ),
    ).toBe(0);
    await press(page)
      .getByRole("button", { name: "Reprint dinner plan", exact: true })
      .click();
    await expect(press(page)).toHaveAttribute("data-phase", "printed");
    expect((await storedPlan(page)).saved).toBe(true);
    await tear(page).focus();
    await page.keyboard.press("Space");
    await expect(press(page)).toHaveAttribute("data-paper", "detached");
    expect(
      await press(page).evaluate(
        (el) =>
          el
            .getAnimations({ subtree: true })
            .filter((a) => a.playState === "running").length,
      ),
    ).toBe(0);
    await press(page)
      .getByRole("button", { name: "Reprint dinner plan", exact: true })
      .click();
    await expect(press(page)).toHaveAttribute("data-phase", "printed");
    await expect(press(page)).toHaveAttribute("data-paper", "attached");
    // Changing a fallback preference during an active cycle must stop its motion.
    if (mode === "reduced motion")
      await page.emulateMedia({ reducedMotion: "no-preference" });
    else
      await page
        .getByRole("button", { name: "Low-power view on", exact: true })
        .click();
    await press(page)
      .getByRole("button", { name: "Reprint dinner plan", exact: true })
      .click();
    await expect(press(page)).toHaveAttribute("data-phase", "printing");
    if (mode === "reduced motion")
      await page.emulateMedia({ reducedMotion: "reduce" });
    else
      await page
        .getByRole("button", { name: "Low-power view", exact: true })
        .click();
    await expect(press(page)).toHaveAttribute("data-phase", "printed");
    expect(
      await press(page).evaluate(
        (el) =>
          el
            .getAnimations({ subtree: true })
            .filter((a) => a.playState === "running").length,
      ),
    ).toBe(0);
  });
}

test("folio cover and folded page corner retain venue continuity and cancel active motion on navigation", async ({
  page,
}) => {
  await trackFrames(page);
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    (
      window as unknown as { __folioAnimations: Animation[] }
    ).__folioAnimations = [];
    Element.prototype.animate = function (
      ...args: Parameters<Element["animate"]>
    ) {
      const a = original.apply(this, args);
      if (this.closest(".menu-book-scene"))
        (
          window as unknown as { __folioAnimations: Animation[] }
        ).__folioAnimations.push(a);
      return a;
    };
  });
  await page.goto("/#menu");
  const first = (
    await page
      .locator(".book-restaurant-title")
      .getByRole("heading")
      .innerText()
  ).trim();
  await page.getByRole("button", { name: "Close folio", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open folio", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".book-pages")).toHaveAttribute("inert", "");
  await expect(
    page.getByRole("button", { name: "Bring this to the table", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open the folio", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Close folio", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".book-restaurant-title")).toContainText(first);
  await page
    .getByRole("button", { name: "Turn this page", exact: true })
    .click();
  await expect(page.locator(".book-restaurant-title")).not.toContainText(first);
  const second = (
    await page
      .locator(".book-restaurant-title")
      .getByRole("heading")
      .innerText()
  ).trim();
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(
    page.getByRole("article", { name: `${second}, selected restaurant` }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open the menu", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Turn this page", exact: true })
    .click();
  await expect(folio(page)).toHaveAttribute("data-flip-state", "flipping");
  await nav(page, "Your table").click();
  await expect(page.locator(".folio-curl-engine")).toHaveCount(0);
  await noFrames(page);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { __folioAnimations: Animation[] }
        ).__folioAnimations.filter((a) => a.playState === "running").length,
    ),
  ).toBe(0);
});

test("fine-pointer folio lighting responds to motion, resets on leave and leaves the main action unobstructed", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/#menu");
  const choose = page.getByRole("button", {
    name: "Bring this to the table",
    exact: true,
  });
  await choose.scrollIntoViewIfNeeded();
  const before = await page
    .locator(".menu-book")
    .evaluate((el) => getComputedStyle(el).transform);
  const box = await folio(page).boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * 0.8,
    Math.max(20, Math.min(900, box!.y + box!.height * 0.4)),
  );
  await expect
    .poll(() =>
      folio(page).evaluate((el) =>
        (el as HTMLElement).style.getPropertyValue("--folio-ry"),
      ),
    )
    .not.toBe("0deg");
  await expect
    .poll(() =>
      page
        .locator(".menu-book")
        .evaluate((el) => getComputedStyle(el).transform),
    )
    .not.toBe(before);
  expect(
    await choose.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (
        document
          .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          ?.closest("button") === el
      );
    }),
  ).toBe(true);
  await page.mouse.move(4, 4);
  await expect
    .poll(() =>
      folio(page).evaluate((el) =>
        (el as HTMLElement).style.getPropertyValue("--folio-rx"),
      ),
    )
    .toBe("0deg");
  await expect
    .poll(() =>
      folio(page).evaluate((el) =>
        (el as HTMLElement).style.getPropertyValue("--folio-ry"),
      ),
    )
    .toBe("0deg");
  await choose.click();
  await expect(page).toHaveURL(/#table$/);
});

test("interaction sound creates no audio context before opt-in and switching it off stops subsequent cues", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    (
      window as unknown as {
        __audioContexts: AudioContext[];
        __audioSources: number;
      }
    ).__audioContexts = [];
    (window as unknown as { __audioSources: number }).__audioSources = 0;
    const Constructor = new Proxy(Native, {
      construct(target, args) {
        const context = Reflect.construct(target, args) as AudioContext;
        (
          window as unknown as { __audioContexts: AudioContext[] }
        ).__audioContexts.push(context);
        const oscillator = context.createOscillator.bind(context),
          buffer = context.createBufferSource.bind(context);
        context.createOscillator = () => {
          (window as unknown as { __audioSources: number }).__audioSources++;
          return oscillator();
        };
        context.createBufferSource = () => {
          (window as unknown as { __audioSources: number }).__audioSources++;
          return buffer();
        };
        return context;
      },
    });
    Object.defineProperty(window, "AudioContext", {
      value: Constructor,
      configurable: true,
    });
  });
  await page.goto("/#menu");
  await page
    .getByRole("button", { name: "Turn this page", exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __audioContexts: AudioContext[] })
          .__audioContexts.length,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "Sound off", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sound on", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __audioContexts: AudioContext[] })
          .__audioContexts.length,
    ),
  ).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __audioContexts: AudioContext[] })
            .__audioContexts[0].state,
      ),
    )
    .toBe("running");
  await page.getByRole("button", { name: "Sound on", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sound off", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __audioContexts: AudioContext[] })
            .__audioContexts[0].state,
      ),
    )
    .toBe("suspended");
  const before = await page.evaluate(
    () => (window as unknown as { __audioSources: number }).__audioSources,
  );
  await page
    .getByRole("button", { name: "Turn this page", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => (window as unknown as { __audioSources: number }).__audioSources,
    ),
  ).toBe(before);
});

test("map look-around is finite, stops on command, and Escape cancels it before folding the atlas", async ({
  page,
}) => {
  await localMap(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const map = page.locator(".geographic-map");
  await expect(map).toHaveAttribute("data-map-status", "ready");
  await expect(map).toHaveAttribute("data-renderer", "maplibre");
  await page.clock.install();
  await page
    .getByRole("button", { name: "Look around this area", exact: true })
    .click();
  await expect(map).toHaveAttribute("data-camera-look", "active");
  await page
    .getByRole("button", { name: "Stop look-around", exact: true })
    .click();
  await expect(map).toHaveAttribute("data-camera-look", "idle");
  await page.clock.fastForward(5000);
  await expect(map).toHaveAttribute("data-camera-look", "idle");
  await page.getByRole("button", { name: "Unfold map", exact: true }).click();
  await page
    .getByRole("button", { name: "Look around this area", exact: true })
    .click();
  await map.locator(".maplibregl-canvas").focus();
  await page.keyboard.press("Escape");
  await expect(map).toHaveAttribute("data-camera-look", "idle");
  await expect(page.locator(".location-atlas")).toHaveClass(/is-unfolded/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".location-atlas")).not.toHaveClass(/is-unfolded/);
  await page
    .getByRole("button", { name: "Look around this area", exact: true })
    .click();
  await expect(map).toHaveAttribute("data-camera-look", "active");
  await page.clock.fastForward(4000);
  await expect(map).toHaveAttribute("data-camera-look", "idle");
  await page.clock.fastForward(8000);
  await expect(map).toHaveAttribute("data-camera-look", "idle");
  await page
    .getByRole("button", { name: "Look around this area", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Low-power view", exact: true })
    .click();
  await expect(map).toHaveAttribute("data-renderer", "leaflet");
  await expect(map).toHaveAttribute("data-camera-look", "idle");
  await expect(
    page.getByRole("button", { name: "Look around this area", exact: true }),
  ).toBeDisabled();
});

for (const width of [320, 390]) {
  test(`physical folio and printed ticket remain usable without horizontal overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#menu");
    await expect(folio(page)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Close folio", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "The menu", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Open the folio", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "The menu", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Bring this to the table", exact: true })
      .click();
    await nav(page, "Dinner plan").click();
    await approve(page);
    const lever = press(page).getByRole("button", {
      name: "Operate dinner plan press",
      exact: true,
    });
    await lever.scrollIntoViewIfNeeded();
    expect(
      await lever.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          document
            .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
            ?.closest("button") === el
        );
      }),
    ).toBe(true);
    await lever.click();
    await expect(press(page)).toHaveAttribute("data-phase", "printed");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("article", { name: "Dinner plan summary" }),
    ).toHaveCount(1);
    await aa(page);
    await usableTearHandle(page);
    await tear(page).click();
    await expect(press(page)).toHaveAttribute("data-paper", "detached");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const sheet = await press(page).locator(".pp-live-sheet").boundingBox();
    const console = await press(page)
      .locator(".pp-press-console")
      .boundingBox();
    expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(console!.y);
    await aa(page);
  });
}

test("the motor feeds a rigid current ticket through several distinct dwell positions", async ({
  page,
}) => {
  await plan(page);
  await page.clock.install();
  await page
    .getByRole("button", { name: "Save this dinner plan", exact: true })
    .click();
  await expect(press(page)).toHaveAttribute("data-phase", "printing");
  const samples = await press(page)
    .locator(".pp-live-sheet")
    .evaluate((el) => {
      const animation = el
        .getAnimations()
        .find(
          (a) =>
            (a.effect as KeyframeEffect | null)?.target === el &&
            (a.effect as KeyframeEffect)
              .getKeyframes()
              .some((frame) => Boolean(frame.transform)),
        );
      if (!animation)
        throw new Error(
          "The normal-motion feed has no inspectable sheet animation.",
        );
      const before = animation.currentTime;
      animation.pause();
      const result: {
        y: number;
        scaleX: number;
        scaleY: number;
        ticketScaleY: number;
      }[] = [];
      for (let time = 0; time <= 1650; time += 50) {
        animation.currentTime = time;
        const transform = getComputedStyle(el).transform;
        const matrix =
          transform === "none" ? new DOMMatrix() : new DOMMatrix(transform);
        const ticket = el.querySelector(".tp-receipt")!;
        const ticketTransform = getComputedStyle(ticket).transform;
        const ticketMatrix =
          ticketTransform === "none"
            ? new DOMMatrix()
            : new DOMMatrix(ticketTransform);
        result.push({
          y: Math.round(matrix.m42 * 10) / 10,
          scaleX: Math.hypot(matrix.m11, matrix.m12, matrix.m13),
          scaleY: Math.hypot(matrix.m21, matrix.m22, matrix.m23),
          ticketScaleY: Math.hypot(
            ticketMatrix.m21,
            ticketMatrix.m22,
            ticketMatrix.m23,
          ),
        });
      }
      animation.currentTime = before;
      animation.play();
      return result;
    });
  for (const sample of samples) {
    expect(sample.scaleX).toBeCloseTo(1, 3);
    expect(sample.scaleY).toBeCloseTo(1, 3);
    expect(sample.ticketScaleY).toBeCloseTo(1, 3);
  }
  const dwells = new Set(
    samples
      .filter((sample, i) => i > 0 && sample.y === samples[i - 1].y)
      .map((sample) => sample.y),
  );
  expect(dwells.size).toBeGreaterThanOrEqual(4);
  expect(
    new Set(samples.map((sample) => sample.y)).size,
  ).toBeGreaterThanOrEqual(5);
  await page.clock.fastForward(1800);
  await expect(press(page)).toHaveAttribute("data-phase", "printed");
});

test("keyboard tear keeps focus, is repeat-safe, and never saves or exports a second time", async ({
  page,
}) => {
  await printedPlan(page);
  const unchanged = await watchVisualOnlyWrites(page);
  const ticket = press(page).getByRole("article", {
    name: "Dinner plan summary",
  });
  await ticket.evaluate(
    (el) =>
      ((window as unknown as { __tearTicket: Element }).__tearTicket = el),
  );
  await usableTearHandle(page);
  await tear(page).focus();
  await page.keyboard.press("Space");
  await expect(press(page)).toHaveAttribute("data-paper", "detached");
  const detached = press(page).getByRole("button", {
    name: "Dinner plan detached",
    exact: true,
  });
  await expect(detached).toBeFocused();
  await expect(detached).toBeDisabled();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Enter");
  await expect(press(page)).toHaveAttribute("data-paper", "detached");
  expect(
    await ticket.evaluate(
      (el) =>
        el === (window as unknown as { __tearTicket: Element }).__tearTicket,
    ),
  ).toBe(true);
  await expect(ticket).toHaveCount(1);
  await unchanged();
  await aa(page);
});

test("short pulls, Escape and native touch cancellation leave the ticket attached and allow a later deliberate tear", async ({
  page,
  context,
}) => {
  await printedPlan(page);
  const unchanged = await watchVisualOnlyWrites(page);
  await pullPaper(page, 90);
  await expect(press(page)).toHaveAttribute("data-paper", "pulling");
  const resistedDistance = await press(page)
    .locator(".pp-live-sheet")
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42);
  expect(resistedDistance).toBeGreaterThan(0);
  expect(resistedDistance).toBeLessThan(90);
  await page.mouse.up();
  await expect(press(page)).toHaveAttribute("data-paper", "attached");
  await expect(
    press(page)
      .getByRole("status")
      .filter({ hasText: "short pull sprang back" }),
  ).toBeVisible();
  await pullPaper(page, 110);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(press(page)).toHaveAttribute("data-paper", "attached");
  await expect(
    press(page).getByRole("status").filter({ hasText: "Pull cancelled" }),
  ).toBeVisible();
  await tear(page).scrollIntoViewIfNeeded();
  const box = await tear(page).boundingBox();
  expect(box).not.toBeNull();
  const session = await context.newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  const touch = {
    id: 7,
    x: box!.x + box!.width / 2,
    y: box!.y + box!.height / 2,
  };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...touch, y: touch.y + 110 }],
  });
  await expect(press(page)).toHaveAttribute("data-paper", "pulling");
  await session.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await expect(press(page)).toHaveAttribute("data-paper", "attached");
  await tear(page).focus();
  await page.keyboard.press("Enter");
  await expect(press(page)).toHaveAttribute("data-paper", "detached");
  await unchanged();
});

test("a full pull detaches the same ticket clear of the console and reprint reattaches without another domain write", async ({
  page,
}) => {
  await printedPlan(page);
  const unchanged = await watchVisualOnlyWrites(page);
  const ticket = press(page).getByRole("article", {
    name: "Dinner plan summary",
  });
  await ticket.evaluate(
    (el) =>
      ((window as unknown as { __tearTicket: Element }).__tearTicket = el),
  );
  await pullPaper(page, 110);
  await page.mouse.up();
  await expect(press(page)).toHaveAttribute("data-paper", "detached");
  await expect(
    press(page).getByRole("button", {
      name: "Dinner plan detached",
      exact: true,
    }),
  ).toBeFocused();
  await expect
    .poll(async () => {
      const sheet = await press(page).locator(".pp-live-sheet").boundingBox(),
        console = await press(page).locator(".pp-press-console").boundingBox();
      return sheet!.y + sheet!.height - console!.y;
    })
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await ticket.evaluate(
      (el) =>
        el === (window as unknown as { __tearTicket: Element }).__tearTicket,
    ),
  ).toBe(true);
  await press(page)
    .getByRole("button", { name: "Reprint dinner plan", exact: true })
    .click();
  await expect(press(page)).toHaveAttribute("data-paper", "attached");
  await expect(press(page)).toHaveAttribute("data-phase", "printing");
  await expect(tear(page)).toBeDisabled();
  await page.clock.fastForward(1800);
  await expect(press(page)).toHaveAttribute("data-phase", "printed");
  await tear(page).click();
  await expect(press(page)).toHaveAttribute("data-paper", "detached");
  expect(
    await ticket.evaluate(
      (el) =>
        el === (window as unknown as { __tearTicket: Element }).__tearTicket,
    ),
  ).toBe(true);
  await expect(ticket).toHaveCount(1);
  await unchanged();
});

test("editing during an unfinished pull cancels the old gesture and leaves one live current proof", async ({
  page,
}) => {
  await printedPlan(page);
  const ticket = press(page).getByRole("article", {
    name: "Dinner plan summary",
  });
  await ticket.evaluate(
    (el) =>
      ((window as unknown as { __tearTicket: Element }).__tearTicket = el),
  );
  await pullPaper(page, 40);
  await notes(page).fill("A revised plan after the interrupted pull.");
  await page.mouse.up();
  await expect(press(page)).toHaveAttribute("data-paper", "attached");
  await expect(press(page)).toHaveAttribute("data-phase", "idle");
  await expect(
    press(page).getByRole("button", {
      name: "Tear off dinner plan",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(ticket).toContainText(
    "A revised plan after the interrupted pull.",
  );
  expect(
    await ticket.evaluate(
      (el) =>
        el === (window as unknown as { __tearTicket: Element }).__tearTicket,
    ),
  ).toBe(true);
  await page.clock.fastForward(5000);
  expect((await storedPlan(page)).saved).toBe(false);
  await approve(page);
  await page
    .getByRole("button", { name: "Save this dinner plan", exact: true })
    .click();
  await page.clock.fastForward(1800);
  await expect(press(page)).toHaveAttribute("data-phase", "printed");
  await expect(press(page)).toHaveAttribute("data-paper", "attached");
});

test("navigation during a captured pull releases the old gesture and returns to an attached saved plan", async ({
  page,
}) => {
  await printedPlan(page);
  const unchanged = await watchVisualOnlyWrites(page);
  await pullPaper(page, 40);
  await nav(page, "Your table").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".printing-press")).toHaveCount(0);
  await page.mouse.move(4, 4);
  await page.mouse.up();
  await nav(page, "Dinner plan").click();
  await expect(press(page)).toHaveAttribute("data-phase", "printed");
  await expect(press(page)).toHaveAttribute("data-paper", "attached");
  await page.clock.fastForward(5000);
  await unchanged();
});

test("tapping actual mobile seats reveals the single existing taste editor for the selected person", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#table");
  await page
    .getByRole("button", { name: "Add a demo guest", exact: true })
    .click();
  await page.getByLabel("Guest’s name").fill("Maya");
  await page.getByRole("button", { name: "Set their place" }).click();
  const maya = page.locator(".tp-seat").filter({ hasText: "Maya" }),
    you = page.locator(".tp-seat").filter({ hasText: "You" });
  await expect(maya).toBeFocused();
  const heading = page.locator("#table-taste-editor-heading");
  await maya.click();
  await expect(heading).toBeFocused();
  await expect(heading).toHaveAccessibleName(
    "Maya’s tastes: What sounds good?",
  );
  await expect
    .poll(() =>
      heading.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight;
      }),
    )
    .toBe(true);
  const vegan = page.getByRole("button", { name: "Vegan", exact: true });
  await vegan.click();
  await expect(vegan).toHaveAttribute("aria-pressed", "true");
  await you.click();
  await expect(heading).toBeFocused();
  await expect(heading).toHaveAccessibleName(/You.*tastes: What sounds good/);
  await expect(vegan).toHaveAttribute("aria-pressed", "false");
  await maya.click();
  await expect(heading).toBeFocused();
  await expect(vegan).toHaveAttribute("aria-pressed", "true");
  await maya.click();
  await expect(heading).toBeFocused();
  await expect(heading).toHaveCount(1);
});

test("a closed folio keeps its paper inaccessible after resize and a window blur event, then reopens to one live menu", async ({
  page,
}) => {
  await trackFrames(page);
  await page.goto("/#menu");
  const first = (await venueTitle(page).innerText()).trim();
  await page.getByRole("button", { name: "Close folio", exact: true }).click();
  const paper = page.locator(".book-pages");
  const closed = async () => {
    await expect(folio(page)).toHaveAttribute("data-folio-open", "false");
    await expect(paper).toHaveAttribute("inert", "");
    await expect(paper).toHaveAttribute("aria-hidden", "true");
    await expect(
      page.getByRole("button", {
        name: "Bring this to the table",
        exact: true,
      }),
    ).toHaveCount(0);
  };
  await closed();
  await page.setViewportSize({ width: 1000, height: 900 });
  await closed();
  // Headless Chromium keeps tabs focused; explicitly exercise the browser lifecycle event.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await closed();
  await page.getByRole("button", { name: "Open folio", exact: true }).click();
  await settledBook(page);
  await expect(paper).not.toHaveAttribute("inert", "");
  await expect(paper).toHaveAttribute("aria-hidden", "false");
  await expect(venueTitle(page)).toHaveText(first);
  await noFrames(page);
});

test("a real paper pull returns when short, cancels on Escape, and turns forward and back into the same dinner plan", async ({
  page,
}, testInfo) => {
  await trackFrames(page);
  await page.goto("/#menu");
  await settledBook(page);
  const first = (await venueTitle(page).innerText()).trim();
  const before = await readSerializedApp(page);
  await beginLeafPull(page, "next", 0.06);
  await expect(folio(page)).toHaveAttribute("data-flip-state", "dragging");
  await snapshotsArePaintOnly(page);
  await page.mouse.up();
  await settledBook(page);
  await expect(venueTitle(page)).toHaveText(first);
  expect(await readSerializedApp(page)).toBe(before);

  const corner = page.getByRole("button", {
    name: "Turn this page",
    exact: true,
  });
  await corner.scrollIntoViewIfNeeded();
  const box = await corner.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 - 12,
    box!.y + box!.height / 2 - 4,
    { steps: 3 },
  );
  await expect(folio(page)).toHaveAttribute("data-flip-state", "dragging");
  await page.getByRole("button", { name: "Close folio", exact: true }).focus();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () =>
          document.activeElement?.closest("[inert],[aria-hidden='true']") ===
          null,
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await settledBook(page);
  await expect(venueTitle(page)).toHaveText(first);
  await noFrames(page);

  await beginLeafPull(page, "next", 0.6);
  await snapshotsArePaintOnly(page);
  await testInfo.attach("actual-dragged-paper", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.mouse.up();
  await expect(venueTitle(page)).not.toHaveText(first);
  await settledBook(page);
  await noFrames(page);
  await beginLeafPull(page, "previous", 0.8);
  await page.mouse.up();
  await expect(venueTitle(page)).toHaveText(first);
  await settledBook(page);
  await page
    .getByRole("button", { name: "Bring this to the table", exact: true })
    .click();
  await expect(page.locator(".tp-chosen-venue")).toContainText(first);
  await nav(page, "Dinner plan").click();
  await expect(
    press(page).getByRole("article", { name: "Dinner plan summary" }),
  ).toContainText(first);
});

test("queued native page turns settle once per action and engine motion stops on Escape, navigation and low power", async ({
  page,
}) => {
  await trackFrames(page);
  await page.goto("/#menu");
  const next = page.getByRole("button", {
    name: "Next restaurant",
    exact: true,
  });
  const previous = page.getByRole("button", {
    name: "Previous restaurant",
    exact: true,
  });
  const first = (await venueTitle(page).innerText()).trim();
  await next.click();
  await expect(venueTitle(page)).not.toHaveText(first);
  await settledBook(page);
  const second = (await venueTitle(page).innerText()).trim();
  await previous.click();
  await expect(venueTitle(page)).toHaveText(first);
  await settledBook(page);
  await noFrames(page);
  await page.clock.install();
  // Rewrap the installed clock's RAF so pending-frame assertions remain real.
  await page.evaluate(() => {
    const pending = new Set<number>();
    (window as unknown as { __pendingFrames: Set<number> }).__pendingFrames =
      pending;
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      const id = request((time) => {
        pending.delete(id);
        callback(time);
      });
      pending.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      pending.delete(id);
      cancel(id);
    };
  });
  await page.clock.pauseAt(
    new Date(await page.evaluate(() => Date.now() + 100)),
  );
  await next.click();
  await next.click();
  // Stop exactly between one completed turn and its queued successor's RAF.
  let reachedGap = false;
  for (let frame = 0; frame < 100; frame++) {
    await page.clock.runFor(16);
    const gap = await page.evaluate(() => ({
      title: document
        .querySelector(".book-restaurant-title h2")
        ?.textContent?.trim(),
      phase:
        document.querySelector<HTMLElement>(".menu-book-scene")?.dataset
          .flipState,
      engines: document.querySelectorAll(".folio-curl-engine").length,
      pending: (window as unknown as { __pendingFrames: Set<number> })
        .__pendingFrames.size,
    }));
    if (
      gap.title === second &&
      gap.phase === "idle" &&
      gap.engines === 0 &&
      gap.pending > 0
    ) {
      reachedGap = true;
      break;
    }
  }
  expect(
    reachedGap,
    "the queued successor waits for the next animation frame",
  ).toBe(true);
  await previous.click();
  await expect(folio(page)).toHaveAttribute("data-flip-state", "idle");
  await expect(page.locator(".folio-curl-engine")).toHaveCount(0);
  await page.clock.runFor(3000);
  await expect(venueTitle(page)).toHaveText(second);
  await settledBook(page);
  await page.clock.resume();
  await noFrames(page);
  await next.click();
  await expect(folio(page)).toHaveAttribute("data-flip-state", "flipping");
  await page.keyboard.press("Escape");
  await settledBook(page);
  await expect(venueTitle(page)).toHaveText(second);
  await noFrames(page);
  await next.click();
  await expect(folio(page)).toHaveAttribute("data-flip-state", "flipping");
  await nav(page, "Your table").click();
  await expect(page.locator(".folio-curl-engine")).toHaveCount(0);
  await noFrames(page);
  await page.goto("/#menu");
  await expect(venueTitle(page)).toHaveText(second);
  await page
    .getByRole("button", { name: "Next restaurant", exact: true })
    .click();
  await expect(folio(page)).toHaveAttribute("data-flip-state", "flipping");
  await page
    .getByRole("button", { name: "Low-power view", exact: true })
    .click();
  await settledBook(page);
  await expect(venueTitle(page)).toHaveText(second);
  await noFrames(page);
  await page
    .getByRole("button", { name: "Next restaurant", exact: true })
    .click();
  await expect(venueTitle(page)).not.toHaveText(second);
  await settledBook(page);
  await noFrames(page);
});

test("touch paper curls return, turn in both directions, and cancel without exposing duplicate actions on mobile", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await trackFrames(page);
  await page.goto("/#menu");
  const first = (await venueTitle(page).innerText()).trim();
  const session = await context.newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  const gesture = async (
    direction: "next" | "previous",
    fraction: number,
    cancel = false,
  ) => {
    const handle = page.getByRole("button", {
      name: direction === "next" ? "Turn this page" : "Turn back a page",
      exact: true,
    });
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox(),
      paper = await page.locator(".book-pages").boundingBox();
    const start = {
      id: 7,
      x: box!.x + box!.width / 2,
      y: box!.y + box!.height / 2,
    };
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [start],
    });
    for (let step = 1; step <= 10; step++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            ...start,
            x:
              start.x +
              ((direction === "next" ? -1 : 1) *
                paper!.width *
                fraction *
                step) /
                10,
            y: start.y - (40 * step) / 10,
          },
        ],
      });
    }
    await expect(folio(page)).toHaveAttribute("data-flip-state", "dragging");
    await snapshotsArePaintOnly(page);
    await session.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
    await settledBook(page);
  };
  await gesture("next", 0.06);
  await expect(venueTitle(page)).toHaveText(first);
  await gesture("next", 0.8);
  await expect(venueTitle(page)).not.toHaveText(first);
  await gesture("previous", 0.8);
  await expect(venueTitle(page)).toHaveText(first);
  await gesture("next", 0.8, true);
  await expect(venueTitle(page)).toHaveText(first);
  await noFrames(page);
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await page
    .getByRole("button", { name: "Turn this page", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(venueTitle(page)).not.toHaveText(first);
  await settledBook(page);
  await page
    .getByRole("button", { name: "Turn back a page", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(venueTitle(page)).toHaveText(first);
  await settledBook(page);
  await page
    .getByRole("button", { name: "Bring this to the table", exact: true })
    .click();
  await expect(page.locator(".tp-chosen-venue")).toContainText(first);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

for (const width of [1440, 390]) {
  for (const count of [1, 3, 6]) {
    test(`projected table keeps ${count} native place cards individually usable at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/#table");
      const names = ["You", "Maya", "Theo", "Priya", "Noor", "Eli"].slice(
        0,
        count,
      );
      for (const name of names.slice(1)) {
        await page
          .getByRole("button", { name: "Add a demo guest", exact: true })
          .click();
        await page.getByLabel("Guest’s name").fill(name);
        await page
          .getByRole("button", { name: "Set their place", exact: true })
          .click();
      }
      const seats = page.locator(".tp-seat");
      await expect(seats).toHaveCount(count);
      const frame = page.locator(".ct-physical-frame");
      await expect(frame).toHaveAttribute("data-image-loaded", "true");
      const render = frame.locator(".ct-table-render");
      const image = await render.evaluate((el) => {
        const img = el as HTMLImageElement,
          r = img.getBoundingClientRect();
        const bounds = img.parentElement!.getBoundingClientRect();
        return {
          loaded: img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          fit: getComputedStyle(img).objectFit,
          ratio: r.width / r.height,
          frameRatio: bounds.width / bounds.height,
          left: r.left - bounds.left,
          top: r.top - bounds.top,
          width: r.width - bounds.width,
          height: r.height - bounds.height,
        };
      });
      expect(image.loaded).toBe(true);
      expect(image.naturalWidth).toBeGreaterThan(0);
      expect(image.naturalHeight).toBeGreaterThan(0);
      expect(image.fit).toBe("contain");
      expect(image.ratio).toBeCloseTo(
        image.naturalWidth / image.naturalHeight,
        2,
      );
      expect(image.frameRatio).toBeCloseTo(image.ratio, 2);
      for (const offset of [image.left, image.top, image.width, image.height])
        expect(Math.abs(offset)).toBeLessThanOrEqual(1);
      await expect(
        page.getByRole("group", {
          name: `Your table has ${count} ${count === 1 ? "seat" : "seats"}`,
          exact: true,
        }),
      ).toBeVisible();
      const cards = await seats.evaluateAll((elements) =>
        elements.map((el) => {
          const r = el.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        }),
      );
      for (const card of cards) {
        expect(card.width).toBeGreaterThanOrEqual(44);
        expect(card.height).toBeGreaterThanOrEqual(44);
      }
      for (let a = 0; a < cards.length; a++) {
        for (let b = a + 1; b < cards.length; b++) {
          const horizontal =
            Math.min(cards[a].right, cards[b].right) -
            Math.max(cards[a].x, cards[b].x);
          const vertical =
            Math.min(cards[a].bottom, cards[b].bottom) -
            Math.max(cards[a].y, cards[b].y);
          expect(
            horizontal <= 0 || vertical <= 0,
            `${names[a]} and ${names[b]} have separate native targets`,
          ).toBe(true);
        }
      }
      const heading = page.locator("#table-taste-editor-heading");
      for (const name of names) {
        const seat = seats.filter({
          has: page.locator(".tp-seat-label", {
            hasText: new RegExp(`^${name}$`),
          }),
        });
        await seat.scrollIntoViewIfNeeded();
        expect(
          await seat.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return (
              document
                .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
                ?.closest("button") === el
            );
          }),
          `${name} can receive a real center click`,
        ).toBe(true);
        await seat.click();
        await expect(seat).toHaveAttribute("aria-pressed", "true");
        const paperCard = seat.locator(".ct-physical-card");
        await paperCard.scrollIntoViewIfNeeded();
        expect(
          await paperCard.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return (
              document
                .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
                ?.closest("button") === el.closest("button")
            );
          }),
          `${name}'s actual paper card receives its own native click`,
        ).toBe(true);
        await paperCard.click();
        await expect(seat).toHaveAttribute("aria-pressed", "true");
        await expect(heading).toHaveAccessibleName(
          `${name}’s tastes: What sounds good?`,
        );
        if (width === 390) {
          await expect(heading).toBeFocused();
          await expect
            .poll(() =>
              heading.evaluate((el) => {
                const r = el.getBoundingClientRect();
                return r.top >= 0 && r.bottom <= innerHeight;
              }),
            )
            .toBe(true);
        }
      }
      await expect(heading).toHaveCount(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (count === 6) {
        await expect(
          page.getByRole("button", { name: "Add a demo guest", exact: true }),
        ).toBeDisabled();
        await aa(page);
      }
    });
  }
}
