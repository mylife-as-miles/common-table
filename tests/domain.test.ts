import test from "node:test";
import assert from "node:assert/strict";
import { venues, defaultParticipant } from "../src/domain/data";
import {
  rankVenues,
  eligibilityReasons,
  demoRecommendationProvider,
} from "../src/domain/ranking";
import {
  createInitialState,
  hydrateState,
  planText,
  planValidationErrors,
  reducer,
  serializeState,
} from "../src/domain/state";
import type { AppState, Participant } from "../src/domain/types";

const friend = (changes: Partial<Participant> = {}): Participant => ({
  ...defaultParticipant,
  id: "alex",
  name: "Alex",
  color: "#7d8860",
  tastes: ["Mexican"],
  restrictions: [],
  ...changes,
});
const approveAll = (state: AppState): AppState =>
  state.participants.reduce(
    (draft, person) =>
      draft.plan.approvals.includes(person.id)
        ? draft
        : reducer(draft, { type: "toggle-approval", participantId: person.id }),
    state,
  );
const savePlan = (state: AppState): AppState =>
  reducer(approveAll(state), { type: "save-plan" });
const chooseFuturePlan = (): AppState => {
  let state = reducer(createInitialState(), {
    type: "choose-plan",
    venueId: "juniper",
  });
  state = reducer(state, {
    type: "update-plan",
    changes: { date: "2099-10-30", time: "19:30" },
  });
  return state;
};

test("solo recommendations respond to stated taste without claiming an integration", async () => {
  const state = createInitialState();
  const ranked = rankVenues(state);
  assert.equal(ranked[0].venue.id, "juniper");
  assert.ok(ranked[0].reasons.some((reason) => reason.includes("Italian")));
  assert.equal(demoRecommendationProvider.source, "demo");
  assert.deepEqual(await demoRecommendationProvider.retrieve(state), ranked);
  assert.ok(ranked.every((result) => result.score >= 0 && result.score < 100));
});

test("every participant budget is a hard constraint, not an average", () => {
  const state = reducer(createInitialState(), {
    type: "add-participant",
    participant: friend({ budget: 35 }),
  });
  const ranked = rankVenues(state);
  assert.deepEqual(
    ranked.map(({ venue }) => venue.id),
    ["casa"],
  );
  assert.equal(state.selectedVenueId, "casa");
});

test("combined restrictions must all be explicitly supported by a venue", () => {
  let state = reducer(createInitialState(), {
    type: "update-participant",
    id: "you",
    changes: { restrictions: ["Vegan"] },
  });
  state = reducer(state, {
    type: "add-participant",
    participant: friend({ restrictions: ["Nut-free"] }),
  });
  assert.deepEqual(
    new Set(rankVenues(state).map(({ venue }) => venue.id)),
    new Set(["momo", "casa", "bomi"]),
  );
  assert.ok(
    eligibilityReasons(venues[0], state).some((reason) =>
      reason.includes("Vegan"),
    ),
  );
});

test("unknown restrictions result in no candidates instead of being silently ignored", () => {
  const state = reducer(createInitialState(), {
    type: "update-participant",
    id: "you",
    changes: { restrictions: ["Strictly kosher"] },
  });
  assert.equal(rankVenues(state).length, 0);
});

test("veto revises the selected venue, clears a vetoed plan, and excludes it from ranking", () => {
  const planned = chooseFuturePlan();
  const state = reducer(planned, { type: "veto", venueId: "juniper" });
  assert.notEqual(state.selectedVenueId, "juniper");
  assert.equal(state.plan.venueId, null);
  assert.ok(rankVenues(state).every(({ venue }) => venue.id !== "juniper"));
});

test("repeated veto is idempotent and undo returns the venue to candidates", () => {
  const vetoed = reducer(createInitialState(), {
    type: "veto",
    venueId: "juniper",
  });
  assert.equal(reducer(vetoed, { type: "veto", venueId: "juniper" }), vetoed);
  const restored = reducer(vetoed, { type: "undo-veto", venueId: "juniper" });
  assert.ok(rankVenues(restored).some(({ venue }) => venue.id === "juniper"));
  assert.equal(
    reducer(restored, { type: "undo-veto", venueId: "juniper" }),
    restored,
  );
});

test("all candidates can be passed on without falling back to a rejected restaurant", () => {
  let state = chooseFuturePlan();
  for (const venue of venues)
    state = reducer(state, { type: "veto", venueId: venue.id });
  assert.deepEqual(rankVenues(state), []);
  assert.equal(state.plan.venueId, null);
  assert.equal(
    reducer(state, { type: "choose-plan", venueId: "juniper" }),
    state,
  );
  assert.equal(reducer(state, { type: "save-plan" }), state);
});

test("shortlist toggles are reversible and a veto removes the venue from it", () => {
  const initial = createInitialState();
  const added = reducer(initial, { type: "shortlist", venueId: "juniper" });
  assert.deepEqual(added.shortlist, ["juniper"]);
  assert.deepEqual(
    reducer(added, { type: "shortlist", venueId: "juniper" }).shortlist,
    [],
  );
  const vetoed = reducer(added, { type: "veto", venueId: "juniper" });
  assert.deepEqual(vetoed.shortlist, []);
  assert.equal(
    reducer(vetoed, { type: "shortlist", venueId: "juniper" }),
    vetoed,
  );
});

test("a valid plan saves once and changing details invalidates that saved snapshot", () => {
  const saved = savePlan(chooseFuturePlan());
  assert.equal(saved.plan.saved, true);
  assert.equal(reducer(saved, { type: "save-plan" }), saved);
  const updated = reducer(saved, {
    type: "update-plan",
    changes: { note: "Meet by the window." },
  });
  assert.equal(updated.plan.saved, false);
  assert.equal(updated.plan.note, "Meet by the window.");
  assert.equal(updated.plan.venueId, "juniper");
  assert.deepEqual(updated.plan.approvals, []);
});

test("a plan requires every current person’s local approval before it can save", () => {
  let state = reducer(chooseFuturePlan(), {
    type: "add-participant",
    participant: friend(),
  });
  const approvalError = "Confirm each person’s demo approval before saving.";
  assert.ok(planValidationErrors(state).includes(approvalError));
  assert.equal(reducer(state, { type: "save-plan" }), state);
  state = reducer(state, { type: "toggle-approval", participantId: "you" });
  assert.ok(planValidationErrors(state).includes(approvalError));
  assert.equal(reducer(state, { type: "save-plan" }), state);
  state = reducer(state, { type: "toggle-approval", participantId: "alex" });
  assert.equal(planValidationErrors(state).length, 0);
  assert.equal(reducer(state, { type: "save-plan" }).plan.saved, true);
});

test("approval toggles are reversible, never duplicate, and reopening agreement invalidates saved status", () => {
  const saved = savePlan(chooseFuturePlan());
  assert.deepEqual(saved.plan.approvals, ["you"]);
  const undone = reducer(saved, {
    type: "toggle-approval",
    participantId: "you",
  });
  assert.deepEqual(undone.plan.approvals, []);
  assert.equal(undone.plan.saved, false);
  const confirmed = reducer(undone, {
    type: "toggle-approval",
    participantId: "you",
  });
  assert.deepEqual(confirmed.plan.approvals, ["you"]);
  assert.equal(confirmed.plan.saved, false);
  assert.equal(
    reducer(confirmed, { type: "toggle-approval", participantId: "unknown" }),
    confirmed,
  );
  const blank = createInitialState();
  assert.equal(
    reducer(blank, { type: "toggle-approval", participantId: "you" }),
    blank,
  );
});

test("plan details, people, preferences, venue replacement and vetoes clear previous agreement", () => {
  const base = savePlan(
    reducer(chooseFuturePlan(), {
      type: "add-participant",
      participant: friend(),
    }),
  );
  const changedStates = [
    reducer(base, { type: "update-plan", changes: { date: "2099-11-01" } }),
    reducer(base, { type: "update-plan", changes: { time: "20:00" } }),
    reducer(base, { type: "update-plan", changes: { note: "Meet outside." } }),
    reducer(base, {
      type: "add-participant",
      participant: friend({ id: "maya", name: "Maya" }),
    }),
    reducer(base, { type: "remove-participant", id: "alex" }),
    reducer(base, {
      type: "update-participant",
      id: "you",
      changes: { budget: 70 },
    }),
    reducer(base, {
      type: "update-participant",
      id: "alex",
      changes: { tastes: ["Italian"] },
    }),
    reducer(base, { type: "choose-plan", venueId: "olive" }),
    reducer(base, { type: "veto", venueId: "olive" }),
  ];
  const withVeto = savePlan(reducer(base, { type: "veto", venueId: "olive" }));
  changedStates.push(
    reducer(withVeto, { type: "undo-veto", venueId: "olive" }),
  );
  for (const state of changedStates) {
    assert.deepEqual(state.plan.approvals, []);
    assert.equal(state.plan.saved, false);
  }
});

test("browsing, shortlisting, and choosing an already chosen venue preserve agreement", () => {
  const saved = savePlan(chooseFuturePlan());
  const browsing = reducer(saved, { type: "select", venueId: "olive" });
  const shortlisted = reducer(browsing, {
    type: "shortlist",
    venueId: "olive",
  });
  const chosenAgain = reducer(shortlisted, {
    type: "choose-plan",
    venueId: "juniper",
  });
  assert.deepEqual(chosenAgain.plan.approvals, ["you"]);
  assert.equal(chosenAgain.plan.saved, true);
  assert.equal(
    reducer(chosenAgain, { type: "choose-plan", venueId: "juniper" }),
    chosenAgain,
  );
  assert.equal(
    reducer(chosenAgain, {
      type: "update-plan",
      changes: { time: chosenAgain.plan.time },
    }),
    chosenAgain,
  );
});

test("changing the table invalidates a saved plan even when the restaurant still fits", () => {
  const saved = savePlan(chooseFuturePlan());
  const updated = reducer(saved, {
    type: "add-participant",
    participant: friend(),
  });
  assert.equal(updated.plan.venueId, "juniper");
  assert.equal(updated.plan.saved, false);
});

test("a budget change that rules out the restaurant clears the plan and revises candidates", () => {
  const saved = savePlan(chooseFuturePlan());
  const updated = reducer(saved, {
    type: "update-participant",
    id: "you",
    changes: { budget: 35 },
  });
  assert.equal(updated.plan.venueId, null);
  assert.equal(updated.selectedVenueId, "casa");
  assert.equal(updated.plan.saved, false);
});

test("browsing another menu preserves a saved dinner plan until explicitly choosing a replacement", () => {
  const saved = savePlan(chooseFuturePlan());
  const browsing = reducer(saved, { type: "select", venueId: "olive" });
  assert.equal(browsing.selectedVenueId, "olive");
  assert.equal(browsing.plan.venueId, "juniper");
  assert.equal(browsing.plan.saved, true);
  const replacement = reducer(browsing, {
    type: "choose-plan",
    venueId: "olive",
  });
  assert.equal(replacement.plan.venueId, "olive");
  assert.equal(replacement.plan.saved, false);
});

test("invalid or past dates and malformed times cannot be saved", () => {
  const planned = chooseFuturePlan();
  const now = new Date("2026-10-29T18:00:00");
  for (const date of ["2026-02-30", "2026-10-28", "", "not-a-date"]) {
    const changed = reducer(planned, {
      type: "update-plan",
      changes: { date },
    });
    assert.ok(
      planValidationErrors(changed, now).includes(
        "Choose today or a future date.",
      ),
      date,
    );
  }
  for (const time of ["25:00", "19:99", "7pm", ""]) {
    const changed = reducer(planned, {
      type: "update-plan",
      changes: { time },
    });
    assert.ok(
      planValidationErrors(changed, now).includes(
        "Choose a valid dinner time.",
      ),
      time,
    );
  }
  const pastTime = reducer(planned, {
    type: "update-plan",
    changes: { date: "2026-10-29", time: "17:00" },
  });
  assert.ok(
    planValidationErrors(pastTime, now).some((error) =>
      error.includes("future"),
    ),
  );
});

test("cannot save a plan without a restaurant", () => {
  const state = createInitialState();
  assert.equal(reducer(state, { type: "save-plan" }), state);
  assert.ok(
    planValidationErrors(state).some((error) => error.includes("restaurant")),
  );
});

test("duplicate people and invalid profile edits cannot corrupt the table", () => {
  const state = reducer(createInitialState(), {
    type: "add-participant",
    participant: friend(),
  });
  assert.equal(
    reducer(state, { type: "add-participant", participant: friend() }),
    state,
  );
  assert.equal(
    reducer(state, {
      type: "update-participant",
      id: "you",
      changes: { budget: NaN },
    }),
    state,
  );
  assert.equal(
    reducer(state, {
      type: "update-participant",
      id: "you",
      changes: { name: "   " },
    }),
    state,
  );
  assert.equal(
    reducer(state, { type: "remove-participant", id: "you" }),
    state,
  );
  assert.equal(
    reducer(state, { type: "remove-participant", id: "missing" }),
    state,
  );
  assert.equal(
    reducer(state, { type: "remove-participant", id: "alex" }).participants
      .length,
    1,
  );
});

test("local persistence roundtrips a valid saved plan", () => {
  const state = savePlan(chooseFuturePlan());
  assert.deepEqual(hydrateState(serializeState(state)), state);
});

test("legacy saved plans without agreement migrate to unapproved drafts", () => {
  const legacy = JSON.parse(serializeState(savePlan(chooseFuturePlan())));
  delete legacy.state.plan.approvals;
  const restored = hydrateState(JSON.stringify(legacy));
  assert.deepEqual(restored.plan.approvals, []);
  assert.equal(restored.plan.saved, false);
  assert.equal(restored.plan.venueId, "juniper");
});

test("hydration filters unknown and duplicate approval IDs and never calls a repaired snapshot saved", () => {
  const state = savePlan(
    reducer(chooseFuturePlan(), {
      type: "add-participant",
      participant: friend(),
    }),
  );
  state.plan.approvals = ["you", "you", "missing", "alex"];
  const restored = hydrateState(serializeState(state));
  assert.deepEqual(restored.plan.approvals, ["you", "alex"]);
  assert.equal(restored.plan.saved, false);
  const resaved = reducer(restored, { type: "save-plan" });
  assert.equal(resaved.plan.saved, true);
  assert.deepEqual(hydrateState(serializeState(resaved)), resaved);
});

test("hydration revises a vetoed selection and clears an ineligible chosen restaurant", () => {
  const state = savePlan(chooseFuturePlan());
  state.vetoes = ["juniper"];
  const restored = hydrateState(serializeState(state));
  assert.notEqual(restored.selectedVenueId, "juniper");
  assert.ok(
    rankVenues(restored).some(
      ({ venue }) => venue.id === restored.selectedVenueId,
    ),
  );
  assert.equal(restored.plan.venueId, null);
  assert.equal(restored.plan.saved, false);
});

test("hydration applies budget and dietary constraints before displaying a selected menu", () => {
  const state = savePlan(chooseFuturePlan());
  state.participants[0] = {
    ...state.participants[0],
    budget: 35,
    restrictions: ["Vegan"],
  };
  const restored = hydrateState(serializeState(state));
  assert.equal(restored.selectedVenueId, "casa");
  assert.equal(restored.plan.venueId, null);
  assert.equal(restored.plan.saved, false);
});

test("hydration restores You as the first protected seat and marks repaired snapshots editable", () => {
  let state = reducer(chooseFuturePlan(), {
    type: "add-participant",
    participant: friend(),
  });
  state = savePlan(state);
  state.participants.reverse();
  const restored = hydrateState(serializeState(state));
  assert.equal(restored.participants[0].id, "you");
  assert.equal(restored.participants[1].id, "alex");
  assert.equal(restored.plan.venueId, "juniper");
  assert.equal(restored.plan.saved, false);
});

test("restoring an exhausted table never re-enables its chosen restaurant", () => {
  const state = savePlan(chooseFuturePlan());
  state.vetoes = venues.map((venue) => venue.id);
  const restored = hydrateState(serializeState(state));
  assert.equal(rankVenues(restored).length, 0);
  assert.equal(restored.plan.venueId, null);
  assert.equal(restored.plan.saved, false);
});

test("corrupt, unsupported, duplicate-person and structurally invalid storage resets safely", () => {
  const initial = createInitialState();
  const invalid: unknown[] = [
    null,
    "oops",
    "[",
    "null",
    "[]",
    "false",
    "{}",
    JSON.stringify({ version: 2, state: initial }),
    JSON.stringify({ ...initial, participants: [] }),
    JSON.stringify({
      ...initial,
      participants: [initial.participants[0], initial.participants[0]],
    }),
    JSON.stringify({
      ...initial,
      participants: [{ ...initial.participants[0], color: "url(evil)" }],
    }),
    JSON.stringify({ ...initial, vetoes: {} }),
  ];
  for (const raw of invalid)
    assert.deepEqual(hydrateState(raw as string | null), initial);
});

test("stale restaurant IDs and duplicate lists are cleaned during restore", () => {
  const state = {
    ...createInitialState(),
    selectedVenueId: "old-venue",
    shortlist: ["juniper", "juniper", "old-venue", "olive"],
    vetoes: ["olive", "olive", "missing"],
    plan: { ...chooseFuturePlan().plan, venueId: "missing", saved: true },
  };
  const restored = hydrateState(JSON.stringify(state));
  assert.equal(restored.selectedVenueId, "juniper");
  assert.deepEqual(restored.shortlist, ["juniper"]);
  assert.deepEqual(restored.vetoes, ["olive"]);
  assert.equal(restored.plan.venueId, null);
  assert.equal(restored.plan.saved, false);
});

test("malformed persisted calendar dates become safe editable defaults", () => {
  const state = savePlan(chooseFuturePlan());
  state.plan.date = "2099-99-99";
  state.plan.saved = true;
  const restored = hydrateState(serializeState(state));
  assert.equal(restored.plan.date, createInitialState().plan.date);
  assert.equal(restored.plan.saved, false);
  assert.deepEqual(restored.plan.approvals, []);
});

test("the local table caps at six non-overlapping seats", () => {
  let state = createInitialState();
  for (let i = 0; i < 5; i++)
    state = reducer(state, {
      type: "add-participant",
      participant: friend({ id: `guest-${i}` }),
    });
  assert.equal(state.participants.length, 6);
  assert.equal(
    reducer(state, {
      type: "add-participant",
      participant: friend({ id: "seventh" }),
    }),
    state,
  );
});

test("expired saved plans restore as editable drafts", () => {
  const state = chooseFuturePlan();
  state.plan.date = "2020-01-01";
  state.plan.saved = true;
  const restored = hydrateState(serializeState(state));
  assert.equal(restored.plan.saved, false);
  assert.equal(restored.plan.date, "2020-01-01");
});

test("exported plans retain edits and clearly disclose demo and reservation status", () => {
  const state = reducer(chooseFuturePlan(), {
    type: "update-plan",
    changes: { note: "Window table if possible." },
  });
  const text = planText(state);
  assert.ok(text.includes("Juniper & Rye"));
  assert.ok(text.includes("2099-10-30 at 19:30"));
  assert.ok(text.includes("Window table if possible."));
  assert.ok(text.includes("Fictional venue"));
  assert.ok(text.includes("not a reservation"));
  assert.ok(text.includes("No invitations have been sent"));
});

test("reset creates an independent solo draft without previous vetoes or saved state", () => {
  const altered = reducer(savePlan(chooseFuturePlan()), {
    type: "veto",
    venueId: "olive",
  });
  const reset = reducer(altered, { type: "reset" });
  assert.deepEqual(reset, createInitialState());
  assert.notEqual(
    reset.participants[0].tastes,
    createInitialState().participants[0].tastes,
  );
});
