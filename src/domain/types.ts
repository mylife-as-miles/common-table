export interface MenuItem {
  name: string;
  description: string;
  price: number;
}

export interface Venue {
  source?: "demo" | "qloo" | "osm";
  providerEntityId?: string;
  latitude?: number;
  longitude?: number;
  websiteUrl?: string;
  bookingUrl?: string;
  retrievedAt?: string;
  priceKnown?: boolean;
  ratingKnown?: boolean;
  walkKnown?: boolean;
  priceLevel?: 1 | 2 | 3 | 4;
  affinity?: number;
  id: string;
  name: string;
  cuisine: string;
  neighborhood: string;
  price: number;
  rating: number;
  walkMinutes: number;
  description: string;
  story: string;
  tags: string[];
  dietary: string[];
  image: string;
  accent: string;
  coordinates: { x: number; y: number };
  menu: MenuItem[];
}

export interface Participant {
  id: string;
  name: string;
  color: string;
  tastes: string[];
  budget: number;
  restrictions: string[];
}

export interface Plan {
  venueId: string | null;
  date: string;
  time: string;
  note: string;
  /** Local simulated agreement, never authenticated consent from another person. */
  approvals: string[];
  saved: boolean;
  /** Explicit acknowledgment of missing real-world menu, cost and dietary details. */
  detailsAcknowledged?: boolean;
}

export interface AppState {
  discoveryMode?: "sample" | "live";
  catalog?: Venue[];
  recommendationIds?: string[];
  recommendationsRetrievedAt?: string;
  participants: Participant[];
  shortlist: string[];
  vetoes: string[];
  selectedVenueId: string;
  plan: Plan;
}

export type AppAction =
  | { type: "receive-recommendations"; venues: Venue[]; orderedIds: string[]; retrievedAt: string }
  | { type: "browse-sample" }
  | { type: "acknowledge-details"; acknowledged: boolean }
  | { type: "select"; venueId: string }
  | { type: "shortlist"; venueId: string }
  | { type: "veto"; venueId: string }
  | { type: "undo-veto"; venueId: string }
  | { type: "add-participant"; participant: Participant }
  | {
      type: "update-participant";
      id: string;
      changes: Partial<Omit<Participant, "id">>;
    }
  | { type: "remove-participant"; id: string }
  | {
      type: "update-plan";
      changes: Partial<Pick<Plan, "date" | "time" | "note">>;
    }
  | { type: "choose-plan"; venueId: string }
  | { type: "toggle-approval"; participantId: string }
  | { type: "save-plan" }
  | { type: "reset" };

export interface RankedVenue {
  venue: Venue;
  score: number;
  reasons: string[];
}

/** A future server-side Qloo adapter must return candidates with source evidence. */
export interface RecommendationProvider {
  readonly source: "demo" | "qloo";
  retrieve(state: AppState): Promise<RankedVenue[]>;
}
