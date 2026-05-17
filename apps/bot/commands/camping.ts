import { randomUUID } from 'node:crypto';
import type { CampingIndex, CampingTrips, Facility, PlannedTrip } from '../../../lib/reccgov/types.js';
import { CURATED_REGIONS } from '../../../lib/reccgov/regions.js';
import type { PendingActionStore } from '../../../lib/pendingActions.js';

export interface CampingDeps {
  readIndex: () => Promise<CampingIndex>;
  readTrips: () => Promise<CampingTrips>;
  writeTrips: (t: CampingTrips) => Promise<void>;
  readMutedIds: () => Promise<string[]>;
  setMuted: (facilityIds: string[], muted: boolean) => Promise<void>;
  pendingActions: PendingActionStore;
}

export interface ParsedCommand { name: string; args: string }

/**
 * Apply a /plan-trip action against a specific facility — used both by the
 * direct happy path (one fuzzy match) and by the numeric-selection
 * continuation (after the user picks "1" from the multi-match list).
 */
async function applyPlanTrip(
  facility: Facility,
  visitDate: string,
  deps: CampingDeps,
): Promise<string> {
  const trips = await deps.readTrips();
  const dup = trips.trips.find(
    (t) => t.facilityId === facility.facilityId && t.visitDate === visitDate && !t.cancelledAt,
  );
  if (dup) return `Already have an active trip to ${facility.name} on ${visitDate}. Use /cancel-trip ${dup.id} first if you want to re-plan.`;
  const releaseDate = addDays(visitDate, -facility.leadTimeDays);
  const trip: PlannedTrip = {
    id: randomUUID(),
    facilityId: facility.facilityId,
    visitDate,
    plannedAt: new Date().toISOString(),
    nudges: [
      { kind: '7-day', firedAt: null },
      { kind: 'release-moment', firedAt: null },
    ],
    cancelledAt: null,
  };
  await deps.writeTrips({ trips: [...trips.trips, trip] });
  return `Planned ${facility.name} for ${visitDate}. Booking opens ${releaseDate}; I'll nudge you 7 days out and at the release moment.`;
}

/**
 * Continuation handler: if the user has a pending camping selection (from a
 * previous multi-match) and sends a plain numeric reply, resolve to the
 * chosen facility and run the original action. Returns the result string,
 * or null if the message isn't a selection reply.
 */
export async function handleCampingSelectionContinuation(
  chatId: string,
  text: string,
  deps: CampingDeps,
): Promise<string | null> {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const pending = deps.pendingActions.peek(chatId);
  if (!pending || pending.type !== 'camping-plan-trip-selection') return null;
  const index = Number(trimmed) - 1;
  if (index < 0 || index >= pending.matches.length) {
    return `That number isn't in the list (1-${pending.matches.length}). Try again, or run /plan-trip with a more specific name.`;
  }
  const chosen = pending.matches[index]!;
  deps.pendingActions.pop(chatId);
  return applyPlanTrip(chosen, pending.visitDate, deps);
}

function fuzzyFindFacility(query: string, facilities: readonly Facility[]): Facility[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  // Exact-id wins.
  const byId = facilities.find((f) => f.facilityId.toLowerCase() === q);
  if (byId) return [byId];
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  const scored = facilities
    .filter((f) => f.active)
    .map((f) => {
      const haystack = `${f.name} ${f.parentUnit}`.toLowerCase();
      const matched = tokens.filter((t) => haystack.includes(t)).length;
      return { f, score: matched };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((s) => s.f);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function handleCampingCommand(
  cmd: ParsedCommand,
  deps: CampingDeps,
  chatId: string = '',
): Promise<string> {
  const idx = await deps.readIndex();
  const mutedIds = new Set(await deps.readMutedIds());

  if (cmd.name === 'watchlist') {
    const active = idx.facilities.filter((f) => f.active && !mutedIds.has(f.facilityId));
    if (active.length === 0) return 'No active facilities (everything is muted or index is empty).';
    const byParent = new Map<string, Facility[]>();
    for (const f of active) {
      if (!byParent.has(f.parentUnit)) byParent.set(f.parentUnit, []);
      byParent.get(f.parentUnit)!.push(f);
    }
    const lines = [`Active watchlist (${active.length} sites):`];
    for (const [parent, sites] of byParent) {
      lines.push(`\n*${parent}* (${sites.length})`);
      for (const s of sites.slice(0, 5)) lines.push(`  • ${s.name}`);
      if (sites.length > 5) lines.push(`  …and ${sites.length - 5} more`);
    }
    return lines.join('\n');
  }

  if (cmd.name === 'regions') {
    const lines: string[] = ['Curated regions and their parent units:'];
    for (const [region, parents] of Object.entries(CURATED_REGIONS)) {
      lines.push(`\n*${region}*`);
      for (const p of parents) lines.push(`  • ${p}`);
    }
    return lines.join('\n');
  }

  if (cmd.name === 'watch' || cmd.name === 'unwatch') {
    if (!cmd.args.trim()) return `Usage: /${cmd.name} <facility-name | facility-id | region | parent-unit>`;
    // Region match: if args matches a curated region exactly, mute every facility in any of those parent units.
    const regionKey = Object.keys(CURATED_REGIONS).find((r) => r.toLowerCase() === cmd.args.toLowerCase());
    if (regionKey) {
      const parents = new Set(CURATED_REGIONS[regionKey]);
      const affected = idx.facilities.filter((f) => parents.has(f.parentUnit)).map((f) => f.facilityId);
      await deps.setMuted(affected, cmd.name === 'unwatch');
      return `${cmd.name === 'unwatch' ? 'Muted' : 'Un-muted'} ${affected.length} sites in ${regionKey}.`;
    }
    // Parent-unit match (exact match against any parent).
    const parentMatch = idx.facilities.find((f) => f.parentUnit.toLowerCase() === cmd.args.toLowerCase());
    if (parentMatch) {
      const affected = idx.facilities.filter((f) => f.parentUnit === parentMatch.parentUnit).map((f) => f.facilityId);
      await deps.setMuted(affected, cmd.name === 'unwatch');
      return `${cmd.name === 'unwatch' ? 'Muted' : 'Un-muted'} ${affected.length} sites in ${parentMatch.parentUnit}.`;
    }
    // Fuzzy facility name.
    const matches = fuzzyFindFacility(cmd.args, idx.facilities);
    if (matches.length === 0) return `No match for "${cmd.args}". Try /watchlist to browse.`;
    if (matches.length > 1) {
      const list = matches.map((m, i) => `  ${i + 1}. ${m.name} (${m.parentUnit})`).join('\n');
      return `Multiple matches for "${cmd.args}":\n${list}\nReply with a more specific name or facility-id.`;
    }
    await deps.setMuted([matches[0]!.facilityId], cmd.name === 'unwatch');
    return `${cmd.name === 'unwatch' ? 'Muted' : 'Un-muted'} ${matches[0]!.name}.`;
  }

  if (cmd.name === 'plan-trip') {
    const m = cmd.args.match(/^(.+?)\s+(\d{4}-\d{2}-\d{2})$/);
    if (!m) return 'Usage: /plan-trip <facility-name> <YYYY-MM-DD>';
    const [, query, visitDate] = m;
    const today = new Date().toISOString().slice(0, 10);
    if (visitDate! < today) return `Visit date ${visitDate} is in the past (today is ${today}).`;
    const matches = fuzzyFindFacility(query!, idx.facilities);
    if (matches.length === 0) return `No facility match for "${query}".`;
    if (matches.length > 1) {
      const list = matches.map((m2, i) => `  ${i + 1}. ${m2.name} (${m2.parentUnit})`).join('\n');
      // Park a pending selection so a numeric reply ("1") resolves to the picked
      // facility without forcing the user to retype the whole command.
      if (chatId) {
        deps.pendingActions.set(chatId, {
          type: 'camping-plan-trip-selection',
          matches, visitDate: visitDate!,
        });
      }
      return `Multiple matches:\n${list}\nReply with 1, 2, or 3 to pick — or re-run /plan-trip with a more specific name.`;
    }
    return applyPlanTrip(matches[0]!, visitDate!, deps);
  }

  if (cmd.name === 'trips') {
    const trips = await deps.readTrips();
    const active = trips.trips.filter((t) => !t.cancelledAt);
    if (active.length === 0) return 'No active planned trips. Use /plan-trip <site> <date> to add one.';
    const byId = new Map(idx.facilities.map((x) => [x.facilityId, x]));
    const lines = [`Active trips (${active.length}):`];
    for (const t of active) {
      const fac = byId.get(t.facilityId);
      const name = fac?.name ?? `(unknown facility ${t.facilityId})`;
      const releaseDate = fac ? addDays(t.visitDate, -fac.leadTimeDays) : '(unknown)';
      const sevenFired = t.nudges.find((n) => n.kind === '7-day')?.firedAt ? '✅' : '⏳';
      const releaseFired = t.nudges.find((n) => n.kind === 'release-moment')?.firedAt ? '✅' : '⏳';
      lines.push(`• ${name} on ${t.visitDate} — opens ${releaseDate} — 7d ${sevenFired} release ${releaseFired}`);
    }
    return lines.join('\n');
  }

  if (cmd.name === 'cancel-trip') {
    if (!cmd.args.trim()) return 'Usage: /cancel-trip <trip-id | facility-name>';
    const trips = await deps.readTrips();
    const matchByExactId = trips.trips.find((t) => t.id === cmd.args.trim() && !t.cancelledAt);
    let target = matchByExactId;
    if (!target) {
      const fmatches = fuzzyFindFacility(cmd.args, idx.facilities);
      if (fmatches.length === 1) {
        target = trips.trips.find((t) => t.facilityId === fmatches[0]!.facilityId && !t.cancelledAt);
      }
    }
    if (!target) return `No active trip matches "${cmd.args}".`;
    const updated: CampingTrips = {
      trips: trips.trips.map((t) => t.id === target!.id ? { ...t, cancelledAt: new Date().toISOString() } : t),
    };
    await deps.writeTrips(updated);
    return `Cancelled trip ${target.id} — no more nudges for it.`;
  }

  if (cmd.name === 'campsites') {
    return 'Use the agent: ask "Where can I camp free near X within Y mi?" — that\'ll run find_free_campsites with weather context.';
  }

  return `Unrecognized camping command: ${cmd.name}`;
}
