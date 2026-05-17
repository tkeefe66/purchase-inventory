import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DispersedSnapshot } from './types.js';

/**
 * Read the merged dispersed-camping snapshot (USFS + BLM + OSM) from disk.
 * Returns null if the file doesn't exist or fails to parse — callers should
 * fall back to an empty `{ refreshedAt: '', spots: [] }` so search still
 * works without dispersed sources.
 */
export async function readDispersedSnapshot(path: string): Promise<DispersedSnapshot | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as DispersedSnapshot;
  } catch {
    return null;
  }
}

export async function writeDispersedSnapshot(path: string, snap: DispersedSnapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(snap, null, 2), 'utf-8');
}
