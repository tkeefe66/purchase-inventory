import { getMasterRows } from './lib/data';
import { ItemsTable } from './components/items-table';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const rows = await getMasterRows();
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Items</h1>
      <p className="mb-6 text-sm text-zinc-400">
        {rows.length} total · {rows.filter((r) => r.status === 'active').length} active
      </p>
      <ItemsTable rows={rows} />
    </div>
  );
}
