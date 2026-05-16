/**
 * Season-window data layer for Rec.gov facilities.
 *
 * Why this file exists: RIDB v1 does NOT expose seasonStart / seasonEnd as
 * structured fields, so T9's metadata-refresh can never populate them from
 * the API. Without a non-null seasonStart, T10's nextSeasonOpenDate returns
 * null and the 90-day season-opener nudge never fires.
 *
 * Strategy: layered defaults.
 *   1. If a facility appears in FACILITY_SEASON_OVERRIDES, use that window.
 *   2. Otherwise use DEFAULT_SEASON.
 *
 * Both are MM-DD strings (no year), matching the existing Facility schema.
 *
 * DEFAULT_SEASON is tuned for CO USFS rolling-release campgrounds — most
 * open around mid-May and close around mid-October. Refine on a per-site
 * basis by adding entries below.
 */

export interface SeasonWindow {
  seasonStart: string;
  seasonEnd: string;
}

export const DEFAULT_SEASON: SeasonWindow = {
  seasonStart: '05-15',
  seasonEnd: '10-15',
};

export const FACILITY_SEASON_OVERRIDES: Record<string, SeasonWindow> = {
  // Add high-priority sites here as you learn their actual open/close dates.
  // Example:
  // '231959': { seasonStart: '05-22', seasonEnd: '10-09' },  // Maroon Bells Amphitheater
};

export function seasonForFacility(facilityId: string): SeasonWindow {
  return FACILITY_SEASON_OVERRIDES[facilityId] ?? DEFAULT_SEASON;
}
