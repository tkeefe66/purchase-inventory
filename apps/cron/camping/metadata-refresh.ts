import type { CampingIndex, Facility } from '../../../lib/reccgov/types.js';
import type { RecGovClient } from '../../../lib/reccgov/client.js';
import { seasonForFacility } from '../../../lib/reccgov/seasons.js';

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
      const updated: Facility = {
        ...f,
        leadTimeDays: meta.leadTimeDays ?? f.leadTimeDays ?? 180,
        specialReleaseDate: meta.specialReleaseDate ?? f.specialReleaseDate,
        seasonStart: meta.seasonStart ?? f.seasonStart ?? seasonFallback.seasonStart,
        seasonEnd: meta.seasonEnd ?? f.seasonEnd ?? seasonFallback.seasonEnd,
        feeUSD: meta.feeUSD ?? f.feeUSD ?? 0,
        reservationType: meta.reservationType ?? f.reservationType ?? 'reservation',
        restrictions: (meta.restrictions as string[] | undefined) ?? f.restrictions,
        amenities,
        hasRestrooms: amenities.some((a) => RESTROOM_RE.test(a)),
        reservationUrl: meta.reservationUrl ?? f.reservationUrl ?? '',
        tentEligibleSites: tentSites,
        totalSites,
        lastMetadataRefresh: nowIso,
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
