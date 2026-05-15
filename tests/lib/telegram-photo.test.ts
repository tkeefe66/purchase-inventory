import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { getFile, downloadFile, type TelegramConfig } from '../../lib/telegram.js';

const cfg: TelegramConfig = { botToken: 'TEST-TOKEN' };

describe('getFile', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  test('returns file_path from Telegram getFile response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, result: { file_id: 'F1', file_path: 'photos/file_1.jpg' } }),
        { status: 200 },
      ),
    );
    const result = await getFile(cfg, 'F1');
    expect(result.file_path).toBe('photos/file_1.jpg');
  });

  test('throws on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Bad Request', { status: 400 }));
    await expect(getFile(cfg, 'F1')).rejects.toThrow(/HTTP 400/);
  });
});

describe('downloadFile', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  test('returns the response body as a Buffer', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]); // JPEG SOI bytes
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(bytes, { status: 200 }));
    const buf = await downloadFile(cfg, 'photos/file_1.jpg');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(3);
    expect(buf[0]).toBe(0xff);
  });

  test('throws on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));
    await expect(downloadFile(cfg, 'photos/missing.jpg')).rejects.toThrow(/HTTP 404/);
  });
});
