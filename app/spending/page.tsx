import { getMasterRows, getNeedsReviewRows } from '../lib/data';
import { computeKpis } from '../lib/kpi';
import { SpendingCharts } from '../components/spending-charts';
import { KpiCard } from '../components/kpi-card';

export const dynamic = 'force-dynamic';

export default async function SpendingPage() {
  const [rows, needsReview] = await Promise.all([
    getMasterRows(),
    getNeedsReviewRows(),
  ]);
  const kept = rows.filter((r) => r.status !== 'returned' && r.status !== 'excluded');
  const kpis = computeKpis(rows, needsReview.filter((r) => !r.resolved).length, new Date());
  const total = kept.reduce((s, r) => s + (r.price || 0), 0);

  return (
    <div className="relative overflow-hidden px-4 py-6 md:px-7">
      <div className="pointer-events-none absolute -right-20 -top-20 h-[280px] w-[280px] rounded-full bg-blob-gradient opacity-[0.18] blur-[40px]" />
      <div className="relative">
        <div className="text-[11px] uppercase tracking-[0.05em] text-text-muted">Inventory</div>
        <h1 className="mt-1 text-[26px] font-bold tracking-[-0.02em] text-text-primary">Spending</h1>
        <p className="text-[13px] text-text-secondary">${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} across {kept.length} kept items</p>

        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <KpiCard label="Active spend" value={`$${kpis.activeSpend.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />
          <KpiCard label="Items YTD" value={String(kpis.itemsYtd.value)} />
          <KpiCard label="Needs review" value={String(kpis.needsReview.value)} href="/needs-review" />
        </div>

        <div className="mt-6">
          <SpendingCharts rows={kept} />
        </div>
      </div>
    </div>
  );
}
