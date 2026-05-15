import { createHash } from 'node:crypto';
import type { AddgearStateStore, PartialDraft } from '../../../lib/addgearState.js';
import type { PendingActionStore } from '../../../lib/pendingActions.js';
import { fuzzyMatchExisting, type FuzzyCandidateRow } from '../../../lib/dedup.js';
import type { PhotoExtraction } from '../../../lib/parsers/photo.js';
import type { Classification } from '../../../lib/classifier.js';
import type { MasterRow } from '../../../lib/types.js';
import { DOMAIN_VALUES, ITEM_TYPE_VALUES, type Domain, type ItemType } from '../../../lib/types.js';

export interface AddgearDeps {
  addgearState: AddgearStateStore;
  pendingActions: PendingActionStore;
  today: () => string;
  downloadPhoto: (fileId: string) => Promise<Buffer>;
  extractFromPhoto: (bytes: Buffer, caption: string) => Promise<PhotoExtraction | null>;
  classify: (input: { brand: string; itemName: string }) => Promise<Classification>;
  listExistingRows: () => readonly FuzzyCandidateRow[];
}

interface CaptionHints {
  year?: string;
  price?: number;
  rest: string;
}

function parseCaptionHints(captionAfterCommand: string): CaptionHints {
  const out: CaptionHints = { rest: '' };
  const yearMatch = captionAfterCommand.match(/~(\d{4})\b/);
  if (yearMatch) out.year = yearMatch[1]!;
  // Capture each ~number with its optional $ sign. Without $, treat
  // year-range numbers (1900-2099) as years, not prices, so `~2018`
  // doesn't get misread as a $2018 purchase. With $, accept any value
  // (gear can legitimately cost $1500+, e.g. bikes, skis).
  const pricePattern = /~(\$?)(\d+(?:\.\d{1,2})?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = pricePattern.exec(captionAfterCommand)) !== null) {
    const hasDollar = m[1] === '$';
    const value = Number(m[2]);
    if (!Number.isFinite(value)) continue;
    if (!hasDollar && value >= 1900 && value <= 2099) continue;
    out.price = value;
    break;
  }
  out.rest = captionAfterCommand
    .replace(/~\d{4}\b/g, '')
    .replace(/~\$?\d+(?:\.\d{1,2})?\b/g, '')
    .trim();
  return out;
}

function makeOrderId(today: string, hash: string): string {
  const compactDate = today.replace(/-/g, '');
  return `IMG-${compactDate}-${hash.slice(0, 6)}`;
}

function makeHash(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function rowFromDraft(draft: PartialDraft, today: string, orderId: string): MasterRow {
  return {
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
    productUrl: '',
    type: draft.type,
    reasoning: draft.reasoning || 'captured via /addgear photo',
    notes: '',
  };
}

function previewRow(row: MasterRow): string {
  return [
    `About to log:`,
    `  ${row.brand} ${row.itemName} (${row.color || '—'}, ${row.size || '—'})`,
    `  $${row.price}, ${row.source}, ${row.date || '—'}, [${row.category}/${row.subCategory}]`,
    `Reply /confirm to write, 'field: value' to change something, or /cancel.`,
  ].join('\n');
}

export async function startAddgear(
  chatId: string,
  photoFileId: string,
  caption: string,
  deps: AddgearDeps,
): Promise<string> {
  const afterCmd = caption.replace(/^\/addgear\s*/i, '');
  const hints = parseCaptionHints(afterCmd);

  const photoBytes = await deps.downloadPhoto(photoFileId);
  const extraction = await deps.extractFromPhoto(photoBytes, hints.rest);
  if (!extraction || (!extraction.brand && !extraction.itemName)) {
    return `Couldn't read brand or item name from the photo. Reply 'brand: X, item: Y' or send a clearer photo with /addgear.`;
  }

  const classification = await deps.classify({
    brand: extraction.brand,
    itemName: extraction.itemName,
  });

  const draft: PartialDraft = {
    brand: extraction.brand,
    itemName: extraction.itemName,
    color: extraction.color,
    size: extraction.size,
    date: hints.year ? `${hints.year}-01-01` : '',
    dateAcknowledgedUnknown: false,
    price: hints.price ?? null,
    priceAcknowledgedUnknown: false,
    imageFileId: photoFileId,
    domain: classification.domain,
    category: classification.category,
    subCategory: classification.subCategory,
    type: classification.type,
    reasoning: 'captured via /addgear photo',
  };

  return advanceFlow(chatId, draft, deps);
}

function advanceFlow(chatId: string, draft: PartialDraft, deps: AddgearDeps): string {
  if (!draft.date && !draft.dateAcknowledgedUnknown) {
    deps.addgearState.set(chatId, { kind: 'awaiting-date', draft });
    return `Got ${draft.brand} ${draft.itemName}. When did you buy it? (year is fine, e.g. "2018", or "unknown")`;
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
  const row = rowFromDraft(draft, deps.today(), orderId);
  deps.addgearState.set(chatId, { kind: 'awaiting-confirm', row });
  return previewRow(row);
}

export async function continueAddgear(
  chatId: string,
  text: string,
  deps: AddgearDeps,
): Promise<string | null> {
  const step = deps.addgearState.peek(chatId);
  if (!step) return null;

  const reply = text.trim();

  // Universal: /cancel exits any step.
  if (/^\/?cancel$/i.test(reply)) {
    deps.addgearState.clear(chatId);
    return `Cancelled. Nothing was written.`;
  }

  if (step.kind === 'awaiting-date') {
    const yearMatch = reply.match(/^(\d{4})$/);
    const fullDateMatch = reply.match(/^\d{4}-\d{2}-\d{2}$/);
    if (yearMatch) {
      step.draft.date = `${yearMatch[1]}-01-01`;
    } else if (fullDateMatch) {
      step.draft.date = reply;
    } else if (/^unknown$/i.test(reply)) {
      step.draft.dateAcknowledgedUnknown = true;
    } else {
      return `Couldn't read that as a date. Reply with a year like "2018", a full date "2018-06-15", or "unknown".`;
    }
    return advanceFlow(chatId, step.draft, deps);
  }

  if (step.kind === 'awaiting-price') {
    if (/^unknown$/i.test(reply)) {
      step.draft.priceAcknowledgedUnknown = true;
    } else {
      const n = Number(reply.replace(/^\$/, ''));
      if (!Number.isFinite(n) || n < 0) {
        return `Couldn't read that as a price. Reply with a number like "120" or "unknown".`;
      }
      step.draft.price = n;
    }
    return advanceFlow(chatId, step.draft, deps);
  }

  if (step.kind === 'awaiting-dedup') {
    if (/^add anyway$/i.test(reply)) {
      const hash = makeHash([
        step.draft.brand, step.draft.itemName, step.draft.color, step.draft.size, String(Date.now()),
      ]);
      const orderId = makeOrderId(deps.today(), hash);
      const row = rowFromDraft(step.draft, deps.today(), orderId);
      deps.addgearState.set(chatId, { kind: 'awaiting-confirm', row });
      return previewRow(row);
    }
    return `Reply 'add anyway' to log this as new, or /cancel.`;
  }

  if (step.kind === 'awaiting-confirm') {
    if (/^yes$/i.test(reply) || /^\/?confirm$/i.test(reply)) {
      deps.pendingActions.set(chatId, { type: 'log-append', row: step.row });
      deps.addgearState.clear(chatId);
      return `Reply /confirm to write the row, or /cancel to discard.`;
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
        case 'date':        updated.date = value; updated.year = value.slice(0, 4); break;
        case 'category':    updated.category = value; break;
        case 'subcategory':
        case 'sub-category':updated.subCategory = value; break;
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
          return `Unknown field "${field}". Try: brand, item, color, size, price, date, category, sub-category, domain, type. Or reply /confirm or /cancel.`;
      }
      deps.addgearState.set(chatId, { kind: 'awaiting-confirm', row: updated });
      return previewRow(updated);
    }
    return `Reply /confirm to write, 'field: value' to change something, or /cancel.`;
  }

  return null;
}
