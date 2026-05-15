import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { PendingActionStore } from '../../lib/pendingActions.js';
import type { MasterRow } from '../../lib/types.js';

const SAMPLE_ROW: MasterRow = {
  year: '2026', date: '2026-05-14', category: 'Climbing', subCategory: 'Harness',
  brand: 'Black Diamond', itemName: 'Couloir Harness', color: '', size: 'M', qty: 1,
  price: 80, source: 'REI', orderId: '', status: 'active', domain: 'Outdoor',
  productUrl: '', type: 'Gear', reasoning: '', notes: '',
};

describe('PendingActionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('returns null for chats with no pending action', () => {
    const store = new PendingActionStore({ ttlMs: 5 * 60 * 1000 });
    expect(store.peek('chat-1')).toBeNull();
  });

  test('set then peek returns the same action', () => {
    const store = new PendingActionStore({ ttlMs: 5 * 60 * 1000 });
    store.set('chat-1', { type: 'log-append', row: SAMPLE_ROW });
    expect(store.peek('chat-1')).toMatchObject({ type: 'log-append', row: SAMPLE_ROW });
  });

  test('pop returns and removes the action', () => {
    const store = new PendingActionStore({ ttlMs: 5 * 60 * 1000 });
    store.set('chat-1', { type: 'log-append', row: SAMPLE_ROW });
    expect(store.pop('chat-1')).toMatchObject({ type: 'log-append' });
    expect(store.peek('chat-1')).toBeNull();
  });

  test('set overwrites a previous pending action for the same chat', () => {
    const store = new PendingActionStore({ ttlMs: 5 * 60 * 1000 });
    store.set('chat-1', { type: 'log-append', row: SAMPLE_ROW });
    const replaced = { ...SAMPLE_ROW, itemName: 'Different' };
    store.set('chat-1', { type: 'log-append', row: replaced });
    expect(store.peek('chat-1')?.row.itemName).toBe('Different');
  });

  test('expires after the TTL', () => {
    const store = new PendingActionStore({ ttlMs: 5 * 60 * 1000 });
    store.set('chat-1', { type: 'log-append', row: SAMPLE_ROW });
    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(store.peek('chat-1')).toBeNull();
  });

  test('clear drops a specific chat without affecting others', () => {
    const store = new PendingActionStore({ ttlMs: 5 * 60 * 1000 });
    store.set('chat-1', { type: 'log-append', row: SAMPLE_ROW });
    store.set('chat-2', { type: 'log-append', row: SAMPLE_ROW });
    store.clear('chat-1');
    expect(store.peek('chat-1')).toBeNull();
    expect(store.peek('chat-2')).not.toBeNull();
  });
});
