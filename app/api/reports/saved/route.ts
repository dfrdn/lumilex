import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody } from '@/lib/validation';

const Schema = z.object({
  name: z.string().min(1).max(120),
  entity: z.enum(['matters', 'deliverables', 'dtr', 'invoices']),
  filters: z.array(z.object({
    col: z.string(),
    op: z.enum(['eq', 'in', 'gte', 'lte']),
    value: z.unknown(),
  })).default([]),
  columns: z.array(z.string()).min(1),
  group_by: z.string().nullable().optional(),
  shared_scope: z.enum(['private', 'firm']).default('private'),
});

export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('saved_reports')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reports: data ?? [] });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const validation = await validateBody(req, Schema);
  if (!validation.success) return validation.response;

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('saved_reports')
    .insert({ firm_id: session.firmId, ...validation.data, owner_id: session.user.notionUserId })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ report: data });
}
