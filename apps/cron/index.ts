import 'dotenv/config';
import { runPipeline, type PipelineOptions } from './pipeline.js';

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
  };
}

async function main(): Promise<void> {
  const flags = parseFlags();
  const env = readEnv();
  const opts: PipelineOptions = {
    dryRun: flags.dryRun,
    reprocessSince: flags.reprocessSince,
    maxMessages: flags.maxMessages,
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

  console.log();
  console.log('=== Result ===');
  console.log(JSON.stringify(result, null, 2));

  if (result.errors.length > 0) {
    console.error(`\n✗ ${result.errors.length} error(s) during run`);
    process.exit(1);
  }
  console.log('\n✓ Cron complete');
}

main().catch((err: unknown) => {
  console.error('✗ Fatal:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
