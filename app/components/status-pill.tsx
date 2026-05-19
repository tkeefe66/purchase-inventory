import type { Status } from '../../lib/types.js';

const STYLES: Record<Status, string> = {
  active:   'text-status-active-fg bg-status-active-bg',
  broken:   'text-status-broken-fg bg-status-broken-bg',
  lost:     'text-status-broken-fg bg-status-broken-bg',
  retired:  'text-status-retired-fg bg-status-retired-bg',
  returned: 'text-status-returned-fg bg-status-returned-bg',
  sold:     'text-status-sold-fg bg-status-sold-bg',
  donated:  'text-status-donated-fg bg-status-donated-bg',
  excluded: 'text-status-excluded-fg bg-status-excluded-bg',
};

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-[10px] font-semibold ${STYLES[status]}`}>
      {status}
    </span>
  );
}
