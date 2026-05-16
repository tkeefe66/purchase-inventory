export type Agency = 'USFS' | 'BLM' | 'NPS' | 'USACE' | 'FWS' | 'other';
export type UseType = 'overnight' | 'day-use';
export type ReservationType = 'reservation' | 'lottery' | 'walk-up' | 'permit';

/**
 * Booking-windows data derived from Rec.gov's /api/camps/campgrounds/<id>/rates
 * endpoint. Mirrors the timeline shown on the campground page's "Seasons & Fees"
 * tab. All dates are ISO "YYYY-MM-DD" strings (no time-of-day). Null when the
 * rates endpoint didn't return enough data to derive that point.
 */
export interface BookingWindows {
  seasonOpenDate: string | null;       // earliest start of the upcoming cycle
  fcfsStartDate: string | null;        // first "Walk In" / FCFS season start in cycle
  reservableStartDate: string | null;  // first non-FCFS (Peak) season start in cycle
  seasonCloseDate: string | null;      // last end_date in the upcoming cycle
  nextSeasonStartDate: string | null;  // start of the cycle AFTER the upcoming one
}

export interface Facility {
  facilityId: string;
  name: string;
  state: string;
  parentUnit: string;
  region: string | null;
  lat: number;
  lng: number;
  agency: Agency;
  useType: UseType;
  leadTimeDays: number;
  specialReleaseDate: string | null;
  seasonStart: string | null;   // "MM-DD"
  seasonEnd: string | null;     // "MM-DD"
  feeUSD: number;
  reservationType: ReservationType;
  tentEligibleSites: string[];
  totalSites: number;
  restrictions: string[];
  amenities: string[];
  hasRestrooms: boolean;
  reservationUrl: string;
  lastMetadataRefresh: string;  // ISO timestamp
  active: boolean;
  /**
   * The exact moment Rec.gov's daily rolling release fires for this facility,
   * from /api/camps/campgrounds/<id>/releases `current_release.release_time`.
   * Used by release-tick for precise alert timing instead of the 5am-UTC
   * approximation. Optional — only populated when we successfully fetched the
   * releases endpoint during metadata-refresh.
   */
  nextReleaseAtIso?: string | null;
  /**
   * Booking-windows timeline derived from the /rates endpoint. Optional —
   * may be missing for facilities where rates data is sparse or the fetch
   * failed.
   */
  bookingWindows?: BookingWindows | null;
}

export interface CampingIndex {
  facilities: Facility[];
}

export interface PlannedTrip {
  id: string;
  facilityId: string;
  visitDate: string;            // ISO date
  plannedAt: string;            // ISO timestamp
  nudges: { kind: '7-day' | 'release-moment'; firedAt: string | null }[];
  cancelledAt: string | null;
}

export interface CampingTrips {
  trips: PlannedTrip[];
}

export interface RecGovError extends Error {
  code: 'rate_limited' | 'not_found' | 'api_error' | 'schema_error';
  status?: number;
}
