import type { ProgressStatus } from '../../lib/photographySheets.js';
import { CheckIcon, PlayIcon, CircleIcon, LockIcon, SlashIcon } from './icons';

const STATUS_ICON: Record<ProgressStatus, typeof CheckIcon> = {
  completed: CheckIcon,
  'in-progress': PlayIcon,
  available: CircleIcon,
  locked: LockIcon,
  skipped: SlashIcon,
};

export const STATUS_LABEL: Record<ProgressStatus, string> = {
  completed: 'Completed',
  'in-progress': 'In progress',
  available: 'Available',
  locked: 'Locked',
  skipped: 'Skipped',
};

const STATUS_CLASS: Record<ProgressStatus, string> = {
  completed: 'text-delta-up',
  'in-progress': 'text-text-primary',
  available: 'text-text-secondary',
  locked: 'text-text-muted opacity-70',
  skipped: 'text-text-muted',
};

/**
 * One glyph rendering per topic/progress status, shared by the Skills grid,
 * branch sections, and topic detail page so the icon set can't drift between
 * screens the way the three hand-rolled emoji maps used to.
 *
 * The icon is decorative (aria-hidden) whenever adjacent visible text already
 * names the status (legends, pills). Pass `label` when the glyph is the only
 * status indicator (topic chips, prereq rows) so screen readers still get it.
 */
export function StatusGlyph({
  status,
  size = 13,
  label = false,
}: {
  status: ProgressStatus;
  size?: number;
  label?: boolean;
}) {
  const Icon = STATUS_ICON[status];
  const glyph = <Icon size={size} className={STATUS_CLASS[status]} />;
  if (!label) {
    return <span className="inline-flex w-4 flex-none justify-center">{glyph}</span>;
  }
  return (
    <span className="inline-flex w-4 flex-none justify-center" role="img" aria-label={STATUS_LABEL[status]}>
      {glyph}
    </span>
  );
}
