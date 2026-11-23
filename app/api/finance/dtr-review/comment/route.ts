import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { isManagingPartner } from '@/lib/auth/isManagingPartner';

interface PostBody {
  revisionId?: unknown;
  body?: unknown;
}

interface PatchBody {
  commentId?: unknown;
  resolved?: unknown;
}

/**
 * POST /api/finance/dtr-review/comment
 * Adds a line-level comment to a revision. Either side (finance or partner) can post.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = session.user.role;
  const isMP = await isManagingPartner(session.user.notionUserId, session.firmId);
  if (role !== 'finance' && role !== 'super_user' && role !== 'partner' && !isMP) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const revisionId = typeof body.revisionId === 'number' ? body.revisionId : null;
  const text = typeof body.body === 'string' ? body.body.trim() : '';

  if (revisionId == null) {
    return NextResponse.json({ error: 'revisionId is required' }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: 'body cannot be empty' }, { status: 400 });
  }

  const authorRole = isMP ? 'managing_partner' : role;
  const supabase = await getSupabaseServerAuthClient();

  const { data, error } = await supabase
    .from('dtr_revision_comments')
    .insert({
      firm_id: session.firmId,
      revision_id: revisionId,
      author_id: session.user.notionUserId,
      author_role: authorRole,
      body: text,
    })
    .select('id, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id, createdAt: data.created_at });
}

/**
 * PATCH /api/finance/dtr-review/comment
 * Toggle a comment's resolved flag.
 */
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = session.user.role;
  const isMP = await isManagingPartner(session.user.notionUserId, session.firmId);
  if (role !== 'finance' && role !== 'super_user' && role !== 'partner' && !isMP) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as PatchBody;
  const commentId = typeof body.commentId === 'number' ? body.commentId : null;
  const resolved = typeof body.resolved === 'boolean' ? body.resolved : null;

  if (commentId == null || resolved == null) {
    return NextResponse.json({ error: 'commentId and resolved are required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase
    .from('dtr_revision_comments')
    .update({
      resolved,
      resolved_at: resolved ? new Date().toISOString() : null,
      resolved_by: resolved ? session.user.notionUserId : null,
    })
    .eq('id', commentId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
