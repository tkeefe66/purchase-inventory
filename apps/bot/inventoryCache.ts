import type { MasterRow } from '../../lib/types.js';
import { serializeCompact, type CompactView } from '../../domains/outdoor/serialize.js';
import { itemId } from '../../domains/outdoor/types.js';

export type Fetcher = () => Promise<MasterRow[]>;

export interface RefreshInfo {
  rowCount: number;
  durationMs: number;
  hashChanged: boolean;
}

export interface StartOptions {
  refreshIntervalMs: number;
  onRefresh?: (info: RefreshInfo) => void;
}

export class InventoryCache {
  private snapshot: MasterRow[] = [];
  private cachedView: CompactView | null = null;
  private timer: NodeJS.Timeout | null = null;
  public lastRefreshChangedHash = false;
  public lastRefreshedAt: Date | null = null;

  constructor(private readonly fetcher: Fetcher) {}

  async start(opts: StartOptions): Promise<void> {
    await this.refreshAndNotify(opts.onRefresh);
    this.timer = setInterval(() => {
      this.refreshAndNotify(opts.onRefresh).catch((err) => {
        console.error('[inventoryCache] refresh failed:', err);
      });
    }, opts.refreshIntervalMs);
  }

  private async refreshAndNotify(onRefresh: ((info: RefreshInfo) => void) | undefined): Promise<void> {
    const t0 = Date.now();
    await this.refresh();
    if (onRefresh) {
      onRefresh({
        rowCount: this.snapshot.length,
        durationMs: Date.now() - t0,
        hashChanged: this.lastRefreshChangedHash,
      });
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async refresh(): Promise<void> {
    const next = await this.fetcher(); // throw on failure; caller decides
    const candidate = serializeCompact(next);
    const prevHash = this.cachedView?.hash ?? null;
    this.snapshot = next;
    if (prevHash === candidate.hash) {
      this.lastRefreshChangedHash = false;
    } else {
      this.cachedView = candidate;
      this.lastRefreshChangedHash = true;
    }
    this.lastRefreshedAt = new Date();
  }

  async forceRefresh(): Promise<void> {
    return this.refresh();
  }

  getSnapshot(): readonly MasterRow[] {
    return this.snapshot;
  }

  getCompactView(): CompactView {
    if (!this.cachedView) {
      this.cachedView = serializeCompact(this.snapshot);
    }
    return this.cachedView;
  }

  applyLocalChange(updated: MasterRow): void {
    const id = itemId(updated);
    const next = [...this.snapshot];
    const existingIdx = next.findIndex((r) => itemId(r) === id);
    if (existingIdx >= 0) {
      next[existingIdx] = updated;
    } else {
      next.push(updated);
    }
    this.snapshot = next;
    this.cachedView = serializeCompact(next);
    this.lastRefreshChangedHash = true;
  }
}
