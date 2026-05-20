import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { formatInTimeZone } from 'date-fns-tz';
import {
  createSheetsClient,
  readMasterRows,
  updateRowStatus,
  updateRowFields,
  appendMasterRow,
  buildVocab,
  readMutedFacilityIds,
  setMutedInCampingIndex,
  readCampingIndexFromSheet,
  readCampingTripsFromSheet,
  writeCampingTripsToSheet,
} from '../../lib/sheets.js';
import { sendMessage, sendPhoto, getUpdates, getFile, downloadFile, type TelegramConfig } from '../../lib/telegram.js';
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
import { extractFromPhoto, mediaTypeFromPath } from '../../lib/parsers/photo.js';
import { lookupProduct, fetchProductName, fetchProductInfo } from '../../lib/parsers/product-lookup.js';
import { DEFAULT_STORAGE_ROOT } from '../../lib/integrations/image-storage.js';
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
import { gradePhoto as gradePhotographyPhoto } from '../../domains/photography/grading.js';
import { filterToActivePhotography } from '../../domains/photography/inventory.js';
import { serializeCompact as serializePhotographyCompact } from '../../domains/photography/serialize.js';
import { handleSubmission as handlePhotographySubmission } from './commands/photography.js';
import { PhotographyAgent } from '../../domains/photography/agent.js';
import { PhotographyReadCache } from './photographyCache.js';
import { geocode } from '../../lib/integrations/weather.js';

const CACHE_REFRESH_MS = 15 * 60 * 1000;
const POLL_TIMEOUT_S = 25;
const TZ = 'America/Denver';
const STICKY_MODE_PATH = process.env.STICKY_MODE_PATH ?? '/data/bot-sticky-mode.json';


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

  // Shared 10s-TTL cache for the two hot photography sheet reads. Used by
  // both the photography agent's tool deps and the slash-command deps —
  // writes from either path invalidate. See apps/bot/photographyCache.ts.
  const photographyReadCache = new PhotographyReadCache({
    readProgress: () => readPhotographyProgress(sheets, env.spreadsheetId),
    getActiveAssignment: () => getPhotographyActiveAssignment(sheets, env.spreadsheetId),
  });

  const photographyAgent = new PhotographyAgent({
    cache,
    conversations,
    stats,
    anthropic,
    toolDeps: {
      weather,
      geocode,
      getActiveAssignment: () => photographyReadCache.getActiveAssignment(),
      readProgress: () => photographyReadCache.readProgress(),
      expanderDeps: {
        anthropic,
        // Inventory is fetched at expander invocation time via a getter so it
        // stays fresh after cache refreshes within the same agent session.
        get inventoryText() {
          return serializePhotographyCompact(filterToActivePhotography(cache.getSnapshot())).text;
        },
      },
    },
  });

  const handlePhotographyAgentMessage = (chatId: string, text: string): Promise<string> =>
    photographyAgent.handleMessage(chatId, text);

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
        const filePath = f.file_path ?? '';
        const bytes = await downloadFile(telegramCfg, filePath);
        const mt = mediaTypeFromPath(filePath);
        const mediaType = mt === 'image/gif' ? 'image/jpeg' : mt;
        return { bytes, mediaType };
      },
      extractFromPhoto: (bytes, caption) => extractFromPhoto(anthropic, bytes, caption),
      classify: (input) =>
        classifyFn({ itemName: `${input.brand} ${input.itemName}`.trim(), source: 'Other' }),
      lookupProduct: (brand, itemName) => lookupProduct(anthropic, brand, itemName),
      fetchProductName: (url, brand) => fetchProductName(url, brand),
      fetchProductInfo: (url) => fetchProductInfo(anthropic, url),
      listExistingRows: () =>
        cache.getSnapshot().map((r) => ({
          brand: r.brand,
          itemName: r.itemName,
          image: r.image,
          orderId: r.orderId,
          productUrl: r.productUrl,
        })),
      imageStorageRoot: DEFAULT_STORAGE_ROOT,
      updateImageOnExisting: async (rowIndex: number, imagePath: string) => {
        await updateRowFields(sheets, env.spreadsheetId, [{ rowIndex, fields: { image: imagePath } }]);
        await cache.forceRefresh();
      },
      sendConfirmPhoto: async (chatId: string, bytes, mediaType, caption) => {
        try {
          await sendPhoto(telegramCfg, { chat_id: chatId, caption, parse_mode: 'Markdown' }, bytes, mediaType);
        } catch (err) {
          console.warn('[addgear] sendConfirmPhoto failed:', err instanceof Error ? err.message : err);
        }
      },
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
      readProgress: () => photographyReadCache.readProgress(),
      upsertProgress: async (topicId, patch) => {
        await upsertPhotographyProgress(sheets, env.spreadsheetId, topicId, patch);
        photographyReadCache.invalidate();
      },
      getActiveAssignment: () => photographyReadCache.getActiveAssignment(),
      appendAssignment: async (row) => {
        const rowIndex = await appendPhotographyAssignment(sheets, env.spreadsheetId, row);
        photographyReadCache.invalidate();
        return rowIndex;
      },
      updateAssignment: async (rowIndex, patch) => {
        await updatePhotographyAssignment(sheets, env.spreadsheetId, rowIndex, patch);
        photographyReadCache.invalidate();
      },
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
      gradePhoto: (input) => gradePhotographyPhoto({ anthropic }, input),
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
    handlePhoto: async (chatId: string, photoFileId: string, caption: string): Promise<string | null> => {
      // Compressed Photo from Telegram. Three paths:
      //   1. "/addgear" caption → outdoor /addgear flow (existing).
      //   2. Sticky mode = photography → treat as a (EXIF-stripped) submission.
      //   3. Otherwise → outdoor's "no caption" fallback (handled by routePhoto).
      if (/^\/addgear\b/i.test(caption.trim())) {
        return handlePhoto(chatId, photoFileId, caption, handlerDeps);
      }
      const mode = stickyMode.get(chatId);
      if (mode === 'photography') {
        try {
          const f = await getFile(telegramCfg, photoFileId);
          const bytes = await downloadFile(telegramCfg, f.file_path!);
          return await handlePhotographySubmission(
            {
              bytes,
              mimeType: 'image/jpeg', // Telegram re-encodes compressed Photos as JPEG
              fileName: '',
              telegramFileId: photoFileId,
              caption,
              compressed: true,
            },
            handlerDeps.photography,
          );
        } catch (err) {
          console.error(`[bot] photography submission (compressed) failed for ${chatId}:`, err instanceof Error ? err.message : err);
          return `Something went wrong handling that photo. The error has been logged.`;
        }
      }
      return handlePhoto(chatId, photoFileId, caption, handlerDeps);
    },
    handleDocument: async (
      chatId: string,
      fileId: string,
      mimeType: string,
      fileName: string,
      caption: string,
    ): Promise<string> => {
      console.log(
        `[bot] document from ${chatId}: file_id=${fileId} mime=${mimeType} name=${fileName.slice(0, 60)}`,
      );
      // Per spec: photo-as-Document always routes to photography (the whole
      // point of sending as Document is to preserve EXIF for grading).
      try {
        const f = await getFile(telegramCfg, fileId);
        const bytes = await downloadFile(telegramCfg, f.file_path!);
        return await handlePhotographySubmission(
          {
            bytes,
            mimeType,
            fileName,
            telegramFileId: fileId,
            caption,
            compressed: false,
          },
          handlerDeps.photography,
        );
      } catch (err) {
        console.error(`[bot] photography submission (document) failed for ${chatId}:`, err instanceof Error ? err.message : err);
        return `Something went wrong handling that document. The error has been logged.`;
      }
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
          const caption = msg.caption ?? '';
          console.log(
            `[bot] ${chatId} -> [document file_id=${d.file_id} mime=${d.mime_type ?? '?'} name="${(d.file_name ?? '').slice(0, 60)}" caption="${caption.slice(0, 60)}"]`,
          );
          reply = await routeDocument(chatId, d.file_id, d.mime_type ?? '', d.file_name ?? '', caption, routerDeps);
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

        // Empty reply signals a side-channel send (e.g. sendConfirmPhoto already
        // sent the message as a photo). Skip the plain-text sendMessage.
        if (!reply) continue;

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
