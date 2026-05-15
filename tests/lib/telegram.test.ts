import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { getUpdates } from '../../lib/telegram.js';

describe('getUpdates', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  test('calls /getUpdates with no params when none are provided', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: [] }) });
    await getUpdates({ botToken: 'TKN' });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain('/botTKN/getUpdates');
    expect(url).not.toMatch(/offset=/);
    expect(url).not.toMatch(/timeout=/);
  });

  test('includes offset and timeout in the query string', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: [] }) });
    await getUpdates({ botToken: 'TKN' }, { offset: 42, timeout: 25 });
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toMatch(/offset=42/);
    expect(url).toMatch(/timeout=25/);
  });

  test('returns the result array on success', async () => {
    const updates = [{ update_id: 1, message: { message_id: 1, chat: { id: 5, type: 'private' }, date: 0, text: 'hi' } }];
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: updates }) });
    const out = await getUpdates({ botToken: 'TKN' });
    expect(out).toEqual(updates);
  });

  test('throws when HTTP status is not ok', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 500, text: async () => 'oops' });
    await expect(getUpdates({ botToken: 'TKN' })).rejects.toThrow(/500/);
  });

  test('throws when API returns ok=false', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ ok: false, description: 'bad token' }) });
    await expect(getUpdates({ botToken: 'TKN' })).rejects.toThrow(/bad token/);
  });
});
