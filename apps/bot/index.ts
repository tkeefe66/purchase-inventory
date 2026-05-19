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
import { routeMessage, routePhoto, routeDocument } from './router.js';
import { runPipeline } from '../cron/pipeline.js';
import { createWeatherClient } from '../../lib/integrations/weather.js';
import { StickyModeStore } from '../../lib/stickyMode.js';
import {
  readProgress as readPhotographyProgress,
  upsertProgress as upsertPhotographyProgress,
  getActiveAssignment as getPhotographyActiveAssignment,
  appendAssignment as appendPhotographyAssignment,
  updateAssignment as updatePhotographyAssignment,
} from '../../lib/photographySheets.js';
import {
  expandAssignment as expandPhotographyAssignment,
  expandLesson as expandPhotographyLesson,
} from '../../domains/photography/expander.js';
import { filterToActivePhotography } from '../../domains/photography/inventory.js';
import { serializeCompact as serializePhotographyCompact } from '../../domains/photography/serialize.js';

const CACHE_REFRESH_MS = 15 * 60 * 1000;
const POLL_TIMEOUT_S = 25;
const TZ = 'America/Denver';
const STICKY_MODE_PATH = process.env.STICKY_MODE_PATH ?? '/data/bot-sticky-mode.json';

const PHOTOGRAPHY_PLACEHOLDER =
  "📸 Photography mode is set, but the photography agent isn't wired yet — that ships in week 2-3 of Phase 7. " +
  "Use `/outdoor` to switch back.";

const DOC_PHOTOGRAPHY_PLACEHOLDER =
  "📸 Got your photo as a document (EXIF preserved). Once the photography submission flow is wired " +
  "(week 2-3 of Phase 7), this will be graded against your active assignment. For now: logged, no action.";

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

  const stickyMode = new StickyModeStore({ path: STICKY_MODE_PATH });
  await stickyMode.load();
  console.log(`[bot] sticky-mode store loaded from ${STICKY_MODE_PATH}`);

  const handlePhotographyAgentMessage = async (_chatId: string, _text: string): Promise<string> =>
    PHOTOGRAPHY_PLACEHOLDER;

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
    stickyMode,
    handleOutdoorAgentMessage: (chatId: string, text: string) => agent.handleMessage(chatId, text),
    handlePhotographyAgentMessage,
    photography: {
      readProgress: () => readPhotographyProgress(sheets, env.spreadsheetId),
      upsertProgress: (topicId, patch) =>
        upsertPhotographyProgress(sheets, env.spreadsheetId, topicId, patch),
      getActiveAssignment: () => getPhotographyActiveAssignment(sheets, env.spreadsheetId),
      appendAssignment: (row) => appendPhotographyAssignment(sheets, env.spreadsheetId, row),
      updateAssignment: (rowIndex, patch) =>
        updatePhotographyAssignment(sheets, env.spreadsheetId, rowIndex, patch),
      expandAssignment: (topic) =>
        expandPhotographyAssignment(
          {
            anthropic,
            inventoryText: serializePhotographyCompact(
              filterToActivePhotography(cache.getSnapshot()),
            ).text,
          },
          topic,
        ),
      expandLesson: (topic) =>
        expandPhotographyLesson(
          {
            anthropic,
            inventoryText: serializePhotographyCompact(
              filterToActivePhotography(cache.getSnapshot()),
            ).text,
          },
          topic,
        ),
      now: () => new Date().toISOString(),
    },
  };

  const routerDeps = {
    dispatchCommand: (chatId: string, text: string) => dispatchCommand(chatId, text, handlerDeps),
    handleOutdoorAgentMessage: (chatId: string, text: string) => agent.handleMessage(chatId, text),
    handlePhotographyAgentMessage,
    handleAddgearContinuation: (chatId: string, text: string) =>
      handleAddgearContinuation(chatId, text, handlerDeps),
    handleCampingSelection: (chatId: string, text: string) =>
      handleCampingSelectionContinuation(chatId, text, handlerDeps.camping),
    handlePhoto: (chatId: string, photoFileId: string, caption: string) =>
      handlePhoto(chatId, photoFileId, caption, handlerDeps),
    handleDocument: async (
      chatId: string,
      fileId: string,
      mimeType: string,
      fileName: string,
    ): Promise<string> => {
      // Photos sent as Document are always treated as photography submissions
      // (per Phase 7 spec). Until the grading flow is wired in week 2-3, log
      // the metadata and reply with the placeholder.
      console.log(
        `[bot] document from ${chatId}: file_id=${fileId} mime=${mimeType} name=${fileName.slice(0, 60)}`,
      );
      if (!/^image\//i.test(mimeType)) {
        return `Send images only — got mime type \`${mimeType}\`.`;
      }
      return DOC_PHOTOGRAPHY_PLACEHOLDER;
    },
    getStickyMode: (chatId: string) => stickyMode.get(chatId),
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
        if (msg.document) {
          const d = msg.document;
          console.log(
            `[bot] ${chatId} -> [document file_id=${d.file_id} mime=${d.mime_type ?? '?'} name="${(d.file_name ?? '').slice(0, 60)}"]`,
          );
          reply = await routeDocument(chatId, d.file_id, d.mime_type ?? '', d.file_name ?? '', routerDeps);
        } else if (msg.photo && msg.photo.length > 0) {
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
