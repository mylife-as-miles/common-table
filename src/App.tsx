import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Leaf,
  Map,
  MapPin,
  Plus,
  ChevronLeft,
  BellRing,
  Utensils,
  X,
} from "lucide-react";
import { useCommonTable, venues } from "./domain";
import MenuBook from "./components/MenuBook";
import { SharedTable } from "./components/SharedTable";
import { DinnerPlan } from "./components/DinnerPlan";
import { ImmersiveMap } from "./components/ImmersiveMap";
import { Waiter } from "./components/Waiter";

type View = "explore" | "table" | "plan";
const viewFromHash = (): View =>
  location.hash === "#table"
    ? "table"
    : location.hash === "#plan"
      ? "plan"
      : "explore";
const modeFromHash = () =>
  location.hash === "#menu" ? ("book" as const) : ("map" as const);
export default function App() {
  const { state, dispatch, ranked, selectedVenue, storageAvailable } =
    useCommonTable();
  const [view, setView] = useState<View>(viewFromHash);
  const [mode, setMode] = useState<"book" | "map">(modeFromHash);
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
  const transition = useRef<ViewTransition | null>(null);
  const modeIntent = useRef<"map" | "book">(modeFromHash());
  useEffect(() => {
    const change = () => {
      const nextView = viewFromHash();
      setView(nextView);
      if (nextView === "explore" && modeIntent.current !== modeFromHash()) {
        modeIntent.current = modeFromHash();
        transition.current?.skipTransition();
        setMode(modeFromHash());
      }
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
    if (lowPower) transition.current?.skipTransition();
  }, [lowPower]);
  useEffect(() => () => transition.current?.skipTransition(), []);
  const switchMode = (next: "map" | "book") => {
    if (modeIntent.current === next) return;
    modeIntent.current = next;
    transition.current?.skipTransition();
    const update = () => flushSync(() => setMode(modeIntent.current));
    if (
      lowPower ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !document.startViewTransition
    ) {
      update();
      return;
    }
    const active = document.startViewTransition(update);
    transition.current = active;
    active.ready.catch(() => {});
    active.finished
      .catch(() => {})
      .finally(() => {
        if (transition.current === active) transition.current = null;
      });
  };
  const navigate = (next: View) => {
    setView(next);
    location.hash =
      next === "explore"
        ? modeIntent.current === "book"
          ? "menu"
          : "explore"
        : next;
    setWaiterOpen(false);
    requestAnimationFrame(() => heading.current?.focus());
  };
  const openMenu = () => {
    switchMode("book");
    navigate("explore");
  };
  const openMap = () => {
    switchMode("map");
    navigate("explore");
  };
  const shortlistSelected = () => {
    dispatch({ type: "shortlist", venueId: selectedVenue.id });
    setNotice(
      state.shortlist.includes(selectedVenue.id)
        ? "Removed from your shortlist."
        : "Kept on your shortlist.",
    );
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
  const togglePower = () => {
    setLowPower(!lowPower);
    try {
      localStorage.setItem("common-table-low-power", String(!lowPower));
    } catch {
      /* Optional preference */
    }
  };
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
          onClick={openMap}
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
              onClick={() => (item === "explore" ? openMap() : navigate(item))}
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
              <button className="text-button" onClick={openMap}>
                Back to the neighborhood <ArrowRight size={16} />
              </button>
            )}
          </div>
        </section>
        {view === "explore" ? (
          mode === "map" && ranked.length > 0 ? (
            <ImmersiveMap
              venues={ranked.map((item) => item.venue)}
              selected={selectedVenue}
              participants={state.participants}
              shortlist={state.shortlist}
              plannedVenueId={state.plan.venueId}
              onSelect={(id) => dispatch({ type: "select", venueId: id })}
              onOpenMenu={openMenu}
              onShortlist={shortlistSelected}
              onTable={() => navigate("table")}
              onAskWaiter={() => setWaiterOpen(true)}
              lowPower={lowPower}
            />
          ) : (
            <section
              className="explore-layout book-world"
              aria-label="Restaurant discovery"
            >
              <aside className="discovery-sidebar book-journey-rail">
                <span className="eyebrow">THE EVENING IS UNFOLDING</span>
                <button className="atlas-return" onClick={openMap}>
                  <span className="folded-atlas" aria-hidden="true">
                    <Map size={33} strokeWidth={1} />
                  </span>
                  <span>
                    Back to the
                    <br />
                    <em>neighborhood.</em>
                    <small>
                      <ChevronLeft size={12} /> Unfold your map
                    </small>
                  </span>
                </button>
                <div className="rail-place-note">
                  <span className="eyebrow">YOU’RE READING</span>
                  <h2>{selectedVenue.name}</h2>
                  <p>
                    {selectedVenue.neighborhood}
                    <br />
                    {selectedVenue.cuisine}
                  </p>
                </div>
                <button
                  className="taste-button"
                  onClick={() => navigate("table")}
                >
                  <span className="rail-people" aria-hidden="true">
                    {state.participants.slice(0, 3).map((person) => (
                      <i key={person.id} style={{ background: person.color }}>
                        {person.name[0]}
                      </i>
                    ))}
                  </span>
                  <span>
                    <b>
                      {state.participants.length === 1
                        ? "A table just for you"
                        : `${state.participants.length} tastes, one table`}
                    </b>
                    <small>Every preference comes with you</small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
                <div className="discovery-note">
                  <Leaf size={19} strokeWidth={1.2} />
                  <p>
                    From a place on the map
                    <br />
                    to a story at the table.
                  </p>
                </div>
                <button
                  className="rail-service"
                  onClick={() => setWaiterOpen(true)}
                >
                  <BellRing size={18} strokeWidth={1.2} />
                  <span>
                    A word with
                    <br />
                    <b>The Waiter</b>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              </aside>
              <div className="discovery-main">
                <button className="mobile-neighborhood" onClick={openMap}>
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
                    <span className="status-dot" /> {ranked.length} places to
                    find common ground
                  </span>
                  <div className="view-switch" aria-label="Discovery view">
                    <button aria-pressed={mode === "book"} onClick={openMenu}>
                      <BookOpen size={14} /> Menu
                    </button>
                    <button aria-pressed={mode === "map"} onClick={openMap}>
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
                ) : (
                  <MenuBook
                    chosen={state.plan.venueId === selectedVenue.id}
                    venue={selectedVenue}
                    shortlisted={state.shortlist.includes(selectedVenue.id)}
                    onShortlist={() => {
                      dispatch({
                        type: "shortlist",
                        venueId: selectedVenue.id,
                      });
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
          )
        ) : view === "table" ? (
          <SharedTable
            state={state}
            dispatch={dispatch}
            onExplore={openMenu}
            onPlan={() => navigate("plan")}
          />
        ) : (
          <DinnerPlan
            storageAvailable={storageAvailable}
            state={state}
            dispatch={dispatch}
            onExplore={openMenu}
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
      <Waiter
        state={state}
        dispatch={dispatch}
        view={view}
        mode={mode}
        lowPower={lowPower}
        storageAvailable={storageAvailable}
        open={waiterOpen}
        onOpenChange={setWaiterOpen}
        onNavigate={(next) => (next === "explore" ? openMap() : navigate(next))}
        onOpenMenu={openMenu}
        onSelectVenue={(id) => dispatch({ type: "select", venueId: id })}
      />
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
