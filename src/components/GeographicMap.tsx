/// <reference types="vite/client" />
import { useEffect, useRef, useState } from "react";
import {
  Compass,
  Layers,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Minus,
  Plus,
  RefreshCw,
  TriangleAlert,
  Orbit,
} from "lucide-react";
import type {
  Map as GLMap,
  Marker as GLMarker,
  StyleSpecification,
} from "maplibre-gl";
import type { Map as RasterMap, Marker as RasterMarker } from "leaflet";
import "./geographic-map.css";

export interface MapPoint {
  id: string;
  name: string;
  category: "food" | "coffee" | "outdoors" | "other";
  latitude: number;
  longitude: number;
}

export interface GeographicMapProps {
  location: { latitude: number; longitude: number; label: string };
  lowPower: boolean;
  atmosphere?: "day" | "supper";
  lens?: "all" | "food" | "coffee" | "outdoors";
  selectedPoint?: MapPoint | null;
  onPointSelect?: (point: MapPoint) => void;
  onPointsChange?: (points: MapPoint[]) => void;
  showAreaLabel?: boolean;
  onCameraChange?: (coords: { latitude: number; longitude: number }) => void;
}

type Engine =
  | { kind: "maplibre"; map: GLMap; marker: GLMarker }
  | { kind: "leaflet"; map: RasterMap; marker: RasterMarker };
type Status = "loading" | "ready" | "error";
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const AREA_ZOOM = 14.8;
const overviewZoom = (width: number) => (width < 650 ? 14.1 : AREA_ZOOM);
const MARKER_HTML =
  '<span class="geo-marker-head"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 21s7-6 7-12A7 7 0 0 0 5 9c0 6 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg></span><span class="geo-marker-caption">Selected area</span>';
const validLocation = (location: GeographicMapProps["location"]) =>
  Number.isFinite(location.latitude) &&
  Number.isFinite(location.longitude) &&
  Math.abs(location.latitude) <= 85.051129 &&
  Math.abs(location.longitude) <= 180;

/** Recolors the real OpenFreeMap style; building footprints/heights remain its actual vector data. */
function tableStyle(
  style: StyleSpecification,
  night: boolean,
): StyleSpecification {
  const colors = night
    ? {
        land: "#b9bdaa",
        water: "#829f9e",
        park: "#9daa87",
        road: "#dedbc4",
        edge: "#b4b59a",
        building: "#b7a98b",
        text: "#455547",
      }
    : {
        land: "#eee8d6",
        water: "#b9ceca",
        park: "#cad3ad",
        road: "#fbf5e5",
        edge: "#d5cfb6",
        building: "#cfbea0",
        text: "#657153",
      };
  for (const layer of style.layers) {
    if (layer.type === "background")
      layer.paint = { ...layer.paint, "background-color": colors.land };
    if (layer.type === "fill") {
      const id = layer.id;
      const color = /water/.test(id)
        ? colors.water
        : /park|grass|wood|cemetery/.test(id)
          ? colors.park
          : /building/.test(id)
            ? colors.building
            : /residential|school|hospital/.test(id)
              ? colors.land
              : null;
      if (color) layer.paint = { ...layer.paint, "fill-color": color };
    }
    if (layer.type === "line") {
      if (/waterway/.test(layer.id))
        layer.paint = { ...layer.paint, "line-color": colors.water };
      else if (
        /^(road|bridge|tunnel)_/.test(layer.id) &&
        !/rail|arrow/.test(layer.id)
      )
        layer.paint = {
          ...layer.paint,
          "line-color": /casing/.test(layer.id) ? colors.edge : colors.road,
        };
    }
    if (layer.type === "symbol" && layer.paint?.["text-color"])
      layer.paint = {
        ...layer.paint,
        "text-color": colors.text,
        "text-halo-color": night ? "#cbd0bc" : "#f8f1df",
      };
    if (layer.type === "symbol" && /^poi_r/.test(layer.id)) {
      layer.minzoom = Math.min(layer.minzoom ?? 15, 14);
      layer.layout = { ...layer.layout, visibility: "none" };
      // The independent POI layer below supplies geometry; bounded DOM objects
      // replace these provider labels without depending on their rank filters.
    }
    if (layer.type === "symbol" && layer.id === "poi_transit") {
      // Keep major transport anchors; repeated neighborhood bus stops obscure
      // the streets and buildings at our neighborhood overview scale.
      layer.filter = [
        "match",
        ["get", "class"],
        ["airport", "rail"],
        true,
        false,
      ];
      layer.layout = { ...layer.layout, "icon-size": 0.65, "text-size": 11 };
      layer.paint = { ...layer.paint, "icon-opacity": 0.8 };
    }
    if (layer.type === "fill-extrusion")
      layer.paint = {
        ...layer.paint,
        "fill-extrusion-color": colors.building,
        "fill-extrusion-opacity": 0.9,
        // Liberty's building source uses these actual OpenMapTiles height fields.
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 0],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      };
  }
  // Query actual point geometry through a presentation-independent layer.
  // No glyphs, sprites, ranks or provider label filters control the place index.
  // The app supplies the bounded, accessible names and collision management.
  const poiLayer = style.layers.find(
    (layer) =>
      "source" in layer &&
      (("source-layer" in layer && layer["source-layer"] === "poi") ||
        (layer.type === "symbol" && /^poi_r/.test(layer.id))),
  );
  const poiSource = poiLayer && "source" in poiLayer ? poiLayer.source : null;
  const poiSourceType =
    typeof poiSource === "string" ? style.sources[poiSource]?.type : null;
  if (
    typeof poiSource === "string" &&
    (poiSourceType === "vector" || poiSourceType === "geojson") &&
    !style.layers.some((layer) => layer.id === "poi_common_table")
  ) {
    style.layers.push({
      id: "poi_common_table",
      type: "circle",
      source: poiSource,
      ...(poiSourceType === "vector" ? { "source-layer": "poi" } : {}),
      minzoom: 14,
      paint: {
        "circle-radius": 1,
        "circle-color": colors.text,
        "circle-opacity": 0.001,
      },
    });
  }
  style.light = {
    anchor: "viewport",
    color: night ? "#dfd7b4" : "#fff6dd",
    intensity: night ? 0.25 : 0.45,
    position: [1.15, 210, 35],
  };
  return style;
}

function webGLAvailable() {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

const POINT_ICONS: Record<MapPoint["category"], string> = {
  food: '<svg viewBox="0 0 28 28" width="26" height="26" fill="none" aria-hidden="true"><ellipse cx="14" cy="21" rx="10" ry="3" fill="currentColor" opacity=".14"/><circle cx="14" cy="13" r="8" stroke="currentColor" stroke-width="1.5"/><circle cx="14" cy="13" r="5" stroke="currentColor" stroke-width=".8"/><path d="M3 5v8m-2-8v5q2 3 4 0V5M25 5v15m0-15q-4 3-3 8h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  coffee:
    '<svg viewBox="0 0 28 28" width="26" height="26" fill="none" aria-hidden="true"><ellipse cx="13" cy="22" rx="10" ry="2.5" fill="currentColor" opacity=".14"/><path d="M5 10h14v7q0 5-7 5t-7-5Zm14 1h3q5 5-3 7" fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-width="1.4"/><path d="M10 3q-3 2 0 4m5-5q-3 2 0 4M3 23h20" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  outdoors:
    '<svg viewBox="0 0 28 28" width="26" height="26" fill="none" aria-hidden="true"><ellipse cx="14" cy="24" rx="10" ry="2" fill="currentColor" opacity=".14"/><path d="M14 24V12m0 5q-10 0-9-9 9-1 9 9Zm0-4Q13 3 23 3q1 10-9 10Z" fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  other:
    '<svg viewBox="0 0 28 28" width="26" height="26" fill="none" aria-hidden="true"><ellipse cx="14" cy="24" rx="8" ry="2" fill="currentColor" opacity=".14"/><path d="M14 3 17 10 24 13 17 16 14 23 11 16 4 13 11 10Z" fill="currentColor" fill-opacity=".1" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
};

function pointFromFeature(feature: {
  id?: string | number;
  source?: string;
  sourceLayer?: string;
  properties: Record<string, unknown> | null;
  geometry: GeoJSON.Geometry;
}): MapPoint | null {
  const properties = feature.properties;
  if (
    !properties ||
    (feature.geometry.type !== "Point" &&
      feature.geometry.type !== "MultiPoint")
  )
    return null;
  const rawName = [
    properties["name:en"],
    properties.name_en,
    properties["name:latin"],
    properties.name,
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  if (typeof rawName !== "string" || !rawName.trim()) return null;
  const name = rawName.trim().slice(0, 120);
  const coordinate =
    feature.geometry.type === "Point"
      ? feature.geometry.coordinates
      : feature.geometry.coordinates[0];
  if (
    !coordinate ||
    !Number.isFinite(coordinate[0]) ||
    !Number.isFinite(coordinate[1])
  )
    return null;
  const [longitude, latitude] = coordinate;
  if (Math.abs(latitude) > 85.051129 || Math.abs(longitude) > 180) return null;
  const kinds = `${properties.class ?? ""} ${properties.subclass ?? ""}`
    .toLowerCase()
    .split(/[\s;,]+/);
  const hasKind = (values: string[]) =>
    kinds.some((kind) => values.includes(kind));
  const category: MapPoint["category"] = hasKind([
    "cafe",
    "coffee",
    "coffee_shop",
    "tea_house",
    "tea_room",
  ])
    ? "coffee"
    : hasKind([
          "food",
          "restaurant",
          "fast_food",
          "food_court",
          "bakery",
          "biergarten",
          "bar",
          "pub",
          "ice_cream",
          "deli",
        ])
      ? "food"
      : hasKind([
            "park",
            "garden",
            "wood",
            "forest",
            "nature_reserve",
            "beach",
            "viewpoint",
            "picnic_site",
            "playground",
          ])
        ? "outdoors"
        : "other";
  const sourceKey = `${feature.source ?? "osm"}:${feature.sourceLayer ?? "poi"}`;
  const providerId = feature.id ?? properties.osm_id;
  const id =
    providerId !== undefined && providerId !== null
      ? `${sourceKey}:${String(providerId)}`
      : `${sourceKey}:${name.toLocaleLowerCase()}:${longitude.toFixed(4)}:${latitude.toFixed(4)}`;
  return { id, name, category, latitude, longitude };
}

export default function GeographicMap({
  location,
  lowPower,
  atmosphere = "day",
  lens = "all",
  selectedPoint = null,
  onPointSelect,
  onPointsChange,
  onCameraChange,
  showAreaLabel = true,
}: GeographicMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const rasterLibrary = useRef<typeof import("leaflet") | null>(null);
  const rememberedMarker = useRef<RasterMarker | null>(null);
  const latestLocation = useRef(location);
  const onCameraChangeRef = useRef(onCameraChange);
  latestLocation.current = location;
  onCameraChangeRef.current = onCameraChange;
  const [status, setStatus] = useState<Status>("loading");
  const [renderer, setRenderer] = useState<
    "loading" | "maplibre" | "leaflet" | "error"
  >("loading");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const [preferRaster, setPreferRaster] = useState(false);
  const [dimensional, setDimensional] = useState(true);
  const [zoom, setZoom] = useState(AREA_ZOOM);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const motionOff = lowPower || reducedMotion;
  const night = atmosphere === "supper";
  const coordinateValid = validLocation(location);
  const atmosphereRef = useRef(night);
  atmosphereRef.current = night;
  const lensRef = useRef(lens);
  const selectedPointRef = useRef(selectedPoint);
  const onPointSelectRef = useRef(onPointSelect);
  const onPointsChangeRef = useRef(onPointsChange);
  lensRef.current = lens;
  selectedPointRef.current = selectedPoint;
  onPointSelectRef.current = onPointSelect;
  onPointsChangeRef.current = onPointsChange;
  const pointMarkers = useRef(
    new Map<
      string,
      { marker: GLMarker; element: HTMLButtonElement; point: MapPoint }
    >(),
  );
  const refreshPoints = useRef<() => void>(() => {});
  const lastPointsSignature = useRef("");
  const lastFocusedPoint = useRef<string | null>(null);
  const [pointCount, setPointCount] = useState(0);
  const [lookingAround, setLookingAround] = useState(false);
  const cameraLook = useRef({
    active: false,
    sequence: 0,
    timers: [] as number[],
  });
  const cancelLookAround = (updateState = true) => {
    const current = cameraLook.current;
    current.sequence++;
    current.timers.forEach(window.clearTimeout);
    current.timers = [];
    if (current.active) {
      current.active = false;
      if (engine.current?.kind === "maplibre") engine.current.map.stop();
      if (updateState) setLookingAround(false);
    }
  };
  const lookAround = () => {
    if (cameraLook.current.active) {
      cancelLookAround();
      return;
    }
    const active = engine.current;
    if (active?.kind !== "maplibre" || motionOff || status !== "ready") return;
    const map = active.map;
    map.stop();
    const original = {
      center: map.getCenter(),
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
    };
    const point = selectedPointRef.current;
    const center: [number, number] = point
      ? [point.longitude, point.latitude]
      : [original.center.lng, original.center.lat];
    const current = cameraLook.current;
    current.active = true;
    const sequence = ++current.sequence;
    setLookingAround(true);
    const step = (delay: number, action: () => void) =>
      current.timers.push(
        window.setTimeout(() => {
          if (current.active && sequence === current.sequence) action();
        }, delay),
      );
    map.easeTo({
      center,
      zoom: Math.max(15.2, original.zoom),
      pitch: 58,
      bearing: original.bearing - 24,
      duration: 850,
      essential: false,
    });
    step(850, () =>
      map.easeTo({
        bearing: original.bearing + 24,
        pitch: 58,
        duration: 1700,
        essential: false,
      }),
    );
    step(2550, () =>
      map.easeTo({
        center: original.center,
        zoom: original.zoom,
        pitch: original.pitch,
        bearing: original.bearing,
        duration: 850,
        essential: false,
      }),
    );
    step(3420, () => {
      current.active = false;
      current.timers = [];
      setLookingAround(false);
    });
  };
  const publishPoints = (points: MapPoint[]) => {
    const signature = JSON.stringify(points);
    if (signature === lastPointsSignature.current) return;
    lastPointsSignature.current = signature;
    setPointCount(points.length);
    onPointsChangeRef.current?.(points);
  };
  const focusPoint = (point: MapPoint) => {
    cancelLookAround();
    const active = engine.current;
    if (!active) return;
    if (active.kind === "leaflet") {
      const L = rasterLibrary.current;
      if (!L) return;
      active.map.stop();
      active.map.setView([point.latitude, point.longitude], 15, {
        animate: false,
      });
      rememberedMarker.current?.remove();
      const element = document.createElement("div");
      element.className = `geo-remembered-object geo-poi-${point.category}`;
      const object = document.createElement("span");
      object.className = "geo-place-object";
      const icon = document.createElement("span");
      icon.className = "geo-place-icon";
      icon.innerHTML = POINT_ICONS[point.category];
      const name = document.createElement("span");
      name.className = "geo-place-name";
      name.textContent = point.name;
      object.append(icon, name);
      element.append(object);
      rememberedMarker.current = L.marker([point.latitude, point.longitude], {
        icon: L.divIcon({
          className: "geo-remembered-marker",
          html: element,
          iconSize: [170, 60],
          iconAnchor: [85, 60],
        }),
        keyboard: false,
        title: `Selected place: ${point.name}`,
      }).addTo(active.map);
      return;
    }
    lastFocusedPoint.current = point.id;
    active.map.stop();
    active.map.flyTo({
      center: [point.longitude, point.latitude],
      zoom: Math.max(15.6, active.map.getZoom()),
      duration: motionOff ? 0 : 850,
      essential: false,
    });
  };

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let disposed = false;
    let localEngine: Engine | null = null;
    let loaded = false;
    let watchdog: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const cleanups: (() => void)[] = [];
    publishPoints([]);
    lastFocusedPoint.current = null;
    refreshPoints.current = () => {};
    setStatus("loading");
    setLookingAround(false);
    setRenderer("loading");
    setMessage("");
    setNotice("");
    const fail = (text: string) => {
      if (!disposed) {
        clearTimeout(watchdog);
        publishPoints([]);
        pointMarkers.current.forEach(({ marker }) => marker.remove());
        pointMarkers.current.clear();
        setStatus("error");
        if (!localEngine) setRenderer("error");
        setMessage(text);
      }
    };
    const ready = () => {
      if (disposed) return;
      loaded = true;
      clearTimeout(watchdog);
      setStatus("ready");
      setMessage("");
    };
    const reportCamera = () => {
      if (disposed || !localEngine) return;
      if (localEngine.kind === "maplibre") {
        const center = localEngine.map.getCenter();
        setZoom(localEngine.map.getZoom());
        onCameraChangeRef.current?.({
          latitude: center.lat,
          longitude: center.lng,
        });
      } else {
        const center = localEngine.map.getCenter();
        setZoom(localEngine.map.getZoom());
        onCameraChangeRef.current?.({
          latitude: center.lat,
          longitude: center.lng,
        });
      }
    };
    const loadRaster = async (reason: string) => {
      if (disposed) return;
      publishPoints([]);
      refreshPoints.current = () => {};
      setNotice(reason);
      const [L] = await Promise.all([
        import("leaflet"),
        import("leaflet/dist/leaflet.css"),
      ]);
      if (disposed) return;
      host.replaceChildren();
      rasterLibrary.current = L;
      const target = latestLocation.current;
      const map = L.map(host, {
        attributionControl: false,
        zoomControl: false,
        keyboard: true,
        zoomAnimation: !motionOff,
        fadeAnimation: !motionOff,
        markerZoomAnimation: !motionOff,
        maxZoom: 19,
        minZoom: 2,
      }).setView([target.latitude, target.longitude], 15);
      host.setAttribute(
        "aria-label",
        `Map of ${target.label}. Arrow keys pan; plus and minus zoom.`,
      );
      const marker = L.marker([target.latitude, target.longitude], {
        icon: L.divIcon({
          className: "geo-leaflet-marker",
          html: MARKER_HTML,
          iconSize: [40, 58],
          iconAnchor: [20, 20],
        }),
        keyboard: false,
        title: "Selected area",
      }).addTo(map);
      localEngine = { kind: "leaflet", map, marker };
      engine.current = localEngine;
      setRenderer("leaflet");
      setZoom(15);
      setDimensional(false);
      if (selectedPointRef.current) focusPoint(selectedPointRef.current);
      const tiles = L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          minZoom: 2,
          detectRetina: false,
          keepBuffer: 1,
          updateWhenIdle: true,
          attribution: "&copy; OpenStreetMap contributors",
        },
      );
      let successfulTiles = 0;
      tiles.on("tileload", () => {
        successfulTiles++;
        ready();
      });
      tiles.on("tileerror", () => {
        if (disposed) return;
        if (successfulTiles)
          setNotice("Some map tiles could not load. You can retry the map.");
      });
      tiles.addTo(map);
      map.on("moveend", reportCamera);
      const observer = new ResizeObserver(() => {
        if (!disposed) map.invalidateSize({ animate: false });
      });
      observer.observe(host);
      cleanups.push(() => observer.disconnect());
    };
    const loadGL = async () => {
      const gl = await import("maplibre-gl");
      await import("maplibre-gl/dist/maplibre-gl.css");
      if (disposed) return;
      const worker = await import(
        "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"
      );
      gl.setWorkerUrl(worker.default);
      const response = await fetch(STYLE_URL, { signal: abort.signal });
      if (!response.ok)
        throw new Error("The vector style could not be loaded.");
      const startedNight = atmosphereRef.current;
      const style = tableStyle(
        (await response.json()) as StyleSpecification,
        startedNight,
      );
      if (disposed) return;
      const target = latestLocation.current;
      const map = new gl.Map({
        container: host,
        style,
        center: [target.longitude, target.latitude],
        zoom: overviewZoom(host.clientWidth),
        pitch: motionOff ? 0 : 45,
        bearing: motionOff ? 0 : -17,
        maxPitch: 65,
        minZoom: 2,
        maxZoom: 19,
        attributionControl: false,
        keyboard: true,
        dragRotate: !motionOff,
        touchZoomRotate: true,
        canvasContextAttributes: { antialias: false },
        maxTileCacheSize: 70,
        fadeDuration: motionOff ? 0 : 250,
      });
      const markerElement = document.createElement("div");
      markerElement.className = "geo-selected-marker";
      markerElement.innerHTML = MARKER_HTML;
      markerElement.title = "Selected area";
      markerElement.setAttribute("role", "img");
      markerElement.setAttribute("aria-label", "Selected area");
      const marker = new gl.Marker({ element: markerElement, anchor: "center" })
        .setLngLat([target.longitude, target.latitude])
        .addTo(map);
      localEngine = { kind: "maplibre", map, marker };
      engine.current = localEngine;
      const collectPoints = () => {
        if (disposed || !loaded || map.isMoving()) return;
        const poiLayers = map
          .getStyle()
          .layers.filter(
            (layer) =>
              (layer.type === "symbol" || layer.id === "poi_common_table") &&
              layer.id.startsWith("poi_") &&
              layer.id !== "poi_transit",
          )
          .map((layer) => layer.id);
        if (!poiLayers.length) {
          pointMarkers.current.forEach(({ marker }) => marker.remove());
          pointMarkers.current.clear();
          publishPoints([]);
          return;
        }
        const center = map.getCenter();
        const width = host.clientWidth,
          height = host.clientHeight;
        const mobile = width < 650;
        const inFrame = (screen: { x: number; y: number }) => {
          const side = mobile ? 35 : 95;
          const top = mobile ? 138 : 160;
          const bottom = mobile && selectedPointRef.current ? 165 : 95;
          return (
            screen.x >= side &&
            screen.x <= width - side &&
            screen.y >= top &&
            screen.y <= height - bottom &&
            !(
              screen.y < (mobile ? 320 : 340) &&
              screen.x > width - (mobile ? 98 : 160)
            )
          );
        };
        const unique = new Map<string, MapPoint>();
        const geographicKeys = new Set<string>();
        for (const feature of map.queryRenderedFeatures({
          layers: poiLayers,
        })) {
          const point = pointFromFeature(feature);
          if (
            !point ||
            (lensRef.current !== "all" && point.category !== lensRef.current)
          )
            continue;
          const screen = map.project([point.longitude, point.latitude]);
          if (!inFrame(screen)) continue;
          const key = `${point.name.toLocaleLowerCase()}:${point.longitude.toFixed(4)}:${point.latitude.toFixed(4)}`;
          if (!unique.has(point.id) && !geographicKeys.has(key)) {
            unique.set(point.id, point);
            geographicKeys.add(key);
          }
        }
        const preferred = selectedPointRef.current;
        if (
          preferred &&
          (lensRef.current === "all" || preferred.category === lensRef.current)
        ) {
          const screen = map.project([preferred.longitude, preferred.latitude]);
          if (inFrame(screen)) {
            unique.set(preferred.id, preferred);
          }
        }
        const categoryOrder = { food: 0, coffee: 1, outdoors: 2, other: 3 };
        const ordered = [...unique.values()].sort((a, b) => {
          if (a.id === preferred?.id) return -1;
          if (b.id === preferred?.id) return 1;
          const category =
            categoryOrder[a.category] - categoryOrder[b.category];
          const distance =
            (a.latitude - center.lat) ** 2 +
            (a.longitude - center.lng) ** 2 -
            ((b.latitude - center.lat) ** 2 + (b.longitude - center.lng) ** 2);
          return (
            category ||
            distance ||
            a.name.localeCompare(b.name) ||
            a.id.localeCompare(b.id)
          );
        });
        const visible: MapPoint[] = [];
        const positions: { x: number; y: number }[] = [];
        for (const point of ordered) {
          const screen = map.project([point.longitude, point.latitude]);
          if (
            positions.some(
              (position) =>
                Math.abs(position.x - screen.x) < (mobile ? 70 : 190) &&
                Math.abs(position.y - screen.y) < (mobile ? 68 : 85),
            )
          )
            continue;
          visible.push(point);
          positions.push(screen);
          if (visible.length === (mobile ? 4 : 12)) break;
        }
        const ids = new Set(visible.map((point) => point.id));
        for (const [id, entry] of pointMarkers.current) {
          if (!ids.has(id)) {
            if (document.activeElement === entry.element)
              map.getCanvas().focus({ preventScroll: true });
            entry.marker.remove();
            pointMarkers.current.delete(id);
          }
        }
        for (const point of visible) {
          let entry = pointMarkers.current.get(point.id);
          if (!entry) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `geo-poi-marker geo-poi-${point.category}`;
            button.dataset.pointId = point.id;
            button.setAttribute("aria-label", `Explore ${point.name}`);
            const object = document.createElement("span");
            object.className = "geo-place-object";
            const icon = document.createElement("span");
            icon.className = "geo-place-icon";
            icon.innerHTML = POINT_ICONS[point.category];
            const name = document.createElement("span");
            name.className = "geo-place-name";
            name.textContent = point.name;
            object.append(icon, name);
            button.append(object);
            button.addEventListener("click", (event) => {
              event.stopPropagation();
              focusPoint(point);
              onPointSelectRef.current?.(point);
            });
            const pointMarker = new gl.Marker({
              element: button,
              anchor: "bottom",
              pitchAlignment: "viewport",
              rotationAlignment: "viewport",
            })
              .setLngLat([point.longitude, point.latitude])
              .addTo(map);
            entry = { marker: pointMarker, element: button, point };
            pointMarkers.current.set(point.id, entry);
          }
          const screen = map.project([point.longitude, point.latitude]);
          entry.element.classList.toggle("geo-poi-edge-left", screen.x < 90);
          entry.element.classList.toggle(
            "geo-poi-edge-right",
            screen.x > width - 90,
          );
          entry.element.setAttribute(
            "aria-pressed",
            String(point.id === selectedPointRef.current?.id),
          );
          entry.element.classList.toggle(
            "geo-poi-selected",
            point.id === selectedPointRef.current?.id,
          );
        }
        publishPoints(visible);
      };
      let collectionFrame: number | null = null;
      const scheduleCollection = () => {
        if (disposed || collectionFrame !== null) return;
        collectionFrame = requestAnimationFrame(() => {
          collectionFrame = null;
          collectPoints();
        });
      };
      refreshPoints.current = scheduleCollection;
      map.on("idle", collectPoints);
      map.on("moveend", scheduleCollection);
      map.on("sourcedata", scheduleCollection);
      map.on("resize", scheduleCollection);
      cleanups.push(() => {
        if (collectionFrame !== null) cancelAnimationFrame(collectionFrame);
      });
      setRenderer("maplibre");
      setDimensional(!motionOff);
      setZoom(overviewZoom(host.clientWidth));
      const canvas = map.getCanvas();
      canvas.setAttribute(
        "aria-label",
        `Map of ${target.label}. Arrow keys pan; plus and minus zoom. Shift and arrows rotate.`,
      );
      const loseContext = (event: Event) => {
        event.preventDefault();
        if (!disposed) {
          setNotice(
            "3D graphics became unavailable. Switching to the standard 2D map.",
          );
          setPreferRaster(true);
        }
      };
      canvas.addEventListener("webglcontextlost", loseContext);
      cleanups.push(() =>
        canvas.removeEventListener("webglcontextlost", loseContext),
      );
      const interruptLook = (event: Event) => {
        if (
          event.type === "keydown" &&
          (event as KeyboardEvent).key === "Escape"
        )
          return;
        cancelLookAround();
      };
      for (const event of ["pointerdown", "wheel", "keydown"])
        canvas.addEventListener(event, interruptLook);
      cleanups.push(() => {
        for (const event of ["pointerdown", "wheel", "keydown"])
          canvas.removeEventListener(event, interruptLook);
      });
      let initialDataError = false;
      map.on("load", () => {
        if (disposed) return;
        if (initialDataError && map.queryRenderedFeatures().length === 0) {
          fail(
            "Map data could not be loaded. Retry the map or try the standard 2D map.",
          );
          return;
        }
        if (initialDataError)
          setNotice("Some map details could not load. You can retry the map.");
        if (atmosphereRef.current !== startedNight)
          map.setStyle(
            tableStyle(structuredClone(map.getStyle()), atmosphereRef.current),
            { diff: true },
          );
        ready();
        if (selectedPointRef.current) focusPoint(selectedPointRef.current);
        else scheduleCollection();
      });
      map.on("moveend", reportCamera);
      map.on("pitchend", () => {
        if (!disposed) setDimensional(map.getPitch() > 5);
      });
      map.on("error", () => {
        if (disposed) return;
        initialDataError = true;
        if (loaded)
          setNotice("Some map details could not load. You can retry the map.");
      });
      let wasMobile = host.clientWidth < 650;
      const observer = new ResizeObserver(() => {
        if (disposed) return;
        map.resize();
        const mobile = host.clientWidth < 650;
        if (mobile !== wasMobile && !selectedPointRef.current)
          map.jumpTo({ zoom: overviewZoom(host.clientWidth) });
        wasMobile = mobile;
        scheduleCollection();
      });
      observer.observe(host);
      cleanups.push(() => observer.disconnect());
    };
    watchdog = setTimeout(() => {
      if (disposed || loaded) return;
      abort.abort();
      fail(
        "The map is taking too long to load. Check your connection and retry, or try the standard 2D map.",
      );
    }, 18000);
    if (!validLocation(location)) {
      clearTimeout(watchdog);
      setRenderer("error");
      fail(
        "This location cannot be displayed. Choose a place with valid latitude and longitude.",
      );
    } else {
      const task =
        motionOff || preferRaster || !webGLAvailable()
          ? loadRaster(
              motionOff
                ? "Standard 2D map for reduced motion or low-power viewing."
                : preferRaster
                  ? "Standard 2D map selected."
                  : "3D graphics are unavailable on this device. Showing the standard OpenStreetMap map.",
            )
          : loadGL().catch(async (error) => {
              if (disposed || abort.signal.aborted) return;
              if (localEngine) {
                localEngine.map.remove();
                localEngine = null;
                engine.current = null;
              }
              await loadRaster(
                "The 3D map could not start. Showing the standard OpenStreetMap map.",
              );
            });
      task.catch(() => {
        if (!disposed) {
          clearTimeout(watchdog);
          setRenderer("error");
          fail(
            "The map could not start. Retry when your connection is available.",
          );
        }
      });
    }
    return () => {
      disposed = true;
      cancelLookAround(false);
      abort.abort();
      clearTimeout(watchdog);
      cleanups.forEach((cleanup) => cleanup());
      pointMarkers.current.forEach(({ marker }) => marker.remove());
      pointMarkers.current.clear();
      rememberedMarker.current?.remove();
      rememberedMarker.current = null;
      refreshPoints.current = () => {};
      localEngine?.map.remove();
      if (engine.current === localEngine) engine.current = null;
      host.replaceChildren();
    };
    // Rebuild only when the renderer changes, never when the user pans or updates atmosphere.
  }, [motionOff, preferRaster, retry, coordinateValid]);

  useEffect(() => {
    cancelLookAround();
    publishPoints([]);
    pointMarkers.current.forEach(({ marker }) => marker.remove());
    pointMarkers.current.clear();
    const active = engine.current;
    if (!active || !validLocation(location)) return;
    if (active.kind === "maplibre") {
      active.marker.setLngLat([location.longitude, location.latitude]);
      active.map.stop();
      active.map.flyTo({
        center: [location.longitude, location.latitude],
        zoom: overviewZoom(container.current?.clientWidth ?? 900),
        duration: motionOff ? 0 : 1100,
        essential: false,
      });
      active.map
        .getCanvas()
        .setAttribute(
          "aria-label",
          `Map of ${location.label}. Arrow keys pan; plus and minus zoom.`,
        );
    } else {
      active.marker.setLatLng([location.latitude, location.longitude]);
      active.map.stop();
      active.map.setView([location.latitude, location.longitude], 15, {
        animate: false,
      });
      container.current?.setAttribute(
        "aria-label",
        `Map of ${location.label}. Arrow keys pan; plus and minus zoom.`,
      );
    }
  }, [location.latitude, location.longitude, location.label, motionOff]);

  useEffect(() => {
    const active = engine.current;
    if (active?.kind !== "maplibre") return;
    const apply = () => {
      const current = active.map.getStyle();
      const updated = tableStyle(structuredClone(current), night);
      updated.transition = { duration: motionOff ? 0 : 450 };
      active.map.setStyle(updated, { diff: true });
    };
    if (active.map.isStyleLoaded()) apply();
  }, [night, renderer, motionOff]);

  useEffect(() => {
    refreshPoints.current();
  }, [lens]);

  useEffect(() => {
    for (const [id, entry] of pointMarkers.current) {
      entry.element.setAttribute(
        "aria-pressed",
        String(id === selectedPoint?.id),
      );
      entry.element.classList.toggle(
        "geo-poi-selected",
        id === selectedPoint?.id,
      );
    }
    if (selectedPoint) focusPoint(selectedPoint);
    else {
      rememberedMarker.current?.remove();
      rememberedMarker.current = null;
      refreshPoints.current();
    }
  }, [selectedPoint]);

  const changeZoom = (delta: number) => {
    cancelLookAround();
    const active = engine.current;
    if (!active) return;
    if (active.kind === "maplibre")
      active.map.zoomTo(
        Math.max(2, Math.min(19, active.map.getZoom() + delta)),
        { duration: motionOff ? 0 : 250 },
      );
    else
      active.map.setZoom(
        Math.max(2, Math.min(19, active.map.getZoom() + delta)),
        { animate: false },
      );
  };
  const recenter = () => {
    cancelLookAround();
    const active = engine.current;
    if (!active || !validLocation(location)) return;
    if (active.kind === "maplibre")
      active.map.flyTo({
        center: [location.longitude, location.latitude],
        zoom: overviewZoom(container.current?.clientWidth ?? 900),
        bearing: dimensional ? -17 : 0,
        pitch: dimensional ? 45 : 0,
        duration: motionOff ? 0 : 800,
      });
    else
      active.map.setView([location.latitude, location.longitude], 15, {
        animate: false,
      });
  };
  const toggleDimension = () => {
    cancelLookAround();
    const active = engine.current;
    if (active?.kind !== "maplibre" || motionOff) return;
    active.map.easeTo({
      pitch: dimensional ? 0 : 45,
      bearing: dimensional ? 0 : -17,
      duration: 650,
    });
    setDimensional((v) => !v);
  };
  const retryMap = () => {
    cancelLookAround();
    setRetry((v) => v + 1);
  };
  return (
    <section
      className={`geographic-map${night ? " geographic-map-night" : ""}${motionOff ? " geographic-map-still" : ""}`}
      aria-label={`Real geographic map of ${location.label}`}
      data-renderer={renderer}
      data-map-status={status}
      data-latitude={location.latitude}
      data-longitude={location.longitude}
      data-atmosphere={atmosphere}
      data-lens={lens}
      data-poi-count={pointCount}
      data-camera-look={lookingAround ? "active" : "idle"}
      onKeyDown={(event) => {
        if (event.key === "Escape" && cameraLook.current.active) {
          event.preventDefault();
          cancelLookAround();
        }
      }}
    >
      <div ref={container} className="geographic-map-canvas" />
      <div className="geo-map-material" aria-hidden="true" />
      {showAreaLabel && (
        <div className="geo-area-label">
          <span>
            <MapPin size={12} /> SELECTED AREA
          </span>
          <h2>{location.label}</h2>
          <p>
            {renderer === "leaflet"
              ? "OpenStreetMap · standard 2D"
              : "OpenStreetMap · real streets & buildings"}
          </p>
        </div>
      )}
      {status !== "error" && (
        <div className="geo-map-controls" aria-label="Geographic map controls">
          <button
            type="button"
            className="geo-look-around"
            aria-pressed={lookingAround}
            aria-label={
              lookingAround ? "Stop look-around" : "Look around this area"
            }
            onClick={lookAround}
            disabled={
              renderer !== "maplibre" || motionOff || status !== "ready"
            }
          >
            <Orbit size={17} />
            <span>{lookingAround ? "Stop" : "Look"}</span>
          </button>
          <button
            type="button"
            onClick={toggleDimension}
            disabled={
              renderer !== "maplibre" || motionOff || status !== "ready"
            }
            aria-label={
              dimensional ? "3D · Switch to 2D map" : "2D · Switch to 3D map"
            }
            aria-pressed={dimensional}
          >
            <Layers size={16} />
            <span>{dimensional ? "3D" : "2D"}</span>
          </button>
          <button
            type="button"
            onClick={recenter}
            aria-label="Recenter selected area"
            disabled={status !== "ready"}
          >
            <LocateFixed size={18} />
          </button>
          <button
            type="button"
            aria-label="Reset north orientation"
            onClick={() => {
              cancelLookAround();
              const active = engine.current;
              if (active?.kind === "maplibre")
                active.map.easeTo({
                  bearing: 0,
                  duration: motionOff ? 0 : 400,
                });
            }}
            disabled={renderer !== "maplibre" || status !== "ready"}
          >
            <Compass size={19} />
          </button>
          <div className="geo-zoom-controls">
            <button
              type="button"
              onClick={() => changeZoom(1)}
              aria-label="Zoom in"
              disabled={status !== "ready" || zoom >= 19}
            >
              <Plus size={20} />
            </button>
            <button
              type="button"
              onClick={() => changeZoom(-1)}
              aria-label="Zoom out"
              disabled={status !== "ready" || zoom <= 2}
            >
              <Minus size={20} />
            </button>
          </div>
        </div>
      )}
      {status === "loading" && (
        <div className="geo-map-loading" role="status">
          <LoaderCircle size={20} />
          <span>Unfolding your neighborhood…</span>
          <button
            type="button"
            onClick={() => {
              setPreferRaster(true);
              retryMap();
            }}
          >
            Try standard 2D map
          </button>
        </div>
      )}
      {status === "error" && (
        <div className="geo-map-error" role="alert">
          <TriangleAlert size={25} strokeWidth={1.3} />
          <h3>The map needs a moment.</h3>
          <p>{message}</p>
          <div>
            <button type="button" onClick={retryMap}>
              <RefreshCw size={14} /> Retry map
            </button>
            {!preferRaster && (
              <button
                type="button"
                onClick={() => {
                  setPreferRaster(true);
                  retryMap();
                }}
              >
                Try standard 2D map
              </button>
            )}
          </div>
        </div>
      )}
      {notice && status === "ready" && (
        <div className="geo-renderer-notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={retryMap}>
            Retry map
          </button>
        </div>
      )}
      <footer className="geo-map-footer">
        <span>Real geography · mapped places · no live tracking</span>
        <span className="geo-provider-attribution">
          {renderer !== "leaflet" && (
            <>
              <a
                href="https://openfreemap.org/"
                target="_blank"
                rel="noreferrer"
              >
                OpenFreeMap
              </a>{" "}
              · ©{" "}
              <a
                href="https://openmaptiles.org/"
                target="_blank"
                rel="noreferrer"
              >
                OpenMapTiles
              </a>{" "}
              ·{" "}
            </>
          )}
          ©{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            OpenStreetMap contributors
          </a>
        </span>
      </footer>
    </section>
  );
}
export { GeographicMap };
