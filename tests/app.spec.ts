import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

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
const note = (page: Page) => page.getByLabel("A note for the evening");
async function openMenu(page: Page) {
  if (!(await page.locator(".menu-book").isVisible())) {
    await page
      .getByRole("button", { name: /^Open (the )?menu$/, exact: true })
      .click();
  }
  await expect(page.locator(".menu-book")).toBeVisible();
}
async function approveAll(page: Page) {
  for (const approval of await page.getByRole("checkbox").all())
    await approval.check();
}
async function choosePlan(page: Page) {
  await page.goto("/#explore");
  await openMenu(page);
  await page.getByRole("button", { name: "Bring this to the table" }).click();
  await expect(page).toHaveURL(/#table$/);
  await nav(page, "Dinner plan").click();
  await expect(
    page.getByRole("article", { name: "Dinner plan summary" }),
  ).toBeVisible();
}

test("map, book, table and dinner plan retain the same chosen venue; Back returns to table", async ({
  page,
}) => {
  await page.goto("/#explore");
  await expect(page.locator(".immersive-atlas")).toBeVisible();
  await page.getByRole("button", { name: /^Places/ }).click();
  await page
    .getByRole("complementary", { name: "Restaurants on this map" })
    .getByRole("button", { name: /Olive & Ember/ })
    .click();
  await expect(
    page.getByRole("article", { name: "Olive & Ember, selected restaurant" }),
  ).toBeVisible();
  await openMenu(page);
  await expect(page.locator(".book-restaurant-title")).toContainText(
    "Olive & Ember",
  );
  await page.getByRole("button", { name: "Bring this to the table" }).click();
  await expect(page).toHaveURL(/#table$/);
  await expect(page.locator("main")).toContainText("Olive & Ember");
  await nav(page, "Dinner plan").click();
  await expect(
    page.getByRole("article", { name: "Dinner plan summary" }),
  ).toContainText("Olive & Ember");
  await page.goBack();
  await expect(page).toHaveURL(/#table$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Different tastes.",
  );
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page).toHaveURL(/#table$/);
  await expect(page.locator("main")).toContainText("Olive & Ember");
});

test("shortlist toggles repeatedly without duplicate contenders", async ({
  page,
}) => {
  await page.goto("/#explore");
  await openMenu(page);
  const save = page.getByRole("button", {
    name: "Save Juniper & Rye to shortlist",
    exact: true,
  });
  const remove = page.getByRole("button", {
    name: "Remove Juniper & Rye from shortlist",
    exact: true,
  });
  await save.click();
  await expect(remove).toHaveAttribute("aria-pressed", "true");
  await remove.click();
  await expect(save).toHaveAttribute("aria-pressed", "false");
  await save.click();
  await nav(page, "Your table").click();
  await expect(page.locator(".tp-contender")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Remove Juniper & Rye from contenders" })
    .click();
  await expect(page.locator(".tp-contender")).toHaveCount(0);
});

test("repeated vetoes revise recommendations, reach an honest empty state and can be undone", async ({
  page,
}) => {
  await page.goto("/#explore");
  await openMenu(page);
  for (let i = 0; i < 6; i++) {
    await page
      .getByRole("button", { name: "Not this time · find another" })
      .click();
    if (i < 5)
      await expect(page.locator(".book-toolbar")).toContainText(
        `${5 - i} places`,
      );
  }
  await expect(
    page.getByRole("heading", { name: "Let’s make a little room." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bring this to the table" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Reconsider Juniper & Rye", exact: true })
    .click();
  await expect(
    page
      .locator(".book-restaurant-title")
      .getByRole("heading", { name: "Juniper & Rye", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next restaurant" }),
  ).toBeDisabled();
});

test("guest creation handles cancel, Escape, focus return, adding and removing", async ({
  page,
}) => {
  await page.goto("/#table");
  const add = page.getByRole("button", { name: "Add a demo guest" });
  await add.click();
  await expect(page.getByLabel("Guest’s name")).toBeFocused();
  await page.getByLabel("Guest’s name").fill("Unsent guest");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(add).toBeFocused();
  await expect(
    page.getByRole("button", { name: /Edit Unsent guest/ }),
  ).toHaveCount(0);
  await add.click();
  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();
  await add.click();
  await page.getByLabel("Guest’s name").fill("Maya");
  await page.getByRole("button", { name: "Set their place" }).click();
  await expect(
    page.getByRole("button", { name: /Edit Maya's tastes/ }),
  ).toBeFocused();
  await expect(
    page.getByRole("status").filter({ hasText: "No invitation was sent" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove Maya from the table" })
    .click();
  await expect(
    page.getByRole("button", { name: /Edit You's tastes/ }),
  ).toBeFocused();
});

test("all dietary restrictions and the lowest budget are respected in candidate retrieval", async ({
  page,
}) => {
  await page.goto("/#table");
  await page.getByRole("button", { name: "Gluten-free", exact: true }).click();
  await page.getByRole("button", { name: "Add a demo guest" }).click();
  await page.getByLabel("Guest’s name").fill("Maya");
  await page.getByRole("button", { name: "Set their place" }).click();
  await page.getByRole("button", { name: "Vegan", exact: true }).click();
  await page.getByRole("button", { name: "Nut-free", exact: true }).click();
  const budget = page.getByRole("slider", { name: /Comfortable spend/ });
  await budget.focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect(budget).toHaveValue("35");
  await expect(page.locator(".tp-shortlist-header")).toContainText(
    "1 places fit this table",
  );
  await nav(page, "Explore").click();
  await page
    .getByRole("button", { name: "Open demo atlas", exact: true })
    .click();
  await openMenu(page);
  await expect(
    page
      .locator(".book-restaurant-title")
      .getByRole("heading", { name: "Casa Nopal", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".book-match-note")).toContainText(
    "Gluten-free + Vegan + Nut-free",
  );
  await expect(
    page.getByRole("button", { name: "Explore Juniper & Rye" }),
  ).toHaveCount(0);
});

test("save, edit, reload, save again and download produce the revised dinner plan", async ({
  page,
}) => {
  await choosePlan(page);
  await page.getByRole("button", { name: "Edit table", exact: true }).click();
  await page.getByRole("button", { name: "Add a demo guest" }).click();
  await page.getByLabel("Guest’s name").fill("Maya");
  await page.getByRole("button", { name: "Set their place" }).click();
  await nav(page, "Dinner plan").click();
  await note(page).fill("A walk after dinner.");
  await page.getByLabel("Time", { exact: true }).fill("20:15");
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  await approveAll(page);
  await page.getByRole("button", { name: "Save this dinner plan" }).click();
  await expect(
    page.getByRole("button", { name: "Saved for a good evening" }),
  ).toBeDisabled();
  await note(page).fill("A walk after dinner, if the weather is kind.");
  for (const approval of await page.getByRole("checkbox").all())
    await expect(approval).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Save this dinner plan" }),
  ).toBeDisabled();
  await approveAll(page);
  await expect(
    page.getByRole("button", { name: "Save this dinner plan" }),
  ).toBeEnabled();
  await page.reload();
  await expect(note(page)).toHaveValue(
    "A walk after dinner, if the weather is kind.",
  );
  await expect(page.getByLabel("Time", { exact: true })).toHaveValue("20:15");
  await page.getByRole("button", { name: "Save this dinner plan" }).click();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy plan", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "A walk after dinner, if the weather is kind.",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("common-table-dinner-plan.txt");
  const body = await readFile((await download.path())!, "utf8");
  expect(body).toContain("Juniper & Rye");
  expect(body).toContain("A walk after dinner, if the weather is kind.");
  expect(body).toContain("20:15");
  expect(body).toContain("not a booking");
  expect(body).toContain("Fictional demo venue");
});

test("invalid schedule cannot be saved and corrupted browser storage recovers safely", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("common-table.demo.v1", "{broken json"),
  );
  await choosePlan(page);
  await page.getByLabel("Day", { exact: true }).fill("2020-01-01");
  await expect(
    page.getByRole("button", { name: "Save this dinner plan" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Choose today or a future date.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Day", { exact: true }).fill("");
  await expect(
    page.getByRole("button", { name: "Copy plan", exact: true }),
  ).toBeDisabled();
});

test("blocked browser storage keeps a temporary usable plan without claiming persistence", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, "getItem", {
      value() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });
    Object.defineProperty(Storage.prototype, "setItem", {
      value() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });
  });
  await choosePlan(page);
  await approveAll(page);
  await page.getByRole("button", { name: "Save this dinner plan" }).click();
  await expect(
    page.getByRole("button", { name: "Kept for this session", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".tp-receipt-status")).toContainText(
    "KEPT FOR THIS SESSION",
  );
  await expect(
    page.getByRole("button", { name: "Download", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your evening is still unwritten." }),
  ).toBeVisible();
});

test("keyboard dialog focus is contained; Escape and Waiter close return focus without actions", async ({
  page,
}) => {
  await page.goto("/#explore");
  const about = page.getByRole("button", { name: "About this demo" });
  await about.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    // Native modal dialogs allow tabbing into browser chrome (represented by BODY),
    // while keeping the application's underlying controls inert.
    expect(
      await page.evaluate(
        () =>
          document.activeElement === document.body ||
          Boolean(document.activeElement?.closest("dialog")),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(about).toBeFocused();
  const guidance = page.getByRole("button", { name: "A little guidance" });
  await guidance.click();
  await expect(
    page.getByRole("region", { name: "The Waiter’s guidance" }),
  ).toContainText("Juniper & Rye");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "The Waiter, at your service" }),
  ).not.toBeVisible();
  await expect(guidance).toBeFocused();
  await guidance.click();
  await page
    .getByRole("button", { name: "Close guidance", exact: true })
    .click();
  await expect(guidance).toBeFocused();
  await expect(page).not.toHaveURL(/#table|#plan/);
});

test("mobile pages support keyboard switching, no horizontal overflow and motion fallbacks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#explore");
  await openMenu(page);
  await expect(page.getByRole("tab", { name: "The menu" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page
      .locator(".book-restaurant-title")
      .getByRole("heading", { name: "Juniper & Rye", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "The menu" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "The place" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "The place" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "The menu" })).toBeFocused();
  for (let i = 0; i < 8; i++)
    await page.getByRole("button", { name: "Next restaurant" }).click();
  expect(
    await page
      .locator(".menu-book")
      .evaluate((el) => el.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Low-power view", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Low-power view on", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Next restaurant" }).click();
  expect(
    await page
      .locator(".menu-book")
      .evaluate((el) => el.getAnimations({ subtree: true }).length),
  ).toBe(0);
  for (const hash of ["#explore", "#table", "#plan"]) {
    await page.goto(`/${hash}`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});

for (const mobile of [false, true]) {
  for (const view of ["explore", "menu", "table", "plan"]) {
    test(`WCAG A/AA automated scan: ${mobile ? "mobile" : "desktop"} ${view}`, async ({
      page,
    }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      if (view === "plan") await choosePlan(page);
      else {
        await page.goto(`/#${view === "menu" ? "explore" : view}`);
        if (view === "menu") await openMenu(page);
      }
      await page.evaluate(() => document.fonts.ready);
      // Measure the settled view; entrance opacity temporarily blends colors.
      await page.evaluate(async () => {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        await Promise.all(
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.effect?.getTiming().iterations !== Infinity,
            )
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(
        results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        })),
      ).toEqual([]);
    });
  }
}
