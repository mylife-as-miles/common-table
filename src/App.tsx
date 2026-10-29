import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Leaf,
  Map,
  MapPin,
  Minus,
  Plus,
  SlidersHorizontal,
  Utensils,
  X,
} from "lucide-react";
import { useCommonTable, venues } from "./domain";
import MenuBook from "./components/MenuBook";
import { SharedTable } from "./components/SharedTable";
import { DinnerPlan } from "./components/DinnerPlan";
import { NeighborhoodMap } from "./components/NeighborhoodMap";

type View = "explore" | "table" | "plan";
const viewFromHash = (): View =>
  location.hash === "#table"
    ? "table"
    : location.hash === "#plan"
      ? "plan"
      : "explore";
export default function App() {
  const { state, dispatch, ranked, selectedVenue, storageAvailable } =
    useCommonTable();
  const [view, setView] = useState<View>(viewFromHash);
  const [mode, setMode] = useState<"book" | "map">("book");
  const [lowPower, setLowPower] = useState(() => {
    try {
      return localStorage.getItem("common-table-low-power") === "true";
    } catch {
      return false;
    }
  });
  const [waiterOpen, setWaiterOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [about, setAbout] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const aboutRef = useRef<HTMLDialogElement>(null);
  const waiterRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const change = () => {
      setView(viewFromHash());
      setWaiterOpen(false);
      requestAnimationFrame(() => heading.current?.focus());
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (about) aboutRef.current?.showModal();
    else aboutRef.current?.close();
  }, [about]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!waiterOpen) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setWaiterOpen(false);
        waiterRef.current?.focus();
      }
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [waiterOpen]);
  const navigate = (next: View) => {
    setView(next);
    location.hash = next === "explore" ? "explore" : next;
    setWaiterOpen(false);
    requestAnimationFrame(() => heading.current?.focus());
  };
  const move = (direction: number) => {
    if (!ranked.length) return;
    const idx = ranked.findIndex((x) => x.venue.id === selectedVenue.id);
    dispatch({
      type: "select",
      venueId:
        ranked[(idx + direction + ranked.length) % ranked.length].venue.id,
    });
  };
  const choose = () => {
    dispatch({ type: "choose-plan", venueId: selectedVenue.id });
    navigate("table");
    setNotice(`${selectedVenue.name} is on your dinner plan.`);
  };
  const reason =
    ranked.find((x) => x.venue.id === selectedVenue.id)?.reasons.join(" · ") ??
    "Adjust your table’s tastes to find a fit.";
  const planned = venues.find((x) => x.id === state.plan.venueId);
  const togglePower = () => {
    setLowPower(!lowPower);
    try {
      localStorage.setItem("common-table-low-power", String(!lowPower));
    } catch {
      /* Optional preference */
    }
  };
  const waiterMessage =
    view === "plan"
      ? state.plan.saved
        ? "Your plan is tucked away. You can copy the details when you’re ready."
        : "A little detail goes a long way. Pick a date and time, then confirm the table’s demo approvals to save your evening."
      : view === "table"
        ? state.participants.length === 1
          ? "A table for one is a lovely start. Set your tastes, or add a demo guest to see how the group fit changes."
          : `${state.participants.length} tastes, one table. I’ll keep everyone’s budget and dietary needs in mind.`
        : ranked.length
          ? `${selectedVenue.name} looks promising. ${ranked[0]?.venue.id === selectedVenue.id ? "It’s the strongest fit for your table right now." : "Take a look inside, or turn the page for another possibility."}`
          : "Nothing fits every preference yet. Try adjusting a budget or undoing a pass; I won’t quietly ignore anyone’s needs.";
  return (
    <div className={`app ${lowPower ? "low-power" : ""}`}>
      <a
        href="#main"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="site-header">
        <a
          className="brand"
          href="#explore"
          aria-label="Common Table home"
          onClick={() => navigate("explore")}
        >
          <span className="brand-icon">
            <Utensils size={23} strokeWidth={1.35} />
            <Leaf size={13} />
          </span>
          <span>
            common table<span className="brand-period">.</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          {(["explore", "table", "plan"] as View[]).map((item, i) => (
            <button
              key={item}
              aria-current={view === item ? "page" : undefined}
              onClick={() => navigate(item)}
            >
              <span className="nav-number">0{i + 1}</span>
              {item === "explore"
                ? "Explore"
                : item === "table"
                  ? "Your table"
                  : "Dinner plan"}
              {item === "table" && (
                <span className="nav-count">{state.participants.length}</span>
              )}
              {item === "plan" && state.plan.saved && <Check size={13} />}
            </button>
          ))}
        </nav>
        <button className="demo-pill" onClick={() => setAbout(true)}>
          <span className="status-dot" /> A little demo{" "}
          <ArrowUpRight size={13} />
        </button>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span /> FIND YOUR COMMON GROUND
            </div>
            <h1 tabIndex={-1} ref={heading}>
              {view === "explore" ? (
                <>
                  Good food.<em> Better company.</em>
                </>
              ) : view === "table" ? (
                <>
                  Different tastes.<em> One table.</em>
                </>
              ) : (
                <>
                  An evening<em> worth keeping.</em>
                </>
              )}
            </h1>
            <p>
              {view === "explore"
                ? "A place you’ll love. A meal you’ll remember. Let’s find it together."
                : view === "table"
                  ? "A little of what everyone loves. Room for what everyone needs."
                  : "From “where should we eat?” to “see you there.”"}
            </p>
          </div>
          <div className="intro-actions">
            {view === "explore" ? (
              <>
                <span className="location-label">
                  <MapPin size={15} /> Brooklyn, New York{" "}
                  <span className="tiny-demo">DEMO</span>
                </span>
                <button
                  className="primary-button"
                  onClick={() => navigate("table")}
                >
                  Set your table <ArrowUpRight size={16} />
                </button>
              </>
            ) : (
              <button
                className="text-button"
                onClick={() => navigate("explore")}
              >
                Back to the neighborhood <ArrowRight size={16} />
              </button>
            )}
          </div>
        </section>
        {view === "explore" ? (
          <section
            className={`explore-layout ${mode === "map" ? "wide-map" : ""}`}
            aria-label="Restaurant discovery"
          >
            <aside className="discovery-sidebar">
              <div className="sidebar-title">
                <span className="eyebrow">THE NEIGHBORHOOD</span>
                <span className="mini-line" />
              </div>
              <NeighborhoodMap
                venues={ranked.map((x) => x.venue)}
                selected={selectedVenue}
                onSelect={(id) => dispatch({ type: "select", venueId: id })}
                onOpenMenu={() => setMode("map")}
              />
              <div className="sidebar-location">
                <h2>
                  A little closer to
                  <br />
                  <em>your kind of place.</em>
                </h2>
                <p>
                  Good corners of Brooklyn,
                  <br />
                  chosen around your table.
                </p>
              </div>
              <button
                className="taste-button"
                onClick={() => navigate("table")}
              >
                <span className="taste-icon">
                  <SlidersHorizontal size={16} />
                </span>
                <span>
                  <b>Your table’s tastes</b>
                  <small>
                    {state.participants.length === 1
                      ? "Just you, for now"
                      : `${state.participants.length} people · every taste counts`}{" "}
                    · ${Math.min(...state.participants.map((x) => x.budget))}{" "}
                    budget
                  </small>
                </span>
                <ArrowUpRight size={16} />
              </button>
              <div className="discovery-note">
                <Leaf size={19} strokeWidth={1.2} />
                <p>
                  A thoughtful shortlist,
                  <br />
                  not an endless scroll.
                </p>
              </div>
            </aside>
            <div className="discovery-main">
              <button
                className="mobile-neighborhood"
                onClick={() => setMode(mode === "book" ? "map" : "book")}
              >
                <MapPin size={17} />
                <span>
                  Brooklyn, a little closer
                  <small>{ranked.length} places around your table</small>
                </span>
                <b>
                  {mode === "book" ? "Open map" : "Open menu"}{" "}
                  <ArrowUpRight size={13} />
                </b>
              </button>
              <div className="book-toolbar">
                <span>
                  <span className="status-dot" /> {ranked.length} places to find
                  common ground
                </span>
                <div className="view-switch" aria-label="Discovery view">
                  <button
                    aria-pressed={mode === "book"}
                    onClick={() => setMode("book")}
                  >
                    <BookOpen size={14} /> Menu
                  </button>
                  <button
                    aria-pressed={mode === "map"}
                    onClick={() => setMode("map")}
                  >
                    <Map size={14} /> Map
                  </button>
                </div>
              </div>
              {!ranked.length ? (
                <div className="empty-discovery">
                  <Leaf size={40} />
                  <h2>Let’s make a little room.</h2>
                  <p>
                    No demo restaurant meets every budget and dietary need.
                    Adjust your table, or revisit a place you passed.
                  </p>
                  <button
                    className="primary-button"
                    onClick={() => navigate("table")}
                  >
                    Review your table <ArrowRight size={16} />
                  </button>
                  {state.vetoes.map((id) => (
                    <button
                      className="text-button"
                      key={id}
                      onClick={() =>
                        dispatch({ type: "undo-veto", venueId: id })
                      }
                    >
                      Reconsider {venues.find((v) => v.id === id)?.name}{" "}
                      <Plus size={14} />
                    </button>
                  ))}
                </div>
              ) : mode === "book" ? (
                <MenuBook
                  chosen={state.plan.venueId === selectedVenue.id}
                  venue={selectedVenue}
                  shortlisted={state.shortlist.includes(selectedVenue.id)}
                  onShortlist={() => {
                    dispatch({ type: "shortlist", venueId: selectedVenue.id });
                    setNotice(
                      state.shortlist.includes(selectedVenue.id)
                        ? "Removed from your shortlist."
                        : "Kept on your shortlist.",
                    );
                  }}
                  onVeto={() => {
                    dispatch({ type: "veto", venueId: selectedVenue.id });
                    setNotice(
                      `Passed on ${selectedVenue.name}. Your suggestions have been revised.`,
                    );
                  }}
                  onNext={() => move(1)}
                  onPrevious={() => move(-1)}
                  onChoose={choose}
                  index={Math.max(
                    0,
                    ranked.findIndex((x) => x.venue.id === selectedVenue.id),
                  )}
                  total={ranked.length}
                  reason={reason}
                  lowPower={lowPower}
                />
              ) : (
                <div className="expanded-map-wrap">
                  <NeighborhoodMap
                    expanded
                    venues={ranked.map((x) => x.venue)}
                    selected={selectedVenue}
                    onSelect={(id) => dispatch({ type: "select", venueId: id })}
                  />
                  <div className="map-venue-card">
                    <img
                      src={selectedVenue.image}
                      alt={`Illustrative interior for ${selectedVenue.name}`}
                    />
                    <div>
                      <span className="eyebrow">A PLACE FOR YOUR TABLE</span>
                      <h2>{selectedVenue.name}</h2>
                      <p>
                        {selectedVenue.cuisine} · ${selectedVenue.price} /
                        person
                      </p>
                    </div>
                    <button
                      className="primary-button"
                      onClick={() => setMode("book")}
                    >
                      Open menu <BookOpen size={16} />
                    </button>
                  </div>
                </div>
              )}
              <div className="under-book">
                <span>FICTIONAL PLACES. REAL POSSIBILITIES.</span>
                <p>
                  {mode === "book"
                    ? "Turn a page. Find a feeling."
                    : "Choose a pin. Meet your next favorite."}{" "}
                  <span>✳</span>
                </p>
                <span>THE BROOKLYN EDITION · VOL. 01</span>
              </div>
            </div>
          </section>
        ) : view === "table" ? (
          <SharedTable
            state={state}
            dispatch={dispatch}
            onExplore={() => navigate("explore")}
            onPlan={() => navigate("plan")}
          />
        ) : (
          <DinnerPlan
            storageAvailable={storageAvailable}
            state={state}
            dispatch={dispatch}
            onExplore={() => navigate("explore")}
            onTable={() => navigate("table")}
          />
        )}
        {state.vetoes.length > 0 && view === "explore" && ranked.length > 0 && (
          <div className="passed-places">
            <span>Passed for now</span>
            {state.vetoes.map((id) => (
              <button
                key={id}
                onClick={() => dispatch({ type: "undo-veto", venueId: id })}
              >
                {venues.find((v) => v.id === id)?.name}
                <Plus size={12} />
                <span className="sr-only">Undo pass</span>
              </button>
            ))}
          </div>
        )}
      </main>
      <div className="waiter-dock">
        <div className="waiter-avatar" aria-hidden="true">
          <Utensils size={19} strokeWidth={1.4} />
        </div>
        <div className="waiter-intro">
          <b>
            The Waiter <span>AT YOUR SERVICE</span>
          </b>
          <p>
            {view === "explore" ? (
              <>
                A good evening starts with a place that feels{" "}
                <em>just right.</em>
              </>
            ) : planned ? (
              <>A place at {planned.name}. The rest is coming together.</>
            ) : (
              <>Let’s find a little common ground.</>
            )}
          </p>
        </div>
        <button
          ref={waiterRef}
          className="waiter-toggle"
          aria-expanded={waiterOpen}
          aria-controls="waiter-panel"
          onClick={() => setWaiterOpen(!waiterOpen)}
        >
          {waiterOpen ? "Close" : "A little guidance"}
          {waiterOpen ? <Minus size={15} /> : <Plus size={15} />}
        </button>
      </div>
      {waiterOpen && (
        <section
          className="waiter-panel"
          id="waiter-panel"
          aria-label="The Waiter’s guidance"
        >
          <button
            className="waiter-close"
            aria-label="Close guidance"
            onClick={() => {
              setWaiterOpen(false);
              waiterRef.current?.focus();
            }}
          >
            <X size={16} />
          </button>
          <span className="eyebrow">A THOUGHT FROM THE WAITER</span>
          <h2>Shall we?</h2>
          <p>{waiterMessage}</p>
          <button
            className="primary-button"
            onClick={() =>
              navigate(
                view === "explore"
                  ? "table"
                  : view === "table" && state.plan.venueId
                    ? "plan"
                    : "explore",
              )
            }
          >
            {view === "explore"
              ? "Refine your tastes"
              : view === "table" && state.plan.venueId
                ? "Put the evening together"
                : "Explore the neighborhood"}
            <ArrowRight size={15} />
          </button>
          <small>
            Contextual demo guidance. No bookings or messages are sent.
          </small>
        </section>
      )}
      <footer className="site-footer">
        <span>Made for the moments between bites.</span>
        <div>
          <button onClick={togglePower} aria-pressed={lowPower}>
            <span className={`power-dot ${lowPower ? "on" : ""}`} />
            {lowPower ? "Low-power view on" : "Low-power view"}
          </button>
          <button onClick={() => setAbout(true)}>
            About this demo <ArrowUpRight size={11} />
          </button>
        </div>
        <span>
          {storageAvailable
            ? "Your table stays in this browser."
            : "Browser storage is unavailable; this session is temporary."}
        </span>
      </footer>
      <div
        role="status"
        aria-live="polite"
        className={`toast ${notice ? "visible" : ""}`}
      >
        {notice && (
          <>
            <Check size={16} />
            {notice}
          </>
        )}
      </div>
      <dialog
        ref={aboutRef}
        className="about-dialog"
        aria-labelledby="demo-heading"
        onCancel={() => setAbout(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setAbout(false);
        }}
      >
        <button
          className="dialog-close"
          aria-label="Close about this demo"
          onClick={() => setAbout(false)}
        >
          <X size={20} />
        </button>
        <span className="eyebrow">WELCOME TO COMMON TABLE</span>
        <h2 id="demo-heading">
          A taste of
          <br />
          <em>what’s to come.</em>
        </h2>
        <p>
          This is an interactive demo with fictional Brooklyn restaurants,
          illustrative menus, prices, dietary options, ratings, walking times,
          and photography.
        </p>
        <p>
          Recommendations use a local taste, budget, and dietary filter.{" "}
          <b>Qloo is not connected.</b> Demo guests are saved in this browser;
          real invitations and shared live tables are not available.
        </p>
        <p>
          Plans can be saved on this device and exported as text. Nothing is
          booked, sent, or shared automatically. No location is collected.
          Always confirm dietary needs directly with a restaurant.
        </p>
        <button className="primary-button" onClick={() => setAbout(false)}>
          Pull up a chair <ArrowRight size={16} />
        </button>
      </dialog>
    </div>
  );
}
