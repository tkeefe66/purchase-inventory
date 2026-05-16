import type { CampingIndex, Facility } from '../../../lib/reccgov/types.js';
import type { RecGovClient } from '../../../lib/reccgov/client.js';
import { regionForParentUnit } from '../../../lib/reccgov/regions.js';
import type { SheetsClient } from '../../../lib/sheets.js';
import { mirrorCampingIndex } from '../../../lib/sheets.js';

export interface RunIndexRefreshOpts {
  existingIndex: CampingIndex;
  client: RecGovClient;
  mirror?: typeof mirrorCampingIndex;
  sheets: SheetsClient;
  sheetSpreadsheetId: string;
}

export interface IndexRefreshResult {
  index: CampingIndex;
  added: number;
  deactivated: number;
  totalActive: number;
}

export async function runIndexRefresh(opts: RunIndexRefreshOpts): Promise<IndexRefreshResult> {
  const mirror = opts.mirror ?? mirrorCampingIndex;

  // Page through Rec.gov until exhausted.
  const all: Partial<Facility>[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const page = await opts.client.searchFacilities({ state: 'CO', limit, offset });
    if (page.length === 0) break;
    all.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }

  if (all.length === 0 && opts.existingIndex.facilities.length > 0) {
    throw new Error(
      `Rec.gov returned 0 facilities but existing index has ${opts.existingIndex.facilities.length} — refusing to deactivate everything (critical data loss guard).`
    );
  }

  // Build a map from existing facilities, using it as the source of truth for merge.
  const byId = new Map(opts.existingIndex.facilities.map((f) => [f.facilityId, { ...f }]));
  const seen = new Set<string>();
  let added = 0;

  // Update existing or add new facilities.
  for (const fresh of all) {
    if (!fresh.facilityId) continue;
    seen.add(fresh.facilityId);

    const existing = byId.get(fresh.facilityId);
    const region = regionForParentUnit(fresh.parentUnit ?? '');

    if (existing) {
      // Update existing facility's mutable fields.
      existing.name = fresh.name ?? existing.name;
      existing.parentUnit = fresh.parentUnit ?? existing.parentUnit;
      existing.region = region;
      existing.lat = fresh.lat ?? existing.lat;
      existing.lng = fresh.lng ?? existing.lng;
      existing.useType = fresh.useType ?? existing.useType;
      existing.active = true;
    } else {
      // Add new facility with defaults.
      added++;
      byId.set(fresh.facilityId, {
        facilityId: fresh.facilityId,
        name: fresh.name ?? '',
        state: 'CO',
        parentUnit: fresh.parentUnit ?? '',
        region,
        lat: fresh.lat ?? 0,
        lng: fresh.lng ?? 0,
        agency: 'USFS',
        useType: fresh.useType ?? 'overnight',
        leadTimeDays: 0,
        specialReleaseDate: null,
        seasonStart: null,
        seasonEnd: null,
        feeUSD: 0,
        reservationType: 'reservation',
        tentEligibleSites: [],
        totalSites: 0,
        restrictions: [],
        amenities: [],
        hasRestrooms: false,
        reservationUrl: '',
        lastMetadataRefresh: '',
        active: true,
      });
    }
  }

  // Deactivate facilities no longer in Rec.gov.
  let deactivated = 0;
  for (const f of byId.values()) {
    if (!seen.has(f.facilityId) && f.active) {
      f.active = false;
      deactivated++;
    }
  }

  const index: CampingIndex = { facilities: Array.from(byId.values()) };
  await mirror(opts.sheets, opts.sheetSpreadsheetId, index.facilities);

  return {
    index,
    added,
    deactivated,
    totalActive: index.facilities.filter((f) => f.active).length,
  };
}
