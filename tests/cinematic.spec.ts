import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const STORAGE_KEY = "common-table.demo.v1";
const press = (page: Page) =>
  page.getByRole("group", { name: "Dinner plan printing press" });
const folio = (page: Page) => page.locator(".menu-book-scene");
const notes = (page: Page) => page.getByLabel("A note for the evening");
const nav = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: new RegExp(name) });
async function storedPlan(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).state.plan,
    STORAGE_KEY,
  );
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
  const before = await page.evaluate(
    (key) => localStorage.getItem(key),
    STORAGE_KEY,
  );
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    (window as unknown as { __tearWrites: number }).__tearWrites = 0;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === key)
        (window as unknown as { __tearWrites: number }).__tearWrites++;
      return original.call(this, k, v);
    };
  }, STORAGE_KEY);
  return async () => {
    expect(
      await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
    ).toBe(before);
    expect(
      await page.evaluate(
        () => (window as unknown as { __tearWrites: number }).__tearWrites,
      ),
    ).toBe(0);
  };
}
async function localMap(page: Page) {
  const tile = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNIrAr4DwAElgIrUm/6bwAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["localhost", "127.0.0.1"].includes(url.hostname))
      return route.continue();
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
  const before = await page.evaluate(
    (key) => localStorage.getItem(key),
    STORAGE_KEY,
  );
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    (
      window as unknown as { __pressStorageWrites: number }
    ).__pressStorageWrites = 0;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === key)
        (window as unknown as { __pressStorageWrites: number })
          .__pressStorageWrites++;
      return original.call(this, k, v);
    };
  }, STORAGE_KEY);
  for (let i = 0; i < 2; i++) {
    await press(page)
      .getByRole("button", { name: "Reprint dinner plan", exact: true })
      .click();
    await expect(press(page)).toHaveAttribute("data-phase", "printing");
    await page.clock.fastForward(1800);
    await expect(press(page)).toHaveAttribute("data-phase", "printed");
  }
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).toBe(before);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __pressStorageWrites: number })
          .__pressStorageWrites,
    ),
  ).toBe(0);
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
    if (mode === "reduced motion")
      await page.emulateMedia({ reducedMotion: "reduce" });
    else
      await page.addInitScript(() =>
        localStorage.setItem("common-table-low-power", "true"),
      );
    await page.goto("/#menu");
    await page
      .getByRole("button", { name: "Close folio", exact: true })
      .click();
    await expect(folio(page)).toHaveAttribute("data-folio-open", "false");
    await page.getByRole("button", { name: "Open folio", exact: true }).click();
    await expect(folio(page)).toHaveAttribute("data-folio-open", "true");
    await page
      .getByRole("button", { name: "Turn this page", exact: true })
      .click();
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
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __folioAnimations: Animation[] }
        ).__folioAnimations.some((a) => a.playState === "running"),
      ),
    )
    .toBe(true);
  await nav(page, "Your table").click();
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
