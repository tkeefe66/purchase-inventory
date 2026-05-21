import { isBlockedHost } from './image-lookup.js';

/**
 * One image result we accept from the search API. Compact subset of the
 * provider's full response.
 */
export interface ImageSearchResult {
  /** The image URL we'd write to the sheet and fetch bytes from. */
  url: string;
  /** The page the image is embedded on (for audit/debug, not used today). */
  pageUrl: string;
  width?: number | undefined;
  height?: number | undefined;
}

/**
 * Image-search providers we know about. Brave is the default — it has a
 * clean free-tier signup and a single API key. Google CSE is kept as a
 * fallback so any existing config still resolves, but Google has closed
 * the Custom Search JSON API to new customers (May 2026), so new keys
 * will 403 with "project does not have the access" regardless of setup.
 */
export type ImageSearchProvider = 'brave' | 'google-cse';

export type ImageSearchConfig =
  | {
      provider: 'brave';
      apiKey: string;
      fetchFn?: typeof fetch;
    }
  | {
      provider: 'google-cse';
      apiKey: string;
      cseId: string;
      fetchFn?: typeof fetch;
    };

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/images/search';
const GOOGLE_ENDPOINT = 'https://www.googleapis.com/customsearch/v1';

/**
 * Dispatches to the configured provider. Returns the first acceptable image
 * result (https, non-blocked host, looks-like-image URL) or null.
 *
 * Errors are logged but never thrown — image search is opportunistic.
 */
export async function searchProductImage(
  brand: string,
  itemName: string,
  config: ImageSearchConfig,
): Promise<ImageSearchResult | null> {
  const q = `${brand} ${itemName}`.trim();
  if (!q) return null;

  if (config.provider === 'brave') {
    return searchBrave(q, config);
  }
  return searchGoogleCse(q, config);
}

// ---------------------------------------------------------------------------
// Brave Search — images endpoint
// ---------------------------------------------------------------------------

interface BraveImageResult {
  url?: unknown;
  source?: unknown;
  thumbnail?: {
    src?: unknown;
    original?: unknown;
  };
  properties?: {
    url?: unknown;
  };
}

interface BraveResponse {
  results?: BraveImageResult[];
  type?: unknown;
}

async function searchBrave(
  q: string,
  config: Extract<ImageSearchConfig, { provider: 'brave' }>,
): Promise<ImageSearchResult | null> {
  const params = new URLSearchParams({ q, count: '10', safesearch: 'strict' });
  const fetchFn = config.fetchFn ?? fetch;
  let resp: Response;
  try {
    resp = await fetchFn(`${BRAVE_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': config.apiKey,
      },
    });
  } catch (err) {
    console.warn(
      `[image-search:brave] fetch failed for "${q}": ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }

  if (!resp.ok) {
    console.warn(`[image-search:brave] ${resp.status} for "${q}"`);
    return null;
  }

  let body: BraveResponse;
  try {
    body = (await resp.json()) as BraveResponse;
  } catch {
    return null;
  }
  const items = Array.isArray(body.results) ? body.results : [];

  for (const item of items) {
    // Brave nests the canonical image URL in a couple of places depending
    // on result kind. `properties.url` is the most reliable for the source
    // image; `thumbnail.original` is next-best. `thumbnail.src` points at
    // Brave's own proxy (search.brave.com) — useful for previews but not
    // what we want to store long-term.
    const candidate = pickStr(item.properties?.url) || pickStr(item.thumbnail?.original);
    if (!candidate) continue;
    if (!/^https:\/\//i.test(candidate)) continue;
    if (isBlockedHost(candidate)) continue;
    if (!looksLikeImageUrl(candidate)) continue;
    const pageUrl = pickStr(item.url) || pickStr(item.source);
    return { url: candidate, pageUrl };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Google Custom Search — images endpoint (legacy fallback, see top-of-file)
// ---------------------------------------------------------------------------

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

async function searchGoogleCse(
  q: string,
  config: Extract<ImageSearchConfig, { provider: 'google-cse' }>,
): Promise<ImageSearchResult | null> {
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
    resp = await fetchFn(`${GOOGLE_ENDPOINT}?${params.toString()}`);
  } catch (err) {
    console.warn(
      `[image-search:google] fetch failed for "${q}": ${err instanceof Error ? err.message : err}`,
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
    console.warn(`[image-search:google] ${resp.status} for "${q}"${detail ? `: ${detail}` : ''}`);
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
    const url = pickStr(item.link);
    if (!url) continue;
    if (!/^https:\/\//i.test(url)) continue;
    if (isBlockedHost(url)) continue;
    if (!looksLikeImageUrl(url)) continue;
    const pageUrl = pickStr(item.image?.contextLink);
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
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
 * Reads provider config from process.env. Prefers Brave (single key, no
 * Cloud-project tango); falls back to Google CSE if only those vars are
 * set. Returns null when neither is configured — callers should treat
 * that as "image search not configured" and skip without erroring.
 */
export function readImageSearchEnv(): ImageSearchConfig | null {
  const braveKey = process.env['BRAVE_API_KEY'] ?? process.env['BRAVE_SEARCH_API_KEY'];
  if (braveKey) return { provider: 'brave', apiKey: braveKey };

  const gKey = process.env['GOOGLE_CSE_API_KEY'];
  const gId = process.env['GOOGLE_CSE_ID'];
  if (gKey && gId) return { provider: 'google-cse', apiKey: gKey, cseId: gId };

  return null;
}
