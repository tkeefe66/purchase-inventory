import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createSheetsClient, readMasterRows, updateRowStatus } from '../lib/sheets.js';
import { InventoryCache } from '../apps/bot/inventoryCache.js';
import { Stats, formatStats } from '../apps/bot/stats.js';
import { ConversationStore } from '../lib/conversations.js';
import { filterToActiveOutdoor } from '../domains/outdoor/inventory.js';
import { OutdoorAgent } from '../domains/outdoor/agent.js';

async function main(): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!clientId || !clientSecret || !refreshToken || !spreadsheetId || !anthropicKey) {
    console.error('Missing required env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_SHEET_ID, ANTHROPIC_API_KEY');
    process.exit(1);
  }

  const message = process.argv.slice(2).join(' ') || 'What sleeping pads do I own?';
  console.log(`\nQuery: "${message}"\n`);

  const sheets = createSheetsClient({ clientId, clientSecret, refreshToken });
  const cache = new InventoryCache(() => readMasterRows(sheets, spreadsheetId));
  const t0 = Date.now();
  await cache.refresh();
  const refreshMs = Date.now() - t0;
  const activeOutdoor = filterToActiveOutdoor(cache.getSnapshot());
  console.log(`Loaded ${activeOutdoor.length} active outdoor rows (${cache.getCompactView().text.length} chars in compact view)`);

  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const stats = new Stats();
  stats.recordRefresh({
    rowCount: cache.getSnapshot().length,
    durationMs: refreshMs,
    hashChanged: cache.lastRefreshChangedHash,
  });
  const conversations = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });

  const agent = new OutdoorAgent({
    cache,
    conversations,
    stats,
    anthropic,
    sheets,
    spreadsheetId,
    updateRowStatus,
  });

  console.log('\n=== Agent reply ===\n');
  const reply = await agent.handleMessage('smoke-test', message);
  console.log(reply);

  const approxTokens = Math.ceil(cache.getCompactView().text.length / 4);
  console.log('\n=== /stats output ===\n');
  console.log(formatStats(stats, {
    activeOutdoorRows: activeOutdoor.length,
    freeContextTokens: 200_000 - approxTokens,
  }));
}

main().catch((err: unknown) => {
  console.error('Smoke failed:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
