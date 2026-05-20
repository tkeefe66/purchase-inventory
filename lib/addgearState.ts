import type { MasterRow, Domain, ItemType } from './types.js';
import type { FuzzyMatch } from './dedup.js';
import type { ProductCandidate } from './parsers/product-lookup.js';
import type { SupportedMediaType } from './integrations/image-storage.js';

/**
 * Per-chat state for the /addgear capture flow.
 *
 * The flow walks chatId through:
 *   [awaiting-product-pick] -> awaiting-date -> awaiting-price ->
 *   awaiting-source -> [awaiting-dedup] -> awaiting-confirm
 *
 * Each step holds a partial draft; awaiting-confirm holds a complete MasterRow.
 * On terminal success (write succeeds) or user /cancel, the entry is cleared.
 */
export interface PartialDraft {
  brand: string;
  itemName: string;
  color: string;
  size: string;
  // date is '' until filled; the *AcknowledgedUnknown flag flips to true when
  // the user explicitly said "I don't know" — so the bot won't re-ask on each
  // advanceFlow() call.
  date: string;
  dateAcknowledgedUnknown: boolean;
  price: number | null;
  priceAcknowledgedUnknown: boolean;
  productUrl: string;
  imageFileId: string;
  imageBytes?: Buffer;
  imageMediaType?: SupportedMediaType;
  domain: Domain;
  category: string;
  subCategory: string;
  type: ItemType;
  reasoning: string;
  /**
   * Where the item was purchased — REI / Amazon / free-text retailer.
   * Empty string until the user answers the source prompt.
   */
  purchaseSource: string;
}

export type AddgearStep =
  | { kind: 'awaiting-product-pick'; draft: PartialDraft; candidates: ProductCandidate[] }
  | { kind: 'awaiting-date'; draft: PartialDraft }
  | { kind: 'awaiting-price'; draft: PartialDraft }
  | { kind: 'awaiting-source'; draft: PartialDraft }
  | { kind: 'awaiting-dedup'; draft: PartialDraft; candidates: FuzzyMatch[] }
  | { kind: 'awaiting-confirm'; row: MasterRow };

interface Entry {
  step: AddgearStep;
  updatedAt: number;
}

export interface AddgearStateStoreOptions {
  ttlMs: number;
}

export class AddgearStateStore {
  private readonly store = new Map<string, Entry>();
  constructor(private readonly opts: AddgearStateStoreOptions) {}

  peek(chatId: string): AddgearStep | null {
    const e = this.store.get(chatId);
    if (!e) return null;
    if (Date.now() - e.updatedAt > this.opts.ttlMs) {
      this.store.delete(chatId);
      return null;
    }
    return e.step;
  }

  set(chatId: string, step: AddgearStep): void {
    this.store.set(chatId, { step, updatedAt: Date.now() });
  }

  clear(chatId: string): void {
    this.store.delete(chatId);
  }
}
