import 'dotenv/config';
import {
  createGmailClient,
  ensureLabel,
  getHeader,
  getMessage,
  listMessages,
  removeLabel,
} from '../lib/gmail.js';

const PROCESSED_LABEL = process.env.PROCESSED_LABEL ?? 'inventory-processed';

interface Args {
  query: string;
  dryRun: boolean;
  label: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { query: '', dryRun: true, label: PROCESSED_LABEL };
  for (const a of argv.slice(2)) {
    if (a === '--apply') args.dryRun = false;
    else if (a.startsWith('--label=')) args.label = a.slice('--label='.length);
    else if (a.startsWith('--query=')) args.query = a.slice('--query='.length);
    else if (!args.query) args.query = a;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (!args.query) {
    console.error('Usage: tsx scripts/unlabel-emails.ts --query="<gmail-query>" [--label=<label-name>] [--apply]');
    console.error('Default is dry-run; pass --apply to actually remove the label.');
    process.exit(1);
  }

  const env = readEnv();
  const gmail = createGmailClient({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    refreshToken: env.refreshToken,
  });

  const fullQuery = `${args.query} label:${args.label} in:anywhere`;
  console.log(`Query: ${fullQuery}`);
  console.log(`Label to remove: ${args.label}`);
  console.log(`Mode: ${args.dryRun ? 'DRY RUN (no changes)' : 'APPLY'}\n`);

  const ids = await listMessages(gmail, { query: fullQuery, maxResults: 100 });
  console.log(`Found ${ids.length} message(s).`);
  if (ids.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const labelId = await ensureLabel(gmail, args.label);

  let removed = 0;
  for (const id of ids) {
    const msg = await getMessage(gmail, id);
    const subject = getHeader(msg, 'Subject') ?? '(no subject)';
    if (args.dryRun) {
      console.log(`  [dry-run] would unlabel ${id} — "${subject.slice(0, 80)}"`);
      continue;
    }
    await removeLabel(gmail, id, labelId);
    removed++;
    console.log(`  [unlabeled] ${id} — "${subject.slice(0, 80)}"`);
  }

  if (args.dryRun) {
    console.log(`\nDry run complete. Re-run with --apply to remove the label from ${ids.length} message(s).`);
  } else {
    console.log(`\n✓ Removed label "${args.label}" from ${removed} message(s).`);
  }
}

function readEnv(): { clientId: string; clientSecret: string; refreshToken: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    console.error('✗ Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN in .env');
    process.exit(1);
  }
  return { clientId, clientSecret, refreshToken };
}

main().catch((err: unknown) => {
  console.error('✗ Failed:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
