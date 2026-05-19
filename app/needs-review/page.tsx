import { getMasterRows, getNeedsReviewRows } from '../lib/data';
import { computeKpis } from '../lib/kpi';
import { NeedsReviewTable } from '../components/needs-review-table';
import { KpiCard } from '../components/kpi-card';

export const dynamic = 'force-dynamic';

export default async function NeedsReviewPage() {
  const [rows, all] = await Promise.all([
    getMasterRows(),
    getNeedsReviewRows(),
  ]);
  const unresolved = all.filter((r) => !r.resolved);
  const kpis = computeKpis(rows, unresolved.length, new Date());

  return (
    <div className="relative overflow-hidden px-4 py-6 md:px-7">
      <div className="pointer-events-none absolute -right-20 -top-20 h-[280px] w-[280px] rounded-full bg-blob-gradient opacity-[0.18] blur-[40px]" />
      <div className="relative">
        <div className="text-[11px] uppercase tracking-[0.05em] text-text-muted">Inventory</div>
        <h1 className="mt-1 text-[26px] font-bold tracking-[-0.02em] text-text-primary">Needs review</h1>
        <p className="text-[13px] text-text-secondary">{unresolved.length} unresolved · {all.length} total in the sheet</p>

        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <KpiCard label="Active spend" value={`$${kpis.activeSpend.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />
          <KpiCard label="Items YTD" value={String(kpis.itemsYtd.value)} />
          <KpiCard label="Needs review" value={String(kpis.needsReview.value)} />
        </div>

        <div className="mt-6">
          <NeedsReviewTable rows={all} />
        </div>
      </div>
    </div>
  );
}
