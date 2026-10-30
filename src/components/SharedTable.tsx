import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type PointerEvent,
  type CSSProperties,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Plus,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import {
  type Action,
  type AppState,
  venues,
  rankVenues,
  tasteOptions,
  restrictionOptions,
} from "../domain";
import "./table-plan.css";
import "./shared-table-cinematic.css";
import { playInteractionSound } from "../experience/interactionSound";

interface SharedTableProps {
  state: AppState;
  dispatch: Dispatch<Action>;
  onExplore: () => void;
  onPlan: () => void;
  lowPower?: boolean;
}
const tastes = [...tasteOptions, "Cozy", "Lively"];
const restrictions = restrictionOptions;
const colors = [
  "#b45c3d",
  "#778264",
  "#b49c65",
  "#7b8d9a",
  "#987c87",
  "#8d755c",
];

export function SharedTable({
  state,
  dispatch,
  onExplore,
  onPlan,
  lowPower = false,
}: SharedTableProps) {
  const [editingId, setEditingId] = useState(state.participants[0]?.id || "");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [arrivingId, setArrivingId] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const editorHeadingRef = useRef<HTMLHeadingElement>(null);
  const editorRevealFrame = useRef<number | null>(null);
  const editing =
    state.participants.find((p) => p.id === editingId) || state.participants[0];
  const ranked = rankVenues(state);
  const eligible = new Set(ranked.map((r) => r.venue.id));
  const shortlist = venues.filter((v) => state.shortlist.includes(v.id));
  const chosenVenue = venues.find((v) => v.id === state.plan.venueId);
  useEffect(() => {
    if (adding) nameRef.current?.focus();
  }, [adding]);
  useEffect(() => {
    if (!arrivingId) return;
    const timer = window.setTimeout(() => setArrivingId(null), 850);
    return () => window.clearTimeout(timer);
  }, [arrivingId]);
  useEffect(() => {
    if (lowPower) resetPerspective();
  }, [lowPower]);
  useEffect(() => cancelEditorReveal, []);
  function cancelEditorReveal() {
    if (editorRevealFrame.current !== null) {
      window.cancelAnimationFrame(editorRevealFrame.current);
      editorRevealFrame.current = null;
    }
  }
  function selectParticipant(id: string) {
    setEditingId(id);
    setAdding(false);
    cancelEditorReveal();
    if (!window.matchMedia("(max-width: 620px)").matches) return;
    // Wait for the selected name and any previously hidden editor to commit.
    editorRevealFrame.current = window.requestAnimationFrame(() => {
      editorRevealFrame.current = null;
      const heading = editorHeadingRef.current;
      if (!heading) return;
      const instant =
        lowPower ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({
        behavior: instant ? "instant" : "smooth",
        block: "start",
      });
    });
  }
  function resetPerspective() {
    stageRef.current?.style.removeProperty("--ct-table-pitch");
    stageRef.current?.style.removeProperty("--ct-table-yaw");
    stageRef.current?.style.removeProperty("--ct-light-x");
  }
  function movePerspective(event: PointerEvent<HTMLDivElement>) {
    if (
      lowPower ||
      event.pointerType !== "mouse" ||
      !window.matchMedia(
        "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
      ).matches
    )
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    event.currentTarget.style.setProperty(
      "--ct-table-pitch",
      `${10 - y * 3}deg`,
    );
    event.currentTarget.style.setProperty("--ct-table-yaw", `${x * 3}deg`);
    event.currentTarget.style.setProperty("--ct-light-x", `${43 + x * 9}%`);
  }
  function cancelAdd() {
    cancelEditorReveal();
    setAdding(false);
    setName("");
    addRef.current?.focus();
  }
  function addGuest(event: FormEvent) {
    event.preventDefault();
    cancelEditorReveal();
    const cleanName = name.trim();
    if (!cleanName || state.participants.length >= 6) return;
    const id = `guest-${crypto.randomUUID()}`;
    dispatch({
      type: "add-participant",
      participant: {
        id,
        name: cleanName,
        color: colors[state.participants.length % colors.length],
        tastes: [],
        budget: 65,
        restrictions: [],
      },
    });
    playInteractionSound("seat");
    setEditingId(id);
    setArrivingId(id);
    setAdding(false);
    setName("");
    requestAnimationFrame(() => document.getElementById(`seat-${id}`)?.focus());
    setMessage(
      `${cleanName} added as a local demo guest. No invitation was sent.`,
    );
  }
  function toggle(field: "tastes" | "restrictions", value: string) {
    if (!editing) return;
    const current = editing[field];
    dispatch({
      type: "update-participant",
      id: editing.id,
      changes: {
        [field]: current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value],
      },
    });
  }
  const seatPositions = state.participants.map((_, index) => {
    const angle =
      ((90 + (index * 360) / state.participants.length) * Math.PI) / 180;
    return {
      x: 50 + 32 * Math.cos(angle),
      y: 50 + (state.participants.length === 1 ? 28 : 31) * Math.sin(angle),
      turn: (index * 360) / state.participants.length,
    };
  });
  return (
    <section
      className={`tp-scene tp-table-scene ct-cinematic-table ${state.participants.length === 1 ? "tp-solo" : ""} ${state.participants.length >= 5 ? "tp-many" : ""}`}
      aria-labelledby="table-heading"
      data-low-power={lowPower || undefined}
    >
      <div className="tp-section-head">
        <div>
          <span className="tp-eyebrow">02 / MAKE ROOM</span>
          <h2 id="table-heading">
            Good company.
            <br />
            <em>Common ground.</em>
          </h2>
        </div>
        <p>
          A little give and take.
          <br />A place everyone can love.
        </p>
      </div>
      {chosenVenue && (
        <article className="tp-chosen-venue">
          <img src={chosenVenue.image} alt="" />
          <div>
            <span className="tp-eyebrow">FOR YOUR EVENING</span>
            <h3>{chosenVenue.name}</h3>
            <p>
              {chosenVenue.neighborhood} · {chosenVenue.cuisine} · $
              {chosenVenue.price} / person
            </p>
          </div>
          <button className="tp-outline" onClick={onPlan}>
            Dinner plan <ArrowRight size={15} />
          </button>
        </article>
      )}
      <div className="tp-table-layout">
        <div className="tp-table-side">
          <div
            className="ct-table-stage"
            ref={stageRef}
            onPointerMove={movePerspective}
            onPointerLeave={resetPerspective}
          >
            <div className="ct-stage-inscription" aria-hidden="true">
              <span>THE EVENING BEGINS HERE</span>
              <i>
                {chosenVenue
                  ? chosenVenue.name
                  : "A little space for good company."}
              </i>
            </div>
            <div className="ct-table-halo" aria-hidden="true" />
            <div
              className="tp-table-top"
              role="group"
              aria-label={`Your table has ${state.participants.length} ${state.participants.length === 1 ? "seat" : "seats"}`}
              aria-describedby="table-seat-hint"
            >
              <div className="ct-linen-fold" aria-hidden="true" />
              <div className="tp-table-center">
                <svg
                  className="ct-table-sprig"
                  viewBox="0 0 130 110"
                  aria-hidden="true"
                >
                  <path
                    d="M40 100Q68 65 93 17"
                    fill="none"
                    stroke="#62684a"
                    strokeWidth="2"
                  />
                  <path
                    d="M57 76Q26 71 33 46Q57 50 57 76M69 57Q89 64 109 43Q87 31 69 57M82 35Q57 35 63 13Q82 17 82 35M92 20Q107 21 116 5Q98 0 92 20"
                    fill="#747e53"
                  />
                  <path
                    d="M60 75L38 54M75 55L100 45M82 35L68 18"
                    stroke="#a5ac79"
                    fill="none"
                  />
                </svg>
                <div className="ct-candle-holder" aria-hidden="true">
                  <div className="tp-candle">
                    <span />
                  </div>
                </div>
                <span className="tp-table-script">
                  a table for
                  <br />
                  <strong>
                    {["one", "one", "two", "three", "four", "five", "six"][
                      state.participants.length
                    ] || state.participants.length}
                  </strong>
                </span>
              </div>
              {state.participants.map((person, i) => (
                <button
                  id={`seat-${person.id}`}
                  key={person.id}
                  className={`tp-seat ${editing?.id === person.id ? "is-active" : ""} ${arrivingId === person.id ? "ct-seat-arriving" : ""}`}
                  style={{
                    left: `${seatPositions[i]?.x || 50}%`,
                    top: `${seatPositions[i]?.y || 50}%`,
                    ...({
                      "--ct-seat-turn": `${seatPositions[i]?.turn || 0}deg`,
                      "--ct-napkin": person.color,
                    } as CSSProperties),
                  }}
                  onClick={() => selectParticipant(person.id)}
                  aria-label={`${person.name}${i > 0 ? " DEMO GUEST" : ""} — Edit ${person.name}'s tastes`}
                  aria-pressed={editing?.id === person.id}
                >
                  <span className="ct-setting-props" aria-hidden="true">
                    <span className="ct-dining-chair" />
                    <svg className="ct-cutlery ct-fork" viewBox="0 0 18 100">
                      <path d="M3 2v20m4-20v20m4-20v20m4-20v20M3 17v10c0 8 12 8 12 0V17M9 34v58" />
                      <path d="M8 60h2l2 33c0 6-6 6-6 0Z" />
                    </svg>
                    <svg className="ct-cutlery ct-knife" viewBox="0 0 18 100">
                      <path d="M7 2Q15 21 11 43L7 46Z" />
                      <path d="M7 45h4l2 47c1 7-8 7-7 0Z" />
                    </svg>
                    <svg className="ct-wineglass" viewBox="0 0 44 88">
                      <path
                        d="M8 4H36L38 27C38 47 6 47 6 27Z"
                        fill="#f9edd311"
                        stroke="#e6ddbd"
                        strokeWidth="1.3"
                      />
                      <path
                        d="M7 24Q21 20 37 24L37 29C34 44 10 44 7 29Z"
                        fill="#8f482b55"
                      />
                      <path
                        d="M22 43v34M8 81Q22 73 36 81Z"
                        fill="#f9edd318"
                        stroke="#e6ddbd"
                        strokeWidth="1.2"
                      />
                      <path
                        d="M12 8L10 26Q10 34 15 36"
                        fill="none"
                        stroke="#fff8de99"
                        strokeWidth="2"
                      />
                    </svg>
                    <span className="tp-plate">
                      <span
                        className="tp-napkin"
                        style={{ backgroundColor: person.color }}
                      />
                      <span
                        className="tp-monogram"
                        data-initial={person.name.slice(0, 1)}
                      />
                    </span>
                  </span>
                  <span className="tp-seat-name">
                    <span className="tp-seat-label">{person.name}</span>
                    {i > 0 && <small aria-hidden="true">DEMO GUEST</small>}
                    {editing?.id === person.id && (
                      <span className="ct-place-card-rule" aria-hidden="true" />
                    )}
                  </span>
                </button>
              ))}
            </div>
            <p id="table-seat-hint" className="ct-table-hint">
              Choose a place card. Make yourself at home.
            </p>
            <div className="ct-stage-edge" aria-hidden="true">
              <span>COMMON TABLE</span>
              <span>
                {String(state.participants.length).padStart(2, "0")} / 06 PLACES
                SET
              </span>
            </div>
          </div>
          <div className="tp-table-caption">
            <Users size={15} />
            <span>
              {state.participants.length === 1
                ? "A lovely dinner starts with you."
                : "A shared table, simulated on this device."}
            </span>
          </div>
          <button
            ref={addRef}
            className="tp-outline"
            onClick={() => {
              setAdding(true);
              setMessage("");
            }}
            disabled={state.participants.length >= 6}
          >
            <Plus size={16} /> Add a demo guest
          </button>
          <p className="tp-fine">
            Local prototype · no invitations are sent. Up to six seats.
          </p>
        </div>
        <div className="tp-preferences">
          <div className="tp-mobile-guests" aria-label="Choose a seat to edit">
            {state.participants.map((person) => (
              <button
                key={person.id}
                onClick={() => selectParticipant(person.id)}
                aria-pressed={person.id === editing?.id}
              >
                <span style={{ backgroundColor: person.color }}>
                  {person.name.slice(0, 1)}
                </span>
                {person.name}
              </button>
            ))}
            <button
              onClick={() => setAdding(true)}
              disabled={state.participants.length >= 6}
            >
              <Plus size={13} /> Guest
            </button>
          </div>
          {adding ? (
            <form
              onSubmit={addGuest}
              className="tp-guest-form"
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelAdd();
              }}
            >
              <span className="tp-eyebrow">PULL UP A CHAIR</span>
              <h3>A name for the place card.</h3>
              <label htmlFor="guest-name">Guest’s name</label>
              <input
                ref={nameRef}
                id="guest-name"
                value={name}
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Maya"
                required
                autoComplete="off"
              />
              <p className="tp-fine">
                You’ll set their preferences here. This creates a local demo
                guest, not a real invitation.
              </p>
              <div className="tp-form-actions">
                <button
                  type="button"
                  className="tp-text-button"
                  onClick={cancelAdd}
                >
                  Cancel
                </button>
                <button
                  className="tp-dark-button"
                  type="submit"
                  disabled={!name.trim()}
                >
                  Set their place <ArrowRight size={15} />
                </button>
              </div>
            </form>
          ) : (
            editing && (
              <div>
                <div className="tp-preference-head">
                  <span className="tp-eyebrow">
                    <SlidersHorizontal size={13} /> {editing.name.toUpperCase()}
                    ’S TASTES
                  </span>
                  {editing.id !== state.participants[0]?.id && (
                    <button
                      className="tp-icon-button"
                      title={`Remove ${editing.name}`}
                      aria-label={`Remove ${editing.name} from the table`}
                      onClick={() => {
                        cancelEditorReveal();
                        dispatch({
                          type: "remove-participant",
                          id: editing.id,
                        });
                        setEditingId(state.participants[0]?.id || "");
                        setMessage(`${editing.name} removed from the table.`);
                        requestAnimationFrame(() =>
                          document
                            .getElementById(`seat-${state.participants[0]?.id}`)
                            ?.focus(),
                        );
                      }}
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <h3
                  id="table-taste-editor-heading"
                  className="ct-taste-editor-heading"
                  ref={editorHeadingRef}
                  tabIndex={-1}
                  aria-label={`${editing.name}’s tastes: What sounds good?`}
                >
                  What sounds good?
                </h3>
                <p className="tp-subtext">
                  Pick a few. We’ll find the overlap.
                </p>
                <fieldset className="tp-chip-field">
                  <legend>Favorite cuisines & moods</legend>
                  {tastes.map((taste) => (
                    <button
                      key={taste}
                      className={`tp-chip ${editing.tastes.includes(taste) ? "selected" : ""}`}
                      onClick={() => toggle("tastes", taste)}
                      aria-pressed={editing.tastes.includes(taste)}
                    >
                      {editing.tastes.includes(taste) && <Check size={12} />}{" "}
                      {taste}
                    </button>
                  ))}
                </fieldset>
                <label className="tp-budget-label" htmlFor="guest-budget">
                  Comfortable spend{" "}
                  <strong>
                    ${editing.budget}
                    <small> / person</small>
                  </strong>
                </label>
                <input
                  id="guest-budget"
                  className="tp-range"
                  type="range"
                  min="20"
                  max="150"
                  step="5"
                  value={editing.budget}
                  onChange={(e) =>
                    dispatch({
                      type: "update-participant",
                      id: editing.id,
                      changes: { budget: Number(e.target.value) },
                    })
                  }
                />
                <div className="tp-range-labels">
                  <span>$20 · easy evening</span>
                  <span>$150 · occasion</span>
                </div>
                <fieldset className="tp-chip-field tp-diet-field">
                  <legend>Dietary needs</legend>
                  {restrictions.map((restriction) => (
                    <button
                      key={restriction}
                      className={`tp-chip ${editing.restrictions.includes(restriction) ? "selected" : ""}`}
                      onClick={() => toggle("restrictions", restriction)}
                      aria-pressed={editing.restrictions.includes(restriction)}
                    >
                      {restriction}
                    </button>
                  ))}
                </fieldset>
                <p className="tp-fine">
                  Demo suitability only. Confirm ingredients and allergy safety
                  with the restaurant.
                </p>
              </div>
            )
          )}
        </div>
      </div>
      <div className="tp-shortlist">
        <div className="tp-shortlist-header">
          <div>
            <span className="tp-eyebrow">THE CONVERSATION SO FAR</span>
            <h3>
              Your contenders <span>({shortlist.length})</span>
            </h3>
          </div>
          <span className="tp-fine">{ranked.length} places fit this table</span>
        </div>
        {shortlist.length ? (
          <div className="tp-contenders">
            {shortlist.map((venue) => (
              <article key={venue.id} className="tp-contender">
                <img src={venue.image} alt="" loading="lazy" />
                <div>
                  <h4>{venue.name}</h4>
                  <p>
                    {venue.cuisine} · ${venue.price} / person
                  </p>
                  <span
                    className={eligible.has(venue.id) ? "tp-fit" : "tp-no-fit"}
                  >
                    {eligible.has(venue.id)
                      ? "Fits your table"
                      : "Outside current needs or vetoed"}
                  </span>
                </div>
                <button
                  className="tp-icon-button"
                  onClick={() =>
                    dispatch({ type: "shortlist", venueId: venue.id })
                  }
                  aria-label={`Remove ${venue.name} from contenders`}
                >
                  <X size={14} />
                </button>
                <button
                  className="tp-outline tp-contender-choose"
                  disabled={!eligible.has(venue.id)}
                  onClick={() => {
                    dispatch({ type: "choose-plan", venueId: venue.id });
                    onPlan();
                  }}
                >
                  Choose <ArrowRight size={14} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="tp-empty">
            <span>
              {chosenVenue
                ? "An evening is taking shape."
                : "A little room for possibility."}
            </span>
            <p>
              {chosenVenue
                ? "Your chosen place is above. Bookmark other restaurants to compare them here."
                : "Bookmark a restaurant in the menu. It will be waiting here."}
            </p>
            <button className="tp-text-button" onClick={onExplore}>
              Explore the menu <ArrowRight size={15} />
            </button>
          </div>
        )}
        {!ranked.length && (
          <p className="tp-fit-warning" role="status">
            No demo venues fit every budget and dietary need. Try a different
            budget or review the vetoes in Explore.
          </p>
        )}
      </div>
      <div className="tp-bottom-actions">
        <button className="tp-text-button" onClick={onExplore}>
          <ArrowLeft size={15} /> Back to exploring
        </button>
        {state.plan.venueId && (
          <button className="tp-dark-button" onClick={onPlan}>
            See your dinner plan <ArrowRight size={16} />
          </button>
        )}
      </div>
      <p className="tp-live" role="status">
        {message}
      </p>
    </section>
  );
}

export default SharedTable;
