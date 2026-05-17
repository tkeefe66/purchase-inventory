/**
 * Shared types for dispersed-camping data sources (USFS, BLM, OSM).
 *
 * Distinct from `Facility` in `lib/reccgov/types.ts`: a Facility is a
 * *reservable* developed Rec.gov campground (has booking windows, lead time,
 * release moments). A DispersedSpot is a walk-up / FCFS pin somewhere on
 * federal or community-tagged land — no reservation, no release moment, no
 * fee tracking.
 */

export type DispersedSource = 'USFS' | 'BLM' | 'OSM';

export interface DispersedSpot {
  /** Which data system this spot came from. */
  source: DispersedSource;
  /** Source-local unique ID (USFS recareaid, BLM ObjectID, OSM node/way id). */
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Free-text description. May be empty (OSM rarely has one). */
  description: string;
  /** Land-managing agency string (e.g. "Modoc National Forest", "BLM Salt Lake FO", "OSM community"). */
  agency: string;
  /** Best-effort amenity tags, lowercase. */
  amenities: string[];
  /** Derived from amenities / description keywords. */
  hasRestrooms: boolean;
  /** Link back to the original source page, if available. */
  sourceUrl: string;
  /** ISO date string if the source records when the data was last verified. */
  lastVerified: string | null;
}

export interface DispersedSnapshot {
  refreshedAt: string;
  spots: DispersedSpot[];
}

export interface Bbox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** The Western US bounding box we filter to for all dispersed sources. */
export const WESTERN_US_BBOX: Bbox = {
  minLat: 31.0,    // S edge of AZ/NM
  maxLat: 49.0,    // N edge of MT/ID
  minLng: -125.0,  // W edge of NV/CA-adj
  maxLng: -102.0,  // E edge of CO/NM/MT
};

export const WESTERN_US_STATES: readonly string[] = ['CO', 'UT', 'WY', 'AZ', 'NM', 'NV', 'ID', 'MT'];
