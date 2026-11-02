# Weather for the chosen area

`WeatherCard` receives latitude, longitude, locationLabel, date and time from the
same active map/dinner state. It does not ask for device location. Pass
`persistCache={false}` for unsaved device coordinates; the shared storage adapter
then uses session memory. Coordinates are rounded to two decimals before either
network requests or browser caching.

Wire GET/HEAD `/api/weather` to `handleWeatherRequest` from `server/weather.ts`.
`createWeatherHandler` accepts an injected fetch, clock, timeout and minimum
interval for deterministic tests. Its default fetch resolves the platform fetch
at invocation, preserving the Worker request context.

The primary endpoint is `https://api.open-meteo.com/v1/forecast`, requesting at most
16 days. Only quota, server or transport failures can use the fixed alternate
`https://api.met.no/weatherapi/locationforecast/2.0/compact` endpoint. Both sources
share the same total eight-second deadline and 192 KiB response limit.
Forecast data are shared by coarse
area, coalesced in flight, fresh for 20 minutes and usable only with an explicit
stale label for at most two hours. It never substitutes current conditions for a
missing/far-future dinner forecast. The browser validates persisted/network data
and expires it without making automatic retries.

The alternate source has at most ten days, with sparse later timestamps. It uses
only exact returned timestamps, converted to an offline IANA timezone, and never
interpolates missing hours. Feels-like values are unknown; absent precipitation
and daylight fields remain null. Only documented, recognized condition symbols
are translated. Model issue dates and current timestamps are freshness checked.
The source's Expires header prevents premature refreshes even after the app's
shorter fresh period; cached data still expire absolutely after two hours.

Official references checked November 2, 2026:

- [Forecast fields, timezone and 16-day horizon](https://open-meteo.com/en/docs)
- [Free endpoint terms and limits](https://open-meteo.com/en/terms): non-commercial,
  fewer than 10,000 calls/day, 5,000/hour and 600/minute. Production commercial
  operation requires an appropriate service agreement.
- [Data licence/attribution](https://open-meteo.com/en/licence): CC BY 4.0, with a
  link beside displayed data. The card's generic “Data credits” link points to
  the site's legal credits, which include source and licence links and state
  that coordinates are coarsened, units formatted, and dinner data shown hourly.
- [MET Norway service terms](https://api.met.no/doc/TermsOfService),
  [data model](https://api.met.no/doc/locationforecast/datamodel) and
  [licence](https://api.met.no/doc/License): identifying application User-Agent,
  coarse coordinates, respect for Expires, and CC BY 4.0 attribution.

Verification: `tests/weather.test.ts`, `tests/weather-client.test.ts`,
`tests/weather-met.test.ts`. One actual
public forecast request for rounded Brooklyn coordinates returned validated
current conditions and the requested next-evening hour. Tests themselves use no
external network.
An actual alternate-source probe also returned 90 valid forecast timestamps for
rounded Brooklyn coordinates. Production ingress remains separately verified
after deployment; local workerd can have different egress from Node's proxy.
