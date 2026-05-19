import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StickyModeStore, type DomainMode } from '../../lib/stickyMode.js';

describe('StickyModeStore', () => {
  let tmp: string;
  let path: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'sticky-'));
    path = join(tmp, 'bot-sticky-mode.json');
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('returns outdoor when no file exists (default for first-ever message)', async () => {
    const store = new StickyModeStore({ path });
    await store.load();
    expect(store.get('111')).toBe<DomainMode>('outdoor');
  });

  it('persists set values across reload', async () => {
    const a = new StickyModeStore({ path });
    await a.load();
    await a.set('111', 'photography');
    await a.set('222', 'outdoor');

    const b = new StickyModeStore({ path });
    await b.load();
    expect(b.get('111')).toBe('photography');
    expect(b.get('222')).toBe('outdoor');
    expect(b.get('333')).toBe('outdoor');
  });

  it('writes the file atomically and contains the new mode after set()', async () => {
    const store = new StickyModeStore({ path });
    await store.load();
    await store.set('111', 'photography');
    const raw = JSON.parse(await readFile(path, 'utf-8')) as Record<string, string>;
    expect(raw['111']).toBe('photography');
  });

  it('tolerates a corrupt file by treating it as empty', async () => {
    await mkdir(tmp, { recursive: true });
    await writeFile(path, '{ not json', 'utf-8');
    const store = new StickyModeStore({ path });
    await store.load();
    expect(store.get('111')).toBe('outdoor');
    // Setting still works after load-from-corrupt
    await store.set('111', 'photography');
    expect(store.get('111')).toBe('photography');
  });

  it('overwrites a previous mode for the same chat', async () => {
    const store = new StickyModeStore({ path });
    await store.load();
    await store.set('111', 'photography');
    await store.set('111', 'outdoor');
    expect(store.get('111')).toBe('outdoor');

    const reloaded = new StickyModeStore({ path });
    await reloaded.load();
    expect(reloaded.get('111')).toBe('outdoor');
  });
});
