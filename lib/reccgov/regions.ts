export const CURATED_REGIONS: Record<string, string[]> = {
  'Front Range': [
    'Roosevelt National Forest',
    'Arapaho National Forest',
    'Pike National Forest',
    'Rocky Mountain National Park',
  ],
  'Western Slope': [
    'White River National Forest',
    'Grand Mesa, Uncompahgre and Gunnison National Forests',
    'Black Canyon of the Gunnison National Park',
    'Colorado National Monument',
  ],
  'San Juans': [
    'San Juan National Forest',
    'Rio Grande National Forest',
    'Mesa Verde National Park',
  ],
  'Sangres': [
    'San Isabel National Forest',
    'Great Sand Dunes National Park',
  ],
  'Northern Mountains': [
    'Routt National Forest',
    'Medicine Bow-Routt National Forest',
  ],
};

/**
 * Look up the curated region label for a given Rec.gov parent unit name.
 * Returns null if the parent unit isn't mapped — index-refresh logs these for follow-up curation.
 */
export function regionForParentUnit(parentUnit: string): string | null {
  for (const [region, parents] of Object.entries(CURATED_REGIONS)) {
    if (parents.includes(parentUnit)) return region;
  }
  return null;
}
