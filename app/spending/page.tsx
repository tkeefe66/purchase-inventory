import { getMasterRows } from '../lib/data';
import { SpendingCharts } from '../components/spending-charts';

export const dynamic = 'force-dynamic';

export default async function SpendingPage() {
  const rows = await getMasterRows();
  // Exclude returned / excluded rows from spend totals — those weren't kept.
  const kept = rows.filter((r) => r.status !== 'returned' && r.status !== 'excluded');
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Spending</h1>
      <p className="mb-6 text-sm text-zinc-400">
        ${kept.reduce((s, r) => s + (r.price || 0), 0).toFixed(2)} total across {kept.length} kept items (excludes returned + excluded rows).
      </p>
      <SpendingCharts rows={kept} />
    </div>
  );
}
