import Link from 'next/link';

interface Props {
  label: string;
  value: string;
  delta?: { value: string; direction: 'up' | 'down' } | undefined;
  href?: string;
}

export function KpiCard({ label, value, delta, href }: Props) {
  const content = (
    <div className="rounded-kpi border border-border-subtle bg-bg-surface p-3.5 shadow-card">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <div className="mt-1 text-[20px] font-bold tracking-[-0.015em] tabular-nums text-text-primary">{value}</div>
      {delta && (
        <div className={`mt-0.5 text-[10px] tabular-nums ${delta.direction === 'up' ? 'text-delta-up' : 'text-delta-down'}`}>
          {delta.direction === 'up' ? '↑' : '↓'} {delta.value}
        </div>
      )}
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block transition hover:brightness-110">
        {content}
      </Link>
    );
  }
  return content;
}
