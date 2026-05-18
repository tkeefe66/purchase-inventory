import 'dotenv/config';
import { createSheetsClient, readMasterRows } from '../lib/sheets.js';
import { runMaintenanceNudge } from '../apps/cron/maintenance-nudge.js';
import { ageYears, MAINTENANCE_RULES } from '../domains/outdoor/maintenance.js';

/**
 * Dry-run the monthly maintenance nudge against real inventory. Prints the
 * Telegram message that WOULD be sent on the next 1st-of-month tick. No
 * writes, no Telegram send.
 *
 *   npm run maintenance-dry
 */
async function main(): Promise<void> {
  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const rows = await readMasterRows(sheets, spreadsheetId);
  console.log(`Read ${rows.length} master rows from sheet`);

  // Diagnostic: how many rows survive each filter step?
  const active = rows.filter((r) => r.status === 'active');
  const gear = active.filter((r) => r.type === 'Gear');
  const outdoor = gear.filter((r) => r.domain === 'Outdoor');
  console.log(`  active=${active.length}  active+Gear=${gear.length}  active+Gear+Outdoor=${outdoor.length}`);

  // Show what subcategories exist among the rule's target population.
  const subCategories = new Map<string, number>();
  for (const r of outdoor) subCategories.set(r.subCategory, (subCategories.get(r.subCategory) ?? 0) + 1);
  const top = Array.from(subCategories.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log(`  Top 20 subCategories (out of ${subCategories.size} distinct):`);
  for (const [sub, n] of top) console.log(`    ${n.toString().padStart(3)}  "${sub}"`);

  // Dump items in subcategories the rules SHOULD plausibly cover.
  const targets = ['Footwear', 'Sleep System', 'Safety & Protection', 'Protection', 'Outerwear', 'Shelter'];
  console.log(`\n  Items in rule-relevant subCategories (with age + rule matches):`);
  const now = new Date();
  for (const t of targets) {
    const items = outdoor.filter((r) => r.subCategory === t);
    if (items.length === 0) continue;
    console.log(`    "${t}":`);
    for (const r of items) {
      const age = ageYears(r.date, now);
      const matchedRules = MAINTENANCE_RULES.filter((rule) => rule.applies(r)).map((rule) => rule.id);
      const evals = matchedRules.map((id) => {
        const rule = MAINTENANCE_RULES.find((m) => m.id === id)!;
        const out = rule.evaluate(age);
        return out ? `${id}=fires(${out.issue})` : `${id}=below`;
      }).join(', ');
      const tag = matchedRules.length === 0 ? '[no rule]' : `[${evals}]`;
      console.log(`      ${r.date}  age=${age}y  ${tag}  ${r.brand} ${r.itemName.slice(0, 50)}`);
    }
  }



  const nudge = await runMaintenanceNudge({
    sheets, spreadsheetId, rows, now: new Date(),
  });

  console.log(`\nFindings: ${nudge.rawFindings.length} total, ${nudge.surfaced.length} surfaced, ${nudge.suppressedItemIds.length} suppressed by ack`);
  if (nudge.message) {
    console.log('\n========== Would send to Telegram ==========');
    console.log(nudge.message);
    console.log('============================================\n');
  } else {
    console.log('\n(no items need attention — no Telegram would be sent)');
  }

  if (nudge.rawFindings.length > 0) {
    console.log('\nAll findings (for sanity-check, including any suppressed):');
    for (const f of nudge.rawFindings) {
      const suppressed = nudge.suppressedItemIds.includes(f.itemId) ? ' [acked]' : '';
      console.log(`  [${f.itemId}] ${f.emoji} ${f.brand} ${f.itemName} — ${f.ageYears}y — ${f.issue}${suppressed}`);
    }
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
