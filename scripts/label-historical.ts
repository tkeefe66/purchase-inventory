import 'dotenv/config';
import {
  applyLabel,
  createGmailClient,
  ensureLabel,
  getHeader,
  getMessage,
  listMessages,
} from '../lib/gmail.js';

const REI_SENDER = 'rei@notices.rei.com';
const AMAZON_ORDER_SENDER = 'auto-confirm@amazon.com';
const AMAZON_SHIPMENT_SENDER = 'shipment-tracking@amazon.com';

/**
 * One-time bulk-labeler. Marks all REI/Amazon emails dated **before** the
 * cutoff as `inventory-processed`, so the cron query (which excludes
 * already-labeled messages) skips them. Use this once after the historical
 * migration so the cron only sees genuinely new emails going forward.
 *
 * Usage:
 *   npm run label-historical -- --before=2026-04-15 [--dry-run]
 *   npm run label-historical -- --before=2026-04-15 --apply
 *
 * Defaults to dry-run; pass --apply to actually label.
 */
async function main(): Promise<void> {
  const flags = parseFlags();
  if (!flags.before) {
    console.error('✗ Required: --before=YYYY-MM-DD');
    console.error('  Example: npm run label-historical -- --before=2026-04-15 --apply');
    process.exit(1);
  }

  const env = readEnv();
  const gmail = createGmailClient({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    refreshToken: env.refreshToken,
  });
  const labelName = process.env.PROCESSED_LABEL ?? 'inventory-processed';

  console.log(`Bulk-label all REI/Amazon emails before ${flags.before}`);
  console.log(`Mode: ${flags.apply ? 'APPLY (will label)' : 'DRY RUN (no writes)'}`);
  console.log();

  const labelId = await ensureLabel(gmail, labelName);
  console.log(`✓ Label "${labelName}" ready (id=${labelId})`);

  const beforeQ = flags.before.replace(/-/g, '/');
  const query = `from:(${REI_SENDER} OR ${AMAZON_ORDER_SENDER} OR ${AMAZON_SHIPMENT_SENDER}) before:${beforeQ} -label:${labelName}`;
  console.log(`\nQuery: ${query}`);

  const ids = await listMessages(gmail, { query, maxResults: 5000 });
  console.log(`Found ${ids.length} messages to label`);

  if (ids.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // Spot-check: print first 3 subjects so the operator sees what's about to be labeled.
  console.log('\nSample (first 3):');
  for (const id of ids.slice(0, 3)) {
    try {
      const m = await getMessage(gmail, id);
      const subj = getHeader(m, 'Subject') ?? '(no subject)';
      const date = getHeader(m, 'Date') ?? '(no date)';
      console.log(`  ${id}  [${date}]  ${subj.slice(0, 70)}`);
    } catch {
      console.log(`  ${id}  (failed to fetch)`);
    }
  }

  if (!flags.apply) {
    console.log(`\n[DRY RUN] Would label ${ids.length} messages. Re-run with --apply to actually label.`);
    return;
  }

  console.log(`\nLabeling ${ids.length} messages…`);
  let done = 0;
  let errors = 0;
  for (const id of ids) {
    try {
      await applyLabel(gmail, id, labelId);
      done++;
      if (done % 25 === 0) {
        process.stdout.write(`  ${done}/${ids.length}\r`);
      }
    } catch (err) {
      errors++;
      console.error(`\n  ✗ ${id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  process.stdout.write(`  ${done}/${ids.length}\n`);
  console.log(`✓ Done. ${done} labeled, ${errors} errors.`);
}

interface Flags {
  before: string | undefined;
  apply: boolean;
}

function parseFlags(): Flags {
  const args = process.argv.slice(2);
  const flags: Flags = { before: undefined, apply: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a?.startsWith('--before=')) flags.before = a.slice('--before='.length);
    else if (a === '--before') {
      flags.before = args[i + 1];
      i++;
    } else if (a === '--apply') flags.apply = true;
    else if (a === '--dry-run') flags.apply = false; // explicit no-op
  }
  return flags;
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
