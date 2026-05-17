import type { CampingIndex, Facility, BookingWindows } from '../../../lib/reccgov/types.js';
import type { RecGovClient } from '../../../lib/reccgov/client.js';
import { seasonForFacility, DEFAULT_LEAD_TIME_DAYS, deriveBookingWindows, deriveFeeUSD } from '../../../lib/reccgov/seasons.js';

const TENT_TYPES = new Set([
  'TENT ONLY NONELECTRIC', 'TENT ONLY ELECTRIC',
  'STANDARD NONELECTRIC', 'STANDARD ELECTRIC',
  'WALK TO', 'WALK-IN', 'GROUP TENT ONLY',
]);
const RESTROOM_RE = /toilet|restroom|bathroom/i;

export interface RunMetadataRefreshOpts {
  existingIndex: CampingIndex;
  client: RecGovClient;
}
export interface MetadataRefreshResult {
  index: CampingIndex;
  refreshed: number;
  deactivated: number;
  failures: number;
}

function deriveTentEligible(campsites: Array<{ campsiteId: string; campsiteType: string }>): string[] {
  return campsites.filter((c) => TENT_TYPES.has(c.campsiteType.toUpperCase())).map((c) => c.campsiteId);
}

export async function runMetadataRefresh(opts: RunMetadataRefreshOpts): Promise<MetadataRefreshResult> {
  let refreshed = 0;
  let deactivated = 0;
  let failures = 0;
  const out: Facility[] = [];
  const nowIso = new Date().toISOString();
  const todayIso = nowIso.slice(0, 10);
  for (const f of opts.existingIndex.facilities) {
    if (!f.active) { out.push(f); continue; }
    try {
      const meta = await opts.client.getFacility(f.facilityId) as Partial<Facility>;
      const tentSites: string[] = f.useType === 'day-use'
        ? []
        : deriveTentEligible(await opts.client.getFacilityCampsites(f.facilityId));
      const totalSites = f.useType === 'day-use' ? 0 : tentSites.length;
      const amenities = (meta.amenities as string[] | undefined) ?? [];
      const seasonFallback = seasonForFacility(f.facilityId);
      // Will this facility remain active? Only fetch /rates and /releases if so —
      // saves ~95% of public-API calls on the first metadata-refresh pass.
      const reservationType = (meta.reservationType ?? f.reservationType ?? 'reservation') as Facility['reservationType'];
      const willRemainActive = !(f.useType === 'overnight' && tentSites.length === 0 && reservationType !== 'permit');

      let nextReleaseAtIso: string | null = null;
      let bookingWindows: BookingWindows | null = null;
      let derivedFeeUSD: number | null = null;
      if (willRemainActive) {
        try {
          const releases = await opts.client.getCampgroundReleases(f.facilityId);
          nextReleaseAtIso = releases.current_release?.release_time ?? null;
        } catch (err) {
          // Not fatal — other fields still useful. Log and continue.
          console.warn(`[metadata-refresh] ${f.facilityId} /releases failed:`, err instanceof Error ? err.message : err);
        }
        try {
          const rates = await opts.client.getCampgroundRates(f.facilityId);
          bookingWindows = deriveBookingWindows(rates.rates_list, todayIso);
          derivedFeeUSD = deriveFeeUSD(rates.rates_list, todayIso);
        } catch (err) {
          console.warn(`[metadata-refresh] ${f.facilityId} /rates failed:`, err instanceof Error ? err.message : err);
        }
      }

      const updated: Facility = {
        ...f,
        // Use `||` not `??` here: index-refresh seeds new facilities with
        // leadTimeDays=0, which is a "not yet known" sentinel, not a real
        // zero-day window. `??` would treat 0 as a valid value and short-
        // circuit before reaching DEFAULT_LEAD_TIME_DAYS.
        leadTimeDays: meta.leadTimeDays || f.leadTimeDays || DEFAULT_LEAD_TIME_DAYS,
        specialReleaseDate: meta.specialReleaseDate ?? f.specialReleaseDate,
        seasonStart: meta.seasonStart ?? f.seasonStart ?? seasonFallback.seasonStart,
        seasonEnd: meta.seasonEnd ?? f.seasonEnd ?? seasonFallback.seasonEnd,
        // Prefer the fee derived from /rates (real $ value per night). Fall
        // back to whatever meta has, then existing, then 0.
        feeUSD: derivedFeeUSD ?? meta.feeUSD ?? f.feeUSD ?? 0,
        reservationType,
        restrictions: (meta.restrictions as string[] | undefined) ?? f.restrictions,
        amenities,
        hasRestrooms: amenities.some((a) => RESTROOM_RE.test(a)),
        reservationUrl: meta.reservationUrl ?? f.reservationUrl ?? '',
        tentEligibleSites: tentSites,
        totalSites,
        lastMetadataRefresh: nowIso,
        nextReleaseAtIso,
        bookingWindows,
      };
      if (f.useType === 'overnight' && updated.tentEligibleSites.length === 0 && updated.reservationType !== 'permit') {
        updated.active = false;
        deactivated++;
      }
      refreshed++;
      out.push(updated);
    } catch (err) {
      console.warn(`[metadata-refresh] ${f.facilityId} failed:`, err instanceof Error ? err.message : err);
      failures++;
      out.push(f);
    }
  }
  return { index: { facilities: out }, refreshed, deactivated, failures };
}
