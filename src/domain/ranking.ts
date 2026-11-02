import { getVenueCatalog, isDemoVenue, venueVerificationWarnings } from "./catalog";
import type {
  AppState,
  RankedVenue,
  RecommendationProvider,
  Venue,
} from "./types";

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();

/** Demo constraints use illustrative venue metadata, never an allergy guarantee. */
export function eligibilityReasons(venue: Venue, state: AppState): string[] {
  const problems: string[] = [];
  if (state.vetoes.includes(venue.id)) problems.push("Passed on by the table");
  for (const person of state.participants) {
    if (isDemoVenue(venue) && venue.price > person.budget)
      problems.push(
        `Above ${person.name === "You" ? "your" : `${person.name}’s`} $${person.budget} budget`,
      );
    for (const restriction of isDemoVenue(venue) ? person.restrictions : []) {
      if (
        !venue.dietary.some(
          (option) => normalize(option) === normalize(restriction),
        )
      ) {
        problems.push(
          `${restriction} options are not listed for ${person.name}`,
        );
      }
    }
  }
  return problems;
}

/** Honest, deterministic local ranking. No Qloo requests or inferred taste profiles. */
export function rankVenues(state: AppState): RankedVenue[] {
  const budget = Math.min(...state.participants.map((person) => person.budget));
  const catalog = getVenueCatalog(state);
  const live = state.discoveryMode === "live" || state.discoveryMode === undefined && state.recommendationIds !== undefined;
  const liveIds = state.recommendationIds ?? catalog.filter(v => !isDemoVenue(v)).map(v => v.id);
  const candidates = live
    ? liveIds.map(id => catalog.find(v => v.id === id)).filter((v): v is Venue => Boolean(v) && !isDemoVenue(v!))
    : catalog.filter(isDemoVenue);
  return candidates
    .filter((venue) => eligibilityReasons(venue, state).length === 0)
    .map((venue, position) => {
      if (!isDemoVenue(venue)) {
        return { venue, score: venue.affinity === undefined ? Math.max(0, 100-position) : venue.affinity * 100,
          reasons: ["Selected for your table’s tastes near this location", ...venueVerificationWarnings(venue, state)] };
      }
      const haystack = [venue.cuisine, ...venue.tags].map(normalize).join(" ");
      const preferences = state.participants.flatMap((person) => person.tastes);
      const matched = [
        ...new Set(
          preferences.filter((taste) => haystack.includes(normalize(taste))),
        ),
      ];
      const tasteRatio = preferences.length
        ? preferences.filter((taste) => haystack.includes(normalize(taste)))
            .length / preferences.length
        : 0;
      const dietary = [
        ...new Set(state.participants.flatMap((person) => person.restrictions)),
      ];
      const score = Math.round(
        70 +
          tasteRatio * 19 +
          Math.min(5, (budget - venue.price) / 8) +
          (venue.rating - 4.5) * 10,
      );
      const reasons = [
        ...(matched.length
          ? [
              `${matched.join(" + ")} matches ${state.participants.length === 1 ? "your tastes" : "the table’s tastes"}`,
            ]
          : ["A new flavor to explore"]),
        `$${venue.price} per person fits ${state.participants.length === 1 ? "your" : "everyone’s"} budget`,
        ...(dietary.length
          ? [`${dietary.join(" + ")} options listed in this demo`]
          : ["An unhurried neighborhood dinner"]),
      ];
      return { venue, score: Math.max(0, Math.min(99, score)), reasons };
    })
    .sort((a, b) => live
      ? liveIds.indexOf(a.venue.id) - liveIds.indexOf(b.venue.id)
      : b.score - a.score || a.venue.id.localeCompare(b.venue.id));
}

export const demoRecommendationProvider: RecommendationProvider = {
  source: "demo",
  async retrieve(state) {
    return rankVenues(state);
  },
};
