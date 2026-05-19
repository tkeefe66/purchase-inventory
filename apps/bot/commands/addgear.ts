import { createHash } from 'node:crypto';
import type { AddgearStateStore, PartialDraft } from '../../../lib/addgearState.js';
import type { PendingActionStore } from '../../../lib/pendingActions.js';
import { fuzzyMatchExisting, type FuzzyCandidateRow } from '../../../lib/dedup.js';
import type { PhotoExtraction } from '../../../lib/parsers/photo.js';
import { mediaTypeFromPath } from '../../../lib/parsers/photo.js';
import type { ProductCandidate, UrlProductInfo } from '../../../lib/parsers/product-lookup.js';
import type { Classification } from '../../../lib/classifier.js';
import type { MasterRow } from '../../../lib/types.js';
import { DOMAIN_VALUES, ITEM_TYPE_VALUES, type Domain, type ItemType } from '../../../lib/types.js';
import { saveItemImage, type SupportedMediaType, type ImageStorageResult } from '../../../lib/integrations/image-storage.js';
import { formatLogPreview } from '../preview.js';

export interface AddgearDeps {
  addgearState: AddgearStateStore;
  pendingActions: PendingActionStore;
  today: () => string;
  downloadPhoto: (fileId: string) => Promise<{ bytes: Buffer; mediaType: SupportedMediaType }>;
  extractFromPhoto: (bytes: Buffer, caption: string) => Promise<PhotoExtraction | null>;
  classify: (input: { brand: string; itemName: string }) => Promise<Classification>;
  lookupProduct: (brand: string, itemName: string) => Promise<ProductCandidate[]>;
  fetchProductName: (url: string, brand: string) => Promise<string | null>;
  fetchProductInfo: (url: string) => Promise<UrlProductInfo | null>;
  listExistingRows: () => readonly FuzzyCandidateRow[];
  imageStorageRoot?: string;
}

interface CaptionHints {
  date?: string;       // YYYY-MM-DD
  price?: number;
  rest: string;        // anything left after stripping recognized hints; passed to vision as a caption
}

/**
 * Pulls a date and/or price out of the caption after the /addgear command.
 *
 * Recognized formats — same as the mid-flow date/price prompts so the user
 * doesn't have to learn two grammars:
 *   "12-11-21 $135.15"     date + price
 *   "May 5 2023 $99"        date + price
 *   "12-11-21"              just date
 *   "$135.15"               just price
 *   "~2018 ~$120"           legacy tilde format (still works)
 */
export function parseCaptionHints(captionAfterCommand: string): CaptionHints {
  const out: CaptionHints = { rest: '' };
  let remaining = captionAfterCommand.trim();

  // Natural date prefix at start: "12-11-21 ...", "May 5 2023 ...", "2018 ..."
  const split = extractDatePrefix(remaining);
  if (split) {
    out.date = split.date;
    remaining = split.rest;
  }

  // Try a $-prefixed price anywhere in the remaining text. Anchored bare-number
  // matching is too brittle when the price sits among other tokens, so we
  // specifically scan for the explicit $ form first.
  const dollarMatch = remaining.match(/\$\s?(\d+(?:\.\d{1,2})?)\b/);
  if (dollarMatch) {
    const n = Number(dollarMatch[1]);
    if (Number.isFinite(n) && n >= 0) {
      out.price = n;
      remaining = remaining.replace(dollarMatch[0], '').trim();
    }
  } else {
    // No $ — try extractPrice on the rest (handles bare "135.15", "for 120")
    const fromText = extractPrice(remaining);
    if (fromText !== null) {
      out.price = fromText;
      remaining = '';
    }
  }

  // Legacy tilde patterns still supported.
  if (out.date === undefined) {
    const tildeYear = remaining.match(/~(\d{4})\b/);
    if (tildeYear) out.date = `${tildeYear[1]}-01-01`;
  }
  if (out.price === undefined) {
    const tildePrice = remaining.match(/~(\$?)(\d+(?:\.\d{1,2})?)\b/);
    if (tildePrice) {
      const hasDollar = tildePrice[1] === '$';
      const value = Number(tildePrice[2]);
      if (Number.isFinite(value) && (hasDollar || value < 1900 || value > 2099)) {
        out.price = value;
      }
    }
  }
  remaining = remaining
    .replace(/~\d{4}\b/g, '')
    .replace(/~\$?\d+(?:\.\d{1,2})?\b/g, '')
    .trim();

  out.rest = remaining;
  return out;
}

function makeOrderId(today: string, hash: string): string {
  const compactDate = today.replace(/-/g, '');
  return `IMG-${compactDate}-${hash.slice(0, 6)}`;
}

const MONTH_NAMES: Readonly<Record<string, number>> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }
function expandYear(y: number): number { return y < 100 ? 2000 + y : y; }

/**
 * Parses the variety of date formats Tom might type after a /addgear prompt.
 * Returns YYYY-MM-DD, or null if the input doesn't look like any supported
 * date shape. Year-only inputs default to Jan 1; month-only inputs default
 * to the 1st of the month.
 *
 * Supported:
 *   2018                → 2018-01-01
 *   2018-06-15          → 2018-06-15
 *   12/21/23            → 2023-12-21       (US M/D/Y)
 *   12/21/2023          → 2023-12-21
 *   12-21-23            → 2023-12-21
 *   May 5 2023          → 2023-05-05
 *   May 5, 2023         → 2023-05-05
 *   May 2023            → 2023-05-01
 *   Sept. 12 2019       → 2019-09-12
 */
export function parseUserDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  // ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Year-only: YYYY
  const yearOnly = s.match(/^(\d{4})$/);
  if (yearOnly) return `${yearOnly[1]}-01-01`;

  // US numeric: M/D/Y or M-D-Y (1-2 digit month/day, 2-4 digit year)
  const numeric = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (numeric) {
    const mon = Number(numeric[1]);
    const day = Number(numeric[2]);
    const yr = expandYear(Number(numeric[3]));
    if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
    return `${yr}-${pad2(mon)}-${pad2(day)}`;
  }

  // Spelled-out month + day + year: "May 5 2023", "May 5, 2023", "Sept. 12 2019"
  const named = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:,)?\s+(\d{2,4})$/);
  if (named) {
    const mon = MONTH_NAMES[named[1]!.toLowerCase()];
    if (!mon) return null;
    const day = Number(named[2]);
    const yr = expandYear(Number(named[3]));
    if (day < 1 || day > 31) return null;
    return `${yr}-${pad2(mon)}-${pad2(day)}`;
  }

  // Spelled-out month + year: "May 2023", "December 2019"
  const monYear = s.match(/^([A-Za-z]+)\.?\s+(\d{2,4})$/);
  if (monYear) {
    const mon = MONTH_NAMES[monYear[1]!.toLowerCase()];
    if (!mon) return null;
    const yr = expandYear(Number(monYear[2]));
    return `${yr}-${pad2(mon)}-01`;
  }

  return null;
}

/**
 * Same date alternations as parseUserDate, but anchored to the START of the
 * input only — used when the user bundles a date with other info, e.g.
 * "12-11-21 for 135.15" or "May 5 2023 $99". Returns the parsed date and
 * whatever text followed it (for downstream price extraction).
 */
export function extractDatePrefix(input: string): { date: string; rest: string } | null {
  const s = input.trim();
  if (!s) return null;
  const prefix = s.match(
    /^(\d{4}-\d{2}-\d{2}|\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|[A-Za-z]+\.?\s+\d{1,2}(?:,)?\s+\d{2,4}|[A-Za-z]+\.?\s+\d{2,4})\b/,
  );
  if (!prefix) return null;
  const parsed = parseUserDate(prefix[1]!);
  if (!parsed) return null;
  return { date: parsed, rest: s.slice(prefix[1]!.length).trim() };
}

/**
 * Extract a price from text. Accepts `$135.15`, `135.15`, `$120`, `120`,
 * with optional leading connector words ("for", "paid", "at", "cost").
 * Bare 4-digit integers in the 1900–2099 range are rejected as year-like.
 */
export function extractPrice(input: string): number | null {
  const trimmed = input.trim().replace(/^(?:for|at|paid|cost|price)\s+/i, '').trim();
  if (!trimmed) return null;
  const withDollar = trimmed.match(/\$\s?(\d+(?:\.\d{1,2})?)/);
  if (withDollar) {
    const n = Number(withDollar[1]);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const bare = trimmed.match(/^(\d+(?:\.\d{1,2})?)$/);
  if (bare) {
    const n = Number(bare[1]);
    if (!Number.isFinite(n) || n < 0) return null;
    if (Number.isInteger(n) && n >= 1900 && n <= 2099) return null;
    return n;
  }
  return null;
}

function makeHash(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

async function rowFromDraft(
  draft: PartialDraft,
  today: string,
  orderId: string,
  imageStorageRoot: string | undefined,
): Promise<MasterRow> {
  const row: MasterRow = {
    year: draft.date ? draft.date.slice(0, 4) : '',
    date: draft.date,
    category: draft.category,
    subCategory: draft.subCategory,
    brand: draft.brand,
    itemName: draft.itemName,
    color: draft.color,
    size: draft.size,
    qty: 1,
    price: draft.price ?? 0,
    source: 'Image',
    orderId,
    status: 'active',
    domain: draft.domain,
    productUrl: draft.productUrl,
    type: draft.type,
    reasoning: draft.reasoning || 'captured via /addgear photo',
    notes: '',
    image: '',
  };

  if (draft.imageBytes && draft.imageMediaType) {
    const itemId = `${orderId}|${draft.productUrl || draft.itemName}`;
    let saved: ImageStorageResult;
    try {
      saved = await saveItemImage(itemId, draft.imageBytes, draft.imageMediaType, imageStorageRoot);
    } catch (err) {
      console.warn('[addgear] saveItemImage failed:', err instanceof Error ? err.message : err);
      saved = { ok: false, error: 'fetch_failed' };
    }
    if (saved.ok) {
      row.image = saved.path;
    }
  }

  return row;
}

function previewRow(row: MasterRow): string {
  return [
    formatLogPreview(row),
    ``,
    `Reply /confirm to write, 'field: value' to change something, or /cancel.`,
  ].join('\n');
}

/**
 * Park the row in PendingActionStore AND set the addgear state to
 * awaiting-confirm. Pre-parking means /confirm works immediately as the
 * preview promises — handleConfirm's existing pop+write path takes over
 * without any second step on the user's side.
 */
function parkForConfirm(chatId: string, row: MasterRow, deps: AddgearDeps): string {
  deps.addgearState.set(chatId, { kind: 'awaiting-confirm', row });
  deps.pendingActions.set(chatId, { type: 'log-append', row });
  return previewRow(row);
}

/**
 * Tokens shared between two brand strings, lowercased and stripped of
 * punctuation and short stopwords. Used for the photo↔URL brand sanity-check.
 */
function brandsDisagree(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false;
  const tokenize = (s: string): string[] => s
    .toLowerCase()
    .replace(/[.,&'"]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !['the', 'co', 'inc', 'llc', 'ltd', 'and'].includes(t));
  const aTokens = new Set(tokenize(a));
  const bTokens = tokenize(b);
  if (aTokens.size === 0 || bTokens.length === 0) return false;
  return !bTokens.some((t) => aTokens.has(t));
}

export async function startAddgear(
  chatId: string,
  photoFileId: string,
  caption: string,
  deps: AddgearDeps,
): Promise<string> {
  const afterCmd = caption.replace(/^\/addgear\s*/i, '');
  const hints = parseCaptionHints(afterCmd);

  // A URL in the caption is the user's explicit signal: "this is the product page."
  // Skip the lookup/pick step, trust the URL for brand/itemName, use vision only
  // for color/size and as a brand cross-check.
  const urlMatch = hints.rest.match(/https?:\/\/\S+/i);
  const captionUrl = urlMatch?.[0];
  const visionCaption = captionUrl ? hints.rest.replace(captionUrl, '').trim() : hints.rest;

  const { bytes: photoBytes, mediaType: photoMediaType } = await deps.downloadPhoto(photoFileId);

  if (captionUrl) {
    return startAddgearWithUrl(chatId, photoFileId, photoBytes, photoMediaType, captionUrl, visionCaption, hints, deps);
  }

  const extraction = await deps.extractFromPhoto(photoBytes, hints.rest);
  if (!extraction || (!extraction.brand && !extraction.itemName)) {
    return `Couldn't read brand or item name from the photo. Reply 'brand: X, item: Y' or send a clearer photo with /addgear.`;
  }

  // classify and lookupProduct both depend only on (brand, itemName) — run in parallel.
  const [classification, candidates] = await Promise.all([
    deps.classify({ brand: extraction.brand, itemName: extraction.itemName }),
    deps.lookupProduct(extraction.brand, extraction.itemName).catch((err: unknown) => {
      console.warn('[addgear] lookupProduct failed:', err instanceof Error ? err.message : err);
      return [] as ProductCandidate[];
    }),
  ]);

  // Vision parses caption end-to-end (date/price too); regex hints are a
  // belt-and-suspenders fallback if vision missed something obvious.
  const resolvedDate = extraction.date ?? hints.date ?? '';
  const resolvedPrice = extraction.price ?? hints.price ?? null;

  const draft: PartialDraft = {
    brand: extraction.brand,
    itemName: extraction.itemName,
    color: extraction.color,
    size: extraction.size,
    date: resolvedDate,
    dateAcknowledgedUnknown: false,
    price: resolvedPrice,
    priceAcknowledgedUnknown: false,
    productUrl: '',
    imageFileId: photoFileId,
    imageBytes: photoBytes,
    imageMediaType: photoMediaType,
    domain: classification.domain,
    category: classification.category,
    subCategory: classification.subCategory,
    type: classification.type,
    reasoning: 'captured via /addgear photo',
  };

  // Always enter the product-pick step. Even with 0 candidates the user
  // should have a chance to paste a URL — silently skipping was the
  // worst UX (Tom hit this with a pair of L.L.Bean boots where the lookup
  // returned empty and the row landed with URL blank + a vision-guessed name).
  deps.addgearState.set(chatId, { kind: 'awaiting-product-pick', draft, candidates });
  if (candidates.length > 0) {
    const lines = candidates.map(
      (c, i) => `  ${i + 1}. ${draft.brand} ${c.itemName} — ${c.source}\n     ${c.productUrl}`,
    );
    return [
      `Vision read: ${draft.brand} ${draft.itemName}.`,
      `Closest product matches:`,
      ...lines,
      `Reply 1, 2, or 3 to pick, paste a URL to use that instead, or 'skip' to leave URL blank.`,
    ].join('\n');
  }
  return [
    `Vision read: ${draft.brand} ${draft.itemName}.`,
    `Couldn't find a confident product page via web search.`,
    `Paste a product URL to use (and refine the name), or reply 'skip' to leave URL blank.`,
  ].join('\n');
}

/**
 * /addgear variant for when the user pasted a URL in the caption. The URL is
 * authoritative for brand/itemName/productUrl; vision is used for color/size
 * and as a brand sanity-check. Skips the product-pick step entirely.
 */
async function startAddgearWithUrl(
  chatId: string,
  photoFileId: string,
  photoBytes: Buffer,
  photoMediaType: SupportedMediaType,
  url: string,
  visionCaption: string,
  hints: CaptionHints,
  deps: AddgearDeps,
): Promise<string> {
  const [extraction, urlInfo] = await Promise.all([
    deps.extractFromPhoto(photoBytes, visionCaption),
    deps.fetchProductInfo(url).catch((err: unknown) => {
      console.warn('[addgear] fetchProductInfo failed:', err instanceof Error ? err.message : err);
      return null;
    }),
  ]);

  const brand = (urlInfo?.brand ?? '').trim() || (extraction?.brand ?? '').trim();
  const itemName = (urlInfo?.itemName ?? '').trim() || (extraction?.itemName ?? '').trim();

  if (!brand && !itemName) {
    return `Couldn't extract a product name from the photo or the URL. Try a different URL or send a clearer photo.`;
  }

  // Surface inconsistency: vision saw a brand, URL gave a different brand,
  // no token overlap. We're using the URL's value; flag it so the user can
  // override via 'brand: X' on the preview if vision was right.
  const visionBrand = (extraction?.brand ?? '').trim();
  const urlBrand = (urlInfo?.brand ?? '').trim();
  const warning = brandsDisagree(visionBrand, urlBrand)
    ? `Heads up: photo looks like "${visionBrand}" but URL says "${urlBrand}" — using URL. Reply 'brand: ${visionBrand}' on the preview if the photo was right.\n\n`
    : '';

  const resolvedDate = extraction?.date ?? hints.date ?? '';
  const resolvedPrice = extraction?.price ?? hints.price ?? null;

  const classification = await deps.classify({ brand, itemName });

  const draft: PartialDraft = {
    brand,
    itemName,
    color: extraction?.color ?? '',
    size: extraction?.size ?? '',
    date: resolvedDate,
    dateAcknowledgedUnknown: false,
    price: resolvedPrice,
    priceAcknowledgedUnknown: false,
    productUrl: url,
    imageFileId: photoFileId,
    imageBytes: photoBytes,
    imageMediaType: photoMediaType,
    domain: classification.domain,
    category: classification.category,
    subCategory: classification.subCategory,
    type: classification.type,
    reasoning: 'captured via /addgear photo+url',
  };

  return warning + await advanceFlow(chatId, draft, deps);
}

async function advanceFlow(chatId: string, draft: PartialDraft, deps: AddgearDeps): Promise<string> {
  if (!draft.date && !draft.dateAcknowledgedUnknown) {
    deps.addgearState.set(chatId, { kind: 'awaiting-date', draft });
    return `Got ${draft.brand} ${draft.itemName}. When did you buy it? (e.g. "2018", "12/21/23", or "12-11-21 for $135.15" to give both at once)`;
  }
  if (draft.price === null && !draft.priceAcknowledgedUnknown) {
    deps.addgearState.set(chatId, { kind: 'awaiting-price', draft });
    return `What did you pay? (number, or "unknown")`;
  }
  const candidates = fuzzyMatchExisting(draft.brand, draft.itemName, deps.listExistingRows());
  if (candidates.length > 0) {
    deps.addgearState.set(chatId, { kind: 'awaiting-dedup', draft, candidates });
    const lines = candidates.map(
      (c, i) => `  ${i + 1}. row ${c.rowIndex + 2}: ${c.brand} ${c.itemName} (score ${c.score.toFixed(2)})`,
    );
    return [
      `Looks similar to existing rows:`,
      ...lines,
      `Reply 'add anyway' to log this as new, or /cancel.`,
    ].join('\n');
  }

  const hash = makeHash([draft.brand, draft.itemName, draft.color, draft.size, String(Date.now())]);
  const orderId = makeOrderId(deps.today(), hash);
  const row = await rowFromDraft(draft, deps.today(), orderId, deps.imageStorageRoot);
  return parkForConfirm(chatId, row, deps);
}

export async function continueAddgear(
  chatId: string,
  text: string,
  deps: AddgearDeps,
): Promise<string | null> {
  const step = deps.addgearState.peek(chatId);
  if (!step) return null;

  const reply = text.trim();

  // Universal: /cancel exits any step. handleCancel clears both stores,
  // but if /cancel is typed as bare 'cancel' it doesn't go through the
  // command dispatcher, so we clear both here too.
  if (/^\/?cancel$/i.test(reply)) {
    deps.addgearState.clear(chatId);
    deps.pendingActions.clear(chatId);
    return `Cancelled. Nothing was written.`;
  }

  if (step.kind === 'awaiting-product-pick') {
    const hasCandidates = step.candidates.length > 0;
    const pick = reply.match(/^([123])$/);
    if (pick) {
      if (!hasCandidates) {
        return `No candidates were found via web search — paste a URL or reply 'skip'.`;
      }
      const idx = Number(pick[1]) - 1;
      const candidate = step.candidates[idx];
      if (!candidate) {
        return `Pick 1, 2, or 3, paste a URL, or 'skip'.`;
      }
      step.draft.itemName = candidate.itemName;
      step.draft.productUrl = candidate.productUrl;
      return await advanceFlow(chatId, step.draft, deps);
    }
    if (/^https?:\/\/\S+$/i.test(reply)) {
      step.draft.productUrl = reply;
      // Refine the item name from the page's title (best-effort, silent fail).
      const refined = await deps.fetchProductName(reply, step.draft.brand);
      if (refined && refined.length > 0) {
        step.draft.itemName = refined;
      }
      return await advanceFlow(chatId, step.draft, deps);
    }
    if (/^skip$/i.test(reply)) {
      return await advanceFlow(chatId, step.draft, deps);
    }
    return hasCandidates
      ? `Pick 1, 2, or 3, paste a full URL (https://...), or reply 'skip' to leave URL blank.`
      : `Paste a product URL (https://...) or reply 'skip' to leave URL blank.`;
  }

  if (step.kind === 'awaiting-date') {
    if (/^unknown$/i.test(reply)) {
      step.draft.dateAcknowledgedUnknown = true;
    } else {
      // Try the whole-input shape first; if that fails, try date-prefix +
      // optional trailing price (e.g. "12-11-21 for 135.15").
      const whole = parseUserDate(reply);
      if (whole) {
        step.draft.date = whole;
      } else {
        const split = extractDatePrefix(reply);
        if (!split) {
          return `Couldn't read "${reply}" as a date. Try a year ("2018"), a slash date ("12/21/23"), a spelled-out month ("May 5 2023"), or "unknown". You can include the price too, e.g. "12/21/23 for 135.15".`;
        }
        step.draft.date = split.date;
        if (split.rest) {
          const bonusPrice = extractPrice(split.rest);
          if (bonusPrice !== null) step.draft.price = bonusPrice;
        }
      }
    }
    return await advanceFlow(chatId, step.draft, deps);
  }

  if (step.kind === 'awaiting-price') {
    if (/^unknown$/i.test(reply)) {
      step.draft.priceAcknowledgedUnknown = true;
    } else {
      const n = extractPrice(reply);
      if (n === null) {
        return `Couldn't read "${reply}" as a price. Try a number like "120", "$135.15", or "unknown".`;
      }
      step.draft.price = n;
    }
    return await advanceFlow(chatId, step.draft, deps);
  }

  if (step.kind === 'awaiting-dedup') {
    if (/^add anyway$/i.test(reply)) {
      const hash = makeHash([
        step.draft.brand, step.draft.itemName, step.draft.color, step.draft.size, String(Date.now()),
      ]);
      const orderId = makeOrderId(deps.today(), hash);
      const row = await rowFromDraft(step.draft, deps.today(), orderId, deps.imageStorageRoot);
      return parkForConfirm(chatId, row, deps);
    }
    return `Reply 'add anyway' to log this as new, or /cancel.`;
  }

  if (step.kind === 'awaiting-confirm') {
    // /confirm is intercepted by the slash-command dispatcher before reaching
    // this handler — the row is already pre-parked in PendingActionStore by
    // parkForConfirm(), so handleConfirm pops it and writes immediately.
    // Here we just handle 'yes' / bare 'confirm' aliases and field corrections.
    if (/^yes$/i.test(reply) || /^confirm$/i.test(reply)) {
      return `Reply /confirm (with the slash) to write, /cancel to discard, or 'field: value' to change.`;
    }
    const fieldMatch = reply.match(/^([a-zA-Z][a-zA-Z\s\-]*?)\s*:\s*(.+)$/);
    if (fieldMatch) {
      const field = fieldMatch[1]!.trim().toLowerCase();
      const value = fieldMatch[2]!.trim();
      const updated: MasterRow = { ...step.row };
      switch (field) {
        case 'brand':       updated.brand = value; break;
        case 'item':
        case 'item name':   updated.itemName = value; break;
        case 'color':       updated.color = value; break;
        case 'size':        updated.size = value; break;
        case 'price': {
          const p = Number(value.replace(/^\$/, ''));
          if (!Number.isFinite(p) || p < 0) {
            return `Couldn't read "${value}" as a price. Try a number like "120".`;
          }
          updated.price = p;
          break;
        }
        case 'date': {
          const parsed = parseUserDate(value);
          if (!parsed) {
            return `Couldn't read "${value}" as a date. Try "2018", "12/21/23", "May 5 2023", or "2018-06-15".`;
          }
          updated.date = parsed;
          updated.year = parsed.slice(0, 4);
          break;
        }
        case 'category':    updated.category = value; break;
        case 'subcategory':
        case 'sub-category':updated.subCategory = value; break;
        case 'url':
        case 'product url':
        case 'producturl': {
          if (value.toLowerCase() === 'clear') {
            updated.productUrl = '';
            break;
          }
          if (!/^https?:\/\//i.test(value)) {
            return `Product URL must start with http:// or https:// (got "${value}"). Use 'url: clear' to blank it.`;
          }
          updated.productUrl = value;
          break;
        }
        case 'domain': {
          if (!(DOMAIN_VALUES as readonly string[]).includes(value)) {
            return `Unknown domain "${value}". Valid: ${DOMAIN_VALUES.join(', ')}.`;
          }
          updated.domain = value as Domain;
          break;
        }
        case 'type': {
          if (!(ITEM_TYPE_VALUES as readonly string[]).includes(value)) {
            return `Unknown type "${value}". Valid: ${ITEM_TYPE_VALUES.join(', ')}.`;
          }
          updated.type = value as ItemType;
          break;
        }
        default:
          return `Unknown field "${field}". Try: brand, item, color, size, price, date, url, category, sub-category, domain, type. Or reply /confirm or /cancel.`;
      }
      // Re-park so the pending action also reflects the patched row.
      return parkForConfirm(chatId, updated, deps);
    }
    return `Reply /confirm to write, 'field: value' to change something, or /cancel.`;
  }

  return null;
}
