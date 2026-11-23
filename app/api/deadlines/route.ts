import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { createDeadlineChain, deleteDeadlineChain } from '@/lib/legal/deadline-chains';

async function assertAuth() {
  const session = await getSession();
  if (!session?.user) return null;
  return session;
}

function canEdit(role: string | undefined): boolean {
  return ['admin', 'super_user', 'partner'].includes(role ?? '');
}

// GET /api/deadlines?matterId=X — list deadline chains + items for a matter
export async function GET(req: NextRequest) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const matterId = req.nextUrl.searchParams.get('matterId');
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();

  const { data: chains, error } = await supabase
    .from('deadline_chains')
    .select('*, deadline_chain_items(*)')
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[deadlines] GET error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: chains ?? [] });
}

// POST /api/deadlines — compute chain, auto-create deliverables + hearings, insert chain records
export async function POST(req: NextRequest) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEdit(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { matterId, ruleSetId, triggerDate, existingFirstEntityId } = body;

  if (!matterId || !ruleSetId || !triggerDate) {
    return NextResponse.json({ error: 'matterId, ruleSetId, and triggerDate are required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  const result = await createDeadlineChain(supabase, {
    firmId: session.firmId,
    matterId,
    ruleSetId,
    triggerDate,
    createdBy: session.user.notionUserId ?? session.user.email,
    existingFirstEntityId,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ data: result.chain }, { status: 201 });
}

// DELETE /api/deadlines — remove chain + all auto-created deliverables/hearings
export async function DELETE(req: NextRequest) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEdit(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { chainId } = body;

  if (!chainId) {
    return NextResponse.json({ error: 'chainId required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  const { removed, error } = await deleteDeadlineChain(supabase, chainId, session.firmId);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, removed });
}
