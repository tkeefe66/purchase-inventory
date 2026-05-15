import type { MasterRow } from './types.js';

export type PendingAction = { type: 'log-append'; row: MasterRow };

interface Entry {
  action: PendingAction;
  createdAt: number;
}

export interface PendingActionStoreOptions {
  ttlMs: number;
}

export class PendingActionStore {
  private readonly store = new Map<string, Entry>();
  constructor(private readonly opts: PendingActionStoreOptions) {}

  peek(chatId: string): PendingAction | null {
    const entry = this.store.get(chatId);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.store.delete(chatId);
      return null;
    }
    return entry.action;
  }

  pop(chatId: string): PendingAction | null {
    const action = this.peek(chatId);
    if (action) this.store.delete(chatId);
    return action;
  }

  set(chatId: string, action: PendingAction): void {
    this.store.set(chatId, { action, createdAt: Date.now() });
  }

  clear(chatId: string): void {
    this.store.delete(chatId);
  }

  private isExpired(entry: Entry): boolean {
    return Date.now() - entry.createdAt > this.opts.ttlMs;
  }
}
