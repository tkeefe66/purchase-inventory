import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { AddgearStateStore, type PartialDraft } from '../../lib/addgearState.js';
import type { MasterRow } from '../../lib/types.js';

const minimalDraft: PartialDraft = {
  brand: 'Patagonia',
  itemName: 'Houdini',
  color: '',
  size: '',
  date: '',
  dateAcknowledgedUnknown: false,
  price: null,
  priceAcknowledgedUnknown: false,
  productUrl: '',
  imageFileId: 'F1',
  domain: 'Outdoor',
  category: 'Hiking Gear',
  subCategory: 'Shell',
  type: 'Gear',
  reasoning: '',
};

describe('AddgearStateStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('peek returns null for an unknown chat', () => {
    const store = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
    expect(store.peek('chat-1')).toBeNull();
  });

  test('set + peek returns the step', () => {
    const store = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
    store.set('chat-1', { kind: 'awaiting-date', draft: minimalDraft });
    const step = store.peek('chat-1');
    expect(step?.kind).toBe('awaiting-date');
    if (step?.kind === 'awaiting-date') {
      expect(step.draft.brand).toBe('Patagonia');
    }
  });

  test('set + peek preserves awaiting-confirm row', () => {
    const store = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
    const row: MasterRow = {
      year: '2026',
      date: '2026-05-14',
      category: 'Hiking Gear',
      subCategory: 'Shell',
      brand: 'Patagonia',
      itemName: 'Houdini',
      color: 'Blue',
      size: 'M',
      qty: 1,
      price: 149,
      source: 'Image',
      orderId: 'IMG-20260514-abc123',
      status: 'active',
      domain: 'Outdoor',
      productUrl: '',
      type: 'Gear',
      reasoning: 'captured via /addgear photo',
      notes: '',
    };
    store.set('chat-1', { kind: 'awaiting-confirm', row });
    const step = store.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(step.row.brand).toBe('Patagonia');
      expect(step.row.source).toBe('Image');
    }
  });

  test('expires entry after ttl', () => {
    const store = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
    store.set('chat-1', { kind: 'awaiting-date', draft: minimalDraft });
    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(store.peek('chat-1')).toBeNull();
  });

  test('clear removes entry', () => {
    const store = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
    store.set('chat-1', { kind: 'awaiting-date', draft: minimalDraft });
    store.clear('chat-1');
    expect(store.peek('chat-1')).toBeNull();
  });

  test('isolates entries by chat id', () => {
    const store = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
    const draftB: PartialDraft = { ...minimalDraft, brand: 'Black Diamond', itemName: 'Vector' };
    store.set('chat-A', { kind: 'awaiting-date', draft: minimalDraft });
    store.set('chat-B', { kind: 'awaiting-price', draft: draftB });
    const sA = store.peek('chat-A');
    const sB = store.peek('chat-B');
    expect(sA?.kind).toBe('awaiting-date');
    expect(sB?.kind).toBe('awaiting-price');
  });
});
