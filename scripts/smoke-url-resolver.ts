import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../lib/models.js';

/**
 * One-shot diagnostic: dump the full Sonnet response for `resolveAgencyUrl`
 * on a known-failing input. Use to debug whether web_search is firing,
 * whether the model is returning NONE, or whether the parser is dropping
 * a valid URL.
 *
 * Cost: ~$0.02 per run (one Sonnet call + 1-2 web_search uses).
 */

const SYSTEM_PROMPT = `You resolve a federal recreation-site name to its canonical agency URL.

You will be given: a rec-area name, the managing agency (e.g. "Carson National Forest" or "BLM Tres Rios Field Office"), and an agency domain (e.g. "fs.usda.gov" or "blm.gov").

Use web_search (1-2 searches) to find the OFFICIAL agency page for this specific rec area. Prefer queries like:
  site:<domain> "<rec area name>" "<agency>"

Pick the FIRST organic (non-ad, non-sponsored) result whose URL is on the agency domain AND whose page is specifically about this rec area — NOT a generic forest/office overview, NOT a list page, NOT a campground-search results page.

Return ONLY a single URL on its own line. No prose, no markdown, no quotes.

If you cannot find a confident match on the agency domain, return the literal string:
NONE`;

async function main(): Promise<void> {
  const anthropic = new Anthropic();
  const cases = [
    { name: 'Miller Camp', agency: 'BLM', domain: 'blm.gov', expectedToFail: true },
    { name: 'Trout Lakes Campground', agency: 'Carson National Forest', domain: 'fs.usda.gov', expectedToFail: false },
  ];

  for (const c of cases) {
    console.log(`\n=== ${c.name} / ${c.agency} (expectedToFail=${c.expectedToFail}) ===`);
    const userText = `name: ${c.name}\nagency: ${c.agency}\ndomain: ${c.domain}`;
    try {
      const resp = await anthropic.messages.create({
        model: MODELS.sonnet,
        max_tokens: 256,
        system: [{ type: 'text', text: SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: userText }],
        tools: [
          {
            type: 'web_search_20260209',
            name: 'web_search',
            max_uses: 2,
          },
        ] as unknown as Anthropic.Messages.Tool[],
      });
      console.log('stop_reason:', resp.stop_reason);
      console.log('usage:', JSON.stringify(resp.usage));
      console.log('content blocks:', resp.content.length);
      for (let i = 0; i < resp.content.length; i++) {
        const b = resp.content[i]!;
        if (b.type === 'text') {
          console.log(`  [${i}] text: ${JSON.stringify(b.text.slice(0, 400))}`);
        } else if (b.type === 'tool_use') {
          console.log(`  [${i}] tool_use: ${b.name} input=${JSON.stringify(b.input).slice(0, 200)}`);
        } else if (b.type === 'server_tool_use') {
          console.log(`  [${i}] server_tool_use: ${(b as { name?: string }).name ?? '?'} input=${JSON.stringify((b as { input?: unknown }).input).slice(0, 200)}`);
        } else if (b.type === 'web_search_tool_result') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = b as any;
          const content = r.content;
          if (Array.isArray(content)) {
            console.log(`  [${i}] web_search_tool_result: ${content.length} results`);
            for (const item of content.slice(0, 3)) {
              console.log(`        - ${(item as { url?: string }).url ?? '?'} | ${(item as { title?: string }).title ?? '?'}`);
            }
          } else {
            console.log(`  [${i}] web_search_tool_result: ${JSON.stringify(content).slice(0, 200)}`);
          }
        } else {
          console.log(`  [${i}] type=${b.type}`);
        }
      }
    } catch (err) {
      console.error('ERROR:', err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
