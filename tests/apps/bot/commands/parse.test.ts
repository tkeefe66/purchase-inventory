import { describe, test, expect } from 'vitest';
import { parseCommand } from '../../../../apps/bot/commands/parse.js';

describe('parseCommand', () => {
  test('returns null for plain text (not a slash command)', () => {
    expect(parseCommand('hello there')).toBeNull();
    expect(parseCommand('')).toBeNull();
    expect(parseCommand('   ')).toBeNull();
  });

  test('returns null for unknown command', () => {
    expect(parseCommand('/foo bar')).toBeNull();
  });

  test('parses /stats with no args', () => {
    expect(parseCommand('/stats')).toEqual({ name: 'stats', args: '' });
  });

  test('parses /refresh with no args', () => {
    expect(parseCommand('/refresh')).toEqual({ name: 'refresh', args: '' });
  });

  test('parses /confirm and /cancel', () => {
    expect(parseCommand('/confirm')).toEqual({ name: 'confirm', args: '' });
    expect(parseCommand('/cancel')).toEqual({ name: 'cancel', args: '' });
  });

  test('parses /lost with args (trims surrounding whitespace)', () => {
    expect(parseCommand('/lost  my Jetboil  ')).toEqual({ name: 'lost', args: 'my Jetboil' });
  });

  test('parses each status-change command', () => {
    for (const cmd of ['lost', 'sold', 'donated', 'retired', 'broken']) {
      expect(parseCommand(`/${cmd} something`)).toEqual({ name: cmd, args: 'something' });
    }
  });

  test('parses /log with multi-word args', () => {
    expect(parseCommand('/log Black Diamond Couloir harness, $80, REI')).toEqual({
      name: 'log',
      args: 'Black Diamond Couloir harness, $80, REI',
    });
  });

  test('is case-insensitive on the command name', () => {
    expect(parseCommand('/Stats')).toEqual({ name: 'stats', args: '' });
    expect(parseCommand('/LOG hello')).toEqual({ name: 'log', args: 'hello' });
  });

  test('preserves arg content casing', () => {
    expect(parseCommand('/lost PATAGONIA jacket')).toEqual({ name: 'lost', args: 'PATAGONIA jacket' });
  });
});
