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
  Volume2,
  VolumeX,
} from "lucide-react";
import { getVenue, getVenueCatalog, isDemoVenue } from "./domain";
import { useTableExperience } from "./collaboration/useTableExperience";
import { SharedTablePanel } from "./collaboration";
import { useBooleanSetting } from "./storage/settings";
import { useRecommendations } from "./recommendations/useRecommendations";
import { RecommendationPanel } from "./recommendations/RecommendationPanel";
import { WeatherCard } from "./weather";
import { BookingCard } from "./booking";
import "./services.css";
import "./finishing.css";
import MenuBook from "./components/MenuBook";
import { SharedTable } from "./components/SharedTable";
import { DinnerPlan } from "./components/DinnerPlan";
import { ImmersiveMap } from "./components/ImmersiveMap";
import { Waiter } from "./components/Waiter";
import { LocationAtlas } from "./components/LocationAtlas";
import { useLocationContext } from "./location/useLocationContext";
import { EveningRoom } from "./components/EveningRoom";
import {
  disposeInteractionSound,
  playInteractionSound,
  setInteractionSoundEnabled,
} from "./experience/interactionSound";

type View = "explore" | "table" | "plan";
const viewFromHash = (): View =>
  location.hash === "#table"
    ? "table"
    : location.hash === "#plan"
      ? "plan"
      : "explore";
const modeFromHash = () =>
  location.hash === "#menu"
    ? ("book" as const)
    : location.hash === "#explore"
      ? ("map" as const)
      : ("real" as const);
export default function App() {
  const experience = useTableExperience();
  const { state, dispatch, ranked, selectedVenue, storageAvailable, storageReady, storageSaving, storageConflict, resolveStorageConflict, shared, editor } = experience;
  const [view, setView] = useState<View>(() => location.hash.startsWith("#join/") ? "table" : viewFromHash());
  const [mode, setMode] = useState<"book" | "map" | "real">(modeFromHash);
  const locationContext = useLocationContext(
    view === "explore" && mode === "real",
  );
  const [lowPower, setLowPower] = useBooleanSetting("lowPower");
  const discovery = useRecommendations({ state, dispatch, location: locationContext.location });
  const discoveredVenues = getVenueCatalog(state).filter(v => !isDemoVenue(v) && v.latitude !== undefined && v.longitude !== undefined);
  const plannedVenue = getVenue(state, state.plan.venueId);
  const weatherArea = plannedVenue?.latitude !== undefined && plannedVenue.longitude !== undefined
    ? {latitude: plannedVenue.latitude, longitude: plannedVenue.longitude, label: plannedVenue.name}
    : locationContext.location;

  const [waiterOpen, setWaiterOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [about, setAbout] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(() => location.hash.startsWith("#join/"));
  const [sound, setSound] = useState(false);
  const [soundBusy, setSoundBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const stage = useRef<HTMLElement>(null);
  const room = useRef<HTMLDivElement>(null);
  const lightFrame = useRef<number | null>(null);
  const aboutRef = useRef<HTMLDialogElement>(null);
  const transition = useRef<ViewTransition | null>(null);
  const modeIntent = useRef<"map" | "book" | "real">(modeFromHash());
  useEffect(() => {
    const change = () => {
      const nextView = location.hash.startsWith("#join/") ? "table" : viewFromHash();
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
  useEffect(
    () => () => {
      disposeInteractionSound();
      if (lightFrame.current !== null) cancelAnimationFrame(lightFrame.current);
    },
    [],
  );
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const active = stage.current;
    if (!active || lowPower || preference.matches) return;
    const entrance = active.animate(
      [
        { opacity: 0.2, transform: "translateY(10px) scale(.996)" },
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ],
      { duration: 460, easing: "cubic-bezier(.18,.7,.24,1)" },
    );
    const stop = () => {
      if (preference.matches) entrance.cancel();
    };
    preference.addEventListener("change", stop);
    return () => {
      entrance.cancel();
      preference.removeEventListener("change", stop);
    };
  }, [view, mode, lowPower]);
  const switchMode = (next: "map" | "book" | "real") => {
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
    if (next !== view || modeIntent.current !== mode)
      playInteractionSound("scene");
    setView(next);
    location.hash =
      next === "explore"
        ? modeIntent.current === "book"
          ? "menu"
          : modeIntent.current === "real"
            ? "nearby"
            : "explore"
        : next;
    setWaiterOpen(false);
    requestAnimationFrame(() => heading.current?.focus());
  };
  const openMenu = () => {
    switchMode("book");
    navigate("explore");
  };
  const openRealMap = () => {
    switchMode("real");
    navigate("explore");
  };
  const openMap = () => {
    switchMode("map");
    navigate("explore");
  };
  const openSample = () => { dispatch({type:"browse-sample"}); openMap(); };
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
  const adjacentVenue = (direction: number) => {
    if (!ranked.length) return undefined;
    const idx = ranked.findIndex((x) => x.venue.id === selectedVenue.id);
    return ranked[(idx + direction + ranked.length) % ranked.length]?.venue;
  };
  const choose = async () => {
    if (shared.table) {
      if (shared.table.ownerId !== shared.table.viewerId) {setNotice("The host chooses the dinner plan. Keep this place on your shortlist.");return;}
      if (editor.draft) {setNotice("Apply or discard your table edits before choosing a new place.");return;}
      const confirmed = await shared.updatePlan({venueId:selectedVenue.id,venueSnapshot:selectedVenue,date:state.plan.date,time:state.plan.time,note:state.plan.note,saved:false});
      if (!confirmed) {setNotice("The plan change was not confirmed. Review your shared table.");return;}
    } else dispatch({ type: "choose-plan", venueId: selectedVenue.id });
    navigate("table");
    setNotice(`${selectedVenue.name} is on your dinner plan.`);
  };
  const reason =
    ranked.find((x) => x.venue.id === selectedVenue.id)?.reasons.join(" · ") ??
    "Adjust your table’s tastes to find a fit.";
  const togglePower = () => setLowPower(value => !value);
  const sampleSelected = isDemoVenue(selectedVenue);
  const initialSharedPlan = {venueId:state.plan.venueId,venueSnapshot:plannedVenue??null,date:state.plan.date,time:state.plan.time,note:state.plan.note,saved:false,detailsAcknowledged:state.plan.detailsAcknowledged};
  const myPreferences = state.participants.find(person => person.id === "you") ?? state.participants[0];
  return (
    <div
      ref={room}
      className={`app cinematic ${lowPower ? "low-power" : ""}`}
      data-view={view}
      data-mode={mode}
      onPointerMove={(event) => {
        if (
          lowPower ||
          event.pointerType !== "mouse" ||
          !window.matchMedia(
            "(hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference)",
          ).matches
        )
          return;
        const x = Math.max(
          10,
          Math.min(90, (event.clientX / window.innerWidth) * 100),
        );
        if (lightFrame.current !== null)
          cancelAnimationFrame(lightFrame.current);
        lightFrame.current = requestAnimationFrame(() => {
          room.current?.style.setProperty("--room-light-x", `${x}%`);
          lightFrame.current = null;
        });
      }}
    >
      <EveningRoom />
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
          href="#nearby"
          aria-label="Common Table home"
          onClick={openRealMap}
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
              onClick={() =>
                item === "explore" ? openRealMap() : navigate(item)
              }
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
        <div className="header-tools">
          <button
            className="sound-toggle"
            aria-label={sound ? "Sound on" : "Sound off"}
            aria-pressed={sound}
            disabled={soundBusy}
            onClick={async () => {
              setSoundBusy(true);
              const enabled = await setInteractionSoundEnabled(!sound);
              setSound(enabled);
              setSoundBusy(false);
              if (!enabled && !sound)
                setNotice(
                  "Sound could not start in this browser. Your evening still works silently.",
                );
            }}
          >
            {sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
            <span>{sound ? "Sound on" : "Sound off"}</span>
          </button>
          <button className="demo-pill" onClick={() => setAbout(true)}>
            <span className="status-dot" /> About your evening{" "}
            <ArrowUpRight size={13} />
          </button>
        </div>
      </header>
      <main ref={stage} id="main" tabIndex={-1}>
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
                  <MapPin size={15} />{" "}
                  {mode === "real"
                    ? locationContext.location.label
                    : isDemoVenue(selectedVenue) ? "Brooklyn, New York" : selectedVenue.neighborhood}{" "}
                  <span className="tiny-demo">
                    {mode === "real" ? "REAL MAP" : isDemoVenue(selectedVenue) ? "DEMO" : "REAL PLACE"}
                  </span>
                </span>
                <button
                  className="primary-button"
                  onClick={() => navigate("table")}
                >
                  Set your table <ArrowUpRight size={16} />
                </button>
              </>
            ) : (
              <button className="text-button" onClick={openRealMap}>
                Back to the neighborhood <ArrowRight size={16} />
              </button>
            )}
          </div>
        </section>
        {!storageReady && <p className="service-notice" role="status">Opening your saved evening…</p>}
        {storageConflict && <section className="service-notice" role="alert"><p>{storageConflict}</p><button onClick={() => void resolveStorageConflict("reload")}>Load device copy</button><button onClick={() => void resolveStorageConflict("keep-local")}>Keep this tab’s draft</button></section>}
        {editor.storageError && <p className="service-notice" role="alert">{editor.storageError}</p>}
        {editor.draft && <section className="service-notice shared-editor" aria-label="Unsubmitted table edits"><p>{editor.draftConflict ? "The shared table changed while you were editing. Review the current plan before applying your draft." : "Your edits are a device draft. Apply them so everyone sees the same details."}</p>{editor.draftConflict && <label><input type="checkbox" checked={editor.reviewed} onChange={e => editor.setReviewed(e.target.checked)} />I reviewed the latest table.</label>}<button disabled={editor.applying || shared.busy || (editor.draftConflict && !editor.reviewed)} onClick={() => void editor.applyDraft()}>Apply table changes</button><button disabled={editor.applying} onClick={editor.discardDraft}>Discard edits</button></section>}
        {view === "explore" && (mode === "real" ? <RecommendationPanel {...discovery} locationLabel={locationContext.location.label} onRefresh={() => void discovery.refresh()} onCancel={discovery.cancel} onDemo={openSample} disabled={!storageReady || shared.busy} /> : <details className="restaurant-discovery-fold"><summary><span aria-hidden="true">✳</span><b>Make room for a new favorite.</b><span>Find real restaurants near your chosen area <Plus size={14}/></span></summary><RecommendationPanel {...discovery} locationLabel={locationContext.location.label} onRefresh={() => void discovery.refresh()} onCancel={discovery.cancel} disabled={!storageReady || shared.busy} /></details>)}
        {view === "explore" && discovery.message.startsWith("Sign in") && <p className="service-notice"><a href="/signin-with-chatgpt?return_to=%2F%23nearby" target="_top">Sign in to discover restaurants</a></p>}
        {view === "table" && <details className="shared-envelope" open={sharingOpen || Boolean(shared.pendingInvite)} onToggle={event => setSharingOpen(event.currentTarget.open)}><summary><span className="envelope-seal" aria-hidden="true">✳</span><span><b>{shared.table ? shared.table.title : "Good company starts with an invitation."}</b><small>{shared.table ? `${shared.table.members.length} at your table · ${shared.status === "connected" ? "connected" : "offline copy"}` : "Private join links · everyone brings their own tastes"}</small></span><span className="envelope-action">{sharingOpen ? "Fold away" : shared.table ? "Manage table" : "Invite your company"}<Plus size={15}/></span></summary><SharedTablePanel session={shared} initialPlan={initialSharedPlan} initialPreferences={myPreferences} onUseTable={() => {setSharingOpen(false);navigate("table");}} /></details>}
        {view === "explore" ? (
          mode === "real" ? (
            <LocationAtlas
              context={locationContext}
              lowPower={lowPower}
              onDemo={openSample}
              onWaiter={() => setWaiterOpen(true)}
              discoveredVenues={discoveredVenues}
              selectedVenueId={selectedVenue.id}
              onOpenVenue={(id) => {dispatch({type:"select",venueId:id});openMenu();}}
            />
          ) : mode === "map" && sampleSelected && ranked.length > 0 ? (
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
                <button className="atlas-return" onClick={sampleSelected ? openMap : openRealMap}>
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
                <button className="mobile-neighborhood" onClick={sampleSelected ? openMap : openRealMap}>
                  <MapPin size={17} />
                  <span>
                    {sampleSelected ? "Brooklyn, a little closer" : locationContext.location.label}
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
                    <button aria-pressed={mode === "map"} onClick={sampleSelected ? openMap : openRealMap}>
                      <Map size={14} /> Map
                    </button>
                  </div>
                </div>
                {!ranked.length ? (
                  <div className="empty-discovery">
                    <Leaf size={40} />
                    <h2>Let’s make a little room.</h2>
                    <p>
                      No restaurant meets the table’s current choices.
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
                        Reconsider {getVenue(state, id)?.name}{" "}
                        <Plus size={14} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <MenuBook
                    chosen={state.plan.venueId === selectedVenue.id}
                    venue={selectedVenue}
                    nextVenue={adjacentVenue(1)}
                    previousVenue={adjacentVenue(-1)}
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
                  <span>{sampleSelected ? "SAMPLE EVENING · FICTIONAL PLACES" : "REAL PLACES · DETAILS TO CONFIRM"}</span>
                  <p>
                    {mode === "book"
                      ? "Turn a page. Find a feeling."
                      : "Choose a pin. Meet your next favorite."}{" "}
                    <span>✳</span>
                  </p>
                  <span>{sampleSelected ? "THE BROOKLYN EDITION · VOL. 01" : "YOUR EVENING, TAKING SHAPE"}</span>
                </div>
              </div>
            </section>
          )
        ) : view === "table" ? (
          <SharedTable
            lowPower={lowPower}
            state={state}
            dispatch={dispatch}
            onExplore={openMenu}
            onPlan={() => navigate("plan")}
            sharedTable={shared.table ?? undefined}
            sharedBusy={shared.busy || editor.applying}
            sharedHasDraft={Boolean(editor.draft)}
          />
        ) : (
          <DinnerPlan
            lowPower={lowPower}
            storageAvailable={storageAvailable}
            state={state}
            dispatch={dispatch}
            onExplore={openMenu}
            onTable={() => navigate("table")}
            sharedTable={shared.table ?? undefined}
            sharedBusy={shared.busy || editor.applying}
            sharedHasDraft={Boolean(editor.draft)}
            sharedOnline={shared.status === "connected"}
          />
        )}
        {view === "plan" && <div className="evening-extras"><WeatherCard latitude={weatherArea.latitude} longitude={weatherArea.longitude} locationLabel={weatherArea.label} date={state.plan.date} time={state.plan.time} persistCache={locationContext.location.source !== "device" || Boolean(plannedVenue?.latitude)} /><BookingCard venue={plannedVenue??null} date={state.plan.date} time={state.plan.time} partySize={state.participants.length} /></div>}
        {view === "explore" && <div className="weather-on-map"><WeatherCard compact latitude={locationContext.location.latitude} longitude={locationContext.location.longitude} locationLabel={locationContext.location.label} date={state.plan.date} time={state.plan.time} persistCache={locationContext.location.source !== "device"} /></div>}
        {state.vetoes.length > 0 && view === "explore" && ranked.length > 0 && (
          <div className="passed-places">
            <span>Passed for now</span>
            {state.vetoes.map((id) => (
              <button
                key={id}
                onClick={() => dispatch({ type: "undo-veto", venueId: id })}
              >
                {getVenue(state, id)?.name}
                <Plus size={12} />
                <span className="sr-only">Undo pass</span>
              </button>
            ))}
          </div>
        )}
      </main>
      <Waiter
        sharedTableId={shared.table?.id}
        canEditPlan={!shared.table || shared.table.ownerId === shared.table.viewerId}
        state={state}
        dispatch={dispatch}
        view={view}
        mode={mode}
        realLocation={
          mode === "real" ? locationContext.location.label : undefined
        }
        realPoint={mode === "real" ? locationContext.selectedPoint : null}
        realPointKept={Boolean(
          locationContext.selectedPoint &&
          locationContext.savedPoints.some(
            (point) => point.id === locationContext.selectedPoint?.id,
          ),
        )}
        onKeepRealPoint={() => {
          if (locationContext.selectedPoint)
            locationContext.toggleSavedPoint(locationContext.selectedPoint);
        }}
        lowPower={lowPower}
        storageAvailable={storageAvailable}
        open={waiterOpen}
        onOpenChange={setWaiterOpen}
        onNavigate={(next) =>
          next === "explore" ? openRealMap() : navigate(next)
        }
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
            About Common Table <ArrowUpRight size={11} />
          </button>
        </div>
        <span>
          {shared.table ? shared.status === "connected" ? "Your shared table is connected." : "Offline table copy · drafts stay on this device." : storageSaving ? "Saving your device draft…" : storageAvailable
            ? "Your evening stays on this device."
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
          aria-label="Close about Common Table"
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
        <p>Explore real geography, find restaurants for your table, and carry the same place into a menu and dinner plan. The sample evening uses fictional Brooklyn restaurants and illustrative menus, prices and photography.</p>
        <p>Sign in to create private invitation links. Every member controls their own preferences and approves the current plan. Plans and offline drafts are stored on this device; shared tables also use secure server storage.</p>
        <p>The Waiter offers guidance when live service is configured. Availability is shown before you send a question. Restaurant discovery and weather show unavailable states when their services cannot connect. Always confirm prices, dietary needs and reservation availability directly with the restaurant.</p>
        <p>Your device location is requested only when you choose it. Nothing is invited, booked or shared automatically. <a href="/data-credits.html" target="_blank" rel="noreferrer">Data credits</a></p>
        <button className="primary-button" onClick={() => setAbout(false)}>
          Pull up a chair <ArrowRight size={16} />
        </button>
      </dialog>
    </div>
  );
}
