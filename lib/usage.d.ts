// Types for ./usage.js, which is copied verbatim from the coach-web repo
// (reporters/usage.js) and must stay byte-identical to it so pricing and field
// fixes can be made in one place and re-copied. Declare types here rather than
// porting the file to TypeScript.

/** The `usage` block from an Anthropic API response. All fields optional: the
 *  reporter coerces anything missing or non-numeric to 0. */
export interface AnthropicUsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export interface ReportOptions {
  url?: string;
  token?: string;
}

export function buildPayload(
  app: string,
  model: string,
  usage: AnthropicUsageLike | null | undefined,
  ts?: string,
): Record<string, string | number>;

/** Fire-and-forget a usage row to coach-web. Never throws, never blocks, and
 *  no-ops when COACH_USAGE_URL / COACH_USAGE_TOKEN are unset. */
export function report(
  app: string,
  model: string,
  usage: AnthropicUsageLike | null | undefined,
  options?: ReportOptions,
): void;
