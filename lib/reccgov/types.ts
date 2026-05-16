export type Agency = 'USFS' | 'BLM' | 'NPS' | 'USACE' | 'FWS' | 'other';
export type UseType = 'overnight' | 'day-use';
export type ReservationType = 'reservation' | 'lottery' | 'walk-up' | 'permit';

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
