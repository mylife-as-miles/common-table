import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// These are browser integration fixtures, not evidence of a live provider response.
// All map styles, tiles and glyphs are served by this test: no tile-server traffic.
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
const STYLE = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "fixture-background",
      type: "background",
      paint: { "background-color": "#eee8d6" },
    },
  ],
};
const PLACES = {
  Paris: {
    id: "paris",
    label: "Paris, Île-de-France, France",
    latitude: 48.8566,
    longitude: 2.3522,
  },
  Rome: {
    id: "rome",
    label: "Rome, Lazio, Italy",
    latitude: 41.9028,
    longitude: 12.4964,
  },
  Tokyo: {
    id: "tokyo",
    label: "Tokyo, Japan",
    latitude: 35.6762,
    longitude: 139.6503,
  },
};
type Place = (typeof PLACES)[keyof typeof PLACES];
const weather = (
  lat: number,
  lon: number,
  changes: Record<string, unknown> = {},
) => ({
  source: "openweather",
  status: "ready",
  latitude: lat,
  longitude: lon,
  placeName: "Fixture selected area",
  temperatureC: 18,
  feelsLikeC: 17,
  description: "scattered clouds",
  condition: "clouds",
  isDay: true,
  observedAt: "2026-10-29T19:45:00.000Z",
  windMps: 2.4,
  ...changes,
});
async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
async function installFixture(
  page: Page,
  { configured = true, forceRaster = true } = {},
) {
  const requests: URL[] = [];
  const fixture: {
    configured: boolean;
    requests: URL[];
    geocode?: (route: Route, url: URL) => Promise<void>;
    weather?: (route: Route, url: URL) => Promise<void>;
  } = { configured, requests };
  if (forceRaster)
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        type: string,
        ...args: unknown[]
      ) {
        if (
          type === "webgl" ||
          type === "webgl2" ||
          type === "experimental-webgl"
        )
          return null;
        return (
          original as (...args: unknown[]) => RenderingContext | null
        ).call(this, type, ...args);
      } as typeof original;
    });
  await page.addInitScript(() => {
    const geo = navigator.geolocation;
    const get = geo.getCurrentPosition.bind(geo),
      watch = geo.watchPosition.bind(geo);
    (window as unknown as { __locationCalls: number }).__locationCalls = 0;
    geo.getCurrentPosition = (
      ...args: Parameters<Geolocation["getCurrentPosition"]>
    ) => {
      (window as unknown as { __locationCalls: number }).__locationCalls++;
      return get(...args);
    };
    geo.watchPosition = (...args: Parameters<Geolocation["watchPosition"]>) => {
      (window as unknown as { __locationCalls: number }).__locationCalls++;
      return watch(...args);
    };
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/location-config") {
      requests.push(url);
      return json(route, { weatherConfigured: fixture.configured });
    }
    if (url.pathname === "/api/geocode") {
      requests.push(url);
      if (fixture.geocode) return fixture.geocode(route, url);
      const place = PLACES[url.searchParams.get("q") as keyof typeof PLACES];
      return json(route, { source: "photon", results: place ? [place] : [] });
    }
    if (url.pathname === "/api/weather") {
      requests.push(url);
      if (fixture.weather) return fixture.weather(route, url);
      if (!fixture.configured)
        return json(
          route,
          {
            status: "unavailable",
            code: "not_configured",
            message: "Live weather is not configured.",
          },
          503,
        );
      return json(
        route,
        weather(
          Number(url.searchParams.get("lat")),
          Number(url.searchParams.get("lon")),
        ),
      );
    }
    if (["localhost", "127.0.0.1"].includes(url.hostname))
      return route.continue();
    if (url.hostname === "tiles.openfreemap.org") {
      if (url.pathname.includes("/styles/")) return json(route, STYLE);
      if (url.pathname.endsWith(".pbf"))
        return route.fulfill({
          status: 200,
          contentType: "application/x-protobuf",
          body: Buffer.alloc(0),
        });
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: TILE,
      });
    }
    if (url.hostname.endsWith("tile.openstreetmap.org"))
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: TILE,
      });
    return route.abort("blockedbyclient");
  });
  return fixture;
}

const map = (page: Page) => page.locator(".geographic-map");
const city = (page: Page) =>
  page.getByRole("searchbox", { name: "Search a city or neighborhood" });
const geoCalls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __locationCalls: number }).__locationCalls,
  );
async function search(page: Page, query: string) {
  await city(page).fill(query);
  await city(page).press("Enter");
}
async function choose(page: Page, place: Place) {
  await search(
    page,
    Object.keys(PLACES).find(
      (key) => PLACES[key as keyof typeof PLACES].id === place.id,
    )!,
  );
  await page.getByRole("button", { name: place.label, exact: true }).click();
}
async function ready(page: Page) {
  await expect(map(page)).toHaveAttribute("data-map-status", "ready");
  const box = await map(page).locator(".geographic-map-canvas").boundingBox();
  expect(box?.height).toBeGreaterThan(400);
  expect(box?.width).toBeGreaterThan(250);
}

test("real geography loads without asking for device location, with weather time and provider attribution", async ({
  page,
}) => {
  await installFixture(page);
  await page.goto("/");
  await ready(page);
  expect(await geoCalls(page)).toBe(0);
  await expect(map(page)).toHaveAttribute("data-renderer", "leaflet");
  await expect(map(page)).toHaveAttribute("data-latitude", "40.692");
  await expect(page.locator(".atlas-photo-pin")).toHaveCount(0);
  await expect(
    map(page).getByRole("link", {
      name: "OpenStreetMap contributors",
      exact: true,
    }),
  ).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  const report = page.getByRole("region", { name: "Local weather" });
  await expect(report).toContainText("18°C");
  await expect(report).toContainText("scattered clouds");
  await expect(report.locator("time")).toHaveAttribute(
    "datetime",
    "2026-10-29T19:45:00.000Z",
  );
  await expect(report).toContainText("OPENWEATHER");
  await expect(
    report.getByRole("link", { name: "OpenWeather", exact: true }),
  ).toHaveAttribute("href", "https://openweathermap.org/");
  await map(page)
    .getByRole("button", { name: "Recenter selected area", exact: true })
    .click();
  expect(await geoCalls(page)).toBe(0);
});

test("device location is used only after the explicit button and updates the actual map and weather coordinates", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 35.6762,
    longitude: 139.6503,
    accuracy: 40,
  });
  const fixture = await installFixture(page);
  await page.goto("/");
  await ready(page);
  expect(await geoCalls(page)).toBe(0);
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(map(page)).toHaveAttribute("data-latitude", "35.6762");
  await expect(map(page)).toHaveAttribute("data-longitude", "139.6503");
  expect(await geoCalls(page)).toBe(1);
  await expect
    .poll(() =>
      fixture.requests.some(
        (url) =>
          url.pathname === "/api/weather" &&
          url.searchParams.get("lat") === "35.676" &&
          url.searchParams.get("lon") === "139.65",
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("region", { name: "Local weather" }),
  ).toContainText("Your chosen device area");
  await expect(page.locator(".atlas-photo-pin")).toHaveCount(0);
  await page.reload();
  await ready(page);
  expect(await geoCalls(page)).toBe(0);
  await expect(map(page)).toHaveAttribute("data-latitude", "40.692");
});

test("denied device permission keeps the map usable and city search remains available", async ({
  page,
  context,
}) => {
  await installFixture(page);
  await page.goto("/");
  await ready(page);
  const session = await context.newCDPSession(page);
  const { targetInfo } = await session.send("Target.getTargetInfo");
  await session.send("Browser.setPermission", {
    permission: { name: "geolocation" },
    setting: "denied",
    origin: "http://localhost:4174",
    browserContextId: targetInfo.browserContextId,
  });
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Location permission was denied" }),
  ).toBeVisible();
  await expect(map(page)).toHaveAttribute("data-latitude", "40.692");
  await choose(page, PLACES.Paris);
  await ready(page);
  await expect(map(page)).toHaveAttribute("data-latitude", "48.8566");
  await expect(map(page)).toHaveAttribute("data-longitude", "2.3522");
});

test("cancelling a location request prevents a late GPS response from replacing a chosen city", async ({
  page,
}) => {
  await installFixture(page);
  await page.goto("/");
  await ready(page);
  await page.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (success) => {
      (window as unknown as { __lateGeo: PositionCallback }).__lateGeo =
        success;
    };
  });
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel location request", exact: true })
    .click();
  await choose(page, PLACES.Paris);
  await page.evaluate(() => {
    (window as unknown as { __lateGeo: PositionCallback }).__lateGeo({
      coords: {
        latitude: 35.6762,
        longitude: 139.6503,
        accuracy: 20,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    } as GeolocationPosition);
  });
  await expect(map(page)).toHaveAttribute("data-latitude", "48.8566");
  await expect(page.locator(".chosen-area-paper")).toContainText(
    PLACES.Paris.label,
  );
});

test("city search handles empty results, repeated submissions, network errors and timeout recovery", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  await page.goto("/");
  await ready(page);
  await search(page, "Nowhere in this fixture");
  await expect(
    page.getByRole("status").filter({ hasText: "No places found" }),
  ).toBeVisible();
  await search(page, "Paris");
  await expect(
    page.getByRole("button", { name: PLACES.Paris.label, exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "Photon / OpenStreetMap", exact: true }),
  ).toHaveAttribute("href", "https://github.com/komoot/photon");
  await search(page, "Paris");
  await expect(
    page.getByRole("button", { name: PLACES.Paris.label, exact: true }),
  ).toHaveCount(1);
  fixture.geocode = async (route) =>
    json(
      route,
      {
        status: "unavailable",
        code: "upstream_unavailable",
        message: "Place search is temporarily unavailable.",
      },
      503,
    );
  await search(page, "Failed city");
  await expect(
    page.getByRole("status").filter({ hasText: "Place search is unavailable" }),
  ).toBeVisible();
  await expect(map(page)).toHaveAttribute("data-map-status", "ready");
  await page.clock.install();
  let pending: Route | undefined;
  fixture.geocode = async (route) => {
    pending = route;
  };
  await search(page, "Slow city");
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.clock.fastForward(12001);
  await expect(
    page.getByRole("status").filter({ hasText: "Place search is unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Search places", exact: true }),
  ).toBeEnabled();
  if (pending)
    await pending
      .fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"source":"photon","results":[]}',
      })
      .catch(() => {});
  fixture.geocode = undefined;
  await choose(page, PLACES.Rome);
  await expect(map(page)).toHaveAttribute("data-latitude", "41.9028");
});

test("newer city searches and clear/cancel cannot be overwritten by late search responses", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  let paris: Route | undefined, tokyo: Route | undefined;
  fixture.geocode = async (route, url) => {
    const q = url.searchParams.get("q");
    if (q === "Paris") {
      paris = route;
      return;
    }
    if (q === "Tokyo") {
      tokyo = route;
      return;
    }
    await json(route, { source: "photon", results: [PLACES.Rome] });
  };
  await page.goto("/");
  await ready(page);
  await search(page, "Paris");
  await expect.poll(() => Boolean(paris)).toBe(true);
  await search(page, "Rome");
  await expect(
    page.getByRole("button", { name: PLACES.Rome.label, exact: true }),
  ).toBeVisible();
  await json(paris!, { source: "photon", results: [PLACES.Paris] }).catch(
    () => {},
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(
    page.getByRole("button", { name: PLACES.Paris.label, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: PLACES.Rome.label, exact: true }),
  ).toBeVisible();
  await search(page, "Tokyo");
  await expect.poll(() => Boolean(tokyo)).toBe(true);
  await page
    .getByRole("button", { name: "Clear place search", exact: true })
    .click();
  await expect(city(page)).toBeFocused();
  await expect(city(page)).toHaveValue("");
  await json(tokyo!, { source: "photon", results: [PLACES.Tokyo] }).catch(
    () => {},
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(
    page.getByRole("list", { name: "Place search results" }),
  ).toHaveCount(0);
  tokyo = undefined;
  await search(page, "Tokyo");
  await expect.poll(() => Boolean(tokyo)).toBe(true);
  await city(page).press("Escape");
  await expect(city(page)).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Search places", exact: true }),
  ).toBeEnabled();
  await json(tokyo!, { source: "photon", results: [PLACES.Tokyo] }).catch(
    () => {},
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(
    page.getByRole("list", { name: "Place search results" }),
  ).toHaveCount(0);
});

test("weather belongs to the selected coordinates, refreshes explicitly, and rejects late data from a previous city", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  let paris: Route | undefined,
    refreshes = 0;
  fixture.weather = async (route, url) => {
    const lat = Number(url.searchParams.get("lat")),
      lon = Number(url.searchParams.get("lon"));
    if (Math.abs(lat - PLACES.Paris.latitude) < 0.01) {
      paris = route;
      return;
    }
    if (Math.abs(lat - PLACES.Rome.latitude) < 0.01) {
      refreshes++;
      await json(
        route,
        weather(lat, lon, {
          temperatureC: refreshes === 1 ? 23 : 24,
          description: "clear night",
          condition: "clear",
          isDay: false,
          observedAt:
            refreshes === 1
              ? "2026-10-29T20:10:00.000Z"
              : "2026-10-29T20:20:00.000Z",
        }),
      );
      return;
    }
    await json(route, weather(lat, lon));
  };
  await page.goto("/");
  await ready(page);
  await choose(page, PLACES.Paris);
  await expect.poll(() => Boolean(paris)).toBe(true);
  await choose(page, PLACES.Rome);
  const report = page.getByRole("region", { name: "Local weather" });
  await expect(report).toContainText("23°C");
  await expect(report).toContainText(PLACES.Rome.label);
  await json(
    paris!,
    weather(PLACES.Paris.latitude, PLACES.Paris.longitude, { temperatureC: 5 }),
  ).catch(() => {});
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(report).toContainText("23°C");
  await expect(report).not.toContainText("5°C");
  await expect(map(page)).toHaveClass(/geographic-map-night/);
  await page
    .getByRole("button", { name: "Refresh local weather", exact: true })
    .click();
  await expect(report).toContainText("24°C");
  await expect(report.locator("time")).toHaveAttribute(
    "datetime",
    "2026-10-29T20:20:00.000Z",
  );
});

test("missing credentials and weather upstream failure are honest and never block the geographic map", async ({
  page,
}) => {
  const fixture = await installFixture(page, { configured: false });
  await page.goto("/");
  await ready(page);
  const report = page.getByRole("region", { name: "Local weather" });
  await expect(report).toContainText("Weather not connected");
  await expect(report.locator("time")).toHaveCount(0);
  await choose(page, PLACES.Paris);
  await expect(map(page)).toHaveAttribute("data-latitude", "48.8566");
  await expect(report).toContainText("Weather not connected");
  fixture.configured = true;
  fixture.weather = async (route) =>
    json(
      route,
      {
        status: "unavailable",
        code: "upstream_unavailable",
        message: "Live weather is temporarily unavailable.",
      },
      503,
    );
  await page
    .getByRole("button", { name: "Refresh local weather", exact: true })
    .click();
  await expect(report).toContainText("Weather unavailable");
  await expect(map(page)).toHaveAttribute("data-map-status", "ready");
  await expect(
    map(page).getByRole("button", {
      name: "Recenter selected area",
      exact: true,
    }),
  ).toBeEnabled();
});

test("real city geography never relocates fictional restaurants, and the authored dinner demo remains separate", async ({
  page,
}) => {
  await installFixture(page);
  await page.goto("/");
  await ready(page);
  await choose(page, PLACES.Paris);
  await expect(map(page)).toHaveAttribute("data-latitude", "48.8566");
  await expect(
    map(page).getByRole("button", { name: /Juniper|Casa Nopal|Momo House/ }),
  ).toHaveCount(0);
  await expect(page.locator(".atlas-photo-pin")).toHaveCount(0);
  await expect(
    page.getByText("Real nearby recommendations are not connected yet.", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open demo atlas", exact: true })
    .click();
  await expect(page.locator(".immersive-atlas")).toBeVisible();
  await expect(page.locator(".atlas-photo-pin")).toHaveCount(6);
  await expect(
    page.getByRole("article", { name: "Juniper & Rye, selected restaurant" }),
  ).toBeVisible();
});

test("the real vector renderer can load a local minimal style fixture without external map requests", async ({
  page,
}) => {
  await installFixture(page, { forceRaster: false });
  await page.goto("/");
  await ready(page);
  const renderer = await map(page).getAttribute("data-renderer");
  test
    .info()
    .annotations.push({
      type: "fixture-renderer",
      description: renderer ?? "unknown",
    });
  expect(["maplibre", "leaflet"]).toContain(renderer);
  if (renderer === "maplibre") {
    expect(
      (await map(page).locator(".maplibregl-canvas").boundingBox())?.height,
    ).toBeGreaterThan(400);
    await expect(
      map(page).getByRole("link", { name: "OpenFreeMap", exact: true }),
    ).toBeVisible();
    await expect(
      map(page).getByRole("button", { name: /Switch to 2D map/ }),
    ).toBeEnabled();
  } else
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /3D.*unavailable|3D map could not start/ }),
    ).toBeVisible();
  await expect(
    map(page).getByRole("link", {
      name: "OpenStreetMap contributors",
      exact: true,
    }),
  ).toBeVisible();
});

for (const mobile of [false, true])
  test(`WCAG A/AA automated scan: ${mobile ? "mobile" : "desktop"} real location controls and attribution`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await installFixture(page);
    await page.goto("/");
    await ready(page);
    await expect(
      page.getByRole("region", { name: "Local weather" }),
    ).toContainText("18°C");
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const report = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      report.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    ).toEqual([]);
  });
