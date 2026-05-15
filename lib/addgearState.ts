import type { MasterRow } from './types.js';
import type { FuzzyMatch } from './dedup.js';

/**
 * Per-chat state for the /addgear capture flow.
 *
 * The flow walks chatId through:
 *   awaiting-date -> awaiting-price -> [awaiting-size] -> [awaiting-dedup] -> awaiting-confirm
 *
 * Each step holds a partial draft; awaiting-confirm holds a complete MasterRow.
 * On terminal success (write succeeds) or user /cancel, the entry is cleared.
 */
export interface PartialDraft {
  brand: string;
  itemName: string;
  color: string;
  size: string;
  date: string;
  dateAcknowledgedUnknown: boolean;
  price: number | null;
  priceAcknowledgedUnknown: boolean;
  imageFileId: string;
  domain: string;
  category: string;
  subCategory: string;
  type: 'Gear' | 'Consumable' | 'Service';
  reasoning: string;
}

export type AddgearStep =
  | { kind: 'awaiting-date'; draft: PartialDraft }
  | { kind: 'awaiting-price'; draft: PartialDraft }
  | { kind: 'awaiting-size'; draft: PartialDraft }
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
