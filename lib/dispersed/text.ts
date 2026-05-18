/**
 * Strip HTML tags + decode common entities from USFS's `recareadescription`
 * field (which arrives as a chunk of raw HTML — paragraphs, images, bold,
 * non-breaking spaces, etc.). Result is plain text suitable for a sheet
 * cell or Telegram message.
 *
 * Not a full HTML parser — these descriptions are simple enough that a
 * regex sweep + entity table covers everything. If we ever see USFS use
 * exotic markup we'll switch to cheerio.
 */
const ENTITIES: ReadonlyArray<[RegExp, string]> = [
  [/&nbsp;/g, ' '],
  [/&amp;/g, '&'],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&rsquo;|&#39;|&apos;|&lsquo;/g, "'"],
  [/&ldquo;|&rdquo;/g, '"'],
  [/&hellip;|&#8230;/g, '...'],
  [/&mdash;|&#8212;/g, '—'],
  [/&ndash;|&#8211;/g, '–'],
  [/&copy;/g, '©'],
  [/&reg;/g, '®'],
  // Generic numeric entity fallback — convert to Unicode codepoint when valid.
];

export function stripHtml(html: string): string {
  let s = html;
  // Drop <script>/<style> blocks entirely (rare but defensible).
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  // Replace paragraph + break boundaries with a space so words don't fuse.
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|br)\s*\/?>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, ' ');
  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, '');
  // Decode named entities.
  for (const [re, ch] of ENTITIES) s = s.replace(re, ch);
  // Decode generic numeric entities (&#NNN; / &#xNN;) — left over after named map.
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  // Drop any lingering unknown entity.
  s = s.replace(/&[a-z]+;/gi, ' ');
  // Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}
