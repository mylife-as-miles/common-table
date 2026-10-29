import { useEffect, useRef, useState } from "react";

export interface MapLocation {
  latitude: number;
  longitude: number;
  label: string;
  source: "starting" | "search" | "device";
}
export interface WeatherData {
  source: "openweather";
  status: "ready";
  latitude: number;
  longitude: number;
  placeName: string;
  temperatureC: number;
  feelsLikeC: number;
  description: string;
  condition: "clear" | "clouds" | "rain" | "snow" | "storm" | "fog";
  isDay: boolean;
  observedAt: string;
  windMps: number;
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
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<
    "loading" | "ready" | "unavailable" | "not_configured"
  >("loading");
  const [refresh, setRefresh] = useState(0);
  const searchRequest = useRef<AbortController | null>(null);
  const searchSequence = useRef(0);
  const geoSequence = useRef(0);
  const cache = useRef(
    new Map<string, { data: WeatherData; fetched: number }>(),
  );

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
    setLocation({ ...place, source: "search" });
  }
  function useDeviceLocation() {
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
  useEffect(() => {
    if (!active) return;
    const latitude = Number(location.latitude.toFixed(3)),
      longitude = Number(location.longitude.toFixed(3));
    const key = `${latitude},${longitude}`;
    const cached = cache.current.get(key);
    if (cached && Date.now() - cached.fetched < 600000 && refresh === 0) {
      setWeather(cached.data);
      setWeatherStatus("ready");
      return;
    }
    const controller = new AbortController();
    let current = true;
    const timer = setTimeout(() => controller.abort(), 12000);
    setWeather(null);
    setWeatherStatus("loading");
    fetch(`/api/weather?lat=${latitude}&lon=${longitude}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!current) return;
        if (!response.ok) {
          setWeatherStatus(
            body.code === "not_configured" ? "not_configured" : "unavailable",
          );
          return;
        }
        if (
          body.source !== "openweather" ||
          body.status !== "ready" ||
          !validCoordinate(body.latitude, body.longitude) ||
          Math.abs(body.latitude - latitude) > 0.02 ||
          Math.abs(body.longitude - longitude) > 0.02 ||
          !Number.isFinite(body.temperatureC) ||
          !Number.isFinite(body.feelsLikeC) ||
          !Number.isFinite(body.windMps) ||
          typeof body.description !== "string" ||
          !["clear", "clouds", "rain", "snow", "storm", "fog"].includes(
            body.condition,
          ) ||
          typeof body.isDay !== "boolean" ||
          !Number.isFinite(Date.parse(body.observedAt))
        )
          throw new Error("invalid_weather");
        cache.current.set(key, { data: body, fetched: Date.now() });
        setWeather(body);
        setWeatherStatus("ready");
      })
      .catch(() => {
        if (current) setWeatherStatus("unavailable");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      current = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, location.latitude, location.longitude, refresh]);
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
    query,
    results,
    searching,
    searchMessage,
    locating,
    locationMessage,
    weather,
    weatherStatus,
    changeQuery,
    searchPlaces,
    selectPlace,
    cancelSearch,
    useDeviceLocation,
    cancelLocation,
    refreshWeather: () => setRefresh((x) => x + 1),
  };
}
export type LocationContext = ReturnType<typeof useLocationContext>;
