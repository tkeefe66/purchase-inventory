import { writeFile as fsWriteFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export type IOverlanderType = 'wild_camping' | 'informal_campsite' | 'established_campground';

export interface BoondockSpot {
  id: string;
  name: string;
  lat: number;
  lng: number;
  description: string;
  amenities: string[];
  hasRestrooms: boolean;
  lastVerified: string | null;
  sourceUrl: string;
  type: IOverlanderType;
}

export interface IOverlanderSnapshot {
  refreshedAt: string;
  spots: BoondockSpot[];
}

const KEEP_TYPES = new Set<IOverlanderType>(['wild_camping', 'informal_campsite', 'established_campground']);
const RESTROOM_RE = /toilet|restroom|bathroom/i;

export function parseIOverlanderCsv(csv: string): IOverlanderSnapshot {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = parseCsvLine(lines[0] ?? '');
  const idx = (n: string): number => header.indexOf(n);
  const spots: BoondockSpot[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]!);
    const type = String(row[idx('type')] ?? '') as IOverlanderType;
    if (!KEEP_TYPES.has(type)) continue;
    const amenities = (row[idx('amenities')] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    spots.push({
      id: row[idx('id')] ?? '',
      name: row[idx('name')] ?? '',
      lat: Number(row[idx('latitude')] ?? 0),
      lng: Number(row[idx('longitude')] ?? 0),
      description: row[idx('description')] ?? '',
      amenities,
      hasRestrooms: amenities.some((a) => RESTROOM_RE.test(a)),
      lastVerified: row[idx('last_verified')] || null,
      sourceUrl: row[idx('source_url')] ?? '',
      type,
    });
  }
  return { refreshedAt: new Date().toISOString(), spots };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') inQuotes = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export interface DownloadOpts {
  url: string;
  cachePath: string;
  writeFile?: (path: string, content: string) => Promise<void>;
  fetcher?: typeof fetch;
}

export async function downloadAndCacheIOverlander(opts: DownloadOpts): Promise<IOverlanderSnapshot> {
  const fetcher = opts.fetcher ?? fetch;
  const writer = opts.writeFile ?? (async (p, c) => {
    await mkdir(dirname(p), { recursive: true });
    await fsWriteFile(p, c, 'utf-8');
  });
  const resp = await fetcher(opts.url);
  if (!resp.ok) throw new Error(`iOverlander download failed: ${resp.status}`);
  const csv = await resp.text();
  const snap = parseIOverlanderCsv(csv);
  await writer(opts.cachePath, JSON.stringify(snap, null, 2));
  return snap;
}

export async function readIOverlanderSnapshot(path: string): Promise<IOverlanderSnapshot | null> {
  if (!existsSync(path)) return null;
  try { return JSON.parse(await readFile(path, 'utf-8')) as IOverlanderSnapshot; }
  catch { return null; }
}
