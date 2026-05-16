const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function buildBookingUrl(facilityId: string, visitDate: string): string | null {
  if (!facilityId || !ISO_DATE.test(visitDate)) return null;
  return `https://www.recreation.gov/camping/campgrounds/${facilityId}?startDate=${visitDate}`;
}
