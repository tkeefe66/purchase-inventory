import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { PhotographyAgent } from '../../domains/photography/agent.js';
import { PhotoBrainChatService } from '../../domains/photography/chatService.js';
import { filterToActivePhotography } from '../../domains/photography/inventory.js';
import { serializeCompact } from '../../domains/photography/serialize.js';
import { ConversationStore, type ChatMessage } from '../../lib/conversations.js';
import { createSheetsClient, readMasterRows } from '../../lib/sheets.js';
import { getActiveAssignment, readProgress } from '../../lib/photographySheets.js';
import { createWeatherClient, geocode } from '../../lib/integrations/weather.js';
import type { MasterRow } from '../../lib/types.js';

const IDLE_TTL_MS = 30 * 60 * 1000;
const INVENTORY_TTL_MS = 30_000;

export interface PhotoBrain {
  send(message: string, topicId?: string): Promise<string>;
  history(): ChatMessage[];
  clear(): void;
}

function createPhotoBrain(): PhotoBrain {
  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const weather = createWeatherClient({ apiKey: process.env.PIRATE_WEATHER_API_KEY! });

  let snapshot: MasterRow[] = [];
  let lastFetchMs = 0;
  const ensureInventory = async (): Promise<void> => {
    if (Date.now() - lastFetchMs < INVENTORY_TTL_MS) return;
    snapshot = await readMasterRows(sheets, spreadsheetId);
    lastFetchMs = Date.now();
  };

  const conversations = new ConversationStore({ idleTtlMs: IDLE_TTL_MS });
  const agent = new PhotographyAgent({
    surface: 'web',
    cache: { getSnapshot: () => snapshot },
    conversations,
    stats: {
      recordQuery: (m) => console.log('[photo-brain] query', JSON.stringify(m)),
    },
    anthropic,
    toolDeps: {
      weather,
      geocode,
      getActiveAssignment: () => getActiveAssignment(sheets, spreadsheetId),
      readProgress: () => readProgress(sheets, spreadsheetId),
      expanderDeps: {
        anthropic,
        get inventoryText() {
          return serializeCompact(filterToActivePhotography(snapshot)).text;
        },
      },
    },
  });
  const service = new PhotoBrainChatService(agent, conversations);

  return {
    async send(message, topicId) {
      // Stale-but-present inventory beats a failed turn; log and continue.
      await ensureInventory().catch((err) => {
        console.error('[photo-brain] inventory refresh failed:', err);
      });
      return service.send(message, topicId);
    },
    history: () => service.history(),
    clear: () => service.clear(),
  };
}

// globalThis so Next dev hot-reload doesn't spawn duplicate stores/agents.
const g = globalThis as typeof globalThis & { __photoBrain?: PhotoBrain };

export function getPhotoBrain(): PhotoBrain {
  g.__photoBrain ??= createPhotoBrain();
  return g.__photoBrain;
}
