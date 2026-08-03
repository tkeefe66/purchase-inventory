import { createHash } from 'node:crypto';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { assertPublicHttpUrl } from './ssrfGuard.js';

export type SupportedMediaType = 'image/jpeg' | 'image/png' | 'image/webp';
export type ImageStorageError = 'fetch_failed' | 'bad_type' | 'too_large';

export type ImageStorageResult =
  | { ok: true; path: string }
  | { ok: false; error: ImageStorageError };

const MAX_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5000;

const EXT_BY_TYPE: Record<SupportedMediaType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Default storage root. Production = Railway volume `/data`; dev/test = local
 * fallback. Most callers pass an explicit root (the cron and bot do); the API
 * route reads from process.env.IMAGE_STORAGE_ROOT.
 */
export const DEFAULT_STORAGE_ROOT =
  process.env.IMAGE_STORAGE_ROOT ?? './local-data';

/**
 * Deterministic short filename derived from itemId. Re-ingest of the same row
 * overwrites the same file, so we don't accumulate stale variants.
 */
export function imageId(itemId: string): string {
  return createHash('sha1').update(itemId).digest('hex').slice(0, 16);
}

function isSupportedMediaType(t: string): t is SupportedMediaType {
  return t === 'image/jpeg' || t === 'image/png' || t === 'image/webp';
}

export async function saveItemImage(
  itemId: string,
  bytes: Buffer,
  mediaType: SupportedMediaType,
  root: string = DEFAULT_STORAGE_ROOT,
): Promise<ImageStorageResult> {
  if (!isSupportedMediaType(mediaType)) return { ok: false, error: 'bad_type' };
  if (bytes.length > MAX_BYTES) return { ok: false, error: 'too_large' };

  const id = imageId(itemId);
  const ext = EXT_BY_TYPE[mediaType];
  const dir = join(root, 'images');
  await mkdir(dir, { recursive: true });

  const finalPath = join(dir, `${id}.${ext}`);
  const tmp = `${finalPath}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, finalPath);

  return { ok: true, path: `/images/${id}.${ext}` };
}

export async function downloadAndSave(
  itemId: string,
  url: string,
  root: string = DEFAULT_STORAGE_ROOT,
): Promise<ImageStorageResult> {
  const guard = await assertPublicHttpUrl(url);
  if (!guard.ok) return { ok: false, error: 'fetch_failed' };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(url, { signal: ac.signal });
  } catch {
    clearTimeout(timer);
    return { ok: false, error: 'fetch_failed' };
  }
  clearTimeout(timer);

  if (!resp.ok) return { ok: false, error: 'fetch_failed' };

  const declaredLength = Number(resp.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_BYTES) return { ok: false, error: 'too_large' };

  const contentType = (resp.headers.get('content-type') ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase() ?? '';
  if (!isSupportedMediaType(contentType)) return { ok: false, error: 'bad_type' };

  const buf = Buffer.from(await resp.arrayBuffer());
  return saveItemImage(itemId, buf, contentType, root);
}
