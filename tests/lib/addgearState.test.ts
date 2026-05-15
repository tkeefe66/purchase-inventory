import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { AddgearStateStore } from '../../lib/addgearState.js';

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
    const draft = {
      brand: 'Patagonia', itemName: 'Houdini', color: '', size: '',
      date: '', dateAcknowledgedUnknown: false,
      price: null, priceAcknowledgedUnknown: false,
      imageFileId: 'F1',
      domain: 'Outdoor', category: 'Hiking Gear', subCategory: 'Shell',
      type: 'Gear' as const, reasoning: '',
    };
    store.set('chat-1', { kind: 'awaiting-date', draft });
    const step = store.peek('chat-1');
    expect(step?.kind).toBe('awaiting-date');
    if (step?.kind === 'awaiting-date') {
      expect(step.draft.brand).toBe('Patagonia');
    }
  });

  test('expires entry after ttl', () => {
    const store = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
    const draft = {
      brand: 'X', itemName: 'Y', color: '', size: '', date: '', dateAcknowledgedUnknown: false,
      price: null, priceAcknowledgedUnknown: false,
      imageFileId: 'F1', domain: 'Outdoor', category: '', subCategory: '',
      type: 'Gear' as const, reasoning: '',
    };
    store.set('chat-1', { kind: 'awaiting-date', draft });
    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(store.peek('chat-1')).toBeNull();
  });

  test('clear removes entry', () => {
    const store = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
    const draft = {
      brand: 'X', itemName: 'Y', color: '', size: '', date: '', dateAcknowledgedUnknown: false,
      price: null, priceAcknowledgedUnknown: false,
      imageFileId: 'F1', domain: 'Outdoor', category: '', subCategory: '',
      type: 'Gear' as const, reasoning: '',
    };
    store.set('chat-1', { kind: 'awaiting-date', draft });
    store.clear('chat-1');
    expect(store.peek('chat-1')).toBeNull();
  });

  test('isolates entries by chat id', () => {
    const store = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
    const draftA = {
      brand: 'A', itemName: 'A', color: '', size: '', date: '', dateAcknowledgedUnknown: false,
      price: null, priceAcknowledgedUnknown: false,
      imageFileId: 'F1', domain: 'Outdoor', category: '', subCategory: '',
      type: 'Gear' as const, reasoning: '',
    };
    const draftB = { ...draftA, brand: 'B', itemName: 'B' };
    store.set('chat-A', { kind: 'awaiting-date', draft: draftA });
    store.set('chat-B', { kind: 'awaiting-price', draft: draftB });
    const sA = store.peek('chat-A');
    const sB = store.peek('chat-B');
    expect(sA?.kind).toBe('awaiting-date');
    expect(sB?.kind).toBe('awaiting-price');
  });
});
