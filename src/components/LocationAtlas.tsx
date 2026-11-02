import { useRef, useState } from "react";
import {
  ArrowUpRight,
  Bookmark,
  Check,
  Coffee,
  Compass,
  Expand,
  Leaf,
  LocateFixed,
  MapPin,
  Minimize2,
  Moon,
  Search,
  Sun,
  Utensils,
  X,
} from "lucide-react";
import { GeographicMap, geographicVenueCandidates, type MapPoint } from "./GeographicMap";
import type { LocationContext } from "../location/useLocationContext";
import "./location-atlas.css";
import type { Venue } from "../domain/types";

interface Props {
  context: LocationContext;
  lowPower: boolean;
  onDemo: () => void;
  onWaiter: () => void;
  discoveredVenues?: Venue[];
  onOpenVenue?: (id: string) => void;
  selectedVenueId?: string;
}
const lenses = [
  { id: "all", label: "Everything", icon: Compass },
  { id: "food", label: "Food", icon: Utensils },
  { id: "coffee", label: "Coffee", icon: Coffee },
  { id: "outdoors", label: "Outdoors", icon: Leaf },
] as const;
const categories = {
  food: "A place to eat",
  coffee: "A coffee stop",
  outdoors: "A little fresh air",
  other: "A mapped place",
};
function PointIcon({ point, size = 16 }: { point: MapPoint; size?: number }) {
  const Icon =
    point.category === "food"
      ? Utensils
      : point.category === "coffee"
        ? Coffee
        : point.category === "outdoors"
          ? Leaf
          : MapPin;
  return <Icon size={size} strokeWidth={1.4} />;
}
export function LocationAtlas({
  context: c,
  lowPower,
  onDemo,
  onWaiter,
  discoveredVenues = [],
  onOpenVenue,
  selectedVenueId,
}: Props) {
  const restaurantPossibilities = geographicVenueCandidates(discoveredVenues);
  const input = useRef<HTMLInputElement>(null),
    root = useRef<HTMLElement>(null),
    unfoldButton = useRef<HTMLButtonElement>(null);
  const notes = useRef<HTMLElement>(null),
    noteHeading = useRef<HTMLHeadingElement>(null),
    peek = useRef<HTMLButtonElement>(null);
  const collectionButton = useRef<HTMLButtonElement>(null);
  const [lens, setLens] = useState<(typeof lenses)[number]["id"]>("all");
  const [atmosphere, setAtmosphere] = useState<"day" | "supper">("day");
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [collection, setCollection] = useState<"view" | "kept">("view");
  const [unfolded, setUnfolded] = useState(false);
  const selected = c.selectedPoint,
    kept = selected && c.savedPoints.some((p) => p.id === selected.id);
  const list = collection === "kept" ? c.savedPoints : points;
  function inspect(point: MapPoint, revisit = false) {
    if (lens !== "all" && point.category !== lens) setLens("all");
    if (revisit) c.revisitPoint(point);
    else c.selectMappedPoint(point);
    if (window.matchMedia("(max-width: 760px)").matches)
      requestAnimationFrame(() => {
        peek.current?.scrollIntoView({
          behavior:
            lowPower ||
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "instant"
              : "smooth",
          block: "nearest",
        });
      });
  }
  function fold() {
    setUnfolded(false);
    requestAnimationFrame(() =>
      unfoldButton.current?.focus({ preventScroll: true }),
    );
  }
  return (
    <section
      ref={root}
      className={`location-atlas${unfolded ? " is-unfolded" : ""}`}
      aria-labelledby="location-atlas-title"
      onKeyDown={(event) => {
        if (event.key === "Escape" && unfolded && !event.defaultPrevented) {
          event.preventDefault();
          fold();
        }
      }}
    >
      <header className="location-atlas-head">
        <div>
          <span className="eyebrow">THE WORLD, A LITTLE CLOSER</span>
          <h2 id="location-atlas-title">
            Find your <em>corner.</em>
          </h2>
        </div>
        <span className="real-geography-label">
          <span className="status-dot" /> OpenStreetMap
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
              event.preventDefault();
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
        <>
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
          <p className="geocode-credit">
            Place search by{" "}
            <a
              href="https://github.com/komoot/photon"
              target="_blank"
              rel="noreferrer"
            >
              Photon / OpenStreetMap
            </a>
            .
          </p>
        </>
      )}
      <div className="atlas-exploration-tools">
        <div
          className="atlas-lenses"
          role="group"
          aria-label="Explore mapped place categories"
        >
          {lenses.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-pressed={lens === id}
              onClick={() => {
                setLens(id);
                setCollection("view");
                if (id !== "all" && selected && selected.category !== id)
                  c.clearPoint();
              }}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
        <div className="atlas-stage-actions">
          <button
            className="atlas-light-switch"
            aria-label={
              atmosphere === "day"
                ? "Daylight · Set supper light"
                : "Supper light · Set daylight"
            }
            aria-pressed={atmosphere === "supper"}
            onClick={() =>
              setAtmosphere((a) => (a === "day" ? "supper" : "day"))
            }
          >
            {atmosphere === "day" ? <Sun size={15} /> : <Moon size={15} />}
            <span>{atmosphere === "day" ? "Daylight" : "Supper light"}</span>
          </button>
          <button
            ref={unfoldButton}
            aria-pressed={unfolded}
            onClick={() => {
              if (unfolded) fold();
              else {
                setUnfolded(true);
                requestAnimationFrame(() =>
                  root.current?.scrollIntoView({
                    behavior: "instant",
                    block: "start",
                  }),
                );
              }
            }}
          >
            {unfolded ? <Minimize2 size={15} /> : <Expand size={15} />}
            <span>{unfolded ? "Fold map" : "Unfold map"}</span>
          </button>
        </div>
      </div>
      <p className="sr-only" role="status">
        {selected
          ? `Selected ${selected.name}. Place notes are available.`
          : "Select a mapped place to read its notes."}
      </p>
      <div className="real-map-scene">
        <div className="location-world">
          <GeographicMap
            showAreaLabel={false}
            location={c.location}
            lowPower={lowPower}
            atmosphere={atmosphere}
            lens={lens}
            selectedPoint={selected}
            onPointSelect={inspect}
            onPointsChange={setPoints}
            discoveredVenues={restaurantPossibilities}
            onOpenVenue={onOpenVenue}
            selectedVenueId={selectedVenueId}
          />
          <div className="chosen-area-paper">
            <Compass size={18} strokeWidth={1.3} />
            <div>
              <span>
                {c.location.source === "starting"
                  ? "STARTING VIEW"
                  : c.location.source === "device"
                    ? "DEVICE AREA · THIS SESSION"
                    : c.location.source === "saved"
                      ? "YOUR SAVED AREA"
                      : "YOUR CHOSEN AREA"}
              </span>
              <h3>{c.location.label}</h3>
            </div>
          </div>
          {selected && (
            <button
              ref={peek}
              className="mobile-place-peek"
              onClick={() => {
                notes.current?.scrollIntoView({
                  behavior: "instant",
                  block: "nearest",
                });
                noteHeading.current?.focus({ preventScroll: true });
              }}
            >
              <PointIcon point={selected} />
              <span>
                <small>A REAL MAPPED PLACE</small>
                <strong>{selected.name}</strong>
              </span>
              <span className="peek-action">
                Read notes <ArrowUpRight size={13} />
              </span>
            </button>
          )}
        </div>
        <aside
          ref={notes}
          className="map-field-notes"
          aria-label="Map field notes"
        >
          <div className="field-notes-binding" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="field-note-heading">
            <span className="eyebrow">A COMMON TABLE FIELD GUIDE</span>
            <span className="field-note-number">No. 01</span>
          </div>
          <div className="field-note-detail" key={selected?.id ?? "unselected"}>
            {selected ? (
              <>
                <div
                  className={`field-note-illustration category-${selected.category}`}
                  aria-hidden="true"
                >
                  <PointIcon point={selected} size={35} />
                  <span />
                </div>
                <span className="field-note-category">
                  {categories[selected.category]}
                </span>
                <h3 ref={noteHeading} tabIndex={-1}>
                  {selected.name}
                </h3>
                <p className="field-note-source">
                  A real place on OpenStreetMap.
                </p>
                <p className="field-note-caveat">
                  {selected.category === "food" ||
                  selected.category === "coffee"
                    ? "Menus, prices, opening hours and dietary suitability haven’t been checked."
                    : "Opening hours, access and other place details haven’t been checked."}
                </p>
                <div className="field-note-actions">
                  <button
                    className="keep-map-place"
                    aria-pressed={Boolean(kept)}
                    onClick={() => c.toggleSavedPoint(selected)}
                  >
                    {kept ? <Check size={14} /> : <Bookmark size={14} />}
                    {kept ? c.storageAvailable ? "Kept on this device" : "Kept for this session" : "Keep this place"}
                  </button>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${selected.latitude}&mlon=${selected.longitude}#map=18/${selected.latitude}/${selected.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`View on OSM, ${selected.name}`}
                  >
                    View on OSM <ArrowUpRight size={13} />
                  </a>
                  <button
                    className="field-note-waiter"
                    onClick={onWaiter}
                    aria-label={`Ask The Waiter about ${selected.name}`}
                  >
                    Ask The Waiter <ArrowUpRight size={13} />
                  </button>
                </div>
                <button
                  className="clear-map-point"
                  onClick={() => {
                    c.clearPoint();
                    setCollection("view");
                    requestAnimationFrame(() =>
                      collectionButton.current?.focus({ preventScroll: true }),
                    );
                  }}
                >
                  Close place notes <X size={12} />
                </button>
              </>
            ) : (
              <>
                <div className="field-note-illustration" aria-hidden="true">
                  <Compass size={40} strokeWidth={0.8} />
                  <span />
                </div>
                <span className="field-note-category">
                  A little curiosity goes a long way.
                </span>
                <h3>
                  The evening starts
                  <br />
                  <em>somewhere.</em>
                </h3>
                <p className="field-note-source">
                  Tap a place on the map. Keep a corner that catches your eye.
                </p>
              </>
            )}
          </div>
          {restaurantPossibilities.length > 0 && onOpenVenue && <section className="recommended-place-index" aria-label="Restaurant possibilities for your table"><span className="eyebrow">A PLACE FOR YOUR EVENING</span><h4>Restaurant possibilities</h4><p>Open a restaurant book to explore the details. Prices and dietary needs may still need confirmation.</p><ol>{restaurantPossibilities.map(venue => <li key={venue.id}><button onClick={() => onOpenVenue(venue.id)} aria-pressed={selectedVenueId === venue.id} aria-label={`${venue.name} — Open menu book`}>{venue.image ? <img src={venue.image} alt="" loading="lazy"/> : <Utensils size={20}/>}<span><strong>{venue.name}</strong><small>{venue.neighborhood || venue.cuisine}</small></span><ArrowUpRight size={14}/></button></li>)}</ol></section>}
          <div
            className="map-collection-tabs"
            role="group"
            aria-label="Map place collection"
          >
            <button
              ref={collectionButton}
              aria-pressed={collection === "view"}
              onClick={() => setCollection("view")}
            >
              In this view <span>{points.length}</span>
            </button>
            <button
              aria-pressed={collection === "kept"}
              onClick={() => setCollection("kept")}
            >
              Kept <span>{c.savedPoints.length}</span>
            </button>
          </div>
          <p className="map-collection-caption">
            {collection === "kept"
              ? c.storageAvailable ? "Your pocket collection · on this device" : "Your pocket collection · this session only"
              : "Places supplied by the map · not ranked recommendations"}
          </p>
          {list.length ? (
            <ol
              className="mapped-place-index"
              aria-label={
                collection === "kept"
                  ? "Kept mapped places"
                  : "Mapped places in view"
              }
            >
              {list.map((point, i) => (
                <li key={point.id}>
                  <button
                    aria-pressed={selected?.id === point.id}
                    onClick={() => inspect(point, collection === "kept")}
                  >
                    <span className="map-index-number">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <PointIcon point={point} />
                    <span className="map-index-name">{point.name}</span>
                    <ArrowUpRight size={13} />
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="map-index-empty">
              {collection === "kept"
                ? "Nothing tucked away yet. Select a mapped place to keep it here."
                : "Pan or zoom to reveal mapped places. The standard 2D map shows geography without this place index."}
            </p>
          )}
          <span className="field-guide-signature" aria-hidden="true">
            Follow your appetite.
          </span>
        </aside>
      </div>
      <div className="location-bottom">
        <p className="map-exploration-note">
          <Compass size={17} strokeWidth={1.2} />
          <span>
            Drag to wander. Zoom to get closer.{" "}
            <strong>Find a place, then make an evening of it.</strong>
          </span>
        </p>
        <div className="demo-journey-invite">
          <span className="eyebrow">
            CONTINUE INTO OUR FICTIONAL NEIGHBORHOOD
          </span>
          <p>From a pin to a shared table.</p>
          <button onClick={onDemo}>
            Open demo atlas <ArrowUpRight size={15} />
          </button>
          <small>
            Six fictional Brooklyn restaurants. Real menus and personalized
            recommendations are not connected yet.
          </small>
        </div>
      </div>
      <footer className="location-privacy">
        <p>
          <LocateFixed size={13} /> Device location is requested only when you
          choose it. Map and place-search services receive the chosen area. {c.storageAvailable
            ? "Chosen areas and kept places are saved on this device; the current device location is not stored."
            : "Changes stay only in this session while device storage is unavailable."} No location is shared with guests or dinner plans.
        </p>
        <button onClick={onWaiter}>
          A word with The Waiter <ArrowUpRight size={12} />
        </button>
      </footer>
    </section>
  );
}
