import type { AppState, Participant } from "../domain/types";
import { getVenueCatalog, sanitizeVenueSnapshot } from "../domain/catalog";
import { memberSeatId, type SharedTableSnapshot } from "./types";

/** Display projection only. Permissions and mutations remain on the authenticated server. */
export function snapshotToAppState(table: SharedTableSnapshot, previous: AppState): AppState {
  const mine = table.members.find(m => m.userId === table.viewerId);
  const ordered = [...(mine ? [mine] : []), ...table.members.filter(m => m.userId !== table.viewerId)];
  const colors = ["#a46c49", "#7d8860", "#8b6a86", "#497f86", "#b58444", "#a45f65"];
  const participants: Participant[] = ordered.map((m, i) => ({ id: memberSeatId(table, m.userId), name: m.userId === table.viewerId ? "You" : m.displayName, color: colors[i % colors.length], ...m.preferences }));
  const chosen = sanitizeVenueSnapshot(table.plan.venueSnapshot);
  const catalog = getVenueCatalog(previous).filter(v => v.id !== chosen?.id);
  if (chosen) catalog.push(chosen);
  const selectedVenueId = catalog.some(v => v.id === previous.selectedVenueId) ? previous.selectedVenueId : chosen?.id ?? catalog[0].id;
  return { ...previous, participants, catalog, selectedVenueId, vetoes: previous.vetoes.filter(id => id !== table.plan.venueId), plan: { venueId: table.plan.venueId, date: table.plan.date, time: table.plan.time, note: table.plan.note, saved: table.plan.saved, detailsAcknowledged: table.plan.detailsAcknowledged, approvals: table.members.filter(m => m.approvedRevision === table.revision).map(m => memberSeatId(table, m.userId)) } };
}
