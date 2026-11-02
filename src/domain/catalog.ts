import { venues } from './data.ts';
import type { AppState, Venue } from './types.ts';

export const QLOO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  if (v.source !== 'qloo' || typeof v.providerEntityId !== 'string' || !QLOO_ID.test(v.providerEntityId) || v.id.toLowerCase() !== `qloo:${v.providerEntityId.toLowerCase()}`) return;
  const name = string(v.name,160);
  const latitude = v.latitude, longitude = v.longitude;
  if (!name || typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude)>90 || typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude)>180) return;
  const level = Number(v.priceLevel);
  const rating = Number(v.rating);
  const retrievedAt = typeof v.retrievedAt === 'string' && Number.isFinite(Date.parse(v.retrievedAt)) ? new Date(v.retrievedAt).toISOString() : undefined;
  return {
    id: `qloo:${v.providerEntityId.toLowerCase()}`, source:'qloo', providerEntityId:v.providerEntityId.toLowerCase(), name,
    latitude, longitude, cuisine:string(v.cuisine,120)||'Restaurant', neighborhood:string(v.neighborhood,200)||'Nearby',
    price:0, priceKnown:false, priceLevel:[1,2,3,4].includes(level) ? level as 1|2|3|4 : undefined,
    rating:v.ratingKnown === true && Number.isFinite(rating) && rating>0 && rating<=5 ? rating : 0,
    ratingKnown:v.ratingKnown === true && Number.isFinite(rating) && rating>0 && rating<=5,
    walkMinutes:0, walkKnown:false,
    description:string(v.description,2000)||'Explore this restaurant with your table.', story:string(v.story,3000)||'Menu, hours and availability need confirmation with the restaurant.',
    tags:labels(v.tags), dietary:[], image:safePublicUrl(v.image)||'/venue-placeholder.svg', accent:'#a96846', coordinates:{x:50,y:50}, menu:[],
    websiteUrl:safePublicUrl(v.websiteUrl), bookingUrl:safePublicUrl(v.bookingUrl), retrievedAt,
    affinity:typeof v.affinity === 'number' && Number.isFinite(v.affinity) && v.affinity>=0 && v.affinity<=1 ? v.affinity : undefined,
  };
}
export function getVenueCatalog(state: Pick<AppState,'catalog'>): Venue[] {
  const dynamic = (state.catalog || []).slice(0,MAX_CATALOG_VENUES).map(sanitizeVenueSnapshot).filter((v):v is Venue => Boolean(v) && !venues.some(x => x.id===v!.id));
  return [...venues, ...new Map(dynamic.map(v=>[v.id,v])).values()];
}
export function getVenue(state: Pick<AppState,'catalog'>, id: string | null | undefined): Venue | undefined { return id ? getVenueCatalog(state).find(v=>v.id===id) : undefined; }
export function venuePriceLabel(venue: Venue): string { return isDemoVenue(venue) ? `$${venue.price}` : venue.priceLevel ? `${'$'.repeat(venue.priceLevel)} · confirm price` : 'Confirm price'; }
export function venueRatingLabel(venue: Venue): string { return isDemoVenue(venue) || venue.ratingKnown ? venue.rating.toFixed(1) : 'Unrated'; }
export function venueTravelLabel(venue: Venue): string { return isDemoVenue(venue) ? `${venue.walkMinutes} min walk` : 'View on map'; }
export function venueVerificationWarnings(venue: Venue, state: AppState): string[] {
  if (isDemoVenue(venue)) return [];
  return ['Confirm the menu and per-person cost with the restaurant.', ...(state.participants.some(p=>p.restrictions.length) ? ['Dietary needs and allergy safety need direct restaurant confirmation.'] : [])];
}
