/**
 * RIDB rec area IDs for the parent units that contain CO campgrounds.
 *
 * Why this list exists: RIDB's `?state=CO` facility filter is buggy — it
 * misses many real CO campgrounds (White River NF Silver Bar/Bell/Queen,
 * Maroon Bells Amphitheatre, Blue River, Prairie Point, etc.) because of
 * inconsistencies in how `state` matches against the facility address
 * records. Querying by parent rec area (`/recareas/<id>/facilities`) is
 * authoritative — it returns every facility under that unit regardless
 * of address quirks.
 *
 * Adding a new national forest / park here automatically pulls all its
 * facilities into the index on the next refresh.
 */
export const CURATED_REC_AREA_IDS: ReadonlyArray<{ id: number; name: string }> = [
  { id: 1051, name: 'Arapaho & Roosevelt National Forests Pawnee NG' },
  { id: 1052, name: 'Grand Mesa, Uncompahgre and Gunnison National Forest' },
  { id: 1053, name: 'PSICC (Pike-San Isabel-Cimarron-Comanche)' },
  { id: 1054, name: 'San Juan National Forest' },
  { id: 1055, name: 'White River National Forest' },
  { id: 1059, name: 'Medicine Bow-Routt NFs & Thunder Basin NG' },
  { id: 2018, name: 'Rio Grande National Forest' },
  { id: 2592, name: 'Black Canyon of the Gunnison National Park' },
  { id: 2641, name: 'Colorado National Monument' },
  { id: 2651, name: 'Curecanti National Recreation Area' },
  { id: 2664, name: 'Dinosaur National Monument' },
  { id: 2738, name: 'Great Sand Dunes National Park & Preserve' },
  { id: 2824, name: 'Mesa Verde National Park' },
  { id: 2907, name: 'Rocky Mountain National Park' },
];

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
