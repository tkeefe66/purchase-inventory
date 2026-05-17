import type { CampingIndex, Facility } from '../../../lib/reccgov/types.js';
import type { RecGovClient } from '../../../lib/reccgov/client.js';
import { regionForParentUnit, CURATED_REC_AREA_IDS } from '../../../lib/reccgov/regions.js';
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

  // Enumerate facilities under each curated parent rec area. RIDB's `?state=CO`
  // facility filter is buggy — misses ~30% of real CO campgrounds (Silver
  // Bar/Bell/Queen, Maroon Bells Amphitheatre, Blue River, etc.) because of
  // address-field inconsistencies. Querying /recareas/<id>/facilities is
  // authoritative within each parent unit.
  const all: Array<Partial<Facility> & { _parentName?: string }> = [];
  const limit = 50;
  for (const recArea of CURATED_REC_AREA_IDS) {
    let offset = 0;
    try {
      while (true) {
        const page = await opts.client.searchFacilitiesByRecArea({ recAreaId: recArea.id, limit, offset });
        if (page.length === 0) break;
        for (const f of page) {
          // The /recareas/<id>/facilities endpoint doesn't include the RECAREA
          // child on each facility, so mapSearchRow's parentUnit lookup gets
          // an empty string. Re-parent using the rec area we're querying.
          all.push({ ...f, parentUnit: f.parentUnit || recArea.name });
        }
        if (page.length < limit) break;
        offset += limit;
      }
    } catch (err) {
      console.warn(`[index-refresh] rec area ${recArea.id} (${recArea.name}) failed:`, err instanceof Error ? err.message : err);
    }
  }

  if (all.length === 0 && opts.existingIndex.facilities.length > 0) {
    throw new Error(
      `Rec.gov returned 0 facilities across all curated rec areas but existing index has ${opts.existingIndex.facilities.length} — refusing to deactivate everything (critical data loss guard).`
    );
  }

  // Build a map from existing facilities, using it as the source of truth for merge.
  const byId = new Map(opts.existingIndex.facilities.map((f) => [f.facilityId, { ...f }]));
  const seen = new Set<string>();
  let added = 0;

  // Update existing or add new facilities. A facility can appear in multiple
  // rec areas (rare, but possible) — first-write-wins via the seen set.
  for (const fresh of all) {
    if (!fresh.facilityId || seen.has(fresh.facilityId)) continue;
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
      // Backfill provenance on existing rows: anything that came back from a
      // Rec.gov RIDB call is `rec.gov`-sourced by definition.
      existing.source = existing.source ?? 'rec.gov';
    } else {
      // Add new facility with defaults.
      added++;
      byId.set(fresh.facilityId, {
        facilityId: fresh.facilityId,
        name: fresh.name ?? '',
        source: 'rec.gov',
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
