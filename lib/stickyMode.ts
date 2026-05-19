import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import lockfile from 'proper-lockfile';

export type DomainMode = 'outdoor' | 'photography';

const VALID: ReadonlySet<DomainMode> = new Set(['outdoor', 'photography']);

export interface StickyModeStoreOptions {
  /** Absolute file path to persist `{ [chatId]: 'outdoor' | 'photography' }`. */
  path: string;
}

/**
 * Per-chat sticky mode. Defaults to 'outdoor' on first read so existing users
 * keep their current behavior. Backed by a single JSON file written under a
 * lock so concurrent saves don't tear.
 */
export class StickyModeStore {
  private readonly memo = new Map<string, DomainMode>();
  private loaded = false;
  constructor(private readonly opts: StickyModeStoreOptions) {}

  async load(): Promise<void> {
    if (!existsSync(this.opts.path)) {
      this.loaded = true;
      return;
    }
    try {
      const raw = await readFile(this.opts.path, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, string>;
      for (const [chatId, mode] of Object.entries(parsed)) {
        if (VALID.has(mode as DomainMode)) {
          this.memo.set(chatId, mode as DomainMode);
        }
      }
    } catch {
      // Corrupt file — treat as empty so we don't crash the bot on startup.
    }
    this.loaded = true;
  }

  get(chatId: string): DomainMode {
    if (!this.loaded) throw new Error('StickyModeStore.get() called before load()');
    return this.memo.get(chatId) ?? 'outdoor';
  }

  async set(chatId: string, mode: DomainMode): Promise<void> {
    if (!this.loaded) throw new Error('StickyModeStore.set() called before load()');
    this.memo.set(chatId, mode);
    await this.persist();
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.opts.path), { recursive: true });
    if (!existsSync(this.opts.path)) {
      await writeFile(this.opts.path, '{}', 'utf-8');
    }
    const release = await lockfile.lock(this.opts.path, {
      retries: { retries: 3, minTimeout: 50 },
    });
    try {
      const snapshot = Object.fromEntries(this.memo.entries());
      await writeFile(this.opts.path, JSON.stringify(snapshot, null, 2), 'utf-8');
    } finally {
      await release();
    }
  }
}
