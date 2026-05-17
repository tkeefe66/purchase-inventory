/**
 * Build a Google site-search URL to deep-link to a federal agency page for
 * a specific rec area. Used when the source API's URL field is either
 * missing (BLM `WEB_LINK` is usually null) or permanently broken (USFS
 * `recareaurl` returns HTTP 200 but silently redirects to a generic forest
 * page after their 2024-2025 site redesign).
 *
 * Result example for ("Trout Lakes Campground", "Carson National Forest",
 * "fs.usda.gov"):
 *   https://www.google.com/search?q=site%3Afs.usda.gov+%22Trout+Lakes+Campground%22+%22Carson+National+Forest%22
 *
 * Google reliably surfaces the new agency page as the first result even
 * when the URL pattern changes underneath us.
 */
export function buildAgencySearchUrl(name: string, agency: string, agencyDomain: string): string {
  const cleanName = name.trim();
  const cleanAgency = agency.trim();
  const tokens = [`site:${agencyDomain}`, `"${cleanName}"`];
  if (cleanAgency) tokens.push(`"${cleanAgency}"`);
  const q = tokens.join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}
