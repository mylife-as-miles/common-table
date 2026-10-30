import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  BookOpen,
  Check,
  ChevronDown,
  ClipboardList,
  Compass,
  Leaf,
  Send,
  Shuffle,
  Users,
  X,
} from "lucide-react";
import {
  type AppAction,
  type AppState,
  rankVenues,
  venues,
  planValidationErrors,
} from "../domain";
import "./waiter.css";

type View = "explore" | "table" | "plan";
type Course = "place" | "table" | "evening";
interface WaiterProps {
  state: AppState;
  dispatch: Dispatch<AppAction>;
  view: View;
  mode: "map" | "book" | "real";
  realLocation?: string;
  realPoint?: {
    name: string;
    category: "food" | "coffee" | "outdoors" | "other";
    id: string;
  } | null;
  onKeepRealPoint?: () => void;
  realPointKept?: boolean;
  lowPower: boolean;
  storageAvailable: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (view: View) => void;
  onOpenMenu: () => void;
  onSelectVenue: (id: string) => void;
}

/** An original little brass service bell. All motion is a short, user-initiated gesture. */
function BellWaiter({ compact = false }: { compact?: boolean }) {
  const id = compact ? "cw-small" : "cw-large";
  return (
    <svg
      className={`cw-bell-art ${compact ? "cw-bell-small" : ""}`}
      viewBox="0 0 220 180"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`${id}-brass`}
          x1="41"
          y1="60"
          x2="169"
          y2="129"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#918553" />
          <stop offset=".24" stopColor="#DED09B" />
          <stop offset=".46" stopColor="#EEE0AC" />
          <stop offset=".77" stopColor="#BBAC74" />
          <stop offset="1" stopColor="#82764D" />
        </linearGradient>
        <linearGradient
          id={`${id}-rim`}
          x1="21"
          y1="131"
          x2="196"
          y2="146"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#6F7254" />
          <stop offset=".47" stopColor="#CED0AF" />
          <stop offset="1" stopColor="#555E46" />
        </linearGradient>
        <linearGradient
          id={`${id}-cloth`}
          x1="151"
          y1="117"
          x2="174"
          y2="169"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFFCED" />
          <stop offset="1" stopColor="#D2C9A9" />
        </linearGradient>
        <radialGradient id={`${id}-shadow`}>
          <stop stopColor="#131E13" stopOpacity=".3" />
          <stop offset="1" stopColor="#131E13" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="112" cy="158" rx="96" ry="17" fill={`url(#${id}-shadow)`} />
      <path
        d="M44 110C28 110 22 120 26 128C30 133 37 133 43 128"
        stroke="#4E5B3D"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M171 110C189 108 199 117 194 128C190 135 180 134 177 130"
        stroke="#4E5B3D"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <g className="cw-bell-dome">
        <ellipse cx="110" cy="48" rx="14" ry="6" fill="#676349" />
        <path
          d="M103 47V36C103 31 117 31 117 36V47"
          fill={`url(#${id}-brass)`}
          stroke="#9F9467"
        />
        <ellipse cx="110" cy="35" rx="12" ry="4" fill="#E4D7AA" />
        <path
          d="M44 119C45 81 65 52 110 52C155 52 175 81 176 119L163 125H56L44 119Z"
          fill={`url(#${id}-brass)`}
          stroke="#93885E"
          strokeWidth="1.2"
        />
        <path
          d="M58 100C62 76 81 62 98 61"
          stroke="#FFEDBD"
          strokeOpacity=".6"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path d="M53 115H167" stroke="#F4E7B5" strokeOpacity=".65" />
        <path
          d="M79 85C83 82 88 82 92 85M122 85C126 82 131 82 135 85"
          stroke="#655E40"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <ellipse cx="86" cy="93" rx="2.4" ry="3.2" fill="#4B4D35" />
        <ellipse cx="128" cy="93" rx="2.4" ry="3.2" fill="#4B4D35" />
        <path
          d="M107 102C100 96 96 101 91 106C99 108 104 107 107 104C110 108 116 108 124 106C119 101 114 97 107 102Z"
          fill="#55593B"
        />
        <path
          d="M101 112C105 115 111 115 115 112"
          stroke="#665B3B"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <ellipse
          cx="69"
          cy="102"
          rx="6"
          ry="3"
          fill="#AD7350"
          fillOpacity=".18"
        />
        <ellipse
          cx="145"
          cy="102"
          rx="6"
          ry="3"
          fill="#AD7350"
          fillOpacity=".18"
        />
      </g>
      <ellipse cx="110" cy="133" rx="88" ry="10" fill="#D0D0AD" />
      <path
        d="M22 132C22 140 61 149 110 149C159 149 198 140 198 132V137C198 146 159 153 110 153C61 153 22 146 22 137V132Z"
        fill={`url(#${id}-rim)`}
      />
      <ellipse
        cx="110"
        cy="132"
        rx="88"
        ry="9"
        stroke="#DADEC1"
        strokeWidth="2"
      />
      <path
        d="M94 126L104 131L94 137V126ZM119 126L109 131L119 137V126Z"
        fill="#52603D"
      />
      <circle cx="107" cy="132" r="3.5" fill="#39482B" />
      <path
        d="M153 121L176 123L173 167L164 163L157 169L151 161L153 121Z"
        fill={`url(#${id}-cloth)`}
        stroke="#C4BEA0"
        strokeWidth=".6"
      />
      <path
        d="M160 125L158 157M168 126L165 159"
        stroke="#ADA88F"
        strokeOpacity=".4"
      />
      <path
        d="M153 151L174 153"
        stroke="#A36B49"
        strokeWidth="2"
        strokeOpacity=".7"
      />
      {!compact && (
        <>
          <path
            className="cw-ring-mark"
            d="M41 49L33 43M179 49L188 43M30 65L22 63M190 65L198 63"
            stroke="#D8DDB8"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M59 144C59 147 63 149 67 148M152 148C156 149 160 147 160 144"
            stroke="#F3EDD2"
            strokeOpacity=".5"
          />
        </>
      )}
    </svg>
  );
}

export function Waiter({
  state,
  dispatch,
  view,
  mode,
  realLocation,
  realPoint,
  onKeepRealPoint,
  realPointKept = false,
  lowPower,
  storageAvailable,
  open,
  onOpenChange,
  onNavigate,
  onOpenMenu,
  onSelectVenue,
}: WaiterProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const requestInput = useRef<HTMLInputElement>(null);
  const seenVenues = useRef(new Set<string>());
  const navigating = useRef(false);
  const ringTip = useRef(0);
  const [course, setCourse] = useState<Course>("place");
  const [why, setWhy] = useState(false);
  const [request, setRequest] = useState("");
  const [response, setResponse] = useState("");
  const [ring, setRing] = useState(0);
  const ranked = rankVenues(state);
  const selected =
    venues.find((v) => v.id === state.selectedVenueId) || venues[0];
  const planned = venues.find((v) => v.id === state.plan.venueId);
  const selectedMatch = ranked.find((v) => v.venue.id === selected.id);
  const alternatives = ranked.filter((v) => v.venue.id !== selected.id);
  const minimumBudget = Math.min(...state.participants.map((p) => p.budget));
  const dietaryNeeds = [
    ...new Set(state.participants.flatMap((p) => p.restrictions)),
  ];
  const shortListed = state.shortlist.includes(selected.id);
  const validation = planValidationErrors(state);
  const detailErrors = validation.filter((v) => !/approv|restaurant/i.test(v));
  const allAgreed = state.participants.every((person) =>
    state.plan.approvals.includes(person.id),
  );
  const realCategory = realPoint
    ? {
        food: "Food & drink",
        coffee: "Coffee",
        outdoors: "Outdoors",
        other: "Mapped place",
      }[realPoint.category]
    : "Area guide";
  const realName = realPoint?.name || realLocation || "Your chosen area";

  // A previously displayed response must not describe the place the user left.
  useEffect(() => {
    setResponse("");
    setWhy(false);
    ringTip.current = 0;
  }, [mode, realPoint?.id, realLocation]);

  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) {
      navigating.current = false;
      seenVenues.current = new Set([state.selectedVenueId]);
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setCourse(
        view === "table" ? "table" : view === "plan" ? "evening" : "place",
      );
      setWhy(false);
      setRequest("");
      setResponse("");
      setRing((value) => value + 1);
      dialog.current.showModal();
    } else if (!open && dialog.current?.open) {
      dialog.current.close();
      if (!navigating.current)
        (opener.current?.isConnected
          ? opener.current
          : launcher.current
        )?.focus({ preventScroll: true });
    }
  }, [open, view]);

  function close() {
    onOpenChange(false);
  }
  function closeForNavigation() {
    navigating.current = true;
    dialog.current?.close();
    onOpenChange(false);
  }
  function navigate(next: View) {
    closeForNavigation();
    onNavigate(next);
  }
  function openMenu() {
    closeForNavigation();
    onOpenMenu();
  }
  function ringBell() {
    setRing((value) => value + 1);
    if (mode === "real" && course === "place") {
      setResponse(
        realPoint
          ? `${realPoint.name} is a real mapped ${realCategory.toLowerCase()} place from OpenStreetMap${realLocation ? ` in ${realLocation}` : ""}. I can help keep this point; prices, menus, dietary fit, and bookings are not connected. Your demo dinner plan stays as it was.`
          : `You’re exploring ${realLocation || "your chosen area"} on OpenStreetMap. Pick a named mapped place for a closer look. Your fictional demo table and dinner plan stay as they were.`,
      );
      return;
    }
    const tips =
      course === "table"
        ? [
            `At your service. ${ranked.length} demo places fit every seat. The table’s tightest budget is $${minimumBudget} per person.`,
            "A little give and take goes a long way. Each seat keeps its own tastes, budget, and dietary needs.",
            "Need another chair? The shared table can hold up to six local demo guests.",
          ]
        : course === "evening"
          ? [
              planned
                ? `Your evening has a place: ${planned.name}. Next: ${eveningNext.toLowerCase()}.`
                : "A place comes first. Choose one from the menu and I’ll help you put an evening around it.",
              "A saved plan is a lovely start. It isn’t a reservation; nothing is booked or sent.",
              storageAvailable
                ? "Your plan stays in this browser. Copy or download it when you’re ready to share the details."
                : "This session has no browser storage. Download your plan to keep a copy.",
            ]
          : [
              `A little service, gladly. ${selected.name} is ${selectedMatch ? "within the table’s current budget and listed dietary needs" : "outside the table’s current needs"}.`,
              alternatives.length
                ? `${alternatives.length} other ${alternatives.length === 1 ? "place fits" : "places fit"} this table. Ask for another possibility and we’ll turn a fresh page.`
                : "This is the only current fit. A budget or preference change can open up a few more doors.",
              "I use local demo tastes and venue notes. Qloo is not connected, and dietary details need confirmation with a restaurant.",
            ];
    setResponse(
      `${mode === "real" ? "For your separate fictional demo journey: " : ""}${tips[ringTip.current++ % tips.length]}`,
    );
  }
  function nextPossibility() {
    if (mode === "real") {
      setCourse("place");
      setResponse(
        `Choose another named place on the OpenStreetMap map to explore a different possibility${realPoint ? ` from ${realPoint.name}` : ""}. Real mapped places aren’t ranked against the table’s budgets or dietary needs. The fictional demo plan stays unchanged.`,
      );
      return;
    }
    seenVenues.current.add(selected.id);
    let candidate = alternatives.find(
      (item) => !seenVenues.current.has(item.venue.id),
    );
    if (!candidate && alternatives.length) {
      seenVenues.current = new Set([selected.id]);
      candidate = alternatives[0];
    }
    if (candidate) seenVenues.current.add(candidate.venue.id);
    if (!candidate) {
      setResponse(
        "This is the only demo place that fits every seat. Adjust the table’s tastes or budget to open up more possibilities.",
      );
      return;
    }
    onSelectVenue(candidate.venue.id);
    setCourse("place");
    setWhy(false);
    setResponse(
      `${candidate.venue.name} is now your browsing choice.${planned ? ` Your dinner plan at ${planned.name} stays as it was.` : " It fits every current budget and listed dietary need."}`,
    );
  }
  function keepPlace() {
    dispatch({ type: "shortlist", venueId: selected.id });
    setResponse(
      shortListed
        ? `${selected.name} is off your contenders. You can keep it again any time.`
        : `${selected.name} is kept with your contenders at the shared table.`,
    );
  }
  function keepMappedPlace() {
    if (!realPoint || !onKeepRealPoint) return;
    onKeepRealPoint();
    setResponse(
      `${realPoint.name}’s mapped-place keep was updated. No dinner plan, invitation, or reservation was created.`,
    );
  }
  function bringToTable(destination: View = "table") {
    if (!selectedMatch) {
      setResponse(
        "This place doesn’t currently fit every seat. Let’s adjust the table or try another possibility first.",
      );
      return;
    }
    dispatch({ type: "choose-plan", venueId: selected.id });
    navigate(destination);
  }
  function handleRequest(event: FormEvent) {
    event.preventDefault();
    const text = request.trim().toLowerCase();
    if (!text) {
      requestInput.current?.focus();
      return;
    }
    if (mode === "real") {
      setCourse("place");
      if (
        /reserv|booking|book a|invite|send|location shar|where am i/.test(text)
      ) {
        setResponse(
          `${realName} has no connected reservation, invitation, or location-sharing service here. Nothing is sent or booked. Your fictional demo plan remains separate.`,
        );
      } else if (
        /another|different|surprise|something else|new place/.test(text)
      ) {
        nextPossibility();
      } else if (/keep|bookmark|remember/.test(text)) {
        if (realPoint && realPointKept)
          setResponse(
            `${realPoint.name} is already kept as a mapped possibility. Your fictional demo shortlist and dinner plan stay separate.`,
          );
        else if (realPoint && onKeepRealPoint) keepMappedPlace();
        else
          setResponse(
            "Pick a named place on the real map first. Its mapped-place keep is separate from the fictional demo shortlist and dinner plan.",
          );
      } else if (
        /why|fit|match|diet|allerg|vegan|vegetarian|gluten|nut|budget|cheap|cost|price|spend|menu|hours|open/.test(
          text,
        )
      ) {
        setResponse(
          `${realName} is ${realPoint ? `an OpenStreetMap ${realCategory.toLowerCase()} point` : "an area on OpenStreetMap"}. That tells us its mapped name, category, and geography. I don’t have verified menus, prices, hours, allergy safety, or a taste or dietary fit for real places. Qloo is not connected.`,
        );
      } else if (
        /save|plan|tonight|dinner|finish|time|date|friend|guest|table|taste|together|group/.test(
          text,
        )
      ) {
        setResponse(
          `${realPoint ? `You can keep ${realPoint.name} as a mapped possibility. ` : "Choose a named mapped place to keep a possibility. "}Real places aren’t connected to dinner planning yet. The Our table and Tonight pages describe your separate fictional demo journey.`,
        );
      } else {
        setResponse(
          `I’m following ${realName} on the real map. Try “keep this place”, “another place”, or ask what’s known about it. Real menus, prices, ranking, and bookings aren’t connected.`,
        );
      }
      setRequest("");
      return;
    }
    if (/reserv|booking|book a|invite|send|location|where am i/.test(text)) {
      setCourse("evening");
      setResponse(
        "I can help shape a local dinner plan. Real reservations, invitations, and location sharing aren’t connected in this demo. Nothing is sent.",
      );
    } else if (/another|different|surprise|something else|new place/.test(text))
      nextPossibility();
    else if (
      /why|fit|match|diet|allerg|vegan|vegetarian|gluten|nut/.test(text)
    ) {
      setCourse("place");
      setWhy(true);
      setResponse(
        "Here’s the reasoning on my pad. It uses local demo metadata, not Qloo or an allergy guarantee.",
      );
    } else if (/budget|cheap|cost|price|spend/.test(text)) {
      setCourse("table");
      setResponse(
        `The tightest budget at this table is $${minimumBudget} per person. ${ranked.length} demo places fit everyone’s current limits. Change any seat’s budget at your table.`,
      );
    } else if (/friend|guest|table|taste|together|group/.test(text)) {
      setCourse("table");
      setResponse(
        "Let’s give every seat a say. The shared table holds your local demo guests, tastes, budgets, and dietary needs.",
      );
    } else if (/save|plan|tonight|dinner|finish|time|date/.test(text)) {
      setCourse("evening");
      setResponse(
        planned
          ? `Your place is ${planned.name}. ${detailErrors.length ? "The date or time still needs a little attention." : !allAgreed ? "Next, collect a local demo nod from each seat." : "The evening is ready to review and save."}`
          : "Pick a place first. Then we’ll put a date, a time, and a little agreement on the page.",
      );
    } else
      setResponse(
        "My little service menu covers places, table tastes, and dinner details. Try “why this place?”, “another place”, or “help finish tonight”.",
      );
    setRequest("");
  }
  const eveningNext = !planned
    ? "Choose a place"
    : detailErrors.length
      ? "Set the little details"
      : !allAgreed
        ? "A nod from each seat"
        : state.plan.saved
          ? "Your evening is kept"
          : "Ready to tuck away";

  return (
    <div className={`cw-companion ${lowPower ? "cw-low-power" : ""}`}>
      <div className="cw-summon">
        <span className="cw-summon-name">THE WAITER</span>
        <div className="cw-dock-copy">
          <span>AT YOUR SERVICE</span>
          <strong>The Waiter</strong>
          <p>
            {view === "plan"
              ? "A little help with the final details."
              : view === "table"
                ? "A little give and take. A lovely evening."
                : "A place, a taste, a little nudge."}
          </p>
        </div>
        <button
          className="cw-launcher"
          ref={launcher}
          onClick={() => onOpenChange(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="common-table-waiter"
        >
          <BellWaiter compact />
          <span>A little guidance</span>
          <span className="cw-launcher-arrow" aria-hidden="true">
            ↗
          </span>
        </button>
      </div>
      <dialog
        id="common-table-waiter"
        ref={dialog}
        className={`cw-dialog ${lowPower ? "cw-low-power" : ""}`}
        aria-label="The Waiter, at your service"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <section className="cw-tray" aria-label="The Waiter’s guidance">
          <div className="cw-service-scene">
            <div className="cw-service-heading">
              <span className="cw-kicker">A LITTLE THOUGHTFUL SERVICE</span>
              <h2>
                The Waiter<span>At your service.</span>
              </h2>
              <p>
                A place, a taste, a little nudge.
                <br />
                What can I bring to your evening?
              </p>
            </div>
            <button
              className="cw-character"
              onClick={ringBell}
              aria-label="Ring the service bell"
            >
              <span key={ring} className="cw-character-art">
                <BellWaiter />
              </span>
              <span className="cw-bell-invitation" aria-hidden="true">
                a little ring?
              </span>
            </button>
            <button
              className="cw-close"
              aria-label="Close guidance"
              onClick={close}
            >
              <X size={18} />
            </button>
            <span className="cw-service-number" aria-hidden="true">
              EST. A GOOD EVENING
            </span>
          </div>
          <div className="cw-pad">
            <div className="cw-pad-binding" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="cw-pad-head">
              <span>THE LITTLE SERVICE PAD</span>
              <span>
                NO. 0{course === "place" ? "1" : course === "table" ? "2" : "3"}
              </span>
            </div>
            <div
              className="cw-courses"
              role="group"
              aria-label="What can The Waiter help with?"
            >
              {(
                [
                  { id: "place", label: "A place", icon: Compass },
                  { id: "table", label: "Our table", icon: Users },
                  { id: "evening", label: "Tonight", icon: ClipboardList },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  aria-pressed={course === item.id}
                  onClick={() => {
                    setCourse(item.id);
                    setResponse("");
                  }}
                >
                  <item.icon size={14} />
                  {item.label}
                </button>
              ))}
            </div>
            {mode === "real" && course !== "place" && (
              <p className="cw-real-context">
                This page describes your fictional demo{" "}
                {course === "table" ? "table" : "dinner plan"}.{" "}
                {realPoint
                  ? `${realPoint.name} stays a separate mapped possibility.`
                  : "Real mapped places stay separate."}
              </p>
            )}
            {course === "place" && mode === "real" ? (
              <div className="cw-course-content">
                <span className="cw-order-kicker">
                  OPENSTREETMAP · REAL GEOGRAPHY
                </span>
                <h3>{realName}</h3>
                <div className="cw-geography-card">
                  <Compass size={23} />
                  <div>
                    <strong>{realCategory}</strong>
                    <span>{realLocation || "OpenStreetMap location"}</span>
                  </div>
                  <span className="cw-osm-stamp">OSM</span>
                </div>
                <p className="cw-guidance">
                  {realPoint
                    ? `“${realPoint.name} is on the real map. A possibility to keep and investigate, before we call it a dinner plan.”`
                    : "“Pick a named place on the real map. I’ll follow that place on my pad, without placing our fictional restaurants here.”"}
                </p>
                <p className="cw-small-note">
                  {realPoint
                    ? "Name, category, and geography come from OpenStreetMap. "
                    : "This is an area guide to OpenStreetMap geography. "}
                  Menus, prices, dietary safety, opening hours, availability,
                  and taste ranking are not verified or connected. Your
                  fictional demo table and dinner plan stay unchanged.
                </p>
                <div className="cw-pad-actions">
                  <button className="cw-secondary" onClick={close}>
                    Back to the map <Compass size={14} />
                  </button>
                  {realPoint ? (
                    <button
                      className="cw-primary"
                      onClick={keepMappedPlace}
                      aria-pressed={realPointKept}
                      disabled={!onKeepRealPoint}
                    >
                      <Bookmark
                        size={14}
                        fill={realPointKept ? "currentColor" : "none"}
                      />
                      {realPointKept
                        ? "Mapped place kept"
                        : "Keep mapped place"}
                    </button>
                  ) : (
                    <button className="cw-primary" onClick={openMenu}>
                      Open demo menu <BookOpen size={15} />
                    </button>
                  )}
                </div>
                {realPoint && (
                  <button className="cw-demo-link" onClick={openMenu}>
                    Try the fictional demo menu <ArrowRight size={12} />
                  </button>
                )}
              </div>
            ) : course === "place" ? (
              <div className="cw-course-content">
                <span className="cw-order-kicker">
                  {mode === "map"
                    ? "A PIN WORTH FOLLOWING"
                    : "A PAGE WORTH LINGERING ON"}
                </span>
                <h3>A good place to begin.</h3>
                <div className="cw-venue-note">
                  <img src={selected.image} alt="" />
                  <div>
                    <h4>{selected.name}</h4>
                    <p>
                      {selected.neighborhood}
                      <br />
                      {selected.cuisine} · ${selected.price} / person
                    </p>
                  </div>
                  <span className="cw-note-corner" aria-hidden="true" />
                </div>
                <p className="cw-guidance">
                  {selectedMatch
                    ? `“${selected.name} fits ${state.participants.length === 1 ? "your" : "everyone’s"} budget${dietaryNeeds.length ? " and listed dietary needs" : ""}. ${selected.tags.slice(0, 2).join(" and ")} sounds like a lovely place to start.”`
                    : "“This place needs another look. It doesn’t fit every current budget and dietary need, or the table has passed on it.”"}
                </p>
                <div className="cw-action-pair">
                  <button
                    onClick={() => setWhy(!why)}
                    aria-expanded={why}
                    aria-controls="cw-fit-reasons"
                  >
                    <Leaf size={15} />
                    <span>Why this place?</span>
                    <ChevronDown
                      size={14}
                      className={why ? "cw-rotated" : ""}
                    />
                  </button>
                  <button
                    onClick={nextPossibility}
                    disabled={!alternatives.length}
                  >
                    <Shuffle size={15} />
                    <span>Another possibility</span>
                    <ArrowUpRight size={14} />
                  </button>
                </div>
                {why && (
                  <div id="cw-fit-reasons" className="cw-reasons">
                    <span className="cw-order-kicker">
                      THE REASONING, ON THE RECORD
                    </span>
                    {selectedMatch ? (
                      <ul>
                        {selectedMatch.reasons.map((reason) => (
                          <li key={reason}>
                            <Check size={12} />
                            {reason}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>
                        No eligible match here. Review your table’s limits
                        before choosing this place.
                      </p>
                    )}
                    <p>
                      {dietaryNeeds.length
                        ? `The table lists ${dietaryNeeds.join(", ")}. `
                        : ""}
                      Fictional venue metadata. Confirm ingredients and allergy
                      safety with the restaurant. Qloo is not connected.
                    </p>
                  </div>
                )}
                <div className="cw-pad-actions">
                  <button
                    className="cw-secondary"
                    onClick={keepPlace}
                    aria-pressed={shortListed}
                    disabled={!selectedMatch}
                  >
                    <Bookmark
                      size={14}
                      fill={shortListed ? "currentColor" : "none"}
                    />
                    {shortListed
                      ? "Kept at the table"
                      : "Keep this possibility"}
                  </button>
                  <button className="cw-primary" onClick={openMenu}>
                    Open this menu <BookOpen size={15} />
                  </button>
                </div>
              </div>
            ) : course === "table" ? (
              <div className="cw-course-content">
                <span className="cw-order-kicker">EVERY SEAT HAS A SAY</span>
                <h3>Find our common ground.</h3>
                <div
                  className="cw-guests"
                  aria-label={`${state.participants.length} people at the table`}
                >
                  {state.participants.map((person) => (
                    <div key={person.id}>
                      <span
                        style={{ backgroundColor: person.color }}
                        aria-hidden="true"
                      >
                        {person.name.slice(0, 1)}
                      </span>
                      <b>{person.name}</b>
                    </div>
                  ))}
                </div>
                <p className="cw-guidance">
                  {mode === "real"
                    ? "“These are the tastes in your separate fictional demo table. Real mapped places haven’t been checked against these budgets or dietary needs.”"
                    : state.participants.length === 1
                      ? "“A table just for you is a very good table. Start with what you love; make room for company if you feel like it.”"
                      : "“Different tastes can make a better evening. I’ll only show places within every seat’s budget and listed dietary needs.”"}
                </p>
                <dl className="cw-table-notes">
                  <div>
                    <dt>The table’s ceiling</dt>
                    <dd>
                      ${minimumBudget}
                      <small> / person</small>
                    </dd>
                  </div>
                  <div>
                    <dt>Places that fit</dt>
                    <dd>
                      {ranked.length}
                      <small> demo venues</small>
                    </dd>
                  </div>
                  <div>
                    <dt>Dietary needs</dt>
                    <dd>
                      {dietaryNeeds.length
                        ? dietaryNeeds.join(", ")
                        : "None listed"}
                    </dd>
                  </div>
                </dl>
                <p className="cw-small-note">
                  Guests, preferences, and agreement are simulated on this
                  device. No invitations or responses are sent.
                </p>
                <div className="cw-pad-actions">
                  <button
                    className="cw-secondary"
                    onClick={() => {
                      setCourse("place");
                      setWhy(true);
                    }}
                  >
                    See the fit <Leaf size={14} />
                  </button>
                  <button
                    className="cw-primary"
                    onClick={() => navigate("table")}
                  >
                    Refine our tastes <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="cw-course-content">
                <span className="cw-order-kicker">
                  FROM A POSSIBILITY TO A PLAN
                </span>
                <h3>Help finish tonight.</h3>
                {planned ? (
                  <div className="cw-venue-note">
                    <img src={planned.image} alt="" />
                    <div>
                      <h4>{planned.name}</h4>
                      <p>
                        {state.plan.date} · {state.plan.time}
                        <br />
                        {state.participants.length}{" "}
                        {state.participants.length === 1 ? "seat" : "seats"} · $
                        {planned.price} / person
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="cw-guidance">
                    “An evening is still a blank page. Shall we start with{" "}
                    {selected.name}?”
                  </p>
                )}
                <ol className="cw-evening-steps">
                  <li className={planned ? "cw-done" : ""}>
                    <span>{planned ? <Check size={12} /> : "1"}</span>
                    <div>
                      A place you love
                      <small>
                        {planned ? planned.name : "Choose from the menu"}
                      </small>
                    </div>
                  </li>
                  <li
                    className={planned && !detailErrors.length ? "cw-done" : ""}
                  >
                    <span>
                      {planned && !detailErrors.length ? (
                        <Check size={12} />
                      ) : (
                        "2"
                      )}
                    </span>
                    <div>
                      The little details
                      <small>
                        {planned && !detailErrors.length
                          ? `${state.plan.date} at ${state.plan.time}`
                          : "Pick a future date and time"}
                      </small>
                    </div>
                  </li>
                  <li className={planned && allAgreed ? "cw-done" : ""}>
                    <span>
                      {planned && allAgreed ? <Check size={12} /> : "3"}
                    </span>
                    <div>
                      A nod around the table
                      <small>
                        {state.plan.approvals.length} /{" "}
                        {state.participants.length} local demo approvals
                      </small>
                    </div>
                  </li>
                  <li className={state.plan.saved ? "cw-done" : ""}>
                    <span>{state.plan.saved ? <Check size={12} /> : "4"}</span>
                    <div>
                      {storageAvailable
                        ? "An evening saved"
                        : "Kept for this session"}
                      <small>
                        {state.plan.saved
                          ? storageAvailable
                            ? "Saved in this browser; ready to export"
                            : "Download a copy to keep it"
                          : "Review, save, and export the plan"}
                      </small>
                    </div>
                  </li>
                </ol>
                <p className="cw-evening-next">
                  <span>NEXT ON THE PAD</span>
                  {eveningNext}
                </p>
                <div className="cw-pad-actions">
                  <button
                    className="cw-secondary"
                    onClick={() => navigate("table")}
                  >
                    Review our table <Users size={14} />
                  </button>
                  {planned ? (
                    <button
                      className="cw-primary"
                      onClick={() => navigate("plan")}
                    >
                      {state.plan.saved ? "See our evening" : "Finish the plan"}
                      <ArrowRight size={15} />
                    </button>
                  ) : (
                    <button
                      className="cw-primary"
                      onClick={() => bringToTable("plan")}
                      disabled={!selectedMatch}
                    >
                      Start with this place <ArrowRight size={15} />
                    </button>
                  )}
                </div>
              </div>
            )}
            {response && (
              <p className="cw-response" role="status">
                <Check size={13} />
                <span>{response}</span>
              </p>
            )}
            <form className="cw-request" onSubmit={handleRequest}>
              <label htmlFor="cw-small-request">Or leave a small request</label>
              <div>
                <input
                  ref={requestInput}
                  id="cw-small-request"
                  value={request}
                  maxLength={180}
                  onChange={(event) => setRequest(event.target.value)}
                  placeholder="e.g. why this place?"
                  autoComplete="off"
                />
                <button
                  type="submit"
                  aria-label="Ask The Waiter"
                  disabled={!request.trim()}
                >
                  <Send size={15} />
                </button>
              </div>
            </form>
            <p className="cw-disclosure">
              {mode === "real"
                ? "REAL MAP · LOCAL GUIDANCE"
                : "DEMO SERVICE · LOCAL GUIDANCE"}
              <span>
                {mode === "real"
                  ? "OpenStreetMap geography. No verified menus, fit ranking, or bookings."
                  : "Places, tastes & plans. No bookings, messages, or location sharing."}
              </span>
            </p>
          </div>
        </section>
      </dialog>
    </div>
  );
}
export default Waiter;
