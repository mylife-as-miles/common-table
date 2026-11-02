import type { Venue } from "../domain/types";

export type BookingHandoff =
  | { status: "available"; kind: "reservation" | "website"; href: string; hostname: string; label: "Check reservations" | "Visit restaurant" }
  | { status: "demo" | "unavailable" | "no_venue" };

/** Navigation only. This does not fetch, resolve DNS, or manufacture a booking URL. */
export function sanitizeBookingUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const labels = host.split(".");
    const privateSuffixes = ["localhost", "local", "localdomain", "internal", "lan", "corp", "home", "test", "invalid", "home.arpa", "nip.io", "sslip.io", "xip.io", "localtest.me", "lvh.me", "localhost.direct"];
    if (url.protocol !== "https:" || url.username || url.password || url.port || labels.length < 2 || host.includes(":") || /^[\d.]+$/.test(host) || labels.some(label => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label)) || !/[a-z]/.test(labels.at(-1)!) || privateSuffixes.some(suffix => host === suffix || host.endsWith(`.${suffix}`))) return;
    return url.href;
  } catch { return; }
}

export function getBookingHandoff(venue: Venue | null | undefined): BookingHandoff {
  if (!venue) return { status: "no_venue" };
  if (!venue.source || venue.source === "demo") return { status: "demo" };
  if (venue.source !== "qloo" && venue.source !== "osm") return { status: "unavailable" };
  const booking = sanitizeBookingUrl(venue.bookingUrl);
  const website = sanitizeBookingUrl(venue.websiteUrl);
  const href = booking || website;
  if (!href) return { status: "unavailable" };
  return { status: "available", kind: booking ? "reservation" : "website", href, hostname: new URL(href).hostname, label: booking ? "Check reservations" : "Visit restaurant" };
}

export function bookingPlanSummary(date: string, time: string, partySize: number) {
  const parsed = new Date(`${date}T12:00:00Z`);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  const timeValid = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
  const partyValid = Number.isInteger(partySize) && partySize >= 1 && partySize <= 100;
  return {
    valid: dateValid && timeValid && partyValid,
    dateLabel: dateValid ? new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(parsed) : "Choose a date",
    timeLabel: timeValid ? time : "Choose a time",
    partyLabel: partyValid ? `${partySize} ${partySize === 1 ? "person" : "people"}` : "Choose your group size",
  };
}
