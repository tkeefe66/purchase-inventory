/**
 * Photography agent — free-form conversational interface for the photography
 * domain. Mirrors OutdoorAgent\'s architecture: cached system prompt,
 * inventory context, tool loop with primary + fallback model chain.
 *
 * Scope: this is the TEACHER / COACH agent. It answers technique questions,
 * plans shoots around weather + sun-times + trails, walks Tom through theory
 * conversationally, and points him at the curriculum. It does NOT generate
 * assignments (that\'s `/start` → expander) or critique submitted photos
 * (that\'s the grading flow on photo submission). Out-of-scope free-form
 * critique gets redirected back to the assignment loop.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ConversationStore } from '../../lib/conversations.js';
import { callWithRetry } from '../../lib/anthropic-retry.js';
import { AGENT_PRIMARY_MODEL, AGENT_FALLBACK_MODELS } from '../../lib/models.js';
import {
  createTools,
  TOOL_SCHEMAS,
  SERVER_TOOLS,
  type ToolDeps,
  type ToolHandlers,
  type GetForecastInput,
  type LookupTrailInput,
  type SearchTrailsNearbyInput,
  type GetSunTimesInput,
  type ListTopicsInput,
  type GetTopicTheoryInput,
} from './tools.js';
import { filterToActivePhotography } from './inventory.js';
import { serializeCompact } from './serialize.js';
import { ALL_TOPICS } from './skillTree.js';
import { computeStatuses, type ProgressEntry } from './curriculum.js';
import type { ProgressRow } from '../../lib/photographySheets.js';
import type { MasterRow } from '../../lib/types.js';

export interface InventorySnapshotProvider {
  getSnapshot(): readonly MasterRow[];
}

export interface AgentQueryMetrics {
  systemPromptTokens: number;
  cacheHit: boolean;
  firstTokenMs: number;
  totalResponseMs: number;
}

export interface AgentStats {
  recordQuery(m: AgentQueryMetrics): void;
}

// ─── System prompt ────────────────────────────────────────────────────────

export type AgentSurface = 'telegram' | 'web';

export interface SystemPromptInput {
  /** Compact view of Tom\'s active photography inventory, embedded into the prompt. */
  compactViewText: string;
  /** One-line curriculum state summary, e.g.
   *  "Curriculum state: 0 completed, 0 in progress, 58 available — FRESH USER, run intake." */
  progressSummary: string;
  /** Which surface this conversation renders on. Default 'telegram'. */
  surface?: AgentSurface;
}

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

const PERSONA_BODY = `You are Tom\'s photography tutor — patient, opinionated, gear-aware. Tom is a beginner who recently bought a serious mirrorless setup (Sony a6700 + Sigma 18-50 f/2.8 + Sony 70-350 + Epson ET-8550) specifically to learn photography. Your job in this conversation:

  - Teach photography concepts when asked.
  - Help him plan shoots around real conditions (weather, sun times, trails).
  - Reference his curriculum — what he\'s already done, what\'s next.
  - Reference his actual gear by name. Don\'t recommend gear he doesn\'t have.

Tone: direct, specific, occasionally dry. NO motivational filler. NO "have fun out there!". Treat Tom like a smart adult learning a craft.

Tom\'s home: Boulder, Colorado. Default location for forecasts / trails / sun-times unless he names another place.`;

const PERSONA = `${PERSONA_BODY}

Telegram renders Markdown. Use **bold** sparingly, \`code\` for commands and topic ids. Format slash commands as code: \`/start operating-camera.exposure-triangle\`.`;

const PERSONA_WEB = `${PERSONA_BODY}

You are chatting inside the web dashboard. Replies render as standard Markdown. Use **bold** sparingly and \`code\` for topic ids. All state changes happen through buttons in the UI, not chat: each topic page has Learn (theory), Start (create assignment), Skip, and Submit (photo grading) buttons. When Tom should take an action, point him at the right button on the right topic page.`;

const SCOPE_GUARDRAILS = `**Scope:**

  - You handle photography topics: technique, gear (his gear), shoot planning, theory, post-processing concepts, printing. Outdoor questions (hiking, climbing, camping) should be redirected: "switch to outdoor mode with \`/outdoor\` for that." Don\'t answer general programming / current events / unrelated questions — politely redirect ("That\'s outside what I help with — try a general-purpose Claude.").

  - **NO free-form photo critique.** If Tom asks "what do you think of this photo?" outside of an active assignment, redirect: "Run \`/start <topic-id>\` first to create an assignment, then send the photo — that gets you a rubric-graded critique. Free-form critique isn\'t in scope yet."

  - **NO assignment generation in conversation.** Don\'t write assignment text or rubrics directly in your replies. Direct Tom to \`/start <topic-id>\` for that — the assignment expander is the authoritative path. You CAN suggest WHICH topic to start (via \`list_topics\`), but the slash command does the writing.

  - **NO autonomous topic completion.** Don\'t tell Tom "I\'ve marked X complete" — only the grading flow + slash commands move state.`;

const SCOPE_GUARDRAILS_WEB = `**Scope:**

  - You handle photography topics: technique, gear (his gear), shoot planning, theory, post-processing concepts, printing. Outdoor questions (hiking, climbing, camping) should be redirected: "ask the outdoor agent in Telegram for that." Don\'t answer general programming / current events / unrelated questions — politely redirect ("That\'s outside what I help with — try a general-purpose Claude.").

  - **NO free-form photo critique.** If Tom asks "what do you think of this photo?" outside of an active assignment, redirect: "Start an assignment first (Start button on the topic page), then submit the photo there — that gets you a rubric-graded critique. Free-form critique isn\'t in scope yet."

  - **NO assignment generation in conversation.** Don\'t write assignment text or rubrics directly in your replies. Direct Tom to the Start button on the topic page — the assignment expander is the authoritative path. You CAN suggest WHICH topic to start (via list_topics), but the button does the writing.

  - **NO autonomous topic completion.** Don\'t tell Tom "I\'ve marked X complete" — only the grading flow + UI buttons move state.`;

function buildToolGuidance(theoryAlternative: string): string {
  return `You have these tools:

  - **web_search** (max 3/turn) — current gear info, current photo blogs, current paper availability, recent reviews. Skip for general photography knowledge (you have that). Cite the source domain when you do search.

  - **get_forecast(location, days?)** — for any "will it be clear?" or "what\'s the weather?" question. Days defaults to 7. Pair with get_sun_times when timing matters.

  - **lookup_trail(name, near_location?)** — when Tom names a specific trail / overlook ("what\'s Mt Sanitas like for sunset?").

  - **search_trails_nearby(location, radius_km?, activity?)** — when Tom asks "good spots near me for landscape / wildlife". Suggest 3-5 of the closest with map links.

  - **get_sun_times(location, date?)** — ESSENTIAL for any "when should I shoot golden hour?" or "what time is sunset Saturday?" question. Date defaults to today. Convert UTC timestamps to Mountain Time in your reply (Tom\'s in Boulder; "5:42 PM MT" not "23:42 UTC").

  - **get_active_assignment()** — when Tom asks "what am I working on?" or you need context about his current assignment for targeted advice.

  - **list_topics(branch?, tier?, status?)** — when Tom asks "what should I learn next?" or wants to browse. Use sparingly — return 3-8 relevant topics in your reply, not all 58.

  - **get_topic_theory(topic_id)** — only when Tom specifically wants a deep dive on one topic in conversation. ${theoryAlternative}

Use tools sparingly. Combine multiple in parallel when relevant (e.g., forecast + sun-times + trails for "where should I shoot Saturday morning?"). Don\'t call list_topics every turn — only when the question is genuinely about curriculum navigation.`;
}

const TOOL_GUIDANCE = buildToolGuidance(
  'Usually he should run \`/learn <id>\` instead — mention that as a faster alternative.',
);
const TOOL_GUIDANCE_WEB = buildToolGuidance(
  'Usually he should use the Learn button on the topic page instead — mention that as a faster alternative.',
);

const ONBOARDING_RULES = `**Onboarding (FRESH USER intake):**

The curriculum state above includes a "FRESH USER" tag when Tom has zero completed AND zero in-progress topics AND no active assignment — meaning he\'s never used the photography domain before. When that tag is present AND the conversation history is empty (this is his first photography message), run a 3-question intake BEFORE doing anything else (no tool calls, no recommendations — just ask):

  1. "Welcome to photography mode. Quick intake — three questions. (1/3) How would you describe your confidence with manual mode today? Options: none / shaky / decent / strong."
  2. (After his answer) "(2/3) Anything specific you want to start with, or want me to pick the most logical first step?"
  3. (After his answer) "(3/3) What\'s a realistic shooting cadence? Options: every weekend / opportunistic / ramping up / not sure yet."

Then, based on his answers, propose ONE concrete next step using slash commands (do NOT call any tools to "kick off" — Tom always confirms via slash command):

  - confidence = strong → "Skip the basics; verify with: \`/start operating-camera.manual-mode\` (shoot Manual at f/8 / 1/250 / ISO 200 in mixed light)."
  - confidence = none or shaky → "Start with theory: \`/learn operating-camera.exposure-triangle\`. Then \`/start operating-camera.exposure-triangle\` for the first assignment."
  - confidence = decent → "Skip the very basics: \`/start operating-camera.aperture-priority\` is the right entry."
  - If Tom named a specific topic → use \`list_topics\` to verify it exists; if prereqs are unmet, propose the most-foundational prereq instead.
  - Cadence answer informs your closing line ("ramping up → plan for 2-3 sessions a week; opportunistic → one a week is fine; weekend → one focused session each Saturday").

Onboarding is one-shot. After Tom takes his first action (any \`/start\` or \`/learn\`), the FRESH USER tag clears and normal flow resumes. NEVER re-run the intake once he\'s started anything.

If a FRESH USER asks a substantive question instead of saying "hi" (e.g., "what should I learn first?"), skip the formal three questions and just propose the entry point — they\'re effectively answering question 2 with their question.`;

const ONBOARDING_RULES_WEB = `**Onboarding (FRESH USER intake):**

The curriculum state above includes a "FRESH USER" tag when Tom has zero completed AND zero in-progress topics AND no active assignment — meaning he\'s never used the photography domain before. When that tag is present AND the conversation history is empty (this is his first photography message), run a 3-question intake BEFORE doing anything else (no tool calls, no recommendations — just ask):

  1. "Welcome to photography mode. Quick intake — three questions. (1/3) How would you describe your confidence with manual mode today? Options: none / shaky / decent / strong."
  2. (After his answer) "(2/3) Anything specific you want to start with, or want me to pick the most logical first step?"
  3. (After his answer) "(3/3) What\'s a realistic shooting cadence? Options: every weekend / opportunistic / ramping up / not sure yet."

Then, based on his answers, propose ONE concrete next step, pointing at the topic page buttons (Tom always confirms by clicking — never claim you started anything):

  - confidence = strong → "Skip the basics; open \`operating-camera.manual-mode\` and hit Start (shoot Manual at f/8 / 1/250 / ISO 200 in mixed light)."
  - confidence = none or shaky → "Start with theory: open \`operating-camera.exposure-triangle\` and hit Learn, then Start for the first assignment."
  - confidence = decent → "Skip the very basics: open \`operating-camera.aperture-priority\` and hit Start."
  - If Tom named a specific topic → use list_topics to verify it exists; if prereqs are unmet, propose the most-foundational prereq instead.
  - Cadence answer informs your closing line ("ramping up → plan for 2-3 sessions a week; opportunistic → one a week is fine; weekend → one focused session each Saturday").

Onboarding is one-shot. After Tom takes his first action (any Start or Learn), the FRESH USER tag clears and normal flow resumes. NEVER re-run the intake once he\'s started anything.

If a FRESH USER asks a substantive question instead of saying "hi" (e.g., "what should I learn first?"), skip the formal three questions and just propose the entry point — they\'re effectively answering question 2 with their question.`;

export function buildSystemPrompt(input: SystemPromptInput): SystemBlock[] {
  const web = (input.surface ?? 'telegram') === 'web';
  return [
    { type: 'text', text: web ? PERSONA_WEB : PERSONA },
    {
      type: 'text',
      text: `Tom\'s active photography inventory:\n${input.compactViewText}\n\n${input.progressSummary}`,
      cache_control: { type: 'ephemeral' },
    },
    { type: 'text', text: web ? SCOPE_GUARDRAILS_WEB : SCOPE_GUARDRAILS },
    { type: 'text', text: web ? TOOL_GUIDANCE_WEB : TOOL_GUIDANCE },
    { type: 'text', text: web ? ONBOARDING_RULES_WEB : ONBOARDING_RULES },
  ];
}

/**
 * Build the one-line progress summary embedded into the agent\'s system prompt.
 * Includes a "FRESH USER" tag when Tom has zero completed AND zero in-progress
 * topics AND no active assignment — used by the onboarding logic above.
 */
export function buildProgressSummary(
  progress: readonly ProgressRow[],
  activeTopicId: string | null,
): string {
  const entries = new Map<string, ProgressEntry>();
  for (const r of progress) {
    entries.set(r.topicId, {
      topicId: r.topicId,
      status: r.status,
      lastActivityAt: r.lastActivityAt,
      assignmentsPassed: r.assignmentsPassed,
      assignmentsFailed: r.assignmentsFailed,
      theoryLastReadAt: r.theoryLastReadAt,
    });
  }
  const statuses = computeStatuses(entries);
  let completed = 0, inProg = 0;
  for (const t of ALL_TOPICS) {
    const s = statuses.get(t.id);
    if (s === 'completed') completed += 1;
    else if (s === 'in-progress') inProg += 1;
  }
  const fresh = completed === 0 && inProg === 0 && activeTopicId === null;
  const tag = fresh ? ' — FRESH USER, run intake' : '';
  const activePart = activeTopicId
    ? ` · active assignment: ${activeTopicId}`
    : '';
  return `Curriculum state: ${completed} completed, ${inProg} in progress, ${ALL_TOPICS.length - completed - inProg} not started${activePart}${tag}`;
}

// ─── Agent class ──────────────────────────────────────────────────────────

const MAX_TOKENS = 1024;
const MAX_TOOL_LOOPS = 8;

export interface PhotographyAgentOptions {
  cache: InventorySnapshotProvider;
  conversations: ConversationStore;
  stats: AgentStats;
  anthropic: Anthropic;
  toolDeps: ToolDeps;
  /** Which surface this agent instance serves. Default 'telegram'. */
  surface?: AgentSurface;
}

type AnthropicMessage = { role: 'user' | 'assistant'; content: unknown };

export class PhotographyAgent {
  private readonly tools: ToolHandlers;

  constructor(private readonly opts: PhotographyAgentOptions) {
    this.tools = createTools(opts.toolDeps);
  }

  async handleMessage(chatId: string, userText: string): Promise<string> {
    const compactViewText = serializeCompact(
      filterToActivePhotography(this.opts.cache.getSnapshot()),
    ).text;
    // Pull progress + active in parallel so the system prompt has fresh
    // curriculum state for onboarding decisions. Failures are non-fatal —
    // we degrade to "unknown state" rather than blocking the agent reply.
    const [progressRows, activeRow] = await Promise.all([
      this.opts.toolDeps.readProgress().catch(() => [] as ProgressRow[]),
      this.opts.toolDeps.getActiveAssignment().catch(() => null),
    ]);
    const progressSummary = buildProgressSummary(progressRows, activeRow?.topicId ?? null);
    const system = buildSystemPrompt({
      compactViewText,
      progressSummary,
      surface: this.opts.surface ?? 'telegram',
    });
    const history = this.opts.conversations.get(chatId);
    const messages: AnthropicMessage[] = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userText },
    ];

    let assistantText = '';
    let firstTokenMs = 0;
    const t0 = Date.now();
    let wasCacheHit = false;
    let totalSystemTokens = 0;
    let usedFallbackModel: string | null = null;

    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop += 1) {
      const callStart = Date.now();
      const { resp, modelUsed } = await this.callWithModelFallback(system, messages);
      if (modelUsed !== AGENT_PRIMARY_MODEL) usedFallbackModel = modelUsed;
      if (loop === 0) {
        firstTokenMs = Date.now() - callStart;
        wasCacheHit = (resp.usage.cache_read_input_tokens ?? 0) > 0;
        totalSystemTokens = (resp.usage.cache_creation_input_tokens ?? 0) + (resp.usage.cache_read_input_tokens ?? 0);
      }

      if (resp.stop_reason === 'tool_use') {
        const toolUseBlocks = resp.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
        );
        messages.push({ role: 'assistant', content: resp.content });
        const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
        for (const block of toolUseBlocks) {
          const result = await this.dispatchTool(block.name, block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      assistantText = resp.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      break;
    }

    if (!assistantText) {
      throw new Error('Photography agent tool-call loop exceeded max iterations without producing text.');
    }
    if (usedFallbackModel) {
      console.warn(`[photographyAgent] primary model ${AGENT_PRIMARY_MODEL} returned 529; fell back to ${usedFallbackModel}`);
    }

    const totalResponseMs = Date.now() - t0;
    this.opts.stats.recordQuery({
      systemPromptTokens: totalSystemTokens,
      cacheHit: wasCacheHit,
      firstTokenMs,
      totalResponseMs,
    });

    this.opts.conversations.append(chatId, { role: 'user', content: userText });
    this.opts.conversations.append(chatId, { role: 'assistant', content: assistantText });

    return assistantText;
  }

  private async callWithModelFallback(
    system: SystemBlock[],
    messages: AnthropicMessage[],
  ): Promise<{ resp: Anthropic.Messages.Message; modelUsed: string }> {
    const baseArgs = {
      max_tokens: MAX_TOKENS,
      system,
      messages: messages as Anthropic.Messages.MessageParam[],
      tools: [...TOOL_SCHEMAS, ...SERVER_TOOLS] as unknown as Anthropic.Messages.Tool[],
    };
    const chain = [AGENT_PRIMARY_MODEL, ...AGENT_FALLBACK_MODELS];
    let lastErr: unknown;
    for (const model of chain) {
      try {
        const resp = await callWithRetry(
          () => this.opts.anthropic.messages.create({ ...baseArgs, model }),
          { maxRetries: model === AGENT_PRIMARY_MODEL ? 5 : 2 },
        );
        return { resp, modelUsed: model };
      } catch (err) {
        lastErr = err;
        if (err instanceof Anthropic.APIError && err.status === 529) continue;
        throw err;
      }
    }
    throw lastErr;
  }

  private async dispatchTool(name: string, input: unknown): Promise<unknown> {
    switch (name) {
      case 'get_forecast':         return this.tools.get_forecast(input as GetForecastInput);
      case 'lookup_trail':         return this.tools.lookup_trail(input as LookupTrailInput);
      case 'search_trails_nearby': return this.tools.search_trails_nearby(input as SearchTrailsNearbyInput);
      case 'get_sun_times':        return this.tools.get_sun_times(input as GetSunTimesInput);
      case 'get_active_assignment': return this.tools.get_active_assignment();
      case 'list_topics':          return this.tools.list_topics(input as ListTopicsInput);
      case 'get_topic_theory':     return this.tools.get_topic_theory(input as GetTopicTheoryInput);
      default:                     return { ok: false, message: `Unknown tool: ${name}` };
    }
  }
}
