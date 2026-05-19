import { describe, test, expect, vi } from 'vitest';
import {
  expandAssignment,
  expandLesson,
  parseExpandedAssignment,
  type ExpanderDeps,
} from '../../../domains/photography/expander.js';
import { getTopicById } from '../../../domains/photography/skillTree.js';

// ─── parseExpandedAssignment ───────────────────────────────────────────────

describe('parseExpandedAssignment', () => {
  test('parses a well-formed JSON fenced response', () => {
    const text = '```json\n' + JSON.stringify({
      assignment_text: 'Take three frames at golden hour.',
      rubric: [
        { criterion: 'frames at golden hour', description: '', is_core: true },
        { criterion: 'three-layer composition', description: '', is_core: false },
      ],
    }) + '\n```';
    const out = parseExpandedAssignment(text);
    expect(out.assignmentText).toBe('Take three frames at golden hour.');
    expect(out.rubric).toHaveLength(2);
    expect(out.rubric[0]!.is_core).toBe(true);
    expect(out.rubric[1]!.is_core).toBe(false);
  });

  test('parses bare JSON (no fence)', () => {
    const text = JSON.stringify({
      assignment_text: 'Hello',
      rubric: [{ criterion: 'x', description: '', is_core: true }],
    });
    expect(parseExpandedAssignment(text).assignmentText).toBe('Hello');
  });

  test('throws on non-JSON output', () => {
    expect(() => parseExpandedAssignment('just some prose')).toThrow(/non-JSON/);
  });

  test('throws when assignment_text is missing', () => {
    const text = '```json\n' + JSON.stringify({ rubric: [{ criterion: 'x', is_core: true }] }) + '\n```';
    expect(() => parseExpandedAssignment(text)).toThrow(/assignment_text/);
  });

  test('throws when rubric is empty', () => {
    const text = '```json\n' + JSON.stringify({ assignment_text: 'x', rubric: [] }) + '\n```';
    expect(() => parseExpandedAssignment(text)).toThrow(/rubric/);
  });

  test('throws when rubric has no core criterion', () => {
    const text = '```json\n' + JSON.stringify({
      assignment_text: 'x',
      rubric: [{ criterion: 'a', is_core: false }, { criterion: 'b', is_core: false }],
    }) + '\n```';
    expect(() => parseExpandedAssignment(text)).toThrow(/is_core: true/);
  });

  test('coerces missing description to empty string', () => {
    const text = '```json\n' + JSON.stringify({
      assignment_text: 'x',
      rubric: [{ criterion: 'a', is_core: true }],
    }) + '\n```';
    expect(parseExpandedAssignment(text).rubric[0]!.description).toBe('');
  });

  test('coerces is_core: "true" (string) to false (strict check)', () => {
    // We require boolean true; string 'true' becomes false → caught by "no core" rule
    const text = '```json\n' + JSON.stringify({
      assignment_text: 'x',
      rubric: [{ criterion: 'a', is_core: 'true' }],
    }) + '\n```';
    expect(() => parseExpandedAssignment(text)).toThrow(/is_core: true/);
  });
});

// ─── expandAssignment / expandLesson (mocked Anthropic) ────────────────────

function mockAnthropic(responses: Array<{ stop_reason: 'end_turn' | 'tool_use'; content: unknown[] }>): ExpanderDeps['anthropic'] {
  const calls = vi.fn();
  let i = 0;
  const create = vi.fn(async () => {
    const r = responses[i++];
    if (!r) throw new Error('mockAnthropic ran out of canned responses');
    return r as never;
  });
  calls.mockImplementation(create);
  return { messages: { create } } as unknown as ExpanderDeps['anthropic'];
}

const TOPIC = getTopicById('operating-camera.exposure-triangle')!;
const DEPS_BASE = { inventoryText: 'a6700, Sigma 18-50, Sony 70-350' };

describe('expandAssignment (mocked Anthropic)', () => {
  test('returns parsed JSON when Claude ends with end_turn + JSON text', async () => {
    const json = {
      assignment_text: 'Take three frames at golden hour.',
      rubric: [{ criterion: 'frames at golden hour', description: '', is_core: true }],
    };
    const anthropic = mockAnthropic([
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '```json\n' + JSON.stringify(json) + '\n```' }],
      },
    ]);
    const out = await expandAssignment({ ...DEPS_BASE, anthropic }, TOPIC);
    expect(out.assignmentText).toBe('Take three frames at golden hour.');
    expect(out.rubric).toHaveLength(1);
  });

  test('throws when Claude returns malformed JSON', async () => {
    const anthropic = mockAnthropic([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json at all' }] },
    ]);
    await expect(expandAssignment({ ...DEPS_BASE, anthropic }, TOPIC)).rejects.toThrow(/non-JSON/);
  });
});

describe('expandLesson (mocked Anthropic)', () => {
  test('returns the text block content as the lesson', async () => {
    const anthropic = mockAnthropic([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'A polished lesson body about the exposure triangle on the a6700.' }] },
    ]);
    const out = await expandLesson({ ...DEPS_BASE, anthropic }, TOPIC);
    expect(out).toContain('polished lesson body');
  });

  test('throws when Claude returns empty text', async () => {
    const anthropic = mockAnthropic([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '' }] },
    ]);
    await expect(expandLesson({ ...DEPS_BASE, anthropic }, TOPIC)).rejects.toThrow(/empty text/);
  });
});
