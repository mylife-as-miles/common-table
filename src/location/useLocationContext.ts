import { useEffect, useRef, useState } from "react";
import type { MapPoint } from "../components/GeographicMap";
import { get, update, subscribe, LOCATION_RECORD_KEY, StorageCorruptionError, useSessionStorageOnly } from "../storage";
import { useDeviceStorageStatus } from "../storage/react";
import { applyLocationChange, cleanLocationSnapshot, emptyLocation, validMapPoint, type LocationChange, type LocationSnapshot } from "../storage/location";

export interface MapLocation {
  latitude: number;
  longitude: number;
  label: string;
  source: "starting" | "search" | "device" | "saved";
}
export interface PlaceResult {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
}
const start: MapLocation = {
  latitude: 40.692,
  longitude: -73.977,
  label: "Brooklyn, New York",
  source: "starting",
};
const validCoordinate = (lat: unknown, lon: unknown): boolean =>
  typeof lat === "number" &&
  Number.isFinite(lat) &&
  Math.abs(lat) <= 85 &&
  typeof lon === "number" &&
  Number.isFinite(lon) &&
  Math.abs(lon) <= 180;

export function useLocationContext(active: boolean) {
  const [location, setLocation] = useState<MapLocation>(start);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [selectedPoint, setSelectedPoint] = useState<MapPoint | null>(null);
  const [savedPoints, setSavedPoints] = useState<MapPoint[]>([]);
  const searchRequest = useRef<AbortController | null>(null);
  const searchSequence = useRef(0);
  const geoSequence = useRef(0);
  const snapshot = useRef<LocationSnapshot>(emptyLocation());
  const changes = useRef<LocationChange[]>([]);
  const locationTouched = useRef(false);
  const hydrated = useRef(false);
  const writing = useRef(false);
  const mounted = useRef(true);
  const inFlightChanges = useRef<LocationChange[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [storageSaving, setStorageSaving] = useState(false);
  const [persistTick, setPersistTick] = useState(0);
  const storage = useDeviceStorageStatus();
  function remember(change: LocationChange) {
    snapshot.current = applyLocationChange(snapshot.current, change);
    changes.current.push(change);
    setStorageSaving(true);
    setSavedPoints(snapshot.current.savedPoints);
    setPersistTick(value => value + 1);
  }
  useEffect(() => {
    let alive = true;
    mounted.current = true;
    void get<LocationSnapshot>("location", LOCATION_RECORD_KEY).then(saved => {
      if (!alive) return;
      if (saved && (saved.schema !== 1 || !Array.isArray(saved.savedPoints))) useSessionStorageOnly(new StorageCorruptionError());
      snapshot.current = changes.current.reduce(applyLocationChange, cleanLocationSnapshot(saved));
      if (!locationTouched.current && snapshot.current.area) {
        setLocation({ ...snapshot.current.area, source: "saved" });
        if (snapshot.current.area.source === "saved") setSelectedPoint(snapshot.current.savedPoints.find(point => point.name === snapshot.current.area?.label && point.latitude === snapshot.current.area.latitude && point.longitude === snapshot.current.area.longitude) ?? null);
      }
      setSavedPoints(snapshot.current.savedPoints);
      hydrated.current = true;
      setStorageReady(true);
      setPersistTick(value => value + 1);
    });
    const stop = subscribe("location", LOCATION_RECORD_KEY, event => {
      if (!alive || !event.external || !hydrated.current) return;
      snapshot.current = [...inFlightChanges.current, ...changes.current].reduce(applyLocationChange, cleanLocationSnapshot(event.record?.value));
      setSavedPoints(snapshot.current.savedPoints);
      if (!locationTouched.current && snapshot.current.area) setLocation({ ...snapshot.current.area, source: "saved" });
    });
    return () => { alive = false; mounted.current = false; stop(); };
  }, []);
  useEffect(() => {
    if (!hydrated.current || writing.current || !changes.current.length) return;
    writing.current = true;
    void (async () => {
      try {
        while (changes.current.length) {
          const batch = changes.current.splice(0);
          inFlightChanges.current = batch;
          try {
            const record = await update<LocationSnapshot>("location", LOCATION_RECORD_KEY, previous => batch.reduce(applyLocationChange, cleanLocationSnapshot(previous)));
            snapshot.current = changes.current.reduce(applyLocationChange, cleanLocationSnapshot(record?.value));
            if (mounted.current) setSavedPoints(snapshot.current.savedPoints);
          } catch (error) {
            useSessionStorageOnly(error);
            if (mounted.current) setLocationMessage("Your map changes are kept only for this session.");
          }
        }
      } finally {
        writing.current = false;
        inFlightChanges.current = [];
        if (mounted.current) setStorageSaving(false);
      }
    })();
  }, [persistTick, storageReady]);

  function cancelSearch(clearQuery = false) {
    searchSequence.current++;
    searchRequest.current?.abort();
    searchRequest.current = null;
    setSearching(false);
    setResults([]);
    setSearchMessage("");
    if (clearQuery) setQuery("");
  }
  function changeQuery(value: string) {
    cancelSearch();
    setQuery(value);
  }
  function cancelLocation(quiet = false) {
    geoSequence.current++;
    setLocating(false);
    if (!quiet)
      setLocationMessage(
        "Location request cancelled. Your chosen area is unchanged.",
      );
  }
  async function searchPlaces() {
    const clean = query.trim();
    cancelSearch();
    cancelLocation(true);
    setLocationMessage("");
    if (clean.length < 2) {
      setSearchMessage("Enter at least two characters to find a place.");
      return;
    }
    const sequence = searchSequence.current;
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true);
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(
        `/api/geocode?q=${encodeURIComponent(clean.slice(0, 100))}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error("search_unavailable");
      const body = await response.json();
      if (sequence !== searchSequence.current) return;
      const places = Array.isArray(body.results)
        ? body.results
            .filter(
              (p: PlaceResult) =>
                typeof p.id === "string" &&
                typeof p.label === "string" &&
                validCoordinate(p.latitude, p.longitude),
            )
            .slice(0, 5)
        : [];
      setResults(places);
      setSearchMessage(
        places.length
          ? `${places.length} places found. Choose an area below.`
          : "No places found. Try a city, neighborhood, or add a country.",
      );
    } catch {
      if (sequence === searchSequence.current)
        setSearchMessage(
          "Place search is unavailable right now. Try again, or use your device location.",
        );
    } finally {
      clearTimeout(timer);
      if (sequence === searchSequence.current) setSearching(false);
    }
  }
  function selectPlace(place: PlaceResult) {
    if (!validCoordinate(place.latitude, place.longitude)) return;
    cancelLocation(true);
    cancelSearch(true);
    setLocationMessage("");
    setSelectedPoint(null);
    locationTouched.current = true;
    setLocation({ ...place, source: "search" });
    remember({ kind: "area", area: { latitude: place.latitude, longitude: place.longitude, label: place.label, source: "search" } });
  }
  function useDeviceLocation() {
    locationTouched.current = true;
    cancelSearch();
    cancelLocation(true);
    setLocationMessage("");
    if (!window.isSecureContext) {
      setLocationMessage(
        "Device location needs HTTPS or localhost. You can still search for a city.",
      );
      return;
    }
    if (!navigator.geolocation) {
      setLocationMessage(
        "This browser does not offer device location. Search for a city instead.",
      );
      return;
    }
    const sequence = geoSequence.current;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (sequence !== geoSequence.current) return;
        setLocating(false);
        if (
          !validCoordinate(position.coords.latitude, position.coords.longitude)
        ) {
          setLocationMessage(
            "The device returned a location outside this map’s supported range. Please search for a city.",
          );
          return;
        }
        setSelectedPoint(null);
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          label: "Your chosen device area",
          source: "device",
        });
        setLocationMessage(
          "Map centered on your device area. Your location is not stored or shared with guests.",
        );
      },
      (error) => {
        if (sequence !== geoSequence.current) return;
        setLocating(false);
        setLocationMessage(
          error.code === 1
            ? "Location permission was denied. Your chosen area is unchanged; search for a city instead."
            : error.code === 3
              ? "The location request timed out. Try again or search for a city."
              : "Your device location could not be found. Search for a city instead.",
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }
  function selectMappedPoint(point: MapPoint) {
    if (!validMapPoint(point)) return;
    locationTouched.current = true;
    cancelLocation(true);
    cancelSearch();
    setLocationMessage("");
    setSelectedPoint({ ...point });
  }
  function revisitPoint(point: MapPoint) {
    if (!validMapPoint(point)) return;
    locationTouched.current = true;
    cancelSearch(true);
    cancelLocation(true);
    setLocationMessage("");
    setSelectedPoint({ ...point });
    setLocation({ ...point, label: point.name, source: "saved" });
    remember({ kind: "area", area: { latitude: point.latitude, longitude: point.longitude, label: point.name, source: "saved" } });
  }
  function toggleSavedPoint(point: MapPoint) {
    if (!validMapPoint(point)) return;
    remember({ kind: "point", point, saved: !snapshot.current.savedPoints.some(saved => saved.id === point.id) });
  }

  useEffect(() => {
    if (!active) {
      searchSequence.current++;
      searchRequest.current?.abort();
      geoSequence.current++;
      setSearching(false);
      setLocating(false);
    }
  }, [active]);
  useEffect(
    () => () => {
      searchRequest.current?.abort();
      geoSequence.current++;
      searchSequence.current++;
    },
    [],
  );
  return {
    location,
    storageReady,
    storageSaving,
    storageStatus: storage,
    storageAvailable: storageReady && storage.available,
    storageError: storage.error,
    query,
    results,
    searching,
    searchMessage,
    locating,
    locationMessage,
    selectedPoint,
    savedPoints,
    selectMappedPoint,
    revisitPoint,
    toggleSavedPoint,
    clearPoint: () => setSelectedPoint(null),
    changeQuery,
    searchPlaces,
    selectPlace,
    cancelSearch,
    useDeviceLocation,
    cancelLocation,
  };
}
export type LocationContext = ReturnType<typeof useLocationContext>;
