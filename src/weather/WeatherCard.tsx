import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudOff, CloudRain, CloudSnow, CloudSun, Droplets, Moon, RefreshCw, Sun, Wind, X } from "lucide-react";
import { weatherDescription } from "./client";
import { useWeather } from "./useWeather";
import type { WeatherOptions } from "./useWeather";
import type { WeatherConditions } from "./types";
import "./weather.css";

export interface WeatherCardProps extends WeatherOptions { locationLabel: string; compact?: boolean }
function ConditionIcon({ value, size = 32 }: { value: WeatherConditions; size?: number }) {
  const code = value.weatherCode;
  const Icon = code === 0 || code === 1 ? value.isDay === null ? CloudSun : value.isDay ? Sun : Moon : code === 2 ? CloudSun : code === 3 ? Cloud : [45, 48].includes(code) ? CloudFog : [51, 53, 55].includes(code) ? CloudDrizzle : [71, 73, 75, 77, 85, 86].includes(code) ? CloudSnow : code >= 95 ? CloudLightning : CloudRain;
  return <Icon size={size} strokeWidth={1.2} aria-hidden="true" />;
}
function dinnerDate(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(parsed) : "Your dinner";
}

export function WeatherCard(props: WeatherCardProps) {
  const weather = useWeather(props);
  const report = weather.data;
  const dinner = report?.dinner;
  const hour = `${props.time.slice(0, 2)}:00`;
  const checked = report ? new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: report.timezone }).format(new Date(report.fetchedAt)) : "";
  return (
    <section className={`weather-paper${props.compact ? " weather-paper-compact" : ""}`} aria-label="Weather for your evening" data-weather-state={weather.status} aria-busy={weather.checking}>
      <div className="weather-paper-pinhole" aria-hidden="true" />
      <header className="weather-paper-heading">
        <div><span className="weather-kicker">A NOTE FOR THE EVENING</span><h2>Before you head out.</h2><p>{props.locationLabel}</p></div>
        <div className="weather-stamp" aria-hidden="true">AIR &amp;<br />ATMOSPHERE<CloudSun size={21} strokeWidth={1} /></div>
      </header>
      {report ? <>
        <div className="weather-dinner-label"><span>AT DINNER</span><span>{dinnerDate(props.date)} · around {hour}</span></div>
        {dinner ? <div className="weather-dinner">
          <div className="weather-temperature"><ConditionIcon value={dinner} size={41} /><strong>{Math.round(dinner.temperatureC)}<small>°C</small></strong></div>
          <div className="weather-condition"><h3>{weatherDescription(dinner.weatherCode, dinner.isDay)}</h3>{dinner.feelsLikeC !== null && <p>Feels like {Math.round(dinner.feelsLikeC)}°C</p>}</div>
          <div className="weather-details">{(dinner.precipitationProbability !== null || dinner.precipitationMm !== null) && <span><Droplets size={14} />{dinner.precipitationProbability === null ? `${dinner.precipitationMm} mm precipitation` : `${Math.round(dinner.precipitationProbability)}% chance of precipitation`}</span>}<span><Wind size={15} />Wind {Math.round(dinner.windKmh)} km/h</span></div>
        </div> : <div className="weather-no-forecast"><CloudOff size={27} strokeWidth={1.2} /><div><h3>{report.dinnerStatus === "past" ? "That dinner time has passed." : report.dinnerStatus === "outside_forecast" ? "A little too far ahead to forecast." : "No forecast for that hour yet."}</h3><p>{report.dinnerStatus === "past" ? "Choose a future dinner time to see its forecast." : "Check again closer to your evening. Current conditions are below."}</p></div></div>}
        <div className="weather-current"><span><ConditionIcon value={report.current} size={21} /><b>Right now</b></span><span>{Math.round(report.current.temperatureC)}°C · {weatherDescription(report.current.weatherCode, report.current.isDay)}</span></div>
        <p className="weather-timezone">Times are local to {report.timezone.replaceAll("_", " ").split("/").slice(-1)[0]}. Conditions can change.</p>
      </> : <div className="weather-empty"><CloudSun size={36} strokeWidth={1.1} /><p>{weather.checking ? "Looking ahead to your evening…" : "The evening is still yours to plan."}</p></div>}
      <p className={`weather-status${weather.status === "stale" ? " is-stale" : ""}`} role="status">{weather.message}{report && weather.status === "stale" ? ` Last checked at ${checked} local time.` : ""}</p>
      <footer className="weather-footer"><a href="/data-credits.html#weather" target="_blank" rel="noopener noreferrer">Data credits</a><span>{report && weather.status === "ready" ? `Checked ${checked}` : ""}</span>{weather.checking ? <button type="button" onClick={weather.cancel}><X size={13} />Cancel weather check</button> : <button type="button" onClick={weather.refresh}><RefreshCw size={12} />Check weather again</button>}</footer>
    </section>
  );
}

export default WeatherCard;
