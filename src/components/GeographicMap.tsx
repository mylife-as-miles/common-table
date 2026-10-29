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
} from "lucide-react";
import type {
  Map as GLMap,
  Marker as GLMarker,
  StyleSpecification,
} from "maplibre-gl";
import type { Map as RasterMap, Marker as RasterMarker } from "leaflet";
import "./geographic-map.css";

export interface GeographicMapProps {
  location: { latitude: number; longitude: number; label: string };
  lowPower: boolean;
  weather: { condition: string; isDay: boolean } | null;
  showAreaLabel?: boolean;
  onCameraChange?: (coords: { latitude: number; longitude: number }) => void;
}

type Engine =
  | { kind: "maplibre"; map: GLMap; marker: GLMarker }
  | { kind: "leaflet"; map: RasterMap; marker: RasterMarker };
type Status = "loading" | "ready" | "error";
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const AREA_ZOOM = 14.8;
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

export default function GeographicMap({
  location,
  lowPower,
  weather,
  onCameraChange,
  showAreaLabel = true,
}: GeographicMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
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
  const night = weather?.isDay === false;
  const coordinateValid = validLocation(location);
  const weatherRef = useRef(night);
  weatherRef.current = night;

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
    setStatus("loading");
    setRenderer("loading");
    setMessage("");
    setNotice("");
    const fail = (text: string) => {
      if (!disposed) {
        clearTimeout(watchdog);
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
      setNotice(reason);
      const [L] = await Promise.all([
        import("leaflet"),
        import("leaflet/dist/leaflet.css"),
      ]);
      if (disposed) return;
      host.replaceChildren();
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
      const startedNight = weatherRef.current;
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
        zoom: AREA_ZOOM,
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
      setRenderer("maplibre");
      setDimensional(!motionOff);
      setZoom(AREA_ZOOM);
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
        if (weatherRef.current !== startedNight)
          map.setStyle(
            tableStyle(structuredClone(map.getStyle()), weatherRef.current),
            { diff: true },
          );
        ready();
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
      const observer = new ResizeObserver(() => {
        if (!disposed) map.resize();
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
      abort.abort();
      clearTimeout(watchdog);
      cleanups.forEach((cleanup) => cleanup());
      localEngine?.map.remove();
      if (engine.current === localEngine) engine.current = null;
      host.replaceChildren();
    };
    // Rebuild only when the renderer changes, never when the user pans or updates weather.
  }, [motionOff, preferRaster, retry, coordinateValid]);

  useEffect(() => {
    const active = engine.current;
    if (!active || !validLocation(location)) return;
    if (active.kind === "maplibre") {
      active.marker.setLngLat([location.longitude, location.latitude]);
      active.map.stop();
      active.map.flyTo({
        center: [location.longitude, location.latitude],
        zoom: AREA_ZOOM,
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

  const changeZoom = (delta: number) => {
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
    const active = engine.current;
    if (!active || !validLocation(location)) return;
    if (active.kind === "maplibre")
      active.map.flyTo({
        center: [location.longitude, location.latitude],
        zoom: AREA_ZOOM,
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
    const active = engine.current;
    if (active?.kind !== "maplibre" || motionOff) return;
    active.map.easeTo({
      pitch: dimensional ? 0 : 45,
      bearing: dimensional ? 0 : -17,
      duration: 650,
    });
    setDimensional((v) => !v);
  };
  const retryMap = () => setRetry((v) => v + 1);
  return (
    <section
      className={`geographic-map${night ? " geographic-map-night" : ""}${motionOff ? " geographic-map-still" : ""}`}
      aria-label={`Real geographic map of ${location.label}`}
      data-renderer={renderer}
      data-map-status={status}
      data-latitude={location.latitude}
      data-longitude={location.longitude}
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
        <span>Real geography · area marker only · no live tracking</span>
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
