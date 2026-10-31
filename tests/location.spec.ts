import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// These are browser integration fixtures, not evidence of a live provider response.
// All map styles, tiles and glyphs are served by this test: no tile-server traffic.
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGNIrAr4TwlmGDVg1IBRA4aLAQC97CofWtw9CQAAAABJRU5ErkJggg==",
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
const POI_STYLE = {
  ...STYLE,
  sprite: "https://tiles.openfreemap.org/qa/poi-sprite",
  sources: {
    "qa-places": {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: 1,
            properties: {
              name: "Fixture Supper Room",
              class: "restaurant",
              subclass: "restaurant",
            },
            geometry: { type: "Point", coordinates: [-73.985, 40.692] },
          },
          {
            type: "Feature",
            id: 2,
            properties: {
              name: "Fixture Coffee Counter",
              class: "cafe",
              subclass: "cafe",
            },
            geometry: { type: "Point", coordinates: [-73.975, 40.692] },
          },
          {
            type: "Feature",
            id: 3,
            properties: {
              name: "Fixture Garden",
              class: "park",
              subclass: "garden",
            },
            geometry: { type: "Point", coordinates: [-73.977, 40.689] },
          },
          {
            type: "Feature",
            id: 4,
            properties: {
              name: "Fixture Parking",
              class: "parking",
              subclass: "parking",
            },
            geometry: { type: "Point", coordinates: [-73.977, 40.695] },
          },
          {
            type: "Feature",
            id: 5,
            properties: {
              "name:en": "",
              name_en: "",
              "name:latin": "",
              name: "Café de la Fixture",
              class: "cafe",
              subclass: "cafe",
            },
            geometry: { type: "Point", coordinates: [2.3522, 48.8566] },
          },
        ],
      },
    },
  },
  layers: [
    ...STYLE.layers,
    {
      id: "poi_r99_qa_places",
      type: "symbol",
      source: "qa-places",
      layout: {
        "icon-image": "qa-point",
        "icon-size": 12,
        "icon-allow-overlap": true,
      },
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
async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
async function installFixture(
  page: Page,
  { forceRaster = true, points = false } = {},
) {
  const requests: URL[] = [];
  const retired: string[] = [];
  retiredRequests.set(page, retired);
  const fixture: {
    requests: URL[];
    geocode?: (route: Route, url: URL) => Promise<void>;
  } = { requests };
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
    if (
      url.pathname === "/api/weather" ||
      url.pathname === "/api/location-config" ||
      url.hostname.endsWith("openweathermap.org")
    ) {
      retired.push(url.toString());
      return json(route, { status: "error", code: "not_found" }, 404);
    }
    if (url.pathname === "/api/geocode") {
      requests.push(url);
      if (fixture.geocode) return fixture.geocode(route, url);
      const place = PLACES[url.searchParams.get("q") as keyof typeof PLACES];
      return json(route, { source: "photon", results: place ? [place] : [] });
    }
    if (["localhost", "127.0.0.1"].includes(url.hostname))
      return route.continue();
    if (url.hostname === "tiles.openfreemap.org") {
      if (url.pathname.includes("/styles/"))
        return json(route, points ? POI_STYLE : STYLE);
      if (
        url.pathname.startsWith("/qa/poi-sprite") &&
        url.pathname.endsWith(".json")
      )
        return json(route, {
          "qa-point": { x: 0, y: 0, width: 16, height: 16, pixelRatio: 1 },
        });
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

const retiredRequests = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => {
  expect(retiredRequests.get(page) ?? []).toEqual([]);
  if (!page.isClosed()) {
    await expect(page.locator(".local-weather")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Refresh local weather", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/OpenWeather/i)).toHaveCount(0);
  }
});

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
async function assertAccessible(page: Page) {
  await page.evaluate(() => document.fonts.ready);
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
}

test("real OpenStreetMap geography loads without device permission or weather services", async ({
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
  await map(page)
    .getByRole("button", { name: "Recenter selected area", exact: true })
    .click();
  expect(await geoCalls(page)).toBe(0);
});

test("device location is used only after the explicit button and updates the actual map coordinates", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 35.6762,
    longitude: 139.6503,
    accuracy: 40,
  });
  await installFixture(page);
  await page.goto("/");
  await ready(page);
  expect(await geoCalls(page)).toBe(0);
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(map(page)).toHaveAttribute("data-latitude", "35.6762");
  await expect(map(page)).toHaveAttribute("data-longitude", "139.6503");
  expect(await geoCalls(page)).toBe(1);
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

test("the standard geographic map actually pans by keyboard and recenters the chosen area without requesting location", async ({
  page,
}) => {
  await installFixture(page);
  await page.goto("/");
  await ready(page);
  await choose(page, PLACES.Paris);
  const marker = map(page).locator(".geo-leaflet-marker");
  const before = await marker.boundingBox();
  expect(before).not.toBeNull();
  await map(page).locator(".geographic-map-canvas").focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => Math.abs((await marker.boundingBox())!.x - before!.x))
    .toBeGreaterThan(20);
  await expect(map(page)).toHaveAttribute("data-latitude", "48.8566");
  await map(page)
    .getByRole("button", { name: "Recenter selected area", exact: true })
    .click();
  await expect
    .poll(async () => Math.abs((await marker.boundingBox())!.x - before!.x))
    .toBeLessThan(2);
  expect(await geoCalls(page)).toBe(0);
  await expect(
    map(page).getByRole("button", {
      name: "Reset north orientation",
      exact: true,
    }),
  ).toBeDisabled();
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
    page.getByText(
      "Real menus and personalized recommendations are not connected yet.",
      {
        exact: false,
      },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open demo atlas", exact: true })
    .click();
  await expect(page.locator(".immersive-atlas")).toBeVisible();
  await expect(page.locator(".atlas-photo-pin")).toHaveCount(6);
  await expect(
    page.getByRole("article", { name: "Juniper & Rye, selected restaurant" }),
  ).toBeVisible();
  await page.goBack();
  await ready(page);
  await expect(map(page)).toHaveAttribute("data-latitude", "48.8566");
  await expect(page.locator(".atlas-photo-pin")).toHaveCount(0);
  await page.goForward();
  await expect(page.locator(".immersive-atlas")).toBeVisible();
  await expect(page.locator(".atlas-photo-pin")).toHaveCount(6);
});

test("the real vector renderer can load a local minimal style fixture without external map requests", async ({
  page,
}) => {
  await installFixture(page, { forceRaster: false });
  await page.goto("/");
  await ready(page);
  const renderer = await map(page).getAttribute("data-renderer");
  test.info().annotations.push({
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

test("rendered named map places can be selected while fictional dinner venues stay separate", async ({
  page,
}) => {
  await installFixture(page, { forceRaster: false, points: true });
  await page.goto("/");
  await ready(page);
  await expect(map(page)).toHaveAttribute("data-renderer", "maplibre");
  const place = map(page).getByRole("button", {
    name: "Explore Fixture Supper Room",
    exact: true,
  });
  await expect(place).toBeVisible();
  await place.click();
  await expect(place).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".atlas-photo-pin")).toHaveCount(0);
  await assertAccessible(page);
});

test("area lenses filter actual rendered place categories and parking never becomes an outdoors suggestion", async ({
  page,
}) => {
  await installFixture(page, { forceRaster: false, points: true });
  await page.goto("/");
  await ready(page);
  await expect(
    map(page).getByRole("button", {
      name: "Explore Fixture Supper Room",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Coffee\b/ }).click();
  await expect(map(page)).toHaveAttribute("data-lens", "coffee");
  await expect(
    map(page).getByRole("button", {
      name: "Explore Fixture Coffee Counter",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    map(page).getByRole("button", {
      name: "Explore Fixture Supper Room",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /^Food\b/ }).click();
  await expect(map(page)).toHaveAttribute("data-lens", "food");
  await expect(
    map(page).getByRole("button", {
      name: "Explore Fixture Supper Room",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    map(page).getByRole("button", {
      name: "Explore Fixture Coffee Counter",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /^Outdoors\b/ }).click();
  await expect(map(page)).toHaveAttribute("data-lens", "outdoors");
  await expect(
    map(page).getByRole("button", {
      name: "Explore Fixture Garden",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    map(page).getByRole("button", {
      name: "Explore Fixture Parking",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /^(All|Everything)\b/ }).click();
  await expect(map(page)).toHaveAttribute("data-lens", "all");
  await expect(
    map(page).getByRole("button", {
      name: "Explore Fixture Supper Room",
      exact: true,
    }),
  ).toBeVisible();
});

test("mapped place notes support repeated keep and unkeep, close focus, and revisiting after a city and demo detour", async ({
  page,
}) => {
  await installFixture(page, { forceRaster: false, points: true });
  await page.goto("/");
  await ready(page);
  await map(page)
    .getByRole("button", { name: "Explore Fixture Supper Room", exact: true })
    .click();
  const notes = page.getByRole("complementary", { name: "Map field notes" });
  const collection = page.getByRole("group", { name: "Map place collection" });
  await expect(
    notes.getByRole("heading", { name: "Fixture Supper Room", exact: true }),
  ).toBeVisible();
  await expect(notes).toContainText(
    "Menus, prices, opening hours and dietary suitability haven’t been checked.",
  );
  await expect(notes).not.toContainText(/\$\s*\d/);
  for (let i = 0; i < 2; i++) {
    await notes
      .getByRole("button", { name: "Keep this place", exact: true })
      .click();
    await expect(
      notes.getByRole("button", { name: "Kept for this session", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      collection.getByRole("button", { name: /^Kept\b/ }),
    ).toContainText("1");
    await notes
      .getByRole("button", { name: "Kept for this session", exact: true })
      .click();
    await expect(
      collection.getByRole("button", { name: /^Kept\b/ }),
    ).toContainText("0");
  }
  await notes
    .getByRole("button", { name: "Keep this place", exact: true })
    .click();
  await notes
    .getByRole("button", { name: "Close place notes", exact: true })
    .click();
  await expect(
    collection.getByRole("button", { name: /^In this view\b/ }),
  ).toBeFocused();
  await expect(
    notes.getByRole("heading", { name: "Fixture Supper Room", exact: true }),
  ).toHaveCount(0);
  await choose(page, PLACES.Paris);
  await expect(map(page)).toHaveAttribute("data-latitude", "48.8566");
  await page
    .getByRole("button", { name: "Open demo atlas", exact: true })
    .click();
  await expect(page.locator(".immersive-atlas")).toBeVisible();
  await page.goBack();
  await ready(page);
  await collection.getByRole("button", { name: /^Kept\b/ }).click();
  const kept = page.getByRole("list", { name: "Kept mapped places" });
  await expect(
    kept.getByRole("button", { name: /Fixture Supper Room/ }),
  ).toHaveCount(1);
  await kept.getByRole("button", { name: /Fixture Supper Room/ }).click();
  await expect
    .poll(async () => Number(await map(page).getAttribute("data-latitude")))
    .toBeCloseTo(40.692, 5);
  await expect
    .poll(async () => Number(await map(page).getAttribute("data-longitude")))
    .toBeCloseTo(-73.985, 5);
  await expect(
    notes.getByRole("heading", { name: "Fixture Supper Room", exact: true }),
  ).toBeVisible();
  await expect(
    notes.getByRole("button", { name: "Kept for this session", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(() =>
      Object.values(localStorage).some((value) =>
        value.includes("Fixture Supper Room"),
      ),
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Low-power view", exact: true })
    .click();
  await ready(page);
  await expect(map(page)).toHaveAttribute("data-renderer", "leaflet");
  await expect(map(page).locator(".geo-remembered-marker")).toContainText(
    "Fixture Supper Room",
  );
  await expect(map(page)).toHaveAttribute("data-poi-count", "0");
  await expect(
    notes.getByRole("heading", { name: "Fixture Supper Room", exact: true }),
  ).toBeVisible();
  await expect(
    notes.getByRole("button", { name: "Kept for this session", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("changing to Paris discovers a localized mapped name and selecting it cancels a late GPS result", async ({
  page,
}) => {
  await installFixture(page, { forceRaster: false, points: true });
  await page.goto("/");
  await ready(page);
  await map(page)
    .getByRole("button", { name: "Explore Fixture Supper Room", exact: true })
    .waitFor();
  await choose(page, PLACES.Paris);
  const french = map(page).getByRole("button", {
    name: "Explore Café de la Fixture",
    exact: true,
  });
  await expect(french).toBeVisible();
  await page.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (success) => {
      (window as unknown as { __lateGeo: PositionCallback }).__lateGeo =
        success;
    };
  });
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await french.click();
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
  await expect(map(page)).toHaveAttribute("data-longitude", "2.3522");
  await expect(
    page
      .getByRole("complementary", { name: "Map field notes" })
      .getByRole("heading", { name: "Café de la Fixture", exact: true }),
  ).toBeVisible();
});

test("area atmosphere and unfolded view respond to repeated controls and Escape preserves search focus before folding", async ({
  page,
}) => {
  await installFixture(page);
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: /Set supper light$/ }).click();
  await expect(map(page)).toHaveAttribute("data-atmosphere", "supper");
  await expect(map(page)).toHaveClass(/geographic-map-night/);
  await page.getByRole("button", { name: /Set daylight$/ }).click();
  await expect(map(page)).toHaveAttribute("data-atmosphere", "day");
  await page.getByRole("button", { name: "Unfold map", exact: true }).click();
  await expect(page.locator(".location-atlas")).toHaveClass(/is-unfolded/);
  await city(page).fill("Paris");
  await city(page).press("Escape");
  await expect(city(page)).toBeFocused();
  await expect(page.locator(".location-atlas")).toHaveClass(/is-unfolded/);
  await map(page).locator(".geographic-map-canvas").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".location-atlas")).not.toHaveClass(/is-unfolded/);
  await expect(
    page.getByRole("button", { name: "Unfold map", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Unfold map", exact: true }).click();
  await page.getByRole("button", { name: "Fold map", exact: true }).click();
  await expect(page.locator(".location-atlas")).not.toHaveClass(/is-unfolded/);
  await expect(
    page.getByRole("button", { name: "Unfold map", exact: true }),
  ).toBeFocused();
});

test("The Waiter follows the same real mapped place and shares its keep state without touching the demo shortlist", async ({
  page,
}) => {
  await installFixture(page, { forceRaster: false, points: true });
  await page.goto("/");
  await ready(page);
  await map(page)
    .getByRole("button", { name: "Explore Fixture Supper Room", exact: true })
    .click();
  const notes = page.getByRole("complementary", { name: "Map field notes" });
  await notes
    .getByRole("heading", { name: "Fixture Supper Room", exact: true })
    .waitFor();
  const summon = notes.getByRole("button", {
    name: "Ask The Waiter about Fixture Supper Room",
    exact: true,
  });
  await summon.click();
  const waiter = page.getByRole("dialog", {
    name: "The Waiter, at your service",
  });
  await expect(
    waiter.getByRole("heading", { name: "Fixture Supper Room", exact: true }),
  ).toBeVisible();
  await expect(waiter).toContainText("OPENSTREETMAP · REAL GEOGRAPHY");
  await expect(waiter).toContainText(
    "Your fictional demo table and dinner plan stay unchanged.",
  );
  await waiter
    .getByRole("button", { name: "Keep mapped place", exact: true })
    .click();
  await expect(
    waiter.getByRole("button", { name: "Mapped place kept", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await waiter.getByLabel("Or leave a small request").fill("keep this place");
  await waiter
    .getByRole("button", { name: "Ask The Waiter", exact: true })
    .click();
  await expect(waiter.locator(".cw-response")).toContainText("already kept");
  await assertAccessible(page);
  await page.keyboard.press("Escape");
  await expect(waiter).not.toBeVisible();
  await expect(summon).toBeFocused();
  await expect(
    notes.getByRole("button", { name: "Kept for this session", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page
      .getByRole("group", { name: "Map place collection" })
      .getByRole("button", { name: /^Kept\b/ }),
  ).toContainText("1");
  await notes
    .getByRole("button", { name: "Kept for this session", exact: true })
    .click();
  await summon.click();
  await expect(
    waiter.getByRole("button", { name: "Keep mapped place", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /Your table/ })
    .click();
  await expect(page.locator(".tp-contender")).toHaveCount(0);
});

test("mobile mapped-place selection reveals a useful peek and Read notes transfers keyboard focus to that place", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 40.692,
    longitude: -73.985,
    accuracy: 40,
  });
  await installFixture(page, { forceRaster: false, points: true });
  await page.goto("/");
  await ready(page);
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(map(page)).toHaveAttribute("data-longitude", "-73.985");
  await map(page)
    .getByRole("button", { name: "Explore Fixture Supper Room", exact: true })
    .click();
  const peek = page.locator(".mobile-place-peek");
  await expect(peek).toBeVisible();
  await expect(peek).toContainText("Fixture Supper Room");
  await expect(peek).toContainText("Read notes");
  await peek.focus();
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("complementary", { name: "Map field notes" })
      .getByRole("heading", { name: "Fixture Supper Room", exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await assertAccessible(page);
});

for (const mobile of [false, true])
  test(`WCAG A/AA automated scan: ${mobile ? "mobile" : "desktop"} real location controls and attribution`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await installFixture(page);
    await page.goto("/");
    await ready(page);
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
