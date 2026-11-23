import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = session.user.role ?? 'lawyer';
  if (role !== 'admin' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const matterId = url.searchParams.get('matterId');
  const excludeId = url.searchParams.get('excludeId');

  if (!matterId) {
    return NextResponse.json({ hearings: [], deliverables: [] });
  }

  const supabase = await getSupabaseServerAuthClient();

  const [hearingsRes, deliverablesRes, filesRes] = await Promise.all([
    supabase
      .from('hearings')
      .select('notion_id, name, date')
      .eq('matter_id', matterId)
      .order('date', { ascending: false })
      .limit(200),
    supabase
      .from('deliverables')
      .select('notion_id, name, type, external_due_date')
      .eq('matter_id', matterId)
      .neq('type', 'Status Report')
      .order('external_due_date', { ascending: false })
      .limit(200),
    supabase
      .from('files')
      .select('notion_id, name, origin, document_date, date_received')
      .eq('matter_id', matterId)
      .order('document_date', { ascending: false, nullsFirst: false })
      .limit(200),
  ]);

  const hearings = (hearingsRes.data ?? []).map((h) => ({
    id: h.notion_id,
    name: h.name ?? '',
    date: h.date,
  }));

  const deliverables = (deliverablesRes.data ?? [])
    .filter((d) => d.notion_id !== excludeId)
    .map((d) => ({
      id: d.notion_id,
      name: d.name ?? '',
      type: d.type ?? '',
      date: d.external_due_date,
    }));

  const files = (filesRes.data ?? []).map((f) => ({
    id: f.notion_id,
    name: f.name ?? '',
    origin: f.origin ?? '',
    date: f.document_date ?? f.date_received ?? null,
  }));

  return NextResponse.json({ hearings, deliverables, files });
}
