import { useEffect, useRef, useState } from "react";
import { get, put, deleteValue } from "../storage";
import { parseWeatherReport, weatherCacheKey, weatherQuery } from "./client";
import type { WeatherReport } from "./types";

export interface WeatherOptions {
  latitude: number;
  longitude: number;
  date: string;
  time: string;
  /** Device location stays in session memory until the user explicitly saves it. */
  persistCache?: boolean;
  active?: boolean;
}
interface WeatherState {
  status: "loading" | "ready" | "stale" | "error" | "cancelled";
  data: WeatherReport | null;
  message: string;
  checking: boolean;
}
const initial: WeatherState = { status: "loading", data: null, message: "Checking the weather for your evening…", checking: true };

export function useWeather({ latitude, longitude, date, time, persistCache = true, active = true }: WeatherOptions) {
  const [state, setState] = useState<WeatherState>(initial);
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0), request = useRef<AbortController | null>(null);
  const query = weatherQuery(latitude, longitude, date, time);
  const key = query ? weatherCacheKey(query) : "invalid";
  const force = useRef(false);

  useEffect(() => {
    const run = ++sequence.current;
    request.current?.abort();
    if (!active) { setState({ status: "cancelled", data: null, message: "Weather check paused.", checking: false }); return; }
    if (!query) { setState({ status: "error", data: null, message: "Choose an area and a valid dinner date and time to check the weather.", checking: false }); return; }
    const controller = new AbortController(); request.current = controller;
    const storageOptions = { persist: persistCache };
    const refresh = force.current; force.current = false;
    let cached: WeatherReport | null = null;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setState(initial);
    const current = () => run === sequence.current && !controller.signal.aborted;
    void (async () => {
      try {
        const saved = await get<WeatherReport>("cache", key, storageOptions).catch(() => undefined);
        if (!current()) return;
        cached = parseWeatherReport(saved, query);
        if (saved && !cached) await deleteValue("cache", key, storageOptions).catch(() => undefined);
        if (!current()) return;
        if (cached) {
          const fresh = !cached.stale && Date.parse(cached.freshUntil) > Date.now();
          setState({ status: fresh ? "ready" : "stale", data: cached, message: fresh ? "Saved weather, recently checked." : "Showing saved weather while checking for an update.", checking: !fresh || refresh });
          if (fresh && !refresh) return;
        }
        timer = setTimeout(() => { timedOut = true; controller.abort(); }, 12_000);
        const params = new URLSearchParams({ latitude: String(query.latitude), longitude: String(query.longitude), date: query.date, hour: String(query.hour) });
        const response = await fetch(`/api/weather?${params}`, { signal: controller.signal, headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(response.status === 429 ? "busy" : "unavailable");
        const text = await response.text();
        if (text.length > 32_768) throw new Error("unavailable");
        const report = parseWeatherReport(JSON.parse(text), query);
        if (!report) throw new Error("unavailable");
        if (!current()) return;
        cached = report;
        setState({ status: report.stale ? "stale" : "ready", data: report, message: report.stale ? "Showing saved weather. A fresh check is unavailable." : "Weather checked for your chosen area.", checking: false });
        await put("cache", key, report, storageOptions).catch(() => undefined);
      } catch (error) {
        if (run !== sequence.current) return;
        if (controller.signal.aborted && !timedOut) return;
        const valid = cached && parseWeatherReport(cached, query);
        setState({ status: valid ? "stale" : "error", data: valid || null, checking: false, message: valid ? "Showing saved weather. A fresh check is unavailable." : timedOut ? "The weather check timed out. Try again when you’re ready." : error instanceof Error && error.message === "busy" ? "Weather is busy. Try again in a moment." : "Weather is unavailable right now. Try again later." });
      } finally {
        if (timer) clearTimeout(timer);
        if (run === sequence.current) request.current = null;
      }
    })();
    return () => { if (sequence.current === run) sequence.current++; controller.abort(); if (timer) clearTimeout(timer); };
    // The validated coarse cache key contains every query field used by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, persistCache, active, revision]);

  useEffect(() => {
    const report = state.data;
    if (!report) return;
    const expiry = Date.parse(report.staleUntil);
    const fresh = Date.parse(report.freshUntil);
    const timestamp = Date.now();
    const next = state.status === "ready" && fresh > timestamp ? Math.min(fresh, expiry) : expiry;
    const timer = setTimeout(() => {
      if (expiry <= Date.now()) setState({ status: "error", data: null, checking: false, message: "The saved weather has expired. Check again for an update." });
      else setState(previous => ({ ...previous, status: "stale", message: "Weather was checked earlier. Check again before you head out." }));
    }, Math.max(0, next - timestamp));
    return () => clearTimeout(timer);
  }, [state.data, state.status]);

  const cancel = () => {
    sequence.current++; request.current?.abort(); request.current = null;
    setState(previous => ({ ...previous, status: "cancelled", message: "Weather check cancelled.", checking: false }));
  };
  const refresh = () => { force.current = true; setRevision(value => value + 1); };
  const matching = state.data && query ? parseWeatherReport(state.data, query) : null;
  const visible = state.data && !matching ? initial : { ...state, data: matching };
  return { ...visible, cancel, refresh };
}
