import 'dotenv/config';
import { fileURLToPath } from 'url';
import { formatInTimeZone } from 'date-fns-tz';
import {
  createGmailClient,
  getHeader,
  getMessage,
  listMessages,
  type GmailClient,
} from '../../lib/gmail.js';
import {
  KNOWN_SENDERS,
  pickRole,
  senderIsAllowlisted,
  subjectLooksLikePurchase,
  subjectMatchesExpected,
} from '../../lib/sources.js';
import { sendMessage } from '../../lib/telegram.js';

const SAMPLE_CAP = 10;
const PURCHASE_DOMAINS = ['amazon.com', 'rei.com'];

export interface AuditFlag {
  messageId: string;
  from: string;
  subject: string;
}

export interface AuditResult {
  startedAt: string;
  endedAt: string;
  lookbackDays: number;
  senderDrift: AuditFlag[];
  subjectDrift: AuditFlag[];
  totals: { senderDrift: number; subjectDrift: number };
  clean: boolean;
}

export interface RunAuditOptions {
  gmail: GmailClient;
  lookbackDays: number;
}

export async function runAudit(opts: RunAuditOptions): Promise<AuditResult> {
  const startedAt = new Date().toISOString();
  const senderDrift: AuditFlag[] = [];
  const subjectDrift: AuditFlag[] = [];
  let senderDriftTotal = 0;
  let subjectDriftTotal = 0;

  const query = buildAuditQuery(opts.lookbackDays);
  const ids = await listMessages(opts.gmail, { query, maxResults: 500 });

  for (const id of ids) {
    const msg = await getMessage(opts.gmail, id);
    const from = (getHeader(msg, 'From') ?? '').toLowerCase();
    const subject = getHeader(msg, 'Subject') ?? '';

    if (senderIsAllowlisted(from)) {
      const role = pickRole(from);
      if (
        role &&
        subjectLooksLikePurchase(subject) &&
        !subjectMatchesExpected(role, subject)
      ) {
        subjectDriftTotal++;
        if (subjectDrift.length < SAMPLE_CAP) {
          subjectDrift.push({ messageId: id, from, subject });
        }
      }
    } else if (subjectLooksLikePurchase(subject)) {
      senderDriftTotal++;
      if (senderDrift.length < SAMPLE_CAP) {
        senderDrift.push({ messageId: id, from, subject });
      }
    }
  }

  return {
    startedAt,
    endedAt: new Date().toISOString(),
    lookbackDays: opts.lookbackDays,
    senderDrift,
    subjectDrift,
    totals: { senderDrift: senderDriftTotal, subjectDrift: subjectDriftTotal },
    clean: senderDriftTotal === 0 && subjectDriftTotal === 0,
  };
}

function buildAuditQuery(lookbackDays: number): string {
  const senderClause = `from:(${PURCHASE_DOMAINS.join(' OR ')})`;
  return `${senderClause} newer_than:${lookbackDays}d`;
}

export function formatAuditDigest(r: AuditResult): string {
  const tz = process.env.TZ ?? 'America/Denver';
  const when = formatInTimeZone(new Date(r.startedAt), tz, 'EEE MMM d, h:mm a zzz');
  const lines: string[] = [];
  lines.push(`🔎 Sender-drift audit @ ${when}`);
  lines.push(
    `Allowlist: ${KNOWN_SENDERS.map((s) => s.email).join(', ')}`,
  );

  if (r.senderDrift.length > 0) {
    lines.push('');
    lines.push(
      `⚠️ Check A — purchase-shaped subjects from NON-allowlisted senders (${r.totals.senderDrift} total, showing ${r.senderDrift.length}):`,
    );
    for (const f of r.senderDrift) {
      lines.push(`  • ${f.from} — ${f.subject.slice(0, 80)}`);
    }
  }

  if (r.subjectDrift.length > 0) {
    lines.push('');
    lines.push(
      `⚠️ Check B — allowlisted senders using NEW subject patterns (${r.totals.subjectDrift} total, showing ${r.subjectDrift.length}):`,
    );
    for (const f of r.subjectDrift) {
      lines.push(`  • ${f.from} — ${f.subject.slice(0, 80)}`);
    }
  }

  return lines.join('\n');
}

interface AuditEnv {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  telegramBotToken: string | undefined;
  telegramChatId: string | undefined;
}

function readEnv(): AuditEnv {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const missing = [
    ['GOOGLE_CLIENT_ID', clientId],
    ['GOOGLE_CLIENT_SECRET', clientSecret],
    ['GOOGLE_REFRESH_TOKEN', refreshToken],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    console.error(`✗ Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    refreshToken: refreshToken!,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
  };
}

async function main(): Promise<void> {
  const env = readEnv();
  const gmail = createGmailClient({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    refreshToken: env.refreshToken,
  });
  const result = await runAudit({ gmail, lookbackDays: 8 });
  console.log(JSON.stringify(result, null, 2));

  if (!result.clean && env.telegramBotToken && env.telegramChatId) {
    await sendMessage(
      { botToken: env.telegramBotToken },
      { chat_id: env.telegramChatId, text: formatAuditDigest(result) },
    );
    console.log('✓ Telegram alert sent');
  } else if (result.clean) {
    console.log('✓ Audit clean — no Telegram alert sent');
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error('✗ Audit fatal:', err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
}
