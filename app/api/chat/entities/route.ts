import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import type { EntityRef } from '@/types/chat';

/**
 * GET /api/chat/entities?q=term&matterId=optional&all=1
 * Search matter entities for the entity reference picker.
 * Filings are external deliverables (those with external_due_date set).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const searchParams = req.nextUrl.searchParams;
  const q = searchParams.get('q')?.trim();
  const matterId = searchParams.get('matterId');
  const listAll = searchParams.get('all') === '1';

  if (!q && !listAll) {
    return NextResponse.json({ entities: [] });
  }

  const results: EntityRef[] = [];

  // Standard tables with their date/status fields
  const tables: {
    table: string;
    type: EntityRef['type'];
    dateCol?: string;
    statusCol?: string;
    extraFilter?: (q: any) => any;
  }[] = [
    { table: 'deliverables', type: 'deliverable', statusCol: 'status' },
    { table: 'tasks', type: 'task', statusCol: 'status' },
    { table: 'hearings', type: 'hearing', dateCol: 'date', statusCol: 'status' },
    { table: 'meetings', type: 'meeting', dateCol: 'date_start' },
    { table: 'files', type: 'file' },
    {
      table: 'deliverables', type: 'filing', dateCol: 'external_due_date', statusCol: 'status',
      extraFilter: (q) => q.eq('type', 'External').not('external_due_date', 'is', null),
    },
  ];

  await Promise.all(
    tables.map(async ({ table, type, dateCol, statusCol, extraFilter }) => {
      const selectCols = ['notion_id', 'name', dateCol, statusCol]
        .filter(Boolean)
        .join(', ');

      let query = supabase.from(table).select(selectCols);

      if (extraFilter) query = extraFilter(query);
      if (q) query = query.ilike('name', `%${q}%`);
      if (matterId) query = query.eq('matter_id', matterId);
      if (!listAll) query = query.limit(5);

      const { data } = await query;
      for (const row of data ?? []) {
        const r = row as any;
        results.push({
          type,
          id: r.notion_id,
          name: r.name,
          date: dateCol ? (r[dateCol] ?? null) : null,
          status: statusCol ? (r[statusCol] ?? null) : null,
        });
      }
    }),
  );

  if (q) {
    const lower = q.toLowerCase();
    results.sort((a, b) => {
      const aStart = a.name.toLowerCase().startsWith(lower) ? 0 : 1;
      const bStart = b.name.toLowerCase().startsWith(lower) ? 0 : 1;
      return aStart - bStart;
    });
  } else {
    results.sort((a, b) => a.name.localeCompare(b.name));
  }

  return NextResponse.json({ entities: listAll ? results : results.slice(0, 20) });
}
