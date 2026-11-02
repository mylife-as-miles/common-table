import type { Page } from "@playwright/test";

/** Legacy UI scenarios must not silently make third-party service calls. */
export async function unavailableOptionalServices(page: Page) {
  await page.route(/\/api\/weather(?:\?|$)/, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        status: "error",
        code: "unavailable",
        message: "Weather could not be checked right now.",
      }),
    }),
  );
  await page.route(/\/api\/recommendations(?:\?|$)/, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "unavailable",
          message: "Restaurant suggestions could not be checked right now.",
        },
      }),
    }),
  );
}
