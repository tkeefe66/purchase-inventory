import { CheckIcon, DashIcon, XIcon } from './icons';
import { sortCriteriaPassFirst } from '../lib/photography-verdicts';

export interface CriterionResult {
  criterion: string;
  result: string;
  reason?: string;
}

const RESULT_ICON: Record<string, typeof CheckIcon> = {
  pass: CheckIcon,
  partial: DashIcon,
  fail: XIcon,
};

const RESULT_CLASS: Record<string, string> = {
  pass: 'text-delta-up',
  partial: 'text-text-secondary',
  fail: 'text-delta-down',
};

const RESULT_LABEL: Record<string, string> = {
  pass: 'Pass',
  partial: 'Partial',
  fail: 'Fail',
};

/**
 * Single per-criterion rubric-result renderer, shared by the topic detail
 * page, the assignments list, and the submit/grade result view — replaces
 * three drifted copies that rendered raw ✓/~/✗ characters with no text
 * alternative for screen readers.
 */
const DEFAULT_HEADING_CLASS = 'mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted';

export function PerCriterionList({
  items,
  title = 'Per criterion',
  headingClassName = DEFAULT_HEADING_CLASS,
}: {
  items: readonly CriterionResult[];
  title?: string;
  /** Override when the surrounding card uses a different section-heading style than the default eyebrow label. */
  headingClassName?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className={headingClassName}>{title}</div>
      <ul className="mt-1 space-y-1">
        {sortCriteriaPassFirst(items).map((c, i) => {
          const Icon = RESULT_ICON[c.result] ?? DashIcon;
          const cls = RESULT_CLASS[c.result] ?? 'text-text-secondary';
          return (
            <li key={i} className="flex gap-2 text-[12px]">
              <span
                className={`mt-0.5 inline-flex w-3 flex-none justify-center ${cls}`}
                role="img"
                aria-label={RESULT_LABEL[c.result] ?? c.result}
              >
                <Icon size={12} />
              </span>
              <span className="text-text-secondary">
                <strong className="text-text-primary">{c.criterion}</strong>
                {c.reason ? ` — ${c.reason}` : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Parses a stored `perCriterionJson` sheet cell into typed items; returns [] on any malformed input. */
export function parsePerCriterionJson(json: string): CriterionResult[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as CriterionResult[]) : [];
  } catch {
    return [];
  }
}
