import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import lockfile from 'proper-lockfile';
import type { CampingIndex, CampingTrips } from './reccgov/types.js';

async function readJsonOr<T>(path: string, fallback: T): Promise<T> {
  if (!existsSync(path)) return fallback;
  const raw = await readFile(path, 'utf-8');
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

async function writeJsonWithLock(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Ensure file exists before locking (proper-lockfile requires the target to exist).
  if (!existsSync(path)) await writeFile(path, '{}', 'utf-8');
  const release = await lockfile.lock(path, { retries: { retries: 3, minTimeout: 50 } });
  try {
    await writeFile(path, JSON.stringify(value, null, 2), 'utf-8');
  } finally {
    await release();
  }
}

export async function readCampingIndex(path: string): Promise<CampingIndex> {
  return readJsonOr<CampingIndex>(path, { facilities: [] });
}
export async function writeCampingIndex(path: string, value: CampingIndex): Promise<void> {
  return writeJsonWithLock(path, value);
}
export async function readCampingTrips(path: string): Promise<CampingTrips> {
  return readJsonOr<CampingTrips>(path, { trips: [] });
}
export async function writeCampingTrips(path: string, value: CampingTrips): Promise<void> {
  return writeJsonWithLock(path, value);
}
