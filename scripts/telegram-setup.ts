import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getMe, getUpdates, sendMessage } from '../lib/telegram.js';

async function main(): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error('✗ TELEGRAM_BOT_TOKEN is missing from .env.');
    console.error('  Get it from @BotFather in Telegram (/newbot), then put TELEGRAM_BOT_TOKEN=<token> in .env.');
    process.exit(1);
  }

  console.log('Verifying bot token...');
  const me = await getMe({ botToken });
  console.log(`✓ Bot OK — id=${me.id}, username=@${me.username ?? '(none)'}, name="${me.first_name ?? ''}"`);

  console.log('\nFetching pending updates (looking for /start message)...');
  const updates = await getUpdates({ botToken });
  if (updates.length === 0) {
    console.error('\n✗ No updates yet.');
    console.error('  In Telegram: open the chat with your new bot and send the message "/start" (or any message).');
    console.error('  Then re-run `npm run telegram-setup`.');
    process.exit(1);
  }

  // Most-recent message wins; that's what the user just sent.
  const latest = [...updates]
    .reverse()
    .map((u) => u.message ?? u.edited_message)
    .find((m): m is NonNullable<typeof m> => !!m);
  if (!latest) {
    console.error('✗ No message found in updates. Send /start to your bot in Telegram and re-run.');
    process.exit(1);
  }

  const chatId = latest.chat.id;
  const chatLabel =
    latest.chat.username ? `@${latest.chat.username}` : (latest.chat.first_name ?? '(unknown)');
  console.log(`✓ Found chat — id=${chatId}, label=${chatLabel}`);

  // Persist chat id to .env (replace if exists, else append).
  const envPath = resolve(process.cwd(), '.env');
  const original = readFileSync(envPath, 'utf-8');
  const lines = original.split('\n');
  let found = false;
  const updated = lines.map((line) => {
    if (line.startsWith('TELEGRAM_CHAT_ID=')) {
      found = true;
      return `TELEGRAM_CHAT_ID=${chatId}`;
    }
    return line;
  });
  if (!found) updated.push(`TELEGRAM_CHAT_ID=${chatId}`);
  writeFileSync(envPath, updated.join('\n'));
  console.log(`✓ TELEGRAM_CHAT_ID written to .env`);

  console.log('\nSending test message...');
  await sendMessage(
    { botToken },
    {
      chat_id: chatId,
      text: [
        '✅ Inventory bot setup complete.',
        '',
        'Phase 1 will use this channel for daily-run digests and error alerts.',
        'Phase 2+ adds conversational queries about your gear, trips, and purchases.',
      ].join('\n'),
      disable_notification: false,
    },
  );
  console.log('✓ Test message sent. Check your Telegram.');
}

main().catch((err: unknown) => {
  console.error('\n✗ Setup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
