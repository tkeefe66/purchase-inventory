import { getMasterRows, getNeedsReviewRows } from './lib/data';
import { computeKpis } from './lib/kpi';
import { ItemsTable } from './components/items-table';
import { KpiCard } from './components/kpi-card';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { domain?: string };
}

export default async function Home({ searchParams }: PageProps) {
  const [allRows, needsReview] = await Promise.all([
    getMasterRows(),
    getNeedsReviewRows(),
  ]);
  const domain = (searchParams.domain ?? '').trim();
  // Scope KPIs to the active domain. ItemsTable receives all rows and applies
  // its own client-side domain filter via useTableFilters — so it stays in sync.
  const scopedRows = domain ? allRows.filter((r) => r.domain.toLowerCase() === domain.toLowerCase()) : allRows;
  const unresolved = needsReview.filter((r) => !r.resolved).length;
  const kpis = computeKpis(scopedRows, unresolved, new Date());
  const activeCount = scopedRows.filter((r) => r.status === 'active').length;
  const scopeLabel = domain ? domain.charAt(0).toUpperCase() + domain.slice(1) : 'All domains';

  return (
    <div className="relative overflow-hidden px-4 py-6 md:px-7">
      {/* Atmospheric gradient blob */}
      <div className="pointer-events-none absolute -right-20 -top-20 h-[280px] w-[280px] rounded-full bg-blob-gradient opacity-[0.18] blur-[40px]" />

      <div className="relative">
        <div className="text-[11px] uppercase tracking-[0.05em] text-text-muted">{scopeLabel}</div>
        <h1 className="mt-1 text-[26px] font-bold tracking-[-0.02em] text-text-primary">Items</h1>
        <p className="text-[13px] text-text-secondary">{activeCount} active items · {scopedRows.length} total</p>

        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <KpiCard
            label="Active spend"
            value={`$${kpis.activeSpend.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
            delta={kpis.activeSpend.delta !== 0
              ? { value: `$${Math.abs(kpis.activeSpend.delta).toFixed(0)} vs same month '${String(new Date().getUTCFullYear() - 1).slice(2)}`, direction: kpis.activeSpend.delta >= 0 ? 'up' : 'down' }
              : undefined}
          />
          <KpiCard
            label="Items YTD"
            value={String(kpis.itemsYtd.value)}
            delta={kpis.itemsYtd.delta !== 0
              ? { value: `${Math.abs(kpis.itemsYtd.delta)} vs '${String(new Date().getUTCFullYear() - 1).slice(2)}`, direction: kpis.itemsYtd.delta >= 0 ? 'up' : 'down' }
              : undefined}
          />
          <KpiCard
            label="Needs review"
            value={String(kpis.needsReview.value)}
            href="/needs-review"
          />
        </div>

        <div className="mt-6">
          <ItemsTable rows={allRows} />
        </div>
      </div>
    </div>
  );
}
