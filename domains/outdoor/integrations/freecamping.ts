import type { CampingIndex, Facility } from '../../../lib/reccgov/types.js';
import type { IOverlanderSnapshot } from '../../../lib/iOverlander/cache.js';

export interface CampsiteResult {
  id: string;
  source: 'recgov' | 'iOverlander';
  name: string;
  distanceKm: number;
  agency: string;
  lat: number;
  lng: number;
  useType: 'overnight' | 'day-use';
  reservationType: string;
  restrictions: string[];
  amenities: string[];
  hasRestrooms: boolean;
  sourceUrl: string;
}

export interface SearchOpts {
  lat: number;
  lng: number;
  radiusKm: number;
  includeDayUse: boolean;
  index: CampingIndex;
  overlander: IOverlanderSnapshot;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const la = a.lat * Math.PI / 180;
  const lb = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function isEligible(f: Facility, includeDayUse: boolean): boolean {
  if (!f.active) return false;
  if (f.feeUSD !== 0) return false;
  if (f.useType === 'overnight' && f.tentEligibleSites.length === 0 && f.reservationType !== 'permit') return false;
  if (f.useType === 'day-use' && !includeDayUse) return false;
  return true;
}

export function searchFreeCampsites(opts: SearchOpts): CampsiteResult[] {
  const center = { lat: opts.lat, lng: opts.lng };
  const recgov: CampsiteResult[] = opts.index.facilities
    .filter((f) => isEligible(f, opts.includeDayUse))
    .map((f) => ({
      id: f.facilityId, source: 'recgov' as const, name: f.name,
      distanceKm: haversineKm(center, f),
      agency: f.agency, lat: f.lat, lng: f.lng,
      useType: f.useType, reservationType: f.reservationType,
      restrictions: f.restrictions, amenities: f.amenities, hasRestrooms: f.hasRestrooms,
      sourceUrl: f.reservationUrl,
    }))
    .filter((r) => r.distanceKm <= opts.radiusKm);

  const io: CampsiteResult[] = opts.overlander.spots
    .map((s) => ({
      id: s.id, source: 'iOverlander' as const, name: s.name,
      distanceKm: haversineKm(center, s),
      agency: 'iOverlander community', lat: s.lat, lng: s.lng,
      useType: 'overnight' as const, reservationType: 'walk-up',
      restrictions: [], amenities: s.amenities, hasRestrooms: s.hasRestrooms,
      sourceUrl: s.sourceUrl,
    }))
    .filter((r) => r.distanceKm <= opts.radiusKm);

  return [...recgov, ...io].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 10);
}
