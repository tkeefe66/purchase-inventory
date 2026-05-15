// Single source of truth for Claude model IDs + pricing used across the codebase.
//
// **Always default to the latest Claude model.** When Anthropic releases a newer
// Opus / Sonnet / Haiku, update this file (and only this file, in most cases).
// Tests that hardcode model names import from here so they pick up new values
// automatically. The DECISIONS.md "2026-05-14 — Upgrade primary agent model"
// entry has the full update checklist.

export const MODELS = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

/** Primary model the outdoor agent calls first. */
export const AGENT_PRIMARY_MODEL: ModelId = MODELS.opus;

/**
 * Fallback chain used when the primary returns sustained 529. Tried in order;
 * each step gets fewer retries than the primary.
 */
export const AGENT_FALLBACK_MODELS: readonly ModelId[] = [MODELS.sonnet, MODELS.haiku];

/** Model the Amazon parser's tier-2 fallback uses (cost-optimized JSON extraction). */
export const PARSER_MODEL: ModelId = MODELS.haiku;

/**
 * Prompt-cache pricing for the agent's primary model (USD per million tokens).
 * Anthropic's standard ratios: cache-write-5min = 1.25x base input, cache-read = 0.1x base input.
 * For Opus 4.7 base input is $15/MTok → write $18.75, read $1.50.
 * Update these whenever AGENT_PRIMARY_MODEL changes to a model with different base pricing.
 */
export const AGENT_PRICING_PER_MTOK = {
  cacheWrite5min: 18.75,
  cacheRead: 1.5,
} as const;
