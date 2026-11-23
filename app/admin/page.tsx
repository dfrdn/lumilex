import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import AdminGreeting from '@/components/admin/AdminGreeting';
import AdminOverviewGrid from '@/components/admin/AdminOverviewGrid';
import AdminRecentTables from '@/components/admin/AdminRecentTables';

export const metadata: Metadata = { title: 'Overview' };

export const revalidate = 30;

const ENTITY_TABLES = [
  { key: 'clients', table: 'clients' },
  { key: 'matters', table: 'matters' },
  { key: 'deliverables', table: 'deliverables' },
  { key: 'tasks', table: 'tasks' },
  { key: 'meetings', table: 'meetings' },
  { key: 'hearings', table: 'hearings' },
  { key: 'files', table: 'files' },
] as const;

export default async function AdminOverviewPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const userName = session.user.name ?? '';

  const supabase = getServiceDbForFirm(session.firmId);

  // Filings = deliverables belonging to matters with case info (case_title, case_number, or court)
  async function countFilings(): Promise<number> {
    const { data: caseMatterRows } = await supabase
      .from('matters')
      .select('notion_id')
      .or('case_title.neq.,case_number.neq.,court.neq.');
    const caseMatterIds = (caseMatterRows ?? []).map((m) => m.notion_id);
    if (caseMatterIds.length === 0) return 0;
    const { count } = await supabase
      .from('deliverables')
      .select('*', { count: 'exact', head: true })
      .in('matter_id', caseMatterIds);
    return count ?? 0;
  }

  const [countResults, filingsCount] = await Promise.all([
    Promise.all(
      ENTITY_TABLES.map(async (entity) => {
        const { count, error } = await supabase
          .from(entity.table)
          .select('*', { count: 'exact', head: true });
        return { key: entity.key, count: error ? 0 : (count ?? 0) };
      }),
    ),
    countFilings(),
  ]);

  const counts = Object.fromEntries([
    ...countResults.map((r) => [r.key, r.count]),
    ['filings', filingsCount],
  ]);

  return (
    <>
      <AdminGreeting userName={userName} />

      <AdminOverviewGrid counts={counts} />
      <AdminRecentTables />
    </>
  );
}
