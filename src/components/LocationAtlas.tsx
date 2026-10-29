import { useRef } from "react";
import {
  ArrowUpRight,
  Cloud,
  CloudDrizzle,
  CloudLightning,
  CloudSnow,
  Compass,
  LocateFixed,
  MapPin,
  RefreshCw,
  Search,
  Sun,
  Wind,
  X,
} from "lucide-react";
import { GeographicMap } from "./GeographicMap";
import type { LocationContext } from "../location/useLocationContext";
import "./location-atlas.css";

interface Props {
  context: LocationContext;
  lowPower: boolean;
  onDemo: () => void;
  onWaiter: () => void;
}
export function LocationAtlas({
  context: c,
  lowPower,
  onDemo,
  onWaiter,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const WeatherIcon =
    c.weather?.condition === "rain"
      ? CloudDrizzle
      : c.weather?.condition === "snow"
        ? CloudSnow
        : c.weather?.condition === "storm"
          ? CloudLightning
          : c.weather?.condition === "clear"
            ? Sun
            : Cloud;
  return (
    <section className="location-atlas" aria-labelledby="location-atlas-title">
      <header className="location-atlas-head">
        <div>
          <span className="eyebrow">THE WORLD, A LITTLE CLOSER</span>
          <h2 id="location-atlas-title">
            Find your <em>corner.</em>
          </h2>
        </div>
        <span className="real-geography-label">
          <span className="status-dot" /> Real geography
        </span>
      </header>
      <div className="location-inputs">
        <form
          className="place-search"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void c.searchPlaces();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              c.cancelSearch();
              input.current?.focus();
            }
          }}
        >
          <label className="sr-only" htmlFor="place-query">
            Search a city or neighborhood
          </label>
          <Search size={18} />
          <input
            ref={input}
            id="place-query"
            type="search"
            value={c.query}
            maxLength={100}
            onChange={(event) => c.changeQuery(event.target.value)}
            placeholder="A city, a neighborhood, somewhere good…"
            autoComplete="off"
            aria-describedby="place-search-status"
          />
          {c.query && (
            <button
              type="button"
              className="clear-place"
              aria-label="Clear place search"
              onClick={() => {
                c.cancelSearch(true);
                input.current?.focus();
              }}
            >
              <X size={15} />
            </button>
          )}
          <button
            className="search-places-submit"
            type="submit"
            disabled={c.searching}
          >
            {c.searching ? "Searching…" : "Search places"}
            <ArrowUpRight size={15} />
          </button>
        </form>
        <button
          className="locate-button"
          onClick={c.useDeviceLocation}
          disabled={c.locating}
        >
          <LocateFixed size={17} />
          {c.locating ? "Finding your area…" : "Use my location"}
        </button>
        {c.locating && (
          <button className="cancel-locate" onClick={() => c.cancelLocation()}>
            Cancel location request
          </button>
        )}
      </div>
      <div className="place-feedback">
        <p id="place-search-status" role="status">
          {c.searchMessage}
        </p>
        {c.locationMessage && <p role="status">{c.locationMessage}</p>}
      </div>
      {c.results.length > 0 && (
        <ul className="place-results" aria-label="Place search results">
          {c.results.map((place) => (
            <li key={place.id}>
              <button onClick={() => c.selectPlace(place)}>
                <MapPin size={17} />
                <span>{place.label}</span>
                <ArrowUpRight size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {c.results.length > 0 && (
        <p className="geocode-credit">
          Place search uses{" "}
          <a
            href="https://github.com/komoot/photon"
            target="_blank"
            rel="noreferrer"
          >
            Photon / OpenStreetMap
          </a>
          , with OpenWeather geocoding when connected.
        </p>
      )}
      <div className="real-map-scene">
        <GeographicMap
          showAreaLabel={false}
          location={c.location}
          lowPower={lowPower}
          weather={
            c.weather
              ? { condition: c.weather.condition, isDay: c.weather.isDay }
              : null
          }
        />
        <div className="chosen-area-paper">
          <Compass size={18} strokeWidth={1.3} />
          <div>
            <span>
              {c.location.source === "starting"
                ? "STARTING VIEW"
                : c.location.source === "device"
                  ? "DEVICE AREA · THIS SESSION"
                  : "YOUR CHOSEN AREA"}
            </span>
            <h3>{c.location.label}</h3>
          </div>
        </div>
      </div>
      <div className="location-bottom">
        <section className="local-weather" aria-label="Local weather">
          <WeatherIcon size={29} strokeWidth={1.2} />
          <div>
            <span className="eyebrow">
              {c.weatherStatus === "ready"
                ? "OPENWEATHER · CURRENT CONDITIONS"
                : "A NOTE FROM THE SKY"}
            </span>
            {c.weatherStatus === "ready" && c.weather ? (
              <>
                <h3>
                  {Math.round(c.weather.temperatureC)}°C{" "}
                  <span>{c.weather.description}</span>
                </h3>
                <p>
                  For {c.location.label}. Feels like{" "}
                  {Math.round(c.weather.feelsLikeC)}° · <Wind size={11} />{" "}
                  {Math.round(c.weather.windMps * 3.6)} km/h · Reported{" "}
                  <time dateTime={c.weather.observedAt}>
                    {new Intl.DateTimeFormat(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(c.weather.observedAt))}
                  </time>{" "}
                  ·{" "}
                  <a
                    href="https://openweathermap.org/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    OpenWeather
                  </a>
                </p>
              </>
            ) : (
              <>
                <h3>
                  {c.weatherStatus === "loading"
                    ? "Checking the weather…"
                    : c.weatherStatus === "not_configured"
                      ? "Weather not connected"
                      : "Weather unavailable"}
                </h3>
                <p>
                  {c.weatherStatus === "not_configured"
                    ? "OpenWeather needs to be connected. Your map is ready to explore."
                    : c.weatherStatus === "loading"
                      ? `Looking up current conditions for ${c.location.label}.`
                      : "We couldn’t get current conditions. Your map still works."}
                </p>
              </>
            )}
          </div>
          <button
            className="weather-refresh"
            onClick={c.refreshWeather}
            aria-label="Refresh local weather"
            disabled={c.weatherStatus === "loading"}
          >
            <RefreshCw size={16} />
          </button>
        </section>
        <div className="demo-journey-invite">
          <span className="eyebrow">
            FROM A REAL PLACE TO A LITTLE POSSIBILITY
          </span>
          <p>Try the dining journey.</p>
          <button onClick={onDemo}>
            Open demo atlas <ArrowUpRight size={15} />
          </button>
          <small>
            Six fictional Brooklyn restaurants. Real nearby recommendations are
            not connected yet.
          </small>
        </div>
      </div>
      <footer className="location-privacy">
        <p>
          <LocateFixed size={13} /> Device location is requested only when you
          choose it. It stays out of your guest invitations and plans. Map and
          weather services receive the chosen area to load local data.
        </p>
        <button onClick={onWaiter}>
          A word with The Waiter <ArrowUpRight size={12} />
        </button>
      </footer>
    </section>
  );
}
