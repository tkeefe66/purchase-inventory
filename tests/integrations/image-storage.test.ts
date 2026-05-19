import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  imageId,
  saveItemImage,
  downloadAndSave,
} from '../../lib/integrations/image-storage.js';

const TMP_ROOT = join(tmpdir(), `image-storage-test-${process.pid}`);

beforeEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
  await mkdir(TMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
});

describe('imageId', () => {
  it('is deterministic from itemId', () => {
    expect(imageId('IMG-20260515-e42590')).toBe(imageId('IMG-20260515-e42590'));
  });

  it('differs across itemIds', () => {
    expect(imageId('A')).not.toBe(imageId('B'));
  });

  it('is safe for use as a filename (no slashes, no spaces)', () => {
    const id = imageId('A123/with spaces');
    expect(id).not.toMatch(/[\/\s]/);
  });
});

describe('saveItemImage', () => {
  it('writes bytes to /<root>/images/<imageId>.<ext>', async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff]); // JPEG SOI
    const result = await saveItemImage('IMG-1', bytes, 'image/jpeg', TMP_ROOT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toBe(`/images/${imageId('IMG-1')}.jpg`);
    const onDisk = await readFile(join(TMP_ROOT, 'images', `${imageId('IMG-1')}.jpg`));
    expect(onDisk.equals(bytes)).toBe(true);
  });

  it('rejects too-large input (>10MB)', async () => {
    const bytes = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
    const result = await saveItemImage('IMG-2', bytes, 'image/jpeg', TMP_ROOT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('too_large');
  });

  it('rejects unsupported media types', async () => {
    const result = await saveItemImage(
      'IMG-3',
      Buffer.from([0]),
      'image/svg+xml' as 'image/jpeg',
      TMP_ROOT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('bad_type');
  });

  it('overwrites existing file (idempotent re-save)', async () => {
    await saveItemImage('IMG-4', Buffer.from([1]), 'image/jpeg', TMP_ROOT);
    await saveItemImage('IMG-4', Buffer.from([2, 3]), 'image/jpeg', TMP_ROOT);
    const onDisk = await readFile(join(TMP_ROOT, 'images', `${imageId('IMG-4')}.jpg`));
    expect(onDisk.length).toBe(2);
    expect(onDisk[0]).toBe(2);
  });
});

describe('downloadAndSave', () => {
  it('rejects bad content-type from a real fetch', async () => {
    // Stub global fetch
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response('not-an-image', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    try {
      const result = await downloadAndSave('IMG-5', 'https://example.com/x', TMP_ROOT);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('bad_type');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('downloads and saves on success', async () => {
    const payload = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(payload, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    try {
      const result = await downloadAndSave('IMG-6', 'https://example.com/x.jpg', TMP_ROOT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const st = await stat(join(TMP_ROOT, 'images', `${imageId('IMG-6')}.jpg`));
      expect(st.size).toBe(payload.length);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('returns fetch_failed on non-200', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('', { status: 404 });
    try {
      const result = await downloadAndSave('IMG-7', 'https://example.com/x', TMP_ROOT);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('fetch_failed');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('rejects too_large via Content-Length header without buffering', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response('whatever', {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
          'content-length': String(10 * 1024 * 1024 + 1),
        },
      });
    try {
      const result = await downloadAndSave('IMG-8', 'https://example.com/big.jpg', TMP_ROOT);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('too_large');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('returns fetch_failed when fetch throws (e.g. abort/timeout)', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('aborted');
    };
    try {
      const result = await downloadAndSave('IMG-9', 'https://example.com/x', TMP_ROOT);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('fetch_failed');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
