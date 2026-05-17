import { describe, test, expect, vi } from 'vitest';
import { mirrorCampingIndex, readMutedFacilityIds } from '../../lib/sheets.js';
import type { Facility } from '../../lib/reccgov/types.js';

const HEADER = [
  'Facility ID', 'Name', 'Site URL', 'Map URL', 'Photo',
  'Agency', 'Parent Unit', 'Region', 'Lat', 'Lng',
  'Lead Days', 'Special Release', 'Fee',
  'Reservation Type', 'Use Type', 'Restrictions',
  'Tent-Eligible Sites', 'Active',
  'Rating', '# Reviews', 'Cell Coverage', 'Accessible Sites', 'Max RV Length (ft)',
  'Pets Allowed', 'Has Restrooms', 'Restroom Type', 'Drinking Water',
  'Season Opens', 'FCFS Start', 'Reservable Start', 'Season Close', 'Next Season Opens',
  'Next Release Moment',
  'Next Calendar Opens', 'Next Reminder Fires',
  'Muted', 'Notes',
];

function mockSheets(opts: { existingTabs: string[]; existingRows?: (string | number | boolean)[][] }) {
  const updated: { range: string; values: unknown[][] }[] = [];
  const appended: unknown[][] = [];
  const created: string[] = [];
  const sheets = {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({ data: { sheets: opts.existingTabs.map((t) => ({ properties: { title: t } })) } }),
      batchUpdate: vi.fn(async (req: { requestBody: { requests: { addSheet: { properties: { title: string } } }[] } }) => {
        for (const r of req.requestBody.requests) created.push(r.addSheet.properties.title);
        return { data: {} };
      }),
      values: {
        get: vi.fn().mockResolvedValue({
          data: { values: opts.existingRows ? [HEADER, ...opts.existingRows] : [HEADER] },
        }),
        update: vi.fn(async (req: { range: string; requestBody: { values: unknown[][] } }) => {
          updated.push({ range: req.range, values: req.requestBody.values });
          return { data: {} };
        }),
        append: vi.fn(async (req: { requestBody: { values: unknown[][] } }) => {
          appended.push(...req.requestBody.values);
          return { data: {} };
        }),
        batchUpdate: vi.fn(async (req: { requestBody: { data: { range: string; values: unknown[][] }[] } }) => {
          for (const d of req.requestBody.data) updated.push({ range: d.range, values: d.values });
          return { data: {} };
        }),
      },
    },
  };
  return { sheets, updated, appended, created };
}

const sampleFacility: Facility = {
  facilityId: 'F1', name: 'Test CG', state: 'CO', parentUnit: 'Test NF', region: 'Front Range',
  lat: 39, lng: -106, agency: 'USFS', useType: 'overnight',
  leadTimeDays: 180, specialReleaseDate: null, seasonStart: '05-15', seasonEnd: '10-15',
  feeUSD: 0, reservationType: 'reservation',
  tentEligibleSites: ['S1', 'S2'], totalSites: 5,
  restrictions: ['no fires'], amenities: ['Vault Toilets'], hasRestrooms: true,
  reservationUrl: 'https://example.com', lastMetadataRefresh: '2026-05-15T00:00:00Z', active: true,
};

describe('mirrorCampingIndex', () => {
  test('creates Camping Index tab when missing and writes header', async () => {
    const { sheets, created } = mockSheets({ existingTabs: ['All Purchases'] });
    await mirrorCampingIndex(sheets as never, 'sid', [sampleFacility]);
    expect(created).toContain('Camping Index');
  });

  test('appends new facilities when tab is empty', async () => {
    const { sheets, appended } = mockSheets({ existingTabs: ['All Purchases', 'Camping Index'] });
    await mirrorCampingIndex(sheets as never, 'sid', [sampleFacility]);
    expect(appended).toHaveLength(1);
    expect(appended[0]![0]).toBe('F1');
  });

  test('updates existing rows by Facility ID without touching Muted or Notes', async () => {
    const { sheets, updated } = mockSheets({
      existingTabs: ['All Purchases', 'Camping Index'],
      // 37 cols. Muted at 35, Notes at 36.
      existingRows: [Array.from({ length: 37 }, (_, i) => {
        if (i === 0) return 'F1';
        if (i === 1) return 'Old Name';
        if (i === 35) return true;          // Muted
        if (i === 36) return 'my notes';    // Notes
        return '';
      })],
    });
    await mirrorCampingIndex(sheets as never, 'sid', [sampleFacility]);
    expect(updated.length).toBeGreaterThan(0);
    const updatedRow = updated.find((u) => u.range.includes('A2'))!.values[0]!;
    expect(updatedRow[1]).toBe('Test CG');
    expect(updatedRow[35]).toBe(true);              // Muted preserved
    expect(updatedRow[36]).toBe('my notes');        // Notes preserved
  });

  test('writes computed Next Calendar Opens + Next Reminder Fires for rolling-release sites', async () => {
    const { sheets, appended } = mockSheets({ existingTabs: ['All Purchases', 'Camping Index'] });
    await mirrorCampingIndex(sheets as never, 'sid', [sampleFacility]);
    expect(appended).toHaveLength(1);
    const nextOpens = appended[0]![33] as string;
    const nextReminder = appended[0]![34] as string;
    expect(nextOpens).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(nextReminder).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(nextReminder < nextOpens).toBe(true);
  });

  test('writes Tier-3 booking-windows columns when facility has bookingWindows data', async () => {
    const facilityWithBW: Facility = {
      ...sampleFacility,
      bookingWindows: {
        seasonOpenDate: '2026-05-15',
        fcfsStartDate: '2026-05-15',
        reservableStartDate: '2026-05-22',
        seasonCloseDate: '2026-09-21',
        nextSeasonStartDate: '2027-06-04',
      },
      nextReleaseAtIso: '2026-05-16T17:00:00-04:00',
    };
    const { sheets, appended } = mockSheets({ existingTabs: ['All Purchases', 'Camping Index'] });
    await mirrorCampingIndex(sheets as never, 'sid', [facilityWithBW]);
    expect(appended[0]![27]).toBe('2026-05-15');   // Season Opens
    expect(appended[0]![28]).toBe('2026-05-15');   // FCFS Start
    expect(appended[0]![29]).toBe('2026-05-22');   // Reservable Start
    expect(appended[0]![30]).toBe('2026-09-21');   // Season Close
    expect(appended[0]![31]).toBe('2027-06-04');   // Next Season Opens
    expect(appended[0]![32]).toMatch(/2026-05-16 15:00 MDT/); // Next Release Moment
  });

  test('emits blanks for Tier-3 columns when bookingWindows is absent', async () => {
    const { sheets, appended } = mockSheets({ existingTabs: ['All Purchases', 'Camping Index'] });
    await mirrorCampingIndex(sheets as never, 'sid', [sampleFacility]);
    expect(appended[0]![27]).toBe('');
    expect(appended[0]![28]).toBe('');
    expect(appended[0]![29]).toBe('');
    expect(appended[0]![30]).toBe('');
    expect(appended[0]![31]).toBe('');
    expect(appended[0]![32]).toBe('');
  });

  test('writes constructed Site URL + Map URL for each facility', async () => {
    const { sheets, appended } = mockSheets({ existingTabs: ['All Purchases', 'Camping Index'] });
    await mirrorCampingIndex(sheets as never, 'sid', [sampleFacility]);
    expect(appended[0]![2]).toBe('https://www.recreation.gov/camping/campgrounds/F1');
    expect(appended[0]![3]).toBe('https://www.google.com/maps?q=39,-106');
  });

  test('Site URL blank for inactive facilities (Rec.gov dead-link); Map URL still emitted', async () => {
    const inactiveFacility: Facility = { ...sampleFacility, facilityId: 'F2', active: false };
    const { sheets, appended } = mockSheets({ existingTabs: ['All Purchases', 'Camping Index'] });
    await mirrorCampingIndex(sheets as never, 'sid', [inactiveFacility]);
    expect(appended[0]![2]).toBe('');
    expect(appended[0]![3]).toBe('https://www.google.com/maps?q=39,-106');
  });
});

describe('readMutedFacilityIds', () => {
  test('returns Facility IDs where Muted=TRUE', async () => {
    const { sheets } = mockSheets({
      existingTabs: ['All Purchases', 'Camping Index'],
      // 37 cols. Active at index 17, Muted at 35.
      existingRows: [
        { id: 'F1', muted: true },
        { id: 'F2', muted: false },
        { id: 'F3', muted: 'TRUE' },
      ].map((spec) => Array.from({ length: 37 }, (_, i) => {
        if (i === 0) return spec.id;
        if (i === 17) return true;
        if (i === 35) return spec.muted;
        return '';
      })),
    });
    const out = await readMutedFacilityIds(sheets as never, 'sid');
    expect(out.sort()).toEqual(['F1', 'F3']);
  });
});
