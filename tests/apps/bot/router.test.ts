import { describe, test, expect, vi } from 'vitest';
import { routeMessage, routePhoto, routeDocument, type RouterDeps } from '../../../apps/bot/router.js';

function makeDeps(overrides: Partial<RouterDeps> = {}): RouterDeps {
  return {
    dispatchCommand: vi.fn(async () => null) as unknown as RouterDeps['dispatchCommand'],
    handleAddgearContinuation: vi.fn(async () => null) as unknown as RouterDeps['handleAddgearContinuation'],
    handleCampingSelection: vi.fn(async () => null) as unknown as RouterDeps['handleCampingSelection'],
    handleOutdoorAgentMessage: vi.fn(async () => 'outdoor reply') as unknown as RouterDeps['handleOutdoorAgentMessage'],
    handlePhotographyAgentMessage: vi.fn(async () => 'photography reply') as unknown as RouterDeps['handlePhotographyAgentMessage'],
    handlePhoto: vi.fn(async () => null) as unknown as RouterDeps['handlePhoto'],
    handleDocument: vi.fn(async () => 'doc reply') as unknown as RouterDeps['handleDocument'],
    getStickyMode: vi.fn(() => 'outdoor') as unknown as RouterDeps['getStickyMode'],
    ...overrides,
  };
}

describe('routeMessage — slash + continuations', () => {
  test('returns the slash-command result when dispatchCommand returns a string', async () => {
    const deps = makeDeps({
      dispatchCommand: vi.fn(async () => 'slash reply') as unknown as RouterDeps['dispatchCommand'],
    });
    const out = await routeMessage('chat-1', '/stats', deps);
    expect(out).toBe('slash reply');
    expect(deps.handleOutdoorAgentMessage).not.toHaveBeenCalled();
    expect(deps.handlePhotographyAgentMessage).not.toHaveBeenCalled();
  });

  test('catches throws from dispatchCommand and returns a generic error', async () => {
    const deps = makeDeps({
      dispatchCommand: vi.fn(async () => { throw new Error('sheets exploded'); }) as unknown as RouterDeps['dispatchCommand'],
    });
    const out = await routeMessage('chat-1', '/lost x', deps);
    expect(out).toMatch(/something went wrong|error/i);
  });

  test('camping selection short-circuits before agent', async () => {
    const deps = makeDeps({
      handleCampingSelection: vi.fn(async () => 'picked') as unknown as RouterDeps['handleCampingSelection'],
    });
    const out = await routeMessage('chat-1', '2', deps);
    expect(out).toBe('picked');
    expect(deps.handleOutdoorAgentMessage).not.toHaveBeenCalled();
  });

  test('addgear continuation short-circuits before agent', async () => {
    const deps = makeDeps({
      handleAddgearContinuation: vi.fn(async () => 'continuing addgear') as unknown as RouterDeps['handleAddgearContinuation'],
    });
    const out = await routeMessage('chat-1', '2018', deps);
    expect(out).toBe('continuing addgear');
    expect(deps.handleOutdoorAgentMessage).not.toHaveBeenCalled();
  });
});

describe('routeMessage — sticky mode dispatch', () => {
  test('routes plain text to the outdoor agent when sticky=outdoor', async () => {
    const deps = makeDeps({
      getStickyMode: vi.fn(() => 'outdoor') as unknown as RouterDeps['getStickyMode'],
    });
    const out = await routeMessage('chat-1', 'what tent do I own', deps);
    expect(out).toBe('outdoor reply');
    expect(deps.handleOutdoorAgentMessage).toHaveBeenCalledWith('chat-1', 'what tent do I own');
    expect(deps.handlePhotographyAgentMessage).not.toHaveBeenCalled();
  });

  test('routes plain text to the photography agent when sticky=photography', async () => {
    const deps = makeDeps({
      getStickyMode: vi.fn(() => 'photography') as unknown as RouterDeps['getStickyMode'],
    });
    const out = await routeMessage('chat-1', 'what aperture for landscape', deps);
    expect(out).toBe('photography reply');
    expect(deps.handlePhotographyAgentMessage).toHaveBeenCalledWith('chat-1', 'what aperture for landscape');
    expect(deps.handleOutdoorAgentMessage).not.toHaveBeenCalled();
  });

  test('catches throws from the sticky-mode agent and returns generic error', async () => {
    const deps = makeDeps({
      handleOutdoorAgentMessage: vi.fn(async () => { throw new Error('anthropic exploded'); }) as unknown as RouterDeps['handleOutdoorAgentMessage'],
    });
    const out = await routeMessage('chat-1', 'hello', deps);
    expect(out).toMatch(/something went wrong|error/i);
  });

  test('addgear continuation runs even when sticky=photography (mode-agnostic in-flight flows)', async () => {
    const deps = makeDeps({
      getStickyMode: vi.fn(() => 'photography') as unknown as RouterDeps['getStickyMode'],
      handleAddgearContinuation: vi.fn(async () => 'continuing') as unknown as RouterDeps['handleAddgearContinuation'],
    });
    const out = await routeMessage('chat-1', '2018', deps);
    expect(out).toBe('continuing');
    expect(deps.handlePhotographyAgentMessage).not.toHaveBeenCalled();
  });
});

describe('routeDocument', () => {
  test('delegates to handleDocument', async () => {
    const handle = vi.fn(async () => 'doc handled') as unknown as RouterDeps['handleDocument'];
    const deps = makeDeps({ handleDocument: handle });
    const out = await routeDocument('chat-1', 'file-123', 'image/jpeg', 'IMG.jpg', deps);
    expect(out).toBe('doc handled');
    expect(handle).toHaveBeenCalledWith('chat-1', 'file-123', 'image/jpeg', 'IMG.jpg');
  });

  test('catches throws and returns generic error', async () => {
    const deps = makeDeps({
      handleDocument: vi.fn(async () => { throw new Error('boom'); }) as unknown as RouterDeps['handleDocument'],
    });
    const out = await routeDocument('chat-1', 'file-123', 'image/jpeg', 'IMG.jpg', deps);
    expect(out).toMatch(/something went wrong|error/i);
  });
});

describe('routePhoto', () => {
  test('returns handlePhoto reply when not null', async () => {
    const deps = makeDeps({
      handlePhoto: vi.fn(async () => 'addgear started') as unknown as RouterDeps['handlePhoto'],
    });
    const out = await routePhoto('chat-1', 'file-1', '/addgear', deps);
    expect(out).toBe('addgear started');
  });

  test('returns helpful fallback when handlePhoto returns null', async () => {
    const deps = makeDeps();
    const out = await routePhoto('chat-1', 'file-1', '', deps);
    expect(out).toMatch(/addgear/i);
  });
});
