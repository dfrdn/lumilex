import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

export async function GET(req: NextRequest) {
  const session = await getSession();
  const role = session?.user?.role;
  if (!session || !role || !['admin', 'finance', 'super_user', 'partner'].includes(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const entityType = searchParams.get('entityType');
  const action = searchParams.get('action');
  const userId = searchParams.get('userId');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const search = searchParams.get('search');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '50')));

  const supabase = getServiceDbForFirm(session.firmId);

  let query = supabase
    .from('audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (entityType) query = query.eq('entity_type', entityType);
  if (action) query = query.eq('action', action);
  if (userId) query = query.eq('performed_by', userId);
  if (from) query = query.gte('created_at', `${from}T00:00:00+08:00`);
  if (to) query = query.lte('created_at', `${to}T23:59:59+08:00`);
  if (search) {
    const sanitized = search.replace(/[%_\\]/g, (c) => `\\${c}`);
    query = query.or(`entity_name.ilike.%${sanitized}%,performed_by_name.ilike.%${sanitized}%`);
  }

  const offset = (page - 1) * pageSize;
  const { data, error, count } = await query.range(offset, offset + pageSize - 1);

  if (error) {
    console.error('[audit-log]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({
    data: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((count ?? 0) / pageSize),
  });
}
