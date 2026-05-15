export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface Entry {
  messages: ChatMessage[];
  lastActivity: number;
}

export interface ConversationStoreOptions {
  idleTtlMs: number;
}

export class ConversationStore {
  private readonly store = new Map<string, Entry>();
  constructor(private readonly opts: ConversationStoreOptions) {}

  get(chatId: string): ChatMessage[] {
    const entry = this.store.get(chatId);
    if (!entry) return [];
    if (this.isExpired(entry)) {
      this.store.delete(chatId);
      return [];
    }
    return entry.messages;
  }

  append(chatId: string, msg: ChatMessage): void {
    const existing = this.store.get(chatId);
    if (existing && !this.isExpired(existing)) {
      existing.messages.push(msg);
      existing.lastActivity = Date.now();
    } else {
      this.store.set(chatId, { messages: [msg], lastActivity: Date.now() });
    }
  }

  clear(chatId: string): void {
    this.store.delete(chatId);
  }

  private isExpired(entry: Entry): boolean {
    return Date.now() - entry.lastActivity > this.opts.idleTtlMs;
  }
}
