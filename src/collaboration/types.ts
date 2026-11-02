import type { Venue } from "../domain/types.ts";

export interface SharedIdentity { userId: string; displayName: string }
export interface SharedPreferences { tastes: string[]; budget: number; restrictions: string[] }
export interface SharedPlan {
  venueId: string | null;
  venueSnapshot: Venue | null;
  date: string;
  time: string;
  note: string;
  saved: boolean;
  detailsAcknowledged?: boolean;
}
export interface SharedMember {
  userId: string;
  displayName: string;
  role: "owner" | "member";
  preferences: SharedPreferences;
  approvedRevision: number | null;
}
export interface SharedInvite { id: string; expiresAt: number; accepted: boolean; revoked: boolean }
export interface SharedTableSnapshot {
  id: string;
  title: string;
  ownerId: string;
  viewerId: string;
  revision: number;
  version: number;
  members: SharedMember[];
  plan: SharedPlan;
  updatedAt: number;
  invites?: SharedInvite[];
}
export interface SharedTableSummary { id: string; title: string; role: "owner" | "member"; updatedAt: number }
export interface SharedInvitationPreview { id: string; title: string; memberCount: number; expiresAt: number }

export const defaultSharedPreferences = (): SharedPreferences => ({ tastes: [], budget: 65, restrictions: [] });
/** App Participant objects contain identity/display fields that must not become write targets. */
export const sharedPreferencesOnly = (person: SharedPreferences): SharedPreferences => ({ tastes: [...person.tastes], budget: person.budget, restrictions: [...person.restrictions] });
export const emptySharedPlan = (): SharedPlan => ({ venueId: null, venueSnapshot: null, date: "", time: "19:00", note: "", saved: false });
export const memberSeatId = (table: SharedTableSnapshot, userId: string) => userId === table.viewerId ? "you" : `member:${userId}`;
export const canEditSharedPlan = (table: SharedTableSnapshot | null) => Boolean(table && table.viewerId === table.ownerId);
export const canEditSharedSeat = (table: SharedTableSnapshot | null, seatId: string) => Boolean(table && seatId === "you");
export const canApproveSharedSeat = canEditSharedSeat;
/** Capture the version actually rendered, rather than a newer polling ref. */
export const sharedMutationTarget = (displayed: Pick<SharedTableSnapshot, "id" | "version"> | null, expectedVersion = displayed?.version) => displayed && Number.isSafeInteger(expectedVersion) && Number(expectedVersion) >= 1 ? { tableId: displayed.id, version: expectedVersion! } : null;
