import { venues } from './data.ts';
import type { AppState, Venue } from './types.ts';

export const OSM_VENUE_ID = /^osm:(node|way|relation):([1-9][0-9]{0,18})$/;
// Read-only migration identifier. It is never submitted to active discovery.
const LEGACY_SAVED_ID = /^qloo:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isSavedVenueId = (value: unknown): value is string => typeof value === 'string' && LEGACY_SAVED_ID.test(value);
export function parseOsmVenueId(value: unknown): { id: string; elementType: "node" | "way" | "relation"; elementId: string } | undefined {
  if (typeof value !== 'string') return;
  const match = OSM_VENUE_ID.exec(value);
  if (!match || BigInt(match[2]) > 9223372036854775807n) return;
  return { id: value, elementType: match[1] as "node" | "way" | "relation", elementId: match[2] };
}
export const isOsmVenue = (venue: Venue): boolean => venue.source === 'osm' && Boolean(parseOsmVenueId(venue.id));
export const isSavedVenue = (venue: Venue): boolean => venue.source === 'saved';
export const MAX_CATALOG_VENUES = 80;
export function isDemoVenue(venue: Venue): boolean { return !venue.source || venue.source === 'demo'; }
/** Public links only. These are navigation hints, never permission to fetch a URL server-side. */
export function safePublicUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !host.includes('.') ||
      host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') ||
      /^[\d.]+$/.test(host) || host.includes(':')) return;
    return url.href;
  } catch { return; }
}
const string = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0,max) : '';
const labels = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string').map(x => string(x,80)).filter(Boolean))].slice(0,30) : [];
/** Storage/shared snapshots are untrusted. Provider evidence is verified separately on the server. */
export function sanitizeVenueSnapshot(value: unknown): Venue | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string') return;
  const sample = venues.find(entry => entry.id === v.id);
  if (sample) return sample;
  const osm = v.source === 'osm' ? parseOsmVenueId(v.id) : undefined;
  const saved = (v.source === 'saved' || v.source === 'qloo') && isSavedVenueId(v.id);
  if (!osm && !saved) return;
  if (osm && ((v.osmElementType !== undefined && v.osmElementType !== osm.elementType) || (v.osmElementId !== undefined && (typeof v.osmElementId !== 'string' || v.osmElementId !== osm.elementId)))) return;
  const name = string(v.name,160);
  const latitude = v.latitude, longitude = v.longitude;
  if (!name || typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude)>90 || typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude)>180) return;
  const retrievedAt = typeof v.retrievedAt === 'string' && Number.isFinite(Date.parse(v.retrievedAt)) ? new Date(v.retrievedAt).toISOString() : undefined;
  return {
    id: v.id, source: osm ? 'osm' : 'saved', ...(osm ? { osmElementType: osm.elementType, osmElementId: osm.elementId } : {}), name,
    latitude, longitude, cuisine:string(v.cuisine,120)||'Restaurant', neighborhood:string(v.neighborhood,200)||'Nearby',
    price:0, priceKnown:false,
    rating:0, ratingKnown:false,
    walkMinutes:0, walkKnown:false,
    description:string(v.description,2000)||(saved ? 'A place retained from an earlier saved plan.' : 'A mapped restaurant to explore with your table.'), story:string(v.story,3000)||'Menu, prices, hours and availability need confirmation with the restaurant.',
    tags:labels(v.tags), dietary:[], image:safePublicUrl(v.image)||'/venue-placeholder.svg', accent:'#a96846', coordinates:{x:50,y:50}, menu:[],
    websiteUrl:safePublicUrl(v.websiteUrl), ...(osm ? { bookingUrl:safePublicUrl(v.bookingUrl) } : {}), retrievedAt,
  };
}
export function getVenueCatalog(state: Pick<AppState,'catalog'>): Venue[] {
  const dynamic = (state.catalog || []).slice(0,MAX_CATALOG_VENUES).map(sanitizeVenueSnapshot).filter((v):v is Venue => Boolean(v) && !venues.some(x => x.id===v!.id));
  return [...venues, ...new Map(dynamic.map(v=>[v.id,v])).values()];
}
export function getVenue(state: Pick<AppState,'catalog'>, id: string | null | undefined): Venue | undefined { return id ? getVenueCatalog(state).find(v=>v.id===id) : undefined; }
export function venuePriceLabel(venue: Venue): string { return isDemoVenue(venue) ? `$${venue.price}` : 'Confirm price'; }
export function venueRatingLabel(venue: Venue): string { return isDemoVenue(venue) ? venue.rating.toFixed(1) : 'Unrated'; }
export function venueTravelLabel(venue: Venue): string { return isDemoVenue(venue) ? `${venue.walkMinutes} min walk` : 'View on map'; }
export function venueVerificationWarnings(venue: Venue, state: AppState): string[] {
  if (isDemoVenue(venue)) return [];
  return [...(isSavedVenue(venue) ? ['Previously saved place; its current details have not been refreshed.'] : []), 'Confirm the menu and per-person cost with the restaurant.', ...(state.participants.some(p=>p.restrictions.length) ? ['Dietary needs and allergy safety need direct restaurant confirmation.'] : [])];
}

export function sanitizeRecommendationRationales(value: unknown, ids: readonly string[]): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, reason]) => ids.includes(id) && Boolean(parseOsmVenueId(id)) && typeof reason === 'string' && Boolean(reason.trim()) && reason.length <= 600 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)).map(([id, reason]) => [id, (reason as string).trim()]));
}
