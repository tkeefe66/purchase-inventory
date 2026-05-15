import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationStore, type ChatMessage } from '../../lib/conversations.js';

describe('ConversationStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('returns empty history for a brand-new chat', () => {
    const store = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });
    expect(store.get('chat-1')).toEqual([]);
  });

  test('appends and returns user + assistant messages in order', () => {
    const store = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });
    store.append('chat-1', { role: 'user', content: 'hi' });
    store.append('chat-1', { role: 'assistant', content: 'hello!' });
    const msgs = store.get('chat-1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'hi' });
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: 'hello!' });
  });

  test('isolates conversations by chat id', () => {
    const store = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });
    store.append('chat-A', { role: 'user', content: 'A message' });
    store.append('chat-B', { role: 'user', content: 'B message' });
    expect(store.get('chat-A')).toHaveLength(1);
    expect(store.get('chat-B')).toHaveLength(1);
    expect(store.get('chat-A')[0]).toMatchObject({ content: 'A message' });
  });

  test('expires a conversation after the idle TTL', () => {
    const store = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });
    store.append('chat-1', { role: 'user', content: 'before idle' });
    vi.advanceTimersByTime(31 * 60 * 1000);
    expect(store.get('chat-1')).toEqual([]);
    store.append('chat-1', { role: 'user', content: 'after idle' });
    expect(store.get('chat-1')).toHaveLength(1);
  });

  test('refreshes the TTL on each append', () => {
    const store = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });
    store.append('chat-1', { role: 'user', content: 'msg-1' });
    vi.advanceTimersByTime(20 * 60 * 1000);
    store.append('chat-1', { role: 'assistant', content: 'reply' });
    vi.advanceTimersByTime(20 * 60 * 1000);
    expect(store.get('chat-1')).toHaveLength(2);
  });

  test('clear(id) drops just that conversation', () => {
    const store = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });
    store.append('chat-1', { role: 'user', content: 'a' });
    store.append('chat-2', { role: 'user', content: 'b' });
    store.clear('chat-1');
    expect(store.get('chat-1')).toEqual([]);
    expect(store.get('chat-2')).toHaveLength(1);
  });
});
