import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "The Waiter, at your service" });
const launcher = (page: Page) =>
  page.getByRole("button", { name: "A little guidance", exact: true });
const input = (page: Page) =>
  dialog(page).getByLabel("Or leave a small request");
const answer = (page: Page) => dialog(page).locator(".cw-claude-result");
const alert = (page: Page) => dialog(page).locator(".cw-request-error");
const submit = (page: Page) =>
  dialog(page).getByRole("button", { name: "Ask The Waiter", exact: true });
async function open(page: Page) {
  await launcher(page).click();
  await expect(dialog(page)).toBeVisible();
}
async function chooseClaude(page: Page) {
  const radio = dialog(page).getByRole("radio", { name: /^Claude\b/ });
  await expect(radio).toHaveAccessibleName(/offline demo/);
  await radio.check();
  await expect(dialog(page).locator(".cw-provider-note")).toContainText(
    "not called",
  );
}
async function ask(page: Page, text = "Help us compare this budget.") {
  await input(page).fill(text);
  await submit(page).click();
}
const response = (route: Route, text: string, source = "mock", status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ source, text }),
  });
type Held = { route: Route; body: Record<string, unknown> };
async function heldApi(page: Page, mode = "mock") {
  const calls: Held[] = [];
  await page.route("**/api/waiter/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ mode }),
    }),
  );
  await page.route("**/api/waiter/reply", (route) => {
    calls.push({ route, body: route.request().postDataJSON() });
  });
  return calls;
}
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  await page.route("https://api.anthropic.com/**", (route) => {
    messages.push("Browser attempted a provider request.");
    return route.abort();
  });
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

test("the real default adapter is explicitly selected, accurately labelled offline, and does not change the plan", async ({
  page,
}) => {
  const requests: {
    path: string;
    body: unknown;
    headers: Record<string, string>;
  }[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/waiter/"))
      requests.push({
        path,
        body: request.postData() ? request.postDataJSON() : null,
        headers: request.headers(),
      });
  });
  await page.goto("/#menu");
  expect(requests).toEqual([]);
  await open(page);
  await expect(
    dialog(page).getByRole("radio", { name: "Local tips", exact: true }),
  ).toBeChecked();
  await ask(page, "why this place?");
  await expect(dialog(page).locator(".cw-reasons")).toBeVisible();
  expect(requests.filter((call) => call.path.endsWith("/reply"))).toHaveLength(
    0,
  );
  const before = await page.evaluate(() =>
    localStorage.getItem("common-table.demo.v1"),
  );
  await chooseClaude(page);
  expect(requests.filter((call) => call.path.endsWith("/reply"))).toHaveLength(
    0,
  );
  await ask(page, "What about the budget?");
  await expect(answer(page)).toBeVisible();
  await expect(answer(page).locator(".cw-claude-label")).toHaveText(
    "OFFLINE DEMO · CLAUDE NOT CALLED",
  );
  await expect(answer(page).locator("p")).toContainText("$48");
  await expect(answer(page).locator("p")).not.toContainText(
    "Offline demo · Claude not called.",
  );
  const posts = requests.filter((call) => call.path.endsWith("/reply"));
  expect(posts).toHaveLength(1);
  expect(posts[0].headers["x-common-table-request"]).toBe("waiter");
  const body = posts[0].body as {
    message: string;
    context: Record<string, unknown>;
  };
  expect(body.message).toBe("What about the budget?");
  expect(Object.keys(body).sort()).toEqual(["context", "message"]);
  expect(Object.keys(body.context).sort()).toEqual([
    "budget",
    "mode",
    "participantCount",
    "planSaved",
    "restrictions",
    "venueId",
    "view",
  ]);
  expect(body.context).toMatchObject({
    view: "explore",
    mode: "book",
    venueId: "juniper",
    participantCount: 1,
    budget: 65,
    restrictions: [],
    planSaved: false,
  });
  expect(
    await page.evaluate(() => localStorage.getItem("common-table.demo.v1")),
  ).toBe(before);
});

test("repeated Enter sends one pending request, Cancel restores input focus, and a later explicit request works", async ({
  page,
}) => {
  const calls = await heldApi(page);
  await page.goto("/#menu");
  await open(page);
  await chooseClaude(page);
  await input(page).fill("One request, please.");
  await input(page).press("Enter");
  await input(page).press("Enter");
  await input(page).press("Enter");
  await expect.poll(() => calls.length).toBe(1);
  await expect(submit(page)).toBeDisabled();
  await expect(dialog(page).locator(".cw-request-pending")).toContainText(
    "Preparing a little guidance",
  );
  await dialog(page)
    .getByRole("button", { name: "Cancel request", exact: true })
    .click();
  await expect(input(page)).toBeFocused();
  await expect(dialog(page).locator(".cw-request-pending")).toHaveCount(0);
  await response(calls[0].route, "OBSOLETE CANCELLED ANSWER").catch(() => {});
  await expect(answer(page)).toHaveCount(0);
  await ask(page, "A fresh explicit request.");
  await expect.poll(() => calls.length).toBe(2);
  await response(calls[1].route, "A fresh answer for this table.");
  await expect(answer(page)).toContainText("A fresh answer for this table.");
  expect(calls).toHaveLength(2);
});

test("course and venue changes clear old answers and discard a pending answer for the previous venue", async ({
  page,
}) => {
  const calls = await heldApi(page);
  await page.goto("/#menu");
  await open(page);
  await chooseClaude(page);
  await ask(page);
  await expect.poll(() => calls.length).toBe(1);
  await response(calls[0].route, "ANSWER FOR FIRST PLACE");
  await expect(answer(page)).toContainText("ANSWER FOR FIRST PLACE");
  await dialog(page)
    .getByRole("button", { name: "Our table", exact: true })
    .click();
  await expect(answer(page)).toHaveCount(0);
  expect(calls).toHaveLength(1);
  await dialog(page)
    .getByRole("button", { name: "A place", exact: true })
    .click();
  const first = await dialog(page).locator(".cw-venue-note h4").innerText();
  await ask(page, "One more thought on this place.");
  await expect.poll(() => calls.length).toBe(2);
  await dialog(page)
    .getByRole("button", { name: "Another possibility", exact: true })
    .click();
  await expect(dialog(page).locator(".cw-venue-note h4")).not.toHaveText(first);
  await expect(dialog(page).locator(".cw-request-pending")).toHaveCount(0);
  await response(calls[1].route, "STALE PREVIOUS VENUE ANSWER").catch(() => {});
  await expect(answer(page)).toHaveCount(0);
  expect(calls).toHaveLength(2);
  await ask(page, "Now help with the new possibility.");
  await expect.poll(() => calls.length).toBe(3);
  expect((calls[2].body.context as { venueId: string }).venueId).not.toBe(
    (calls[1].body.context as { venueId: string }).venueId,
  );
  await response(calls[2].route, "CURRENT VENUE ANSWER");
  await expect(answer(page)).toContainText("CURRENT VENUE ANSWER");
});

test("closing cancels the request, restores the opener and sends fresh aggregate context after editing the table", async ({
  page,
}) => {
  const calls = await heldApi(page);
  await page.goto("/#table");
  await page
    .getByRole("button", { name: "Add a demo guest", exact: true })
    .click();
  await page.getByLabel("Guest’s name").fill("Private Demo Name");
  await page
    .getByRole("button", { name: "Set their place", exact: true })
    .click();
  await page.getByRole("button", { name: "Vegan", exact: true }).click();
  const budget = page.getByRole("slider", { name: /Comfortable spend/ });
  await budget.focus();
  await page.keyboard.press("Home");
  await open(page);
  await chooseClaude(page);
  await ask(page, "Help with our table.");
  await expect.poll(() => calls.length).toBe(1);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).not.toBeVisible();
  await expect(launcher(page)).toBeFocused();
  await budget.focus();
  await page.keyboard.press("ArrowRight");
  await response(calls[0].route, "STALE OLD BUDGET ANSWER").catch(() => {});
  await open(page);
  await expect(
    dialog(page).getByRole("radio", { name: "Local tips", exact: true }),
  ).toBeChecked();
  await expect(answer(page)).toHaveCount(0);
  expect(calls).toHaveLength(1);
  await chooseClaude(page);
  await ask(page, "Help with the revised table.");
  await expect.poll(() => calls.length).toBe(2);
  const before = calls[0].body.context as { budget: number },
    after = calls[1].body.context as Record<string, unknown>;
  expect(after.budget).not.toBe(before.budget);
  expect(after.participantCount).toBe(2);
  expect(after.restrictions).toEqual(["Vegan"]);
  expect(JSON.stringify(after)).not.toContain("Private Demo Name");
  for (const key of Object.keys(after))
    expect([
      "view",
      "mode",
      "venueId",
      "participantCount",
      "budget",
      "restrictions",
      "planVenueId",
      "planSaved",
    ]).toContain(key);
  await response(calls[1].route, "CURRENT TABLE ANSWER");
  await expect(answer(page)).toContainText("CURRENT TABLE ANSWER");
});

test("reply text stays literal, failed/mislabeled responses are sanitized, and errors never auto-resubmit", async ({
  page,
}) => {
  const calls = await heldApi(page);
  await page.goto("/#menu");
  await open(page);
  await chooseClaude(page);
  await ask(page);
  await expect.poll(() => calls.length).toBe(1);
  const html =
    '<img src=x onerror="window.__waiterXss=true"><script>window.__waiterXss=true</script>';
  await response(calls[0].route, html);
  await expect(answer(page).locator("p")).toHaveText(html);
  await expect(answer(page).locator("img,script")).toHaveCount(0);
  expect(await page.evaluate(() => "__waiterXss" in window)).toBe(false);
  await ask(page, "Try another answer.");
  await expect.poll(() => calls.length).toBe(2);
  await calls[1].route.fulfill({
    status: 502,
    contentType: "application/json",
    body: JSON.stringify({ error: "PRIVATE_PROVIDER_ERROR_CANARY" }),
  });
  await expect(alert(page)).toContainText("Local tips are still available");
  await expect(dialog(page)).not.toContainText("PRIVATE_PROVIDER_ERROR_CANARY");
  await expect(answer(page)).toHaveCount(0);
  expect(calls).toHaveLength(2);
  await ask(page, "Reject a false source label.");
  await expect.poll(() => calls.length).toBe(3);
  await response(calls[2].route, "UNVERIFIED LIVE CLAIM", "anthropic");
  await expect(alert(page)).toBeVisible();
  await expect(answer(page)).toHaveCount(0);
  expect(calls).toHaveLength(3);
  await ask(page, "A busy answer.");
  await expect.poll(() => calls.length).toBe(4);
  await calls[3].route.fulfill({
    status: 429,
    contentType: "application/json",
    body: '{"message":"PRIVATE_RATE_CANARY"}',
  });
  await expect(alert(page)).toContainText("finishing a request");
  await expect(dialog(page)).not.toContainText("PRIVATE_RATE_CANARY");
  expect(calls).toHaveLength(4);
});

test("disabled browser Claude cannot submit and local guidance remains useful", async ({
  page,
}) => {
  const calls = await heldApi(page, "disabled");
  await page.goto("/#menu");
  await open(page);
  await dialog(page)
    .getByRole("radio", { name: /^Claude\b/ })
    .check();
  await input(page).fill("A question.");
  await expect(submit(page)).toBeDisabled();
  await expect(dialog(page).locator(".cw-provider-note")).toContainText(
    "not available",
  );
  expect(calls).toHaveLength(0);
  await dialog(page)
    .getByRole("radio", { name: "Local tips", exact: true })
    .check();
  await ask(page, "why this place?");
  await expect(dialog(page).locator(".cw-reasons")).toBeVisible();
  expect(calls).toHaveLength(0);
});

for (const mobile of [false, true]) {
  test(`offline provider guidance meets WCAG AA and has a reachable exit on ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const calls = await heldApi(page);
    await page.goto("/#menu");
    await open(page);
    await chooseClaude(page);
    await ask(page);
    await expect.poll(() => calls.length).toBe(1);
    await response(
      calls[0].route,
      "Review your table’s budget and dietary needs before choosing. ".repeat(
        14,
      ),
    );
    await expect(answer(page)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      scan.violations.map((value) => ({
        id: value.id,
        nodes: value.nodes.map((node) => ({
          target: node.target,
          summary: node.failureSummary,
        })),
      })),
    ).toEqual([]);
    const exit = dialog(page).getByRole("button", {
      name: "Back to the evening",
      exact: true,
    });
    await exit.scrollIntoViewIfNeeded();
    const box = await exit.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(
      await exit.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          document
            .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
            ?.closest("button") === el
        );
      }),
    ).toBe(true);
    await exit.click();
    await expect(dialog(page)).not.toBeVisible();
    await expect(launcher(page)).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
