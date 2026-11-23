import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { rowToResolutionTemplate } from '@/lib/corporation-row';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const includeInactive = url.searchParams.get('all') === '1';

  const supabase = await getSupabaseServerAuthClient();
  let q = supabase
    .from('resolution_templates')
    .select('*')
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true });
  if (!includeInactive) q = q.eq('is_active', true);
  const { data } = await q;
  return NextResponse.json({
    templates: (data ?? []).map((r) => rowToResolutionTemplate(r as Record<string, unknown>)),
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'super_user' && session.user.role !== 'partner') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const { id, name, kind, category, description, bodyTemplate, variableSchema, isActive, sortOrder } =
    body as Record<string, unknown>;
  if (!id || !name || !kind || !category || !bodyTemplate) {
    return NextResponse.json({ error: 'id, name, kind, category, bodyTemplate are required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('resolution_templates')
    .upsert({
      firm_id: session.firmId,
      id,
      name,
      kind,
      category,
      description: description ?? null,
      body_template: bodyTemplate,
      variable_schema: variableSchema ?? [],
      is_active: isActive ?? true,
      sort_order: sortOrder ?? 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    .select('*')
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Upsert failed' }, { status: 500 });
  return NextResponse.json({ ok: true, template: rowToResolutionTemplate(data as Record<string, unknown>) });
}
