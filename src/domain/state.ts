import { defaultParticipant, initialVenueId } from "./data";
import { getVenue, isDemoVenue, sanitizeVenueSnapshot, MAX_CATALOG_VENUES, venueVerificationWarnings } from "./catalog";
import { rankVenues, eligibilityReasons } from "./ranking";
import type { AppAction, AppState, Participant, Plan } from "./types";

export const STORAGE_KEY = "common-table.demo.v1";
export const MAX_PARTICIPANTS = 6;
const venueExists = (state: Pick<AppState, "catalog">, id: unknown): id is string =>
  typeof id === "string" && Boolean(getVenue(state, id));
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return localDate(date);
}
function isCalendarDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return (
    datePattern.test(value) &&
    !Number.isNaN(parsed.getTime()) &&
    localDate(parsed) === value
  );
}
export function createInitialState(): AppState {
  return {
    participants: [
      {
        ...defaultParticipant,
        tastes: [...defaultParticipant.tastes],
        restrictions: [],
      },
    ],
    discoveryMode: "sample",
    shortlist: [],
    vetoes: [],
    selectedVenueId: initialVenueId,
    plan: {
      venueId: null,
      date: tomorrow(),
      time: "19:00",
      note: "",
      approvals: [],
      saved: false,
    },
  };
}
export const initialState = createInitialState();

export function planValidationErrors(
  state: AppState,
  now = new Date(),
): string[] {
  const errors: string[] = [];
  const venue = getVenue(state, state.plan.venueId);
  if (!venue) errors.push("Choose a restaurant for the plan.");
  else if (eligibilityReasons(venue, state).length)
    errors.push("This restaurant no longer fits the table. Choose another.");
  if (venue && venueVerificationWarnings(venue, state).length && !state.plan.detailsAcknowledged)
    errors.push("Acknowledge that menu, cost and dietary details need restaurant confirmation.");
  if (!isCalendarDate(state.plan.date) || state.plan.date < localDate(now)) {
    errors.push("Choose today or a future date.");
  }
  if (!timePattern.test(state.plan.time))
    errors.push("Choose a valid dinner time.");
  else if (
    state.plan.date === localDate(now) &&
    new Date(`${state.plan.date}T${state.plan.time}:00`) <= now
  )
    errors.push("Choose a dinner time in the future.");
  if (
    !state.participants.every((person) =>
      state.plan.approvals.includes(person.id),
    )
  )
    errors.push(venue && !isDemoVenue(venue) ? "Everyone needs to approve this plan before saving." : "Confirm each person’s demo approval before saving.");
  return errors;
}

function reconcileGroup(state: AppState, clearApprovals = true): AppState {
  const ranked = rankVenues(state);
  const selectedVenueId = ranked.some(
    ({ venue }) => venue.id === state.selectedVenueId,
  )
    ? state.selectedVenueId
    : (ranked[0]?.venue.id ?? state.selectedVenueId);
  const planned = getVenue(state, state.plan.venueId);
  const venueId = planned && !eligibilityReasons(planned, state).length ? planned.id : null;
  return {
    ...state,
    selectedVenueId,
    plan: {
      ...state.plan,
      venueId,
      approvals: clearApprovals || !venueId ? [] : state.plan.approvals,
      saved: false,
      detailsAcknowledged: clearApprovals ? false : state.plan.detailsAcknowledged,
    },
  };
}

const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 30 &&
  value.every((entry) => typeof entry === "string" && entry.length <= 80);
function validParticipant(value: unknown): value is Participant {
  if (!value || typeof value !== "object") return false;
  const person = value as Participant;
  return (
    typeof person.id === "string" &&
    person.id.length > 0 &&
    person.id.length < 100 &&
    typeof person.name === "string" &&
    person.name.trim().length > 0 &&
    person.name.length <= 50 &&
    typeof person.color === "string" &&
    /^#[0-9a-f]{6}$/i.test(person.color) &&
    typeof person.budget === "number" &&
    Number.isFinite(person.budget) &&
    person.budget >= 1 &&
    person.budget <= 1000 &&
    stringArray(person.tastes) &&
    stringArray(person.restrictions)
  );
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "receive-recommendations": {
      const received = action.venues.slice(0, 30).map(sanitizeVenueSnapshot).filter((v): v is NonNullable<typeof v> => Boolean(v) && !isDemoVenue(v!));
      const merged = new Map((state.catalog || []).map(v => [v.id, v]));
      received.forEach(v => merged.set(v.id, v));
      const protectedIds = new Set([state.plan.venueId, state.selectedVenueId, ...state.shortlist, ...state.vetoes]);
      const catalog = [...merged.values()].sort((a,b) => Number(protectedIds.has(b.id))-Number(protectedIds.has(a.id))).slice(0, MAX_CATALOG_VENUES);
      const orderedIds = [...new Set(action.orderedIds)].filter(id => received.some(v => v.id===id) && !state.vetoes.includes(id));
      return { ...state, discoveryMode: "live", catalog, recommendationIds: orderedIds,
        recommendationsRetrievedAt: Number.isFinite(Date.parse(action.retrievedAt)) ? action.retrievedAt : undefined,
        selectedVenueId: orderedIds.includes(state.selectedVenueId) ? state.selectedVenueId : (orderedIds[0] || state.selectedVenueId) };
    }
    case "browse-sample": {
      const sampleState: AppState = { ...state, discoveryMode: "sample" };
      const first = rankVenues(sampleState)[0]?.venue.id;
      return { ...sampleState, selectedVenueId: first ?? state.selectedVenueId };
    }
    case "acknowledge-details":
      return { ...state, plan: { ...state.plan, detailsAcknowledged: action.acknowledged === true, approvals: [], saved: false } };
    case "select": {
      const venue = getVenue(state, action.venueId);
      if (!venue) return state;
      const discoveryMode = isDemoVenue(venue) ? "sample" : "live";
      return state.selectedVenueId === venue.id && state.discoveryMode === discoveryMode
        ? state : { ...state, selectedVenueId: venue.id, discoveryMode };
    }
    case "shortlist":
      if (!venueExists(state, action.venueId) || state.vetoes.includes(action.venueId))
        return state;
      return {
        ...state,
        shortlist: state.shortlist.includes(action.venueId)
          ? state.shortlist.filter((id) => id !== action.venueId)
          : [...state.shortlist, action.venueId],
      };
    case "veto": {
      if (!venueExists(state, action.venueId) || state.vetoes.includes(action.venueId))
        return state;
      const next = {
        ...state,
        vetoes: [...state.vetoes, action.venueId],
        shortlist: state.shortlist.filter((id) => id !== action.venueId),
      };
      return reconcileGroup(next);
    }
    case "undo-veto":
      if (!state.vetoes.includes(action.venueId)) return state;
      return reconcileGroup({
        ...state,
        vetoes: state.vetoes.filter((id) => id !== action.venueId),
      });
    case "add-participant":
      if (
        state.participants.length >= MAX_PARTICIPANTS ||
        !validParticipant(action.participant) ||
        state.participants.some((person) => person.id === action.participant.id)
      )
        return state;
      return reconcileGroup({
        ...state,
        participants: [
          ...state.participants,
          { ...action.participant, name: action.participant.name.trim() },
        ],
      });
    case "update-participant": {
      const person = state.participants.find((entry) => entry.id === action.id);
      if (!person) return state;
      const updated = { ...person, ...action.changes, id: person.id };
      if (!validParticipant(updated)) return state;
      updated.name = updated.name.trim();
      if (JSON.stringify(updated) === JSON.stringify(person)) return state;
      return reconcileGroup({
        ...state,
        participants: state.participants.map((entry) =>
          entry.id === action.id ? updated : entry,
        ),
      });
    }
    case "remove-participant":
      if (
        action.id === "you" ||
        !state.participants.some((person) => person.id === action.id) ||
        state.participants.length === 1
      )
        return state;
      return reconcileGroup({
        ...state,
        participants: state.participants.filter(
          (person) => person.id !== action.id,
        ),
      });
    case "update-plan": {
      const changes: Partial<Plan> = {};
      if (typeof action.changes.date === "string")
        changes.date = action.changes.date.slice(0, 10);
      if (typeof action.changes.time === "string")
        changes.time = action.changes.time.slice(0, 5);
      if (typeof action.changes.note === "string")
        changes.note = action.changes.note.slice(0, 1000);
      if (
        Object.entries(changes).every(
          ([key, value]) => state.plan[key as keyof Plan] === value,
        )
      )
        return state;
      return {
        ...state,
        plan: { ...state.plan, ...changes, approvals: [], saved: false },
      };
    }
    case "choose-plan": {
      const venue = getVenue(state, action.venueId);
      if (!venue || eligibilityReasons(venue, state).length) return state;
      const discoveryMode = isDemoVenue(venue) ? "sample" : "live";
      if (state.plan.venueId === venue.id)
        return state.selectedVenueId === venue.id && state.discoveryMode === discoveryMode
          ? state
          : { ...state, selectedVenueId: venue.id, discoveryMode };
      return {
        ...state,
        selectedVenueId: venue.id,
        discoveryMode,
        plan: { ...state.plan, venueId: venue.id, approvals: [], saved: false, detailsAcknowledged: false },
      };
    }
    case "toggle-approval": {
      const venue = getVenue(state, state.plan.venueId);
      if (
        !venue ||
        eligibilityReasons(venue, state).length ||
        !state.participants.some((person) => person.id === action.participantId)
      )
        return state;
      const approvals = state.plan.approvals.includes(action.participantId)
        ? state.plan.approvals.filter((id) => id !== action.participantId)
        : [...state.plan.approvals, action.participantId];
      return { ...state, plan: { ...state.plan, approvals, saved: false } };
    }
    case "save-plan":
      return state.plan.saved || planValidationErrors(state).length
        ? state
        : { ...state, plan: { ...state.plan, saved: true } };
    case "reset":
      return createInitialState();
    default:
      return state;
  }
}

/** Storage is untrusted: schema-check, drop stale venue IDs, and never throw. */
export function hydrateState(raw: string | null): AppState {
  const fallback = createInitialState();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;
    if ("version" in parsed && parsed.version !== 1) return fallback;
    const source = ("state" in parsed ? parsed.state : parsed) as AppState;
    if (
      !source ||
      !Array.isArray(source.participants) ||
      source.participants.length < 1 ||
      source.participants.length > MAX_PARTICIPANTS ||
      !source.participants.every(validParticipant) ||
      !source.participants.some((person) => person.id === "you") ||
      new Set(source.participants.map((person) => person.id)).size !==
        source.participants.length ||
      !Array.isArray(source.shortlist) ||
      !Array.isArray(source.vetoes) ||
      !source.plan ||
      typeof source.plan !== "object"
    )
      return fallback;
    const catalog = Array.isArray(source.catalog) ? source.catalog.slice(0,MAX_CATALOG_VENUES).map(sanitizeVenueSnapshot).filter((v): v is NonNullable<typeof v> => Boolean(v) && !isDemoVenue(v!)) : [];
    const exists = (id: unknown): id is string => venueExists({ catalog }, id);
    const vetoes = [...new Set(source.vetoes.filter(exists))];
    const state: AppState = {
      discoveryMode: source.discoveryMode === "sample" || source.discoveryMode === "live" ? source.discoveryMode : Array.isArray(source.recommendationIds) || catalog.some(v => v.id === source.selectedVenueId) ? "live" : "sample",
      ...(catalog.length ? { catalog } : {}),
      ...(Array.isArray(source.recommendationIds) ? { recommendationIds: [...new Set(source.recommendationIds.filter(exists))].filter(id=>!vetoes.includes(id)) } : {}),
      ...(typeof source.recommendationsRetrievedAt === 'string' && Number.isFinite(Date.parse(source.recommendationsRetrievedAt)) ? { recommendationsRetrievedAt: source.recommendationsRetrievedAt } : {}),
      participants: [
        ...source.participants.filter((person) => person.id === "you"),
        ...source.participants.filter((person) => person.id !== "you"),
      ].map((person) => ({ ...person, name: person.name.trim() })),
      shortlist: [...new Set(source.shortlist.filter(exists))].filter(
        (id) => !vetoes.includes(id),
      ),
      vetoes,
      selectedVenueId: exists(source.selectedVenueId)
        ? source.selectedVenueId
        : initialVenueId,
      plan: {
        detailsAcknowledged: source.plan.detailsAcknowledged === true,
        venueId: exists(source.plan.venueId) ? source.plan.venueId : null,
        date:
          typeof source.plan.date === "string" &&
          isCalendarDate(source.plan.date)
            ? source.plan.date
            : fallback.plan.date,
        time:
          typeof source.plan.time === "string" &&
          timePattern.test(source.plan.time)
            ? source.plan.time
            : fallback.plan.time,
        note:
          typeof source.plan.note === "string"
            ? source.plan.note.slice(0, 1000)
            : "",
        approvals: Array.isArray(source.plan.approvals)
          ? [
              ...new Set(
                source.plan.approvals.filter(
                  (id): id is string =>
                    typeof id === "string" &&
                    source.participants.some((person) => person.id === id),
                ),
              ),
            ]
          : [],
        saved:
          source.plan.saved === true &&
          typeof source.plan.date === "string" &&
          isCalendarDate(source.plan.date) &&
          typeof source.plan.time === "string" &&
          timePattern.test(source.plan.time) &&
          exists(source.plan.venueId),
      },
    };
    const reconciled = reconcileGroup(state, false);
    const planRepaired = (["venueId", "date", "time", "note"] as const).some(
      (key) => reconciled.plan[key] !== source.plan[key],
    );
    if (planRepaired) reconciled.plan.approvals = [];
    // A saved receipt represents an exact snapshot. Repairs must become a draft,
    // including table reordering, cleaned lists, or a newly ineligible restaurant.
    const corrected =
      reconciled.selectedVenueId !== source.selectedVenueId ||
      JSON.stringify(reconciled.participants) !==
        JSON.stringify(source.participants) ||
      JSON.stringify(reconciled.shortlist) !==
        JSON.stringify(source.shortlist) ||
      JSON.stringify(reconciled.vetoes) !== JSON.stringify(source.vetoes) ||
      JSON.stringify(reconciled.plan.approvals) !==
        JSON.stringify(source.plan.approvals) ||
      planRepaired;
    reconciled.plan.saved =
      state.plan.saved &&
      !corrected &&
      planValidationErrors(reconciled).length === 0;
    return reconciled;
  } catch {
    return fallback;
  }
}

export function serializeState(state: AppState): string {
  return JSON.stringify({ version: 1, state });
}

export function planText(state: AppState): string {
  const venue = getVenue(state, state.plan.venueId);
  if (!venue)
    return "Common Table · Choose a restaurant to make a dinner plan.";
  return [
    isDemoVenue(venue) ? "COMMON TABLE · Demo dinner plan" : "COMMON TABLE · Dinner plan",
    venue.name,
    `${venue.neighborhood} · ${venue.cuisine}`,
    `${state.plan.date} at ${state.plan.time} · ${state.participants.length} ${state.participants.length === 1 ? "person" : "people"}`,
    isDemoVenue(venue) ? `About $${venue.price} per person · illustrative pricing` : "Confirm menu, pricing and dietary needs with the restaurant.",
    state.plan.note,
    isDemoVenue(venue) ? "Fictional venue. This is a plan, not a reservation. No invitations have been sent." : "This is a dinner plan. A reservation needs separate confirmation.",
    !isDemoVenue(venue) ? venue.websiteUrl : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}
