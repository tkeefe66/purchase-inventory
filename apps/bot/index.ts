import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { formatInTimeZone } from 'date-fns-tz';
import {
  createSheetsClient,
  readMasterRows,
  updateRowStatus,
  appendMasterRow,
  buildVocab,
  readMutedFacilityIds,
  setMutedInCampingIndex,
  readCampingIndexFromSheet,
  readCampingTripsFromSheet,
  writeCampingTripsToSheet,
} from '../../lib/sheets.js';
import { sendMessage, getUpdates, getFile, downloadFile, type TelegramConfig } from '../../lib/telegram.js';
import { InventoryCache } from './inventoryCache.js';
import { Stats } from './stats.js';
import { ConversationStore } from '../../lib/conversations.js';
import { PendingActionStore } from '../../lib/pendingActions.js';
import { AddgearStateStore } from '../../lib/addgearState.js';
import { OutdoorAgent } from '../../domains/outdoor/agent.js';
import { dispatchCommand, handlePhoto, handleAddgearContinuation, type HandlerDeps } from './handlers.js';
import { extractLogDraft } from './commands/log.js';
import { startAddgear, continueAddgear } from './commands/addgear.js';
import { handleCampingSelectionContinuation } from './commands/camping.js';
import { extractFromPhoto } from '../../lib/parsers/photo.js';
import { lookupProduct, fetchProductName, fetchProductInfo } from '../../lib/parsers/product-lookup.js';
import { createClassifier } from '../../lib/classifier.js';
import { routeMessage, routePhoto } from './router.js';
import { runPipeline } from '../cron/pipeline.js';
import { createWeatherClient } from '../../domains/outdoor/integrations/weather.js';

const CACHE_REFRESH_MS = 15 * 60 * 1000;
const POLL_TIMEOUT_S = 25;
const TZ = 'America/Denver';

interface Env {
  googleClientId: string;
  googleClientSecret: string;
  googleRefreshToken: string;
  spreadsheetId: string;
  anthropicApiKey: string;
  telegramBotToken: string;
  authorizedChatIds: Set<string>;
  pirateWeatherApiKey: string;
  /** Earliest YYYY-MM-DD to ingest from. Optional — when unset, /scan uses
   *  the pipeline default ("newer_than:30d"). Must match cron's value so
   *  scheduled and on-demand runs see the same Gmail window. */
  ingestAfterDate: string | undefined;
}

function readEnv(): Env {
  const required = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
    GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_AUTHORIZED_CHAT_IDS: process.env.TELEGRAM_AUTHORIZED_CHAT_IDS,
    PIRATE_WEATHER_API_KEY: process.env.PIRATE_WEATHER_API_KEY,
  };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  return {
    googleClientId: required.GOOGLE_CLIENT_ID!,
    googleClientSecret: required.GOOGLE_CLIENT_SECRET!,
    googleRefreshToken: required.GOOGLE_REFRESH_TOKEN!,
    spreadsheetId: required.GOOGLE_SHEET_ID!,
    anthropicApiKey: required.ANTHROPIC_API_KEY!,
    telegramBotToken: required.TELEGRAM_BOT_TOKEN!,
    pirateWeatherApiKey: required.PIRATE_WEATHER_API_KEY!,
    authorizedChatIds: new Set(
      required.TELEGRAM_AUTHORIZED_CHAT_IDS!.split(',').map((s) => s.trim()).filter(Boolean),
    ),
    ingestAfterDate: process.env.INGEST_AFTER_DATE,
  };
}

async function main(): Promise<void> {
  const env = readEnv();
  console.log(`[bot] starting; authorized chats: ${[...env.authorizedChatIds].join(', ')}`);

  const sheets = createSheetsClient({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    refreshToken: env.googleRefreshToken,
  });
  const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });
  const weather = createWeatherClient({ apiKey: env.pirateWeatherApiKey });
  const telegramCfg: TelegramConfig = { botToken: env.telegramBotToken };

  const stats = new Stats();
  const conversations = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });
  const pendingActions = new PendingActionStore({ ttlMs: 5 * 60 * 1000 });
  const addgearState = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });

  const cache = new InventoryCache(() => readMasterRows(sheets, env.spreadsheetId));
  await cache.start({
    refreshIntervalMs: CACHE_REFRESH_MS,
    onRefresh: (info) => stats.recordRefresh(info),
  });
  console.log(`[bot] inventory loaded: ${cache.getSnapshot().length} rows`);

  const vocab = await buildVocab(sheets, env.spreadsheetId);
  const classifyFn = createClassifier({ vocab, anthropic });

  const agent = new OutdoorAgent({
    cache,
    conversations,
    stats,
    anthropic,
    sheets,
    spreadsheetId: env.spreadsheetId,
    weather,
    updateRowStatus,
  });

  const handlerDeps: HandlerDeps = {
    cache,
    stats,
    pendingActions,
    sheets,
    spreadsheetId: env.spreadsheetId,
    anthropic,
    updateRowStatus,
    appendMasterRow,
    extractLogDraft,
    today: () => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'),
    addgearState,
    startAddgear,
    continueAddgear,
    addgearInner: {
      downloadPhoto: async (fileId: string) => {
        const f = await getFile(telegramCfg, fileId);
        const bytes = await downloadFile(telegramCfg, f.file_path!);
        return bytes;
      },
      extractFromPhoto: (bytes, caption) => extractFromPhoto(anthropic, bytes, caption),
      classify: (input) =>
        classifyFn({ itemName: `${input.brand} ${input.itemName}`.trim(), source: 'Image' }),
      lookupProduct: (brand, itemName) => lookupProduct(anthropic, brand, itemName),
      fetchProductName: (url, brand) => fetchProductName(url, brand),
      fetchProductInfo: (url) => fetchProductInfo(anthropic, url),
      listExistingRows: () =>
        cache.getSnapshot().map((r) => ({ brand: r.brand, itemName: r.itemName })),
    },
    camping: {
      // All persistent camping state lives in the sheet (Camping Index +
      // Camping Trips tabs). Cron writes the index after refresh phases;
      // bot reads it here. /plan-trip and /cancel-trip flow through the
      // Camping Trips tab so the camping-cron sees them on the next tick.
      readIndex: () => readCampingIndexFromSheet(sheets, env.spreadsheetId),
      readTrips: () => readCampingTripsFromSheet(sheets, env.spreadsheetId),
      writeTrips: (t) => writeCampingTripsToSheet(sheets, env.spreadsheetId, t),
      readMutedIds: () => readMutedFacilityIds(sheets, env.spreadsheetId),
      setMuted: (ids, muted) => setMutedInCampingIndex(sheets, env.spreadsheetId, ids, muted),
      pendingActions,
    },
    // /scan triggers the same pipeline the cron runs. Telegram token is
    // intentionally omitted so the pipeline doesn't send its own digest —
    // the bot returns a formatted reply instead.
    runScan: () => runPipeline({
      dryRun: false,
      reprocessSince: undefined,
      maxMessages: undefined,
      ingestAfterDate: env.ingestAfterDate,
      spreadsheetId: env.spreadsheetId,
      clientId: env.googleClientId,
      clientSecret: env.googleClientSecret,
      refreshToken: env.googleRefreshToken,
      anthropicKey: env.anthropicApiKey,
      telegramBotToken: undefined,
      telegramChatId: undefined,
    }),
  };

  const routerDeps = {
    dispatchCommand: (chatId: string, text: string) => dispatchCommand(chatId, text, handlerDeps),
    handleAgentMessage: (chatId: string, text: string) => agent.handleMessage(chatId, text),
    handleAddgearContinuation: (chatId: string, text: string) =>
      handleAddgearContinuation(chatId, text, handlerDeps),
    handleCampingSelection: (chatId: string, text: string) =>
      handleCampingSelectionContinuation(chatId, text, handlerDeps.camping),
    handlePhoto: (chatId: string, photoFileId: string, caption: string) =>
      handlePhoto(chatId, photoFileId, caption, handlerDeps),
  };

  let offset: number | undefined;
  console.log(`[bot] polling started; refresh interval ${CACHE_REFRESH_MS}ms`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const updates = await getUpdates(
        telegramCfg,
        offset !== undefined ? { offset, timeout: POLL_TIMEOUT_S } : { timeout: POLL_TIMEOUT_S },
      );
      for (const update of updates) {
        offset = update.update_id + 1;
        const msg = update.message ?? update.edited_message;
        if (!msg) continue;
        const chatId = String(msg.chat.id);
        if (!env.authorizedChatIds.has(chatId)) {
          console.warn(`[bot] rejected message from unauthorized chat ${chatId}`);
          continue;
        }

        let reply: string;
        if (msg.photo && msg.photo.length > 0) {
          const largest = msg.photo[msg.photo.length - 1]!;
          const caption = msg.caption ?? '';
          console.log(`[bot] ${chatId} -> [photo file_id=${largest.file_id} caption="${caption.slice(0, 60)}"]`);
          reply = await routePhoto(chatId, largest.file_id, caption, routerDeps);
        } else if (msg.text) {
          const text = msg.text;
          console.log(`[bot] ${chatId} -> "${text.slice(0, 80)}"`);
          reply = await routeMessage(chatId, text, routerDeps);
        } else {
          continue;
        }

        try {
          await sendMessage(telegramCfg, {
            chat_id: chatId,
            text: reply,
            parse_mode: 'Markdown',
            link_preview_options: { is_disabled: true },
          });
        } catch (mdErr) {
          console.warn(
            `[bot] markdown send failed for ${chatId}, retrying as plain text:`,
            mdErr instanceof Error ? mdErr.message : mdErr,
          );
          await sendMessage(telegramCfg, { chat_id: chatId, text: reply });
        }
        console.log(`[bot] ${chatId} <- "${reply.slice(0, 80)}"`);
      }
    } catch (loopErr) {
      console.error(
        `[bot] poll loop error:`,
        loopErr instanceof Error ? loopErr.message : loopErr,
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

main().catch((err: unknown) => {
  console.error('[bot] fatal:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
