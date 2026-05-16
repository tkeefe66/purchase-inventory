import { describe, test, expect, vi } from 'vitest';
import { parseIOverlanderCsv, downloadAndCacheIOverlander } from '../../../lib/iOverlander/cache.js';

const SAMPLE_CSV = `id,name,latitude,longitude,description,amenities,type,last_verified,source_url
abc,Wild Spot 1,39.5,-107.0,Free dispersed,"toilets,water",wild_camping,2025-10-01,https://example.com/1
xyz,Gas Station,40.0,-108.0,Just gas,"","gas_station",2025-09-01,https://example.com/2
def,Boondock 2,38.0,-105.5,Quiet spot,"fire_pit",informal_campsite,,https://example.com/3
`;

describe('parseIOverlanderCsv', () => {
  test('keeps only camping-eligible types', () => {
    const out = parseIOverlanderCsv(SAMPLE_CSV);
    expect(out.spots).toHaveLength(2);
    expect(out.spots.map((s) => s.id).sort()).toEqual(['abc', 'def']);
  });
  test('derives hasRestrooms from amenities', () => {
    const out = parseIOverlanderCsv(SAMPLE_CSV);
    const spot = out.spots.find((s) => s.id === 'abc')!;
    expect(spot.hasRestrooms).toBe(true);
    const spot2 = out.spots.find((s) => s.id === 'def')!;
    expect(spot2.hasRestrooms).toBe(false);
  });
  test('refreshedAt is set', () => {
    const out = parseIOverlanderCsv(SAMPLE_CSV);
    expect(out.refreshedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('downloadAndCacheIOverlander', () => {
  test('writes a snapshot file', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(SAMPLE_CSV, { status: 200 }));
    const writes: { path: string; content: string }[] = [];
    const writer = async (path: string, content: string) => { writes.push({ path, content }); };
    await downloadAndCacheIOverlander({
      url: 'https://example.com/io.csv',
      cachePath: '/tmp/io.json',
      writeFile: writer,
    });
    expect(writes).toHaveLength(1);
    const snap = JSON.parse(writes[0]!.content);
    expect(snap.spots.length).toBeGreaterThan(0);
  });
});
