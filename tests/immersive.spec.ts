import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const atlas = (page: Page) => page.locator(".immersive-atlas");
const world = (page: Page) => page.locator(".atlas-world");
const waiter = (page: Page) =>
  page.getByRole("dialog", { name: "The Waiter, at your service" });
test.beforeEach(async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
});
const nav = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: new RegExp(name) });
const request = (page: Page) =>
  waiter(page).getByLabel("Or leave a small request");
async function openWaiter(page: Page) {
  await page
    .getByRole("button", { name: "A little guidance", exact: true })
    .click();
  await expect(waiter(page)).toBeVisible();
}
async function ask(page: Page, text: string) {
  await request(page).fill(text);
  await waiter(page)
    .getByRole("button", { name: "Ask The Waiter", exact: true })
    .click();
}
async function camera(page: Page) {
  return world(page).evaluate((el) => ({
    x: (el as HTMLElement).style.getPropertyValue("--atlas-pan-x"),
    y: (el as HTMLElement).style.getPropertyValue("--atlas-pan-y"),
    scale: (el as HTMLElement).style.getPropertyValue("--atlas-scale"),
  }));
}
async function dragOrigin(page: Page) {
  return page.locator(".atlas-viewport").evaluate((el) => {
    const r = el.getBoundingClientRect();
    for (const fy of [0.65, 0.55, 0.45, 0.75, 0.35])
      for (const fx of [0.55, 0.65, 0.75, 0.45, 0.85]) {
        const x = r.x + r.width * fx,
          y = r.y + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (
          hit?.closest(".atlas-viewport") &&
          !hit.closest("button,a,input,aside")
        )
          return { x, y };
      }
    throw new Error(
      "No unobscured map background found for a genuine pointer gesture.",
    );
  });
}
const uncaught = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  uncaught.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(uncaught.get(page)).toEqual([]);
});

test("map distinguishes a background tap, a drag and a photo-pin selection; keyboard Home resets", async ({
  page,
}) => {
  await page.goto("/#explore");
  await expect(atlas(page)).toBeVisible();
  const before = await camera(page);
  const point = await dragOrigin(page);
  await page.mouse.click(point.x, point.y);
  expect(await camera(page)).toEqual(before);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 93, point.y + 34, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await camera(page)).x).not.toBe(before.x);
  await expect(
    page.getByRole("article", { name: "Juniper & Rye, selected restaurant" }),
  ).toBeVisible();
  await expect(atlas(page)).not.toHaveClass(/atlas-dragging/);
  await page.locator(".atlas-viewport").focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => (await camera(page)).x).toBe("0px");
  await expect.poll(async () => (await camera(page)).y).toBe("0px");
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await camera(page)).x).toBe("-60px");
  await page.getByRole("button", { name: /Explore.*Momo House/ }).click();
  await expect(
    page.getByRole("article", { name: "Momo House, selected restaurant" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Explore.*Momo House/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("camera zoom clamps, pan controls and compass reset work repeatedly; lighting and depth change the scene", async ({
  page,
}) => {
  await page.goto("/#explore");
  for (let cycle = 0; cycle < 2; cycle++) {
    for (
      let i = 0;
      i < 8 &&
      (await page
        .getByRole("button", { name: "Zoom in", exact: true })
        .isEnabled());
      i++
    )
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Zoom in", exact: true }),
    ).toBeDisabled();
    await expect(page.locator(".atlas-zoom")).toContainText("160%");
    for (
      let i = 0;
      i < 10 &&
      (await page
        .getByRole("button", { name: "Zoom out", exact: true })
        .isEnabled());
      i++
    )
      await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Zoom out", exact: true }),
    ).toBeDisabled();
    await expect(page.locator(".atlas-zoom")).toContainText("70%");
    await page
      .getByRole("button", { name: "Pan map left", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Reset map view to north", exact: true })
      .click();
    await expect(page.locator(".atlas-zoom")).toContainText("100%");
    expect((await camera(page)).x).toBe("0px");
  }
  const depth = await page
    .locator(".atlas-building")
    .first()
    .locator("path")
    .first()
    .getAttribute("d");
  const daylight = await page
    .locator(".atlas-building")
    .first()
    .locator("rect")
    .nth(3)
    .getAttribute("fill");
  await page.getByRole("button", { name: /Switch to flat map$/ }).click();
  await expect(atlas(page)).toHaveClass(/atlas-flat/);
  expect(
    await page
      .locator(".atlas-building")
      .first()
      .locator("path")
      .first()
      .getAttribute("d"),
  ).not.toBe(depth);
  await page.getByRole("button", { name: /Switch to evening light$/ }).click();
  await expect(atlas(page)).toHaveClass(/atlas-evening/);
  expect(
    await page
      .locator(".atlas-building")
      .first()
      .locator("rect")
      .nth(3)
      .getAttribute("fill"),
  ).not.toBe(daylight);
  await page.getByRole("button", { name: /Switch to daylight$/ }).click();
  await page
    .getByRole("button", { name: /Switch to dimensional map$/ })
    .click();
  await expect(atlas(page)).not.toHaveClass(/atlas-flat|atlas-evening/);
});

test("restaurant index is a keyboard equivalent and rapid book/map changes retain the selected venue", async ({
  page,
}) => {
  await page.goto("/#explore");
  const places = page.getByRole("button", { name: /^Places/ });
  await places.click();
  await expect(page.locator(".atlas-list-venue").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(places).toBeFocused();
  await places.click();
  await page
    .getByRole("complementary", { name: "Restaurants on this map" })
    .getByRole("button", { name: /Casa Nopal/ })
    .focus();
  await page.keyboard.press("Enter");
  await expect(places).toBeFocused();
  await expect(
    page.getByRole("article", { name: "Casa Nopal, selected restaurant" }),
  ).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await page
      .getByRole("button", { name: "Open the menu", exact: true })
      .click();
    await expect(page).toHaveURL(/#menu$/);
    await expect(page.locator(".book-restaurant-title")).toContainText(
      "Casa Nopal",
    );
    if (i === 0) await page.goBack();
    else await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect(page).toHaveURL(/#explore$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expect(
      page.getByRole("article", { name: "Casa Nopal, selected restaurant" }),
    ).toBeVisible();
  }
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open the menu", exact: true }),
  ).toBeEnabled();
});

test("mobile keyboard pin focus moves the camera without scrolling the clipped canvas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#explore");
  const viewport = page.locator(".atlas-viewport");
  await viewport.focus();
  const pins = page.locator(".atlas-photo-pin");
  for (let i = 0; i < (await pins.count()); i++) {
    await page.keyboard.press("Tab");
    await expect(pins.nth(i)).toBeFocused();
    await expect
      .poll(() =>
        viewport.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop })),
      )
      .toEqual({ x: 0, y: 0 });
    await expect
      .poll(() =>
        pins.nth(i).evaluate((el) => {
          const p = el.getBoundingClientRect(),
            v = el.closest(".atlas-viewport")!.getBoundingClientRect();
          return (
            p.x + p.width / 2 >= v.x &&
            p.x + p.width / 2 <= v.right &&
            p.y + p.height / 2 >= v.y &&
            p.y + p.height / 2 <= v.bottom
          );
        }),
      )
      .toBe(true);
  }
  await page.keyboard.press("Enter");
  await expect(
    page.locator(".atlas-photo-pin[aria-pressed=true]"),
  ).toBeFocused();
  const selected = (
    await page
      .locator(".atlas-photo-pin[aria-pressed=true] .atlas-pin-caption strong")
      .innerText()
  ).trim();
  await expect(
    page.getByRole("article", { name: `${selected}, selected restaurant` }),
  ).toBeVisible();
});

test("group limits filter map pins and index, and The Waiter explains the actual group budget and needs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#table");
  await page.getByRole("button", { name: "Gluten-free", exact: true }).click();
  await page
    .getByRole("button", { name: "Add a demo guest", exact: true })
    .click();
  await page.getByLabel("Guest’s name").fill("Maya");
  await page.getByRole("button", { name: "Set their place" }).click();
  await page.getByRole("button", { name: "Vegan", exact: true }).click();
  const budget = page.getByRole("slider", { name: /Comfortable spend/ });
  await budget.focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await nav(page, "Explore").click();
  await page
    .getByRole("button", { name: "Open demo atlas", exact: true })
    .click();
  await expect(page.locator(".atlas-photo-pin")).toHaveCount(1);
  await expect(
    page.getByRole("article", { name: "Casa Nopal, selected restaurant" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Places/ }).click();
  await expect(page.locator(".atlas-list-venue")).toHaveCount(1);
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await openWaiter(page);
  await expect(
    waiter(page).getByRole("button", {
      name: "Another possibility",
      exact: true,
    }),
  ).toBeDisabled();
  await waiter(page)
    .getByRole("button", { name: "Our table", exact: true })
    .click();
  await expect(waiter(page).locator(".cw-guests")).toContainText("Maya");
  await expect(waiter(page).locator(".cw-table-notes")).toContainText("$35");
  await expect(waiter(page).locator(".cw-table-notes")).toContainText(
    "Gluten-free, Vegan",
  );
  await waiter(page)
    .getByRole("button", { name: "See the fit", exact: true })
    .click();
  await expect(waiter(page).locator(".cw-reasons")).toContainText(
    "$32 per person fits everyone’s budget",
  );
  await expect(waiter(page).locator(".cw-reasons")).toContainText(
    "Qloo is not connected",
  );
});

test("reduced-motion and low-power map views are flat, stable and still usable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#explore");
  await expect(atlas(page)).toHaveClass(/atlas-flat/);
  await expect(
    page.getByRole("button", { name: /Switch to dimensional map$/ }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  expect(
    await atlas(page).evaluate(
      (el) => el.getAnimations({ subtree: true }).length,
    ),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Low-power view", exact: true })
    .click();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(atlas(page)).toHaveClass(/atlas-flat/);
  await expect(
    page.getByRole("button", { name: /Switch to dimensional map$/ }),
  ).toBeDisabled();
  await openWaiter(page);
  for (let i = 0; i < 3; i++)
    await waiter(page)
      .getByRole("button", { name: "Ring the service bell", exact: true })
      .click();
  expect(
    await waiter(page).evaluate(
      (el) => el.getAnimations({ subtree: true }).length,
    ),
  ).toBe(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Open the menu", exact: true })
    .click();
  expect(
    await page
      .locator(".menu-book")
      .evaluate((el) => el.getAnimations({ subtree: true }).length),
  ).toBe(0);
});

test("mobile postcard bookmark has an unobstructed hit target before and after scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#explore");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  const save = page.getByRole("button", {
    name: "Save Juniper & Rye to shortlist",
    exact: true,
  });
  const hitIsButton = async (label: "save" | "remove") => {
    const button =
      label === "save"
        ? save
        : page.getByRole("button", {
            name: "Remove Juniper & Rye from shortlist",
            exact: true,
          });
    return button.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (
        document
          .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          ?.closest("button") === el
      );
    });
  };
  await expect.poll(() => hitIsButton("save")).toBe(true);
  await save.click();
  const remove = page.getByRole("button", {
    name: "Remove Juniper & Rye from shortlist",
    exact: true,
  });
  await expect(remove).toHaveAttribute("aria-pressed", "true");
  await expect(waiter(page)).not.toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await remove.scrollIntoViewIfNeeded();
  await expect.poll(() => hitIsButton("remove")).toBe(true);
  await remove.click();
  await expect(save).toHaveAttribute("aria-pressed", "false");
  await expect(waiter(page)).not.toBeVisible();
});

test("Waiter alternatives cycle through eligible venues, preserve a chosen plan and actually update the shortlist", async ({
  page,
}) => {
  await page.goto("/#explore");
  await page
    .getByRole("button", { name: "Open the menu", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Bring this to the table", exact: true })
    .click();
  await nav(page, "Explore").click();
  await page
    .getByRole("button", { name: "Open demo atlas", exact: true })
    .click();
  await openWaiter(page);
  const seen = new Set<string>();
  for (let i = 0; i < 5; i++) {
    await waiter(page)
      .getByRole("button", { name: "Another possibility", exact: true })
      .click();
    const name = (
      await waiter(page).locator(".cw-venue-note h4").innerText()
    ).trim();
    expect(name).not.toBe("Juniper & Rye");
    expect(seen.has(name)).toBe(false);
    seen.add(name);
    await expect(waiter(page).locator(".cw-response")).toContainText(
      "Your dinner plan at Juniper & Rye stays as it was.",
    );
  }
  const selected = (
    await waiter(page).locator(".cw-venue-note h4").innerText()
  ).trim();
  await waiter(page)
    .getByRole("button", { name: "Keep this possibility", exact: true })
    .click();
  await expect(
    waiter(page).getByRole("button", {
      name: "Kept at the table",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await waiter(page)
    .getByRole("button", { name: "Kept at the table", exact: true })
    .click();
  await waiter(page)
    .getByRole("button", { name: "Keep this possibility", exact: true })
    .click();
  await waiter(page)
    .getByRole("button", { name: "Our table", exact: true })
    .click();
  await waiter(page)
    .getByRole("button", { name: "Refine our tastes", exact: true })
    .click();
  await expect(waiter(page)).not.toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(page.locator(".tp-contender")).toHaveCount(1);
  await expect(page.locator(".tp-contender")).toContainText(selected);
  await nav(page, "Dinner plan").click();
  await expect(
    page.getByRole("article", { name: "Dinner plan summary" }),
  ).toContainText("Juniper & Rye");
});

test("Waiter accepts useful typed requests and honestly handles unsupported services without sending or replacing a plan", async ({
  page,
}) => {
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()))
      mutations.push(`${request.method()} ${request.url()}`);
  });
  await page.goto("/#explore");
  await openWaiter(page);
  const before = (
    await waiter(page).locator(".cw-venue-note h4").innerText()
  ).trim();
  await ask(page, "why this place?");
  await expect(waiter(page).locator(".cw-reasons")).toContainText(
    "Italian + Seasonal",
  );
  await ask(page, "another place");
  expect(
    (await waiter(page).locator(".cw-venue-note h4").innerText()).trim(),
  ).not.toBe(before);
  await ask(page, "tell me about quantum entanglement");
  await expect(waiter(page).locator(".cw-response")).toContainText(
    "My little service menu covers",
  );
  await ask(page, "book a table and invite Maya to my location");
  await expect(waiter(page).locator(".cw-response")).toContainText(
    "Nothing is sent.",
  );
  await expect(waiter(page)).toContainText("aren’t connected in this demo");
  await expect(page).not.toHaveURL(/#plan|#table/);
  expect(mutations).toEqual([]);
  await waiter(page)
    .getByRole("button", { name: "Close guidance", exact: true })
    .click();
  await nav(page, "Dinner plan").click();
  await expect(
    page.getByRole("heading", { name: "Your evening is still unwritten." }),
  ).toBeVisible();
});

test("Waiter is a real modal with native keyboard focus, Escape return and an explicit finish-plan action", async ({
  page,
}) => {
  await page.goto("/#explore");
  await openWaiter(page);
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () =>
          document.activeElement === document.body ||
          Boolean(document.activeElement?.closest("dialog[open]")),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(waiter(page)).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "A little guidance", exact: true }),
  ).toBeFocused();
  await openWaiter(page);
  await waiter(page)
    .getByRole("button", { name: "Ring the service bell", exact: true })
    .click();
  await expect(waiter(page).locator(".cw-response")).toBeVisible();
  await waiter(page)
    .getByRole("button", { name: "Tonight", exact: true })
    .click();
  await waiter(page)
    .getByRole("button", { name: "Start with this place", exact: true })
    .click();
  await expect(page).toHaveURL(/#plan$/);
  await expect(waiter(page)).not.toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(
    page.getByRole("article", { name: "Dinner plan summary" }),
  ).toContainText("Juniper & Rye");
  await expect(
    page.getByRole("checkbox", { name: "Works for me" }),
  ).not.toBeChecked();
});

for (const mobile of [false, true]) {
  test(`WCAG A/AA automated scan: ${mobile ? "mobile" : "desktop"} Waiter modal and fit details`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#explore");
    await openWaiter(page);
    await waiter(page)
      .getByRole("button", { name: "Why this place?", exact: true })
      .click();
    if (mobile) {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await waiter(page).evaluate(
          (el) => el.scrollWidth <= el.clientWidth + 1,
        ),
      ).toBe(true);
    }
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
  });
}
