import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody, dateSchema } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { markMatterArtifactsStale } from '@/lib/ai/matter-brief-refresh';

const WRITE_ROLES = new Set(['lawyer', 'partner', 'admin', 'super_user']);

const OFFERED_BY = [
  'plaintiff',
  'defendant',
  'prosecution',
  'accused',
  'petitioner',
  'respondent',
  'complainant',
  'other',
] as const;

const STATUS = ['marked', 'offered', 'admitted', 'denied', 'withdrawn'] as const;

const UpdateExhibitSchema = z
  .object({
    label: z.string().trim().min(1).max(32),
    offeredBy: z.enum(OFFERED_BY),
    partyLabel: z.string().trim().max(120),
    parentExhibitId: z.string().uuid().nullable(),
    title: z.string().trim().max(500),
    description: z.string().trim().max(4000),
    documentDate: dateSchema.nullable(),
    purpose: z.string().trim().max(4000),
    fileId: z.string().nullable(),
    status: z.enum(STATUS),
    markedAt: dateSchema.nullable(),
    offeredAt: dateSchema.nullable(),
    rulingDate: dateSchema.nullable(),
    rulingNote: z.string().trim().max(2000),
    notes: z.string().trim().max(4000),
    sortOrder: z.number().int(),
  })
  .partial();

/**
 * PATCH /api/matters/[id]/exhibits/[exhibitId]
 * Partial update. RLS enforces matter access + lawyer/admin write role.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; exhibitId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!WRITE_ROLES.has(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: matterId, exhibitId } = await params;

  const validation = await validateBody(req, UpdateExhibitSchema);
  if (!validation.success) return validation.response;
  const body = validation.data;

  const update: Record<string, unknown> = {};
  if (body.label !== undefined) update.label = body.label;
  if (body.offeredBy !== undefined) update.offered_by = body.offeredBy;
  if (body.partyLabel !== undefined) update.party_label = body.partyLabel;
  if (body.parentExhibitId !== undefined) update.parent_exhibit_id = body.parentExhibitId;
  if (body.title !== undefined) update.title = body.title;
  if (body.description !== undefined) update.description = body.description;
  if (body.documentDate !== undefined) update.document_date = body.documentDate;
  if (body.purpose !== undefined) update.purpose = body.purpose;
  if (body.fileId !== undefined) update.file_id = body.fileId;
  if (body.status !== undefined) update.status = body.status;
  if (body.markedAt !== undefined) update.marked_at = body.markedAt;
  if (body.offeredAt !== undefined) update.offered_at = body.offeredAt;
  if (body.rulingDate !== undefined) update.ruling_date = body.rulingDate;
  if (body.rulingNote !== undefined) update.ruling_note = body.rulingNote;
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.sortOrder !== undefined) update.sort_order = body.sortOrder;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, exhibit: null });
  }

  const supabase = await getSupabaseServerAuthClient();

  const { data: updated, error } = await supabase
    .from('exhibits')
    .update(update)
    .eq('id', exhibitId)
    .eq('matter_id', matterId)
    .select('id, label, offered_by, status')
    .single();

  if (error || !updated) {
    if (error?.code === '23505') {
      return NextResponse.json(
        { error: `Exhibit label conflict for that party` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error?.message ?? 'Failed to update exhibit' },
      { status: 500 },
    );
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'exhibit',
    entityId: updated.id,
    entityName: `Exh. "${updated.label}" (${updated.offered_by})`,
    action: 'updated',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  void markMatterArtifactsStale(matterId, session.firmId);

  return NextResponse.json({ ok: true, exhibit: updated });
}

/**
 * DELETE /api/matters/[id]/exhibits/[exhibitId]
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; exhibitId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!WRITE_ROLES.has(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id: matterId, exhibitId } = await params;

  const supabase = await getSupabaseServerAuthClient();
  const { data: deleted, error } = await supabase
    .from('exhibits')
    .delete()
    .eq('id', exhibitId)
    .eq('matter_id', matterId)
    .select('id, label, offered_by')
    .single();

  if (error || !deleted) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to delete exhibit' },
      { status: 500 },
    );
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'exhibit',
    entityId: deleted.id,
    entityName: `Exh. "${deleted.label}" (${deleted.offered_by})`,
    action: 'deleted',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  void markMatterArtifactsStale(matterId, session.firmId);

  return NextResponse.json({ ok: true });
}
