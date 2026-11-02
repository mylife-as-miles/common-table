import test from "node:test";
import assert from "node:assert/strict";
import { parseOsmVenueId, isSavedVenueId, sanitizeVenueSnapshot, getVenue, venuePriceLabel, venueRatingLabel } from "../src/domain/catalog.ts";
import { createInitialState, reducer, hydrateState, serializeState } from "../src/domain/state.ts";
import { rankVenues } from "../src/domain/ranking.ts";

const oldId = "qloo:11111111-1111-4111-8111-111111111111";
const legacy = () => ({ id: oldId, source: "qloo", providerEntityId: "11111111-1111-4111-8111-111111111111", name: "An earlier saved place", cuisine: "Italian", neighborhood: "Earlier area", latitude: 40.7, longitude: -74, price: 45, priceKnown: true, priceLevel: 2, rating: 4.8, ratingKnown: true, affinity: 0.9, menu: [{ name: "Unverified", description: "", price: 1 }], dietary: ["Vegan"], tags: ["Italian"], bookingUrl: "https://restaurant.example/reserve" });
const mapped = (id = "osm:node:12345") => sanitizeVenueSnapshot({ id, source: "osm", name: "Mapped restaurant", cuisine: "Italian", neighborhood: "Mapped address", latitude: 40.71, longitude: -73.99, websiteUrl: "https://restaurant.example/", price: 35, priceKnown: true, priceLevel: 2, rating: 4.8, ratingKnown: true, affinity: 0.9, walkMinutes: 5, walkKnown: true, menu: [{ name: "Invented", description: "", price: 1 }], dietary: ["Vegan"], tags: ["Italian"] })!;

test("mapped identity accepts canonical positive 64-bit elements and rejects aliases, overflow and mismatched metadata", () => {
  for (const elementType of ["node", "way", "relation"] as const) assert.deepEqual(parseOsmVenueId(`osm:${elementType}:123`), { id: `osm:${elementType}:123`, elementType, elementId: "123" });
  assert.equal(parseOsmVenueId("osm:relation:9223372036854775807")?.elementId, "9223372036854775807");
  for (const id of ["osm:node:0", "osm:node:-1", "osm:node:001", "osm:node:1.5", "osm:node:1e5", "OSM:node:1", "osm:other:1", "osm:node:9223372036854775808", oldId, "https://example.com/1"]) assert.equal(parseOsmVenueId(id), undefined);
  assert.equal(sanitizeVenueSnapshot({ ...mapped(), osmElementId: "999" }), undefined);
  assert.equal(sanitizeVenueSnapshot({ ...mapped(), osmElementId: 12345 }), undefined);
  assert.equal(sanitizeVenueSnapshot({ ...mapped(), osmElementType: "way" }), undefined);
  assert.equal(sanitizeVenueSnapshot({ ...mapped(), latitude: 91 }), undefined);
  assert.equal(isSavedVenueId(oldId), true); assert.equal(isSavedVenueId("qloo:invalid"), false); assert.equal(isSavedVenueId("saved:11111111-1111-4111-8111-111111111111"), false);
});

test("mapped facts retain actual coordinates and links but cannot acquire generated menu, cost, rating, walk or dietary facts", () => {
  const venue = mapped();
  assert.equal(venue.source, "osm"); assert.equal(venue.osmElementType, "node"); assert.equal(venue.osmElementId, "12345");
  assert.equal(venue.latitude, 40.71); assert.equal(venue.longitude, -73.99); assert.equal(venue.websiteUrl, "https://restaurant.example/");
  assert.equal(venue.price, 0); assert.equal(venue.priceKnown, false); assert.equal(venue.rating, 0); assert.equal(venue.ratingKnown, false); assert.equal(venue.walkMinutes, 0); assert.equal(venue.walkKnown, false);
  assert.equal(venue.priceLevel, undefined); assert.equal(venue.affinity, undefined); assert.deepEqual(venue.menu, []); assert.deepEqual(venue.dietary, []);
  assert.equal(venuePriceLabel(venue), "Confirm price"); assert.equal(venueRatingLabel(venue), "Unrated");
  assert.equal((venue as unknown as Record<string, unknown>).providerEntityId, undefined);
});

test("live ordering and rationales come from the server while a saved mapped plan survives refresh and sample browsing", () => {
  const first = mapped(), second = mapped("osm:way:23456");
  let state = reducer(createInitialState(), { type: "receive-recommendations", venues: [first, second], orderedIds: [second.id, first.id], retrievedAt: "2026-11-02T12:00:00Z", rationales: { [first.id]: "Italian cuisine is listed for this mapped place.", [second.id]: "Another mapped option for the table.", [oldId]: "Must not become a new recommendation." } });
  assert.deepEqual(rankVenues(state).map(v => v.venue.id), [second.id, first.id]);
  assert.equal(rankVenues(state)[0].reasons[0], "Another mapped option for the table.");
  assert.ok(rankVenues(state).every(v => v.score === 0));
  assert.equal(state.recommendationRationales?.[oldId], undefined);
  state = reducer(state, { type: "choose-plan", venueId: first.id });
  state = reducer(state, { type: "update-plan", changes: { date: "2099-12-10", time: "19:00" } });
  state = reducer(state, { type: "acknowledge-details", acknowledged: true }); state = reducer(state, { type: "toggle-approval", participantId: "you" }); state = reducer(state, { type: "save-plan" });
  assert.equal(state.plan.saved, true); const plan = state.plan;
  state = reducer(state, { type: "browse-sample" }); assert.equal(state.plan, plan); assert.ok(rankVenues(state).every(v => !v.venue.source || v.venue.source === "demo"));
  state = reducer(state, { type: "select", venueId: first.id });
  const restored = hydrateState(serializeState(state)); assert.equal(restored.plan.saved, true); assert.equal(restored.plan.venueId, first.id); assert.equal(getVenue(restored, first.id)?.source, "osm");
  assert.deepEqual(rankVenues(restored).map(v => v.venue.id), [second.id, first.id]); assert.deepEqual(restored.recommendationRationales, state.recommendationRationales);
});

test("legacy private saved plans migrate metadata without losing IDs, exact agreement, saved status or viewability", () => {
  const initial = createInitialState();
  const source = { ...initial, discoveryMode: "live", catalog: [legacy()], recommendationIds: [oldId], selectedVenueId: oldId, shortlist: [oldId], plan: { ...initial.plan, venueId: oldId, date: "2099-12-10", time: "19:00", note: "The earlier evening", detailsAcknowledged: true, approvals: ["you"], saved: true } };
  const restored = hydrateState(JSON.stringify({ version: 1, state: source }));
  assert.equal(restored.plan.venueId, oldId); assert.equal(restored.selectedVenueId, oldId); assert.equal(restored.plan.saved, true); assert.deepEqual(restored.plan.approvals, ["you"]); assert.equal(restored.plan.note, "The earlier evening");
  const venue = getVenue(restored, oldId)!; assert.equal(venue.source, "saved"); assert.equal(venue.name, "An earlier saved place"); assert.equal(venue.latitude, 40.7);
  assert.equal(venue.priceKnown, false); assert.equal(venue.ratingKnown, false); assert.equal(venue.bookingUrl, undefined);
  assert.deepEqual(restored.recommendationIds, []); assert.equal(rankVenues(restored)[0].venue.id, oldId); assert.match(rankVenues(restored)[0].reasons.join(" "), /not a new recommendation/);
  const again = hydrateState(serializeState(restored)); assert.equal(again.plan.saved, true); assert.equal(again.plan.venueId, oldId);
});

test("archived entities cannot enter fresh results or become a new plan, but the existing saved plan may be reopened", () => {
  const archived = sanitizeVenueSnapshot(legacy())!;
  let state = { ...createInitialState(), catalog: [archived] };
  assert.equal(reducer(state, { type: "choose-plan", venueId: oldId }), state);
  const received = reducer(createInitialState(), { type: "receive-recommendations", venues: [archived], orderedIds: [oldId], retrievedAt: "2026-11-02T12:00:00Z" });
  assert.deepEqual(received.recommendationIds, []); assert.equal(getVenue(received, oldId), undefined);
  state = { ...state, selectedVenueId: oldId, plan: { ...state.plan, venueId: oldId, saved: true, detailsAcknowledged: true, approvals: ["you"] } };
  const reopened = reducer(state, { type: "choose-plan", venueId: oldId }); assert.equal(reopened.plan, state.plan); assert.equal(reopened.plan.saved, true);
});
