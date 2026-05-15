import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { getFile, downloadFile, type TelegramConfig } from '../../lib/telegram.js';

const cfg: TelegramConfig = { botToken: 'TEST-TOKEN' };

describe('getFile', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  test('returns file_path from Telegram getFile response', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, result: { file_id: 'F1', file_path: 'photos/file_1.jpg' } }),
        { status: 200 },
      ),
    );
    const result = await getFile(cfg, 'F1');
    expect(result.file_path).toBe('photos/file_1.jpg');
    expect(spy).toHaveBeenCalledWith('https://api.telegram.org/botTEST-TOKEN/getFile?file_id=F1');
  });

  test('url-encodes the file_id', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, result: { file_id: 'A B/C', file_path: 'p.jpg' } }),
        { status: 200 },
      ),
    );
    await getFile(cfg, 'A B/C');
    expect(spy).toHaveBeenCalledWith('https://api.telegram.org/botTEST-TOKEN/getFile?file_id=A%20B%2FC');
  });

  test('throws on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Bad Request', { status: 400 }));
    await expect(getFile(cfg, 'F1')).rejects.toThrow(/HTTP 400/);
  });

  test('throws when Telegram returns ok=false on a 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, description: 'invalid file_id' }),
        { status: 200 },
      ),
    );
    await expect(getFile(cfg, 'BAD')).rejects.toThrow(/ok=false.*invalid file_id/);
  });

  test('throws when result has no file_path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, result: { file_id: 'F1' } }),
        { status: 200 },
      ),
    );
    await expect(getFile(cfg, 'F1')).rejects.toThrow(/no file_path/);
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
