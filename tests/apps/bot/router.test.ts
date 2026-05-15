import { describe, test, expect, vi } from 'vitest';
import { routeMessage, type RouterDeps } from '../../../apps/bot/router.js';

function makeDeps(overrides: Partial<RouterDeps> = {}): RouterDeps {
  return {
    dispatchCommand: vi.fn(async () => null) as unknown as RouterDeps['dispatchCommand'],
    handleAddgearContinuation: vi.fn(async () => null) as unknown as RouterDeps['handleAddgearContinuation'],
    handleAgentMessage: vi.fn(async () => 'agent reply') as unknown as RouterDeps['handleAgentMessage'],
    handlePhoto: vi.fn(async () => null) as unknown as RouterDeps['handlePhoto'],
    ...overrides,
  };
}

describe('routeMessage', () => {
  test('returns the slash-command result when dispatchCommand returns a string', async () => {
    const deps = makeDeps({
      dispatchCommand: vi.fn(async () => 'slash reply') as unknown as RouterDeps['dispatchCommand'],
    });
    const out = await routeMessage('chat-1', '/stats', deps);
    expect(out).toBe('slash reply');
    expect(deps.handleAgentMessage).not.toHaveBeenCalled();
  });

  test('falls back to the agent when dispatchCommand returns null', async () => {
    const deps = makeDeps();
    const out = await routeMessage('chat-1', 'hello there', deps);
    expect(out).toBe('agent reply');
    expect(deps.handleAgentMessage).toHaveBeenCalledWith('chat-1', 'hello there');
  });

  test('catches throws from dispatchCommand and returns a generic error', async () => {
    const deps = makeDeps({
      dispatchCommand: vi.fn(async () => { throw new Error('sheets exploded'); }) as unknown as RouterDeps['dispatchCommand'],
    });
    const out = await routeMessage('chat-1', '/lost x', deps);
    expect(out).toMatch(/something went wrong|error/i);
  });

  test('catches throws from the agent and returns a generic error', async () => {
    const deps = makeDeps({
      handleAgentMessage: vi.fn(async () => { throw new Error('anthropic exploded'); }) as unknown as RouterDeps['handleAgentMessage'],
    });
    const out = await routeMessage('chat-1', 'hello', deps);
    expect(out).toMatch(/something went wrong|error/i);
  });
});
