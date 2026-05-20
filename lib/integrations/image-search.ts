import { isBlockedHost } from './image-lookup.js';

/**
 * One image result we accept from the search API. Compact subset of the
 * Google Custom Search response.
 */
export interface ImageSearchResult {
  /** The image URL we'd write to the sheet and fetch bytes from. */
  url: string;
  /** The page the image is embedded on (for audit/debug, not used today). */
  pageUrl: string;
  width?: number | undefined;
  height?: number | undefined;
}

export interface ImageSearchConfig {
  apiKey: string;
  cseId: string;
  /** Override fetch for tests. */
  fetchFn?: typeof fetch;
}

const ENDPOINT = 'https://www.googleapis.com/customsearch/v1';

interface CseResponseItem {
  link?: unknown;
  image?: {
    contextLink?: unknown;
    width?: unknown;
    height?: unknown;
  };
}

interface CseResponse {
  items?: CseResponseItem[];
  error?: { message?: unknown; code?: unknown };
}

/**
 * Calls Google Custom Search (searchType=image) for the given product and
 * returns the first acceptable result, or null. Acceptable = absolute https
 * URL, host not on the blocklist (Pinterest, eBay, etc.), ends with a
 * recognizable image extension or is on a known CDN path.
 *
 * The Google free tier is 100 queries/day; over that, calls return 429 and
 * we surface null (cache treats as tried-null). Errors are logged but do
 * not throw — image search is opportunistic.
 */
export async function searchProductImage(
  brand: string,
  itemName: string,
  config: ImageSearchConfig,
): Promise<ImageSearchResult | null> {
  const q = `${brand} ${itemName}`.trim();
  if (!q) return null;

  const params = new URLSearchParams({
    key: config.apiKey,
    cx: config.cseId,
    q,
    searchType: 'image',
    num: '10',
    safe: 'active',
  });

  const fetchFn = config.fetchFn ?? fetch;
  let resp: Response;
  try {
    resp = await fetchFn(`${ENDPOINT}?${params.toString()}`);
  } catch (err) {
    console.warn(
      `[image-search] fetch failed for "${q}": ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }

  if (!resp.ok) {
    let detail = '';
    try {
      const body = (await resp.json()) as CseResponse;
      detail = body.error?.message ? String(body.error.message) : '';
    } catch {
      /* ignore */
    }
    console.warn(`[image-search] ${resp.status} for "${q}"${detail ? `: ${detail}` : ''}`);
    return null;
  }

  let body: CseResponse;
  try {
    body = (await resp.json()) as CseResponse;
  } catch {
    return null;
  }
  const items = Array.isArray(body.items) ? body.items : [];

  for (const item of items) {
    const url = typeof item.link === 'string' ? item.link.trim() : '';
    if (!url) continue;
    if (!/^https:\/\//i.test(url)) continue;
    if (isBlockedHost(url)) continue;
    if (!looksLikeImageUrl(url)) continue;
    const pageUrl =
      typeof item.image?.contextLink === 'string' ? item.image.contextLink : '';
    const w = item.image?.width;
    const h = item.image?.height;
    return {
      url,
      pageUrl,
      width: typeof w === 'number' ? w : undefined,
      height: typeof h === 'number' ? h : undefined,
    };
  }

  return null;
}

/**
 * Accept either standard image-extension URLs or a few well-known dynamic
 * CDN paths (Amazon's /images/I/, REI's /media/product/, L.L.Bean's
 * /is/image/, etc.). Rejects HTML pages even when they slip through.
 */
function looksLikeImageUrl(url: string): boolean {
  if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) return true;
  if (/\/images\/I\//i.test(url)) return true;       // m.media-amazon.com
  if (/\/media\/product\//i.test(url)) return true;  // rei.com
  if (/\/is\/image\//i.test(url)) return true;       // llbean.com, scene7-style
  return false;
}

/**
 * Reads GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID from process.env. Returns null
 * if either is missing — callers should treat that as "image search not
 * configured" and skip without erroring.
 */
export function readImageSearchEnv(): ImageSearchConfig | null {
  const apiKey = process.env['GOOGLE_CSE_API_KEY'];
  const cseId = process.env['GOOGLE_CSE_ID'];
  if (!apiKey || !cseId) return null;
  return { apiKey, cseId };
}
