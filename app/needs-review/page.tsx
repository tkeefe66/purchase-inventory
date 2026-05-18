import { getNeedsReviewRows } from '../lib/data';
import { NeedsReviewTable } from '../components/needs-review-table';

export const dynamic = 'force-dynamic';

export default async function NeedsReviewPage() {
  const rows = await getNeedsReviewRows();
  const unresolved = rows.filter((r) => !r.resolved);
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Needs review</h1>
      <p className="mb-6 text-sm text-zinc-400">
        {unresolved.length} unresolved · {rows.length} total in the sheet
      </p>
      <NeedsReviewTable rows={rows} />
    </div>
  );
}
