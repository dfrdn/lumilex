import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { isReviewer } from '@/lib/library/model';

const schema = z.object({
  note: z.string().trim().max(1000).optional(),
});

/**
 * POST /api/codes/provisions/[id]/review — record that the caller checked
 * the provision's current version against its source. Reviews are
 * append-only; RLS admits only reviewers recording their own.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isReviewer(session.user.role)) return NextResponse.json({ error: 'Only partners and admins review provisions' }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const validation = await validateBody(req, schema);
  if (!validation.success) return validation.response;

  const supabase = await getSupabaseServerAuthClient();
  const { data: latest } = await supabase.from('code_provision_versions').select('seq').eq('provision_id', id).order('seq', { ascending: false }).limit(1).maybeSingle();
  if (!latest) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: row, error } = await supabase
    .from('code_provision_reviews')
    .insert({ firm_id: session.firmId, provision_id: id, version_seq: latest.seq, reviewed_by: session.user.notionUserId, note: validation.data.note || null })
    .select('id, version_seq, reviewed_by, reviewed_at, note')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'CodeProvision',
    entityId: String(id),
    action: 'reviewed',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({
    review: {
      id: row.id,
      versionSeq: row.version_seq,
      reviewedBy: row.reviewed_by,
      reviewerName: session.user.name ?? 'You',
      reviewedAt: row.reviewed_at,
      note: row.note,
    },
  });
}
