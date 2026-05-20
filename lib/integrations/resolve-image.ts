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

export interface ResolveImageInput {
  itemId: string;
  brand: string;
  itemName: string;
  productUrl: string;
  parsedImageUrl: string | undefined;
  anthropic: Anthropic;
  /** Override for tests. Defaults to lookupProductImageUrl. */
  lookupFn?: (a: Anthropic, id: ProductIdentity) => Promise<string | null>;
  storageRoot?: string;
  cachePath?: string;
}

const DEFAULT_CACHE_PATH =
  process.env.IMAGE_URL_CACHE_PATH ?? './local-data/image-url-cache.json';

/**
 * Resolves a product image and persists the bytes to local storage as a hedge
 * against upstream URL rot. Returns the *source URL* used (not the local path).
 *
 * Storage is best-effort: if the download fails after a URL is found, the URL
 * is still returned. Callers write this URL into the sheet's Image column,
 * which the web UI uses directly as the `<img src>`. The bytes on disk are a
 * future failover — useful if/when the upstream CDN URL stops working.
 */
export async function resolveImage(input: ResolveImageInput): Promise<string> {
  // 1. Email-extracted URL
  if (input.parsedImageUrl) {
    await downloadAndSave(input.itemId, input.parsedImageUrl, input.storageRoot);
    return input.parsedImageUrl;
  }

  // 2. AI lookup with persistent cache
  const cachePath = input.cachePath ?? DEFAULT_CACHE_PATH;
  const cache = await readImageUrlCache(cachePath);
  const key = imageCacheKey(input.brand, input.itemName);
  const cached = lookupCachedImageUrl(cache, key, new Date());

  let lookedUpUrl: string | null;
  if (cached.hit) {
    lookedUpUrl = cached.url ?? null;
  } else {
    const lookup = input.lookupFn ?? lookupProductImageUrl;
    lookedUpUrl = await lookup(input.anthropic, {
      brand: input.brand,
      itemName: input.itemName,
      productUrl: input.productUrl,
    });
    recordImageResolution(cache, key, lookedUpUrl, new Date());
    await writeImageUrlCache(cachePath, cache);
  }

  if (lookedUpUrl) {
    await downloadAndSave(input.itemId, lookedUpUrl, input.storageRoot);
    return lookedUpUrl;
  }

  return '';
}
