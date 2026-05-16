import { describe, test, expect, vi } from 'vitest';
import { mirrorCampingIndex, readMutedFacilityIds } from '../../lib/sheets.js';
import type { Facility } from '../../lib/reccgov/types.js';

const HEADER = [
  'Facility ID', 'Name', 'Site URL', 'Map URL',
  'Agency', 'Parent Unit', 'Region', 'Lat', 'Lng',
  'Lead Days', 'Special Release', 'Season Start', 'Season End', 'Fee',
  'Reservation Type', 'Use Type', 'Restrictions', 'Has Restrooms',
  'Amenities', 'Tent-Eligible Sites', 'Active',
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
      // 25 cols: ID(0), Name(1), Site URL(2), Map URL(3), Agency(4), ParentUnit(5),
      // Region(6), Lat(7), Lng(8), LeadDays(9), SpecialRelease(10), SeasonStart(11),
      // SeasonEnd(12), Fee(13), ReservationType(14), UseType(15), Restrictions(16),
      // HasRestrooms(17), Amenities(18), TentSites(19), Active(20),
      // NextCalendarOpens(21), NextReminderFires(22), Muted(23), Notes(24)
      existingRows: [['F1', 'Old Name', '', '', 'USFS', '', '', 0, 0, 0, '', '', '', 0, '', '', '', false, '', '', false, '', '', true, 'my notes']],
    });
    await mirrorCampingIndex(sheets as never, 'sid', [sampleFacility]);
    expect(updated.length).toBeGreaterThan(0);
    const updatedRow = updated.find((u) => u.range.includes('A2'))!.values[0]!;
    expect(updatedRow[1]).toBe('Test CG');         // Name updated
    expect(updatedRow[23]).toBe(true);              // Muted preserved (col index 23)
    expect(updatedRow[24]).toBe('my notes');        // Notes preserved (col index 24)
  });

  test('writes computed Next Calendar Opens + Next Reminder Fires for rolling-release sites', async () => {
    const { sheets, appended } = mockSheets({ existingTabs: ['All Purchases', 'Camping Index'] });
    await mirrorCampingIndex(sheets as never, 'sid', [sampleFacility]);
    expect(appended).toHaveLength(1);
    const nextOpens = appended[0]![21] as string;       // col index 21
    const nextReminder = appended[0]![22] as string;    // col index 22
    expect(nextOpens).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(nextReminder).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(nextReminder < nextOpens).toBe(true);
  });

  test('writes constructed Site URL + Map URL for each facility', async () => {
    const { sheets, appended } = mockSheets({ existingTabs: ['All Purchases', 'Camping Index'] });
    await mirrorCampingIndex(sheets as never, 'sid', [sampleFacility]);
    expect(appended[0]![2]).toBe('https://www.recreation.gov/camping/campgrounds/F1');
    expect(appended[0]![3]).toBe('https://www.google.com/maps?q=39,-106');
  });

  test('Site URL is blank for inactive facilities (Rec.gov error page); Map URL still emitted', async () => {
    const inactiveFacility: Facility = { ...sampleFacility, facilityId: 'F2', active: false };
    const { sheets, appended } = mockSheets({ existingTabs: ['All Purchases', 'Camping Index'] });
    await mirrorCampingIndex(sheets as never, 'sid', [inactiveFacility]);
    expect(appended[0]![2]).toBe('');                                    // Site URL blank
    expect(appended[0]![3]).toBe('https://www.google.com/maps?q=39,-106'); // Map URL still works
  });
});

describe('readMutedFacilityIds', () => {
  test('returns Facility IDs where Muted=TRUE', async () => {
    const { sheets } = mockSheets({
      existingTabs: ['All Purchases', 'Camping Index'],
      // 25-col rows: Muted at index 23
      existingRows: [
        ['F1', 'A', '', '', 'USFS', '', '', 0, 0, 0, '', '', '', 0, '', '', '', false, '', '', true, '', '', true, ''],
        ['F2', 'B', '', '', 'USFS', '', '', 0, 0, 0, '', '', '', 0, '', '', '', false, '', '', true, '', '', false, ''],
        ['F3', 'C', '', '', 'USFS', '', '', 0, 0, 0, '', '', '', 0, '', '', '', false, '', '', true, '', '', 'TRUE', ''],
      ],
    });
    const out = await readMutedFacilityIds(sheets as never, 'sid');
    expect(out.sort()).toEqual(['F1', 'F3']);
  });
});
