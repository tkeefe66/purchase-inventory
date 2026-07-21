/**
 * Web-chat orchestration for the photography agent: message validation,
 * one-turn-at-a-time busy guard, and topic-page context resolution.
 * Surface wiring (Anthropic client, sheets, env) lives in app/lib/photo-brain.ts;
 * this stays dependency-injected so it is unit-testable.
 */

import { getTopicById } from './skillTree.js';
import type { ConversationStore, ChatMessage } from '../../lib/conversations.js';
import type { HandleMessageOptions } from './agent.js';

export const CHAT_MESSAGE_MAX_CHARS = 4000;

export class ChatBusyError extends Error {
  constructor() { super('A chat turn is already in flight.'); }
}

export class InvalidMessageError extends Error {
  constructor(reason: string) { super(reason); }
}

export interface ChatAgent {
  handleMessage(chatId: string, userText: string, opts?: HandleMessageOptions): Promise<string>;
}

export class PhotoBrainChatService {
  private inFlight = false;

  constructor(
    private readonly agent: ChatAgent,
    private readonly conversations: ConversationStore,
    private readonly chatId: string = 'web',
  ) {}

  history(): ChatMessage[] {
    return this.conversations.get(this.chatId);
  }

  clear(): void {
    this.conversations.clear(this.chatId);
  }

  async send(rawMessage: string, topicId?: string): Promise<string> {
    const message = rawMessage.trim();
    if (!message) throw new InvalidMessageError('Message is empty.');
    if (message.length > CHAT_MESSAGE_MAX_CHARS) {
      throw new InvalidMessageError(`Message exceeds ${CHAT_MESSAGE_MAX_CHARS} characters.`);
    }
    if (this.inFlight) throw new ChatBusyError();
    this.inFlight = true;
    try {
      const topic = topicId ? getTopicById(topicId) : undefined;
      const opts: HandleMessageOptions = topic
        ? { viewingTopic: { id: topic.id, name: topic.name } }
        : {};
      return await this.agent.handleMessage(this.chatId, message, opts);
    } finally {
      this.inFlight = false;
    }
  }
}
