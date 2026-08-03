import 'dotenv/config';
import { formatInTimeZone } from 'date-fns-tz';
import { runPipeline, type PipelineOptions } from './pipeline.js';
import { createGmailClient } from '../../lib/gmail.js';
import { sendMessage } from '../../lib/telegram.js';
import { runAudit, formatAuditDigest } from './audit.js';
import { appendCronLogRow, readCronLogToday, pruneCronLog, createSheetsClient, readMasterRows } from '../../lib/sheets.js';
import { formatDailySummary, formatErrorAlert, shouldSendDailyDigestAt } from './digest.js';
import { runMaintenanceNudge } from './maintenance-nudge.js';
import { shouldRunMaintenanceNudge } from './maintenance-schedule.js';
import { shouldRunDailyBackup } from './backup-schedule.js';
import { runSheetBackup } from '../../lib/sheetBackup.js';

interface CliFlags {
  dryRun: boolean;
  reprocessSince: string | undefined;
  maxMessages: number | undefined;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const flags: CliFlags = {
    dryRun: false,
    reprocessSince: undefined,
    maxMessages: undefined,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') flags.dryRun = true;
    else if (a?.startsWith('--since=')) {
      flags.reprocessSince = a.slice('--since='.length);
    } else if (a === '--since') {
      flags.reprocessSince = args[i + 1];
      i++;
    } else if (a?.startsWith('--max=')) {
      flags.maxMessages = parseInt(a.slice('--max='.length), 10);
    }
  }
  return flags;
}

interface AppEnv {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  spreadsheetId: string;
  anthropicKey: string;
  telegramBotToken: string | undefined;
  telegramChatId: string | undefined;
  ingestAfterDate: string | undefined;
}

function readEnv(): AppEnv {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const missing = [
    ['GOOGLE_CLIENT_ID', clientId],
    ['GOOGLE_CLIENT_SECRET', clientSecret],
    ['GOOGLE_REFRESH_TOKEN', refreshToken],
    ['GOOGLE_SHEET_ID', spreadsheetId],
    ['ANTHROPIC_API_KEY', anthropicKey],
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
    spreadsheetId: spreadsheetId!,
    anthropicKey: anthropicKey!,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    ingestAfterDate: process.env.INGEST_AFTER_DATE,
  };
}

async function main(): Promise<void> {
  const flags = parseFlags();
  const env = readEnv();
  const opts: PipelineOptions = {
    dryRun: flags.dryRun,
    reprocessSince: flags.reprocessSince,
    maxMessages: flags.maxMessages,
    ingestAfterDate: env.ingestAfterDate,
    spreadsheetId: env.spreadsheetId,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    refreshToken: env.refreshToken,
    anthropicKey: env.anthropicKey,
    telegramBotToken: env.telegramBotToken,
    telegramChatId: env.telegramChatId,
  };

  console.log(`Mode: ${flags.dryRun ? 'DRY RUN' : 'LIVE'}${flags.reprocessSince ? ` (reprocess since ${flags.reprocessSince})` : ''}`);
  console.log();

  const result = await runPipeline(opts);

  if (shouldRunWeeklyAudit()) {
    try {
      console.log('\n=== Running weekly sender-drift audit ===');
      const gmail = createGmailClient({
        clientId: env.clientId,
        clientSecret: env.clientSecret,
        refreshToken: env.refreshToken,
      });
      const audit = await runAudit({ gmail, lookbackDays: 8 });
      console.log(JSON.stringify(audit, null, 2));
      if (!audit.clean && env.telegramBotToken && env.telegramChatId) {
        await sendMessage(
          { botToken: env.telegramBotToken },
          { chat_id: env.telegramChatId, text: formatAuditDigest(audit) },
        );
        console.log('✓ Audit Telegram alert sent');
      } else if (audit.clean) {
        console.log('✓ Audit clean — no alert sent');
      }
    } catch (err) {
      console.error('✗ Weekly audit failed (non-fatal):', err instanceof Error ? err.message : err);
    }
  }

  console.log('\n=== Result ===');
  console.log(JSON.stringify(result, null, 2));

  if (!flags.dryRun) {
    // Persist this run to the Cron Log tab.
    const sheets = createSheetsClient({
      clientId: env.clientId,
      clientSecret: env.clientSecret,
      refreshToken: env.refreshToken,
    });
    const durationS = (new Date(result.endedAt).getTime() - new Date(result.startedAt).getTime()) / 1000;
    try {
      await appendCronLogRow(sheets, env.spreadsheetId, {
        runTimestamp: result.startedAt,
        itemsAdded: result.itemsAdded,
        itemsBySource: result.itemsBySource,
        itemsByDomain: result.itemsByDomain,
        returnsApplied: result.returnsApplied,
        messagesScanned: result.messagesScanned,
        errorsCount: result.errors.length,
        durationSeconds: Number(durationS.toFixed(2)),
      });
      // Best-effort prune; failures here don't block the digest.
      try { await pruneCronLog(sheets, env.spreadsheetId, 30); } catch (err) {
        console.warn('[cron] pruneCronLog failed:', err instanceof Error ? err.message : err);
      }
    } catch (err) {
      console.warn('[cron] appendCronLogRow failed:', err instanceof Error ? err.message : err);
    }

    // Conditional Telegram send.
    const tgEnabled = env.telegramBotToken && env.telegramChatId;
    if (tgEnabled && result.errors.length > 0) {
      try {
        await sendMessage(
          { botToken: env.telegramBotToken! },
          {
            chat_id: env.telegramChatId!,
            text: formatErrorAlert(result),
            disable_notification: false,
          },
        );
      } catch (err) {
        console.warn('[cron] error-alert send failed:', err instanceof Error ? err.message : err);
      }
    } else if (tgEnabled && shouldSendDailyDigestAt(new Date())) {
      const todayMt = formatInTimeZone(new Date(), 'America/Denver', 'yyyy-MM-dd');
      let logRows: Awaited<ReturnType<typeof readCronLogToday>> = [];
      try { logRows = await readCronLogToday(sheets, env.spreadsheetId, todayMt); }
      catch (err) { console.warn('[cron] readCronLogToday failed:', err instanceof Error ? err.message : err); }
      try {
        await sendMessage(
          { botToken: env.telegramBotToken! },
          {
            chat_id: env.telegramChatId!,
            text: formatDailySummary(logRows, logRows.length),
            disable_notification: false,
          },
        );
      } catch (err) {
        console.warn('[cron] daily-digest send failed:', err instanceof Error ? err.message : err);
      }
    }
  }

  // Monthly gear-maintenance nudge (Phase 5.5). Piggybacks on the hourly
  // cron — fires only on the 1st of the month at 9 AM Mountain.
  if (!flags.dryRun && shouldRunMaintenanceNudge(new Date())) {
    try {
      console.log('\n=== Running monthly gear-maintenance nudge ===');
      const sheets = createSheetsClient({
        clientId: env.clientId, clientSecret: env.clientSecret, refreshToken: env.refreshToken,
      });
      const rows = await readMasterRows(sheets, env.spreadsheetId);
      const nudge = await runMaintenanceNudge({
        sheets, spreadsheetId: env.spreadsheetId, rows, now: new Date(),
      });
      console.log(`Findings: ${nudge.rawFindings.length} total, ${nudge.surfaced.length} surfaced, ${nudge.suppressedItemIds.length} suppressed by ack`);
      if (nudge.message && env.telegramBotToken && env.telegramChatId) {
        await sendMessage(
          { botToken: env.telegramBotToken },
          { chat_id: env.telegramChatId, text: nudge.message, disable_notification: false },
        );
        console.log('✓ Maintenance nudge sent');
      } else if (!nudge.message) {
        console.log('✓ No gear needs attention this month — no message sent');
      }
    } catch (err) {
      console.warn('[cron] maintenance-nudge failed (non-fatal):', err instanceof Error ? err.message : err);
    }
  }

  // Daily whole-sheet backup snapshot (Phase 5.6). Piggybacks on the hourly
  // cron — fires only at 3 AM Mountain.
  if (!flags.dryRun && shouldRunDailyBackup(new Date())) {
    try {
      console.log('\n=== Running daily sheet backup ===');
      const sheets = createSheetsClient({
        clientId: env.clientId, clientSecret: env.clientSecret, refreshToken: env.refreshToken,
      });
      const root = process.env['SHEET_BACKUP_ROOT'] ?? '/data';
      const keepDays = Number(process.env['SHEET_BACKUP_KEEP_DAYS'] ?? '30');
      const now = new Date();
      const dateStamp = formatInTimeZone(now, 'America/Denver', 'yyyy-MM-dd');
      const res = await runSheetBackup(sheets, env.spreadsheetId, {
        root, keepDays, takenAtIso: now.toISOString(), dateStamp,
      });
      console.log(`✓ Sheet backup written: ${res.path}${res.deleted.length ? ` (pruned ${res.deleted.length})` : ''}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[cron] sheet backup failed:', message);
      if (env.telegramBotToken && env.telegramChatId) {
        try {
          await sendMessage(
            { botToken: env.telegramBotToken },
            {
              chat_id: env.telegramChatId,
              text: `❌ Sheet backup failed @ ${formatInTimeZone(new Date(), 'America/Denver', 'EEE MMM d h:mm a zzz')}\n${message}`,
              disable_notification: false,
            },
          );
        } catch (sendErr) {
          console.warn('[cron] sheet-backup error-alert send failed:', sendErr instanceof Error ? sendErr.message : sendErr);
        }
      }
    }
  }

  console.log('\n✓ Cron complete');
}

function shouldRunWeeklyAudit(): boolean {
  const tz = process.env.TZ ?? 'America/Denver';
  const dayOfWeek = formatInTimeZone(new Date(), tz, 'EEEE');
  const hour = parseInt(formatInTimeZone(new Date(), tz, 'H'), 10);
  return dayOfWeek === 'Sunday' && hour === 9;
}

main().catch((err: unknown) => {
  console.error('✗ Fatal:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
