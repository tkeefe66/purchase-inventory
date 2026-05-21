import { describe, test, expect, vi } from 'vitest';
import { appendRejectedImage } from '../../lib/sheets.js';

const HEADER = ['Order ID', 'Product URL', 'Item Name', 'Rejected URL', 'Rejected At', 'Source Before'];

function mockSheets(opts: { existingTabs: string[] }) {
  const updated: { range: string; values: unknown[][] }[] = [];
  const appended: unknown[][] = [];
  const created: string[] = [];
  const sheets = {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({
        data: { sheets: opts.existingTabs.map((t) => ({ properties: { title: t } })) },
      }),
      batchUpdate: vi.fn(async (req: { requestBody: { requests: { addSheet: { properties: { title: string } } }[] } }) => {
        for (const r of req.requestBody.requests) created.push(r.addSheet.properties.title);
        return { data: {} };
      }),
      values: {
        update: vi.fn(async (req: { range: string; requestBody: { values: unknown[][] } }) => {
          updated.push({ range: req.range, values: req.requestBody.values });
          return { data: {} };
        }),
        append: vi.fn(async (req: { requestBody: { values: unknown[][] } }) => {
          appended.push(...req.requestBody.values);
          return { data: {} };
        }),
      },
    },
  };
  return { sheets, updated, appended, created };
}

describe('appendRejectedImage', () => {
  test('appends a new row when tab exists', async () => {
    const { sheets, appended, created } = mockSheets({ existingTabs: ['Rejected Images'] });
    await appendRejectedImage(sheets as never, 'sid', {
      orderId: 'A123',
      productUrl: 'https://example.com/p',
      itemName: 'Test Jacket',
      rejectedUrl: 'https://cdn.example.com/wrong.jpg',
      rejectedAt: '2026-05-21T19:00:00-06:00',
      sourceBefore: 'cdn.example.com',
    });
    expect(created).not.toContain('Rejected Images');
    expect(appended).toHaveLength(1);
    expect(appended[0]).toEqual([
      'A123',
      'https://example.com/p',
      'Test Jacket',
      'https://cdn.example.com/wrong.jpg',
      '2026-05-21T19:00:00-06:00',
      'cdn.example.com',
    ]);
  });

  test('creates the tab and writes headers when missing', async () => {
    const { sheets, appended, created, updated } = mockSheets({ existingTabs: ['All Purchases'] });
    await appendRejectedImage(sheets as never, 'sid', {
      orderId: 'A123',
      productUrl: '',
      itemName: 'Test Jacket',
      rejectedUrl: '/images/abc.jpg',
      rejectedAt: '2026-05-21T19:00:00-06:00',
      sourceBefore: 'local',
    });
    expect(created).toContain('Rejected Images');
    expect(updated).toEqual([
      { range: `'Rejected Images'!A1`, values: [HEADER] },
    ]);
    expect(appended).toHaveLength(1);
  });

  test('does not re-write headers when tab already exists', async () => {
    const { sheets, updated } = mockSheets({ existingTabs: ['Rejected Images'] });
    await appendRejectedImage(sheets as never, 'sid', {
      orderId: 'A123',
      productUrl: '',
      itemName: 'X',
      rejectedUrl: 'https://example.com/x.jpg',
      rejectedAt: '2026-05-21T19:00:00-06:00',
      sourceBefore: 'example.com',
    });
    expect(updated).toEqual([]);
  });
});
