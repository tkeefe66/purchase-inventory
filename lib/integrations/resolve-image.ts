import type Anthropic from '@anthropic-ai/sdk';
import { downloadAndSave } from './image-storage.js';
import {
  readImageUrlCache,
  writeImageUrlCache,
  lookupCachedImageUrl,
  recordImageResolution,
  imageCacheKey,
} from './image-url-cache.js';
import { lookupProductImageUrl, type ProductIdentity } from './image-lookup.js';
import {
  readImageSearchEnv,
  searchProductImage,
  type ImageSearchConfig,
  type ImageSearchResult,
} from './image-search.js';

export interface ResolveImageInput {
  itemId: string;
  brand: string;
  itemName: string;
  productUrl: string;
  parsedImageUrl: string | undefined;
  anthropic: Anthropic;
  /** Override for tests. Defaults to lookupProductImageUrl. */
  lookupFn?: (a: Anthropic, id: ProductIdentity) => Promise<string | null>;
  /** Override for tests. Defaults to searchProductImage. */
  searchFn?: (
    brand: string,
    itemName: string,
    config: ImageSearchConfig,
  ) => Promise<ImageSearchResult | null>;
  /** Override for tests. When omitted, falls back to readImageSearchEnv(). */
  imageSearchConfig?: ImageSearchConfig | null;
  storageRoot?: string;
  cachePath?: string;
}

const DEFAULT_CACHE_PATH =
  process.env.IMAGE_URL_CACHE_PATH ?? './local-data/image-url-cache.json';

/**
 * Resolves a product image. Persists the bytes to local storage as a hedge
 * against upstream URL rot. Returns the *source URL* used (not the local path).
 *
 * Resolution chain, in order:
 *   1. Email-extracted URL (free, always best — parser pulled it from the
 *      retailer's own confirmation email).
 *   2. Cache hit — short-circuit on either a canonical URL or a recent
 *      tried-null entry (30-day TTL) to avoid hitting paid APIs repeatedly
 *      for the same item.
 *   3. Brave image search (fast, free at our volume — 2000/mo).
 *   4. Sonnet + web_search (slow, ~$0.03/call — last resort for niche items
 *      Brave didn't surface).
 *
 * Storage is best-effort: if the download fails after a URL is found, the
 * URL is still returned. Callers write this URL into the sheet's Image
 * column, which the web UI uses directly as the `<img src>`. The bytes on
 * disk are a future failover — useful if/when the upstream CDN URL stops
 * working.
 */
export async function resolveImage(input: ResolveImageInput): Promise<string> {
  // 1. Email-extracted URL — immediate return, no cache write needed.
  if (input.parsedImageUrl) {
    await downloadAndSave(input.itemId, input.parsedImageUrl, input.storageRoot);
    return input.parsedImageUrl;
  }

  // 2. Cache check — covers both providers below.
  const cachePath = input.cachePath ?? DEFAULT_CACHE_PATH;
  const cache = await readImageUrlCache(cachePath);
  const key = imageCacheKey(input.brand, input.itemName);
  const cached = lookupCachedImageUrl(cache, key, new Date());
  if (cached.hit) {
    if (cached.url) {
      await downloadAndSave(input.itemId, cached.url, input.storageRoot);
      return cached.url;
    }
    return '';
  }

  // 3. Brave image search (fast + cheap).
  const imageSearchConfig =
    input.imageSearchConfig === undefined
      ? readImageSearchEnv()
      : input.imageSearchConfig;
  if (imageSearchConfig) {
    const searchFn = input.searchFn ?? searchProductImage;
    const braveResult = await searchFn(input.brand, input.itemName, imageSearchConfig);
    if (braveResult) {
      recordImageResolution(cache, key, braveResult.url, new Date());
      await writeImageUrlCache(cachePath, cache);
      await downloadAndSave(input.itemId, braveResult.url, input.storageRoot);
      return braveResult.url;
    }
  }

  // 4. Sonnet + web_search (last resort).
  const lookup = input.lookupFn ?? lookupProductImageUrl;
  const sonnetUrl = await lookup(input.anthropic, {
    brand: input.brand,
    itemName: input.itemName,
    productUrl: input.productUrl,
  });
  recordImageResolution(cache, key, sonnetUrl, new Date());
  await writeImageUrlCache(cachePath, cache);

  if (sonnetUrl) {
    await downloadAndSave(input.itemId, sonnetUrl, input.storageRoot);
    return sonnetUrl;
  }

  return '';
}
