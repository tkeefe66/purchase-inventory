export type CommandName =
  | 'log'
  | 'addgear'
  | 'lost'
  | 'sold'
  | 'donated'
  | 'retired'
  | 'broken'
  | 'confirm'
  | 'cancel'
  | 'stats'
  | 'refresh';

export interface ParsedCommand {
  name: CommandName;
  args: string;
}

const KNOWN: readonly CommandName[] = [
  'log', 'addgear', 'lost', 'sold', 'donated', 'retired', 'broken', 'confirm', 'cancel', 'stats', 'refresh',
];

export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const [head, ...rest] = trimmed.slice(1).split(/\s+/);
  const name = (head ?? '').toLowerCase() as CommandName;
  if (!KNOWN.includes(name)) return null;
  return { name, args: rest.join(' ').trim() };
}
