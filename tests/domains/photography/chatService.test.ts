import { describe, test, expect, vi } from 'vitest';
import {
  PhotoBrainChatService,
  ChatBusyError,
  InvalidMessageError,
  CHAT_MESSAGE_MAX_CHARS,
} from '../../../domains/photography/chatService.js';
import { ConversationStore } from '../../../lib/conversations.js';

function makeService(handleMessage = vi.fn(async () => 'reply')) {
  const conversations = new ConversationStore({ idleTtlMs: 60_000 });
  const service = new PhotoBrainChatService({ handleMessage }, conversations);
  return { service, conversations, handleMessage };
}

describe('PhotoBrainChatService.send', () => {
  test('passes the trimmed message and resolved viewingTopic to the agent', async () => {
    const { service, handleMessage } = makeService();
    const reply = await service.send('  what is this assignment?  ', 'operating-camera.exposure-triangle');
    expect(reply).toBe('reply');
    expect(handleMessage).toHaveBeenCalledWith('web', 'what is this assignment?', {
      viewingTopic: { id: 'operating-camera.exposure-triangle', name: expect.any(String) },
    });
  });

  test('omits viewingTopic for an unknown topicId (e.g. the "assignments" path segment)', async () => {
    const { service, handleMessage } = makeService();
    await service.send('hello', 'assignments');
    expect(handleMessage).toHaveBeenCalledWith('web', 'hello', {});
  });

  test('omits viewingTopic when no topicId is given', async () => {
    const { service, handleMessage } = makeService();
    await service.send('hello');
    expect(handleMessage).toHaveBeenCalledWith('web', 'hello', {});
  });

  test('rejects empty and whitespace-only messages', async () => {
    const { service } = makeService();
    await expect(service.send('')).rejects.toThrow(InvalidMessageError);
    await expect(service.send('   ')).rejects.toThrow(InvalidMessageError);
  });

  test('rejects messages over the char limit', async () => {
    const { service } = makeService();
    await expect(service.send('x'.repeat(CHAT_MESSAGE_MAX_CHARS + 1))).rejects.toThrow(InvalidMessageError);
  });

  test('rejects a second send while one is in flight, then accepts after it settles', async () => {
    let resolveFirst!: (v: string) => void;
    const handleMessage = vi.fn(() => new Promise<string>((res) => { resolveFirst = res; }));
    const { service } = makeService(handleMessage as never);
    const first = service.send('one');
    await expect(service.send('two')).rejects.toThrow(ChatBusyError);
    resolveFirst('done');
    await expect(first).resolves.toBe('done');
    (handleMessage as ReturnType<typeof vi.fn>).mockImplementation(async () => 'ok');
    await expect(service.send('three')).resolves.toBe('ok');
  });

  test('releases the busy guard when the agent throws', async () => {
    const handleMessage = vi.fn(async () => { throw new Error('boom'); });
    const { service } = makeService(handleMessage as never);
    await expect(service.send('one')).rejects.toThrow('boom');
    (handleMessage as ReturnType<typeof vi.fn>).mockImplementation(async () => 'ok');
    await expect(service.send('two')).resolves.toBe('ok');
  });
});

describe('history / clear', () => {
  test('exposes and clears the web conversation', () => {
    const { service, conversations } = makeService();
    conversations.append('web', { role: 'user', content: 'q' });
    conversations.append('web', { role: 'assistant', content: 'a' });
    expect(service.history()).toHaveLength(2);
    service.clear();
    expect(service.history()).toHaveLength(0);
  });
});
