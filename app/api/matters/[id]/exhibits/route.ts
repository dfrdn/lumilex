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

const CreateExhibitSchema = z.object({
  label: z.string().trim().min(1).max(32),
  offeredBy: z.enum(OFFERED_BY),
  partyLabel: z.string().trim().max(120).optional().default(''),
  parentExhibitId: z.string().uuid().nullable().optional(),
  title: z.string().trim().max(500).optional().default(''),
  description: z.string().trim().max(4000).optional().default(''),
  documentDate: dateSchema.nullable().optional(),
  purpose: z.string().trim().max(4000).optional().default(''),
  fileId: z.string().nullable().optional(),
  status: z.enum(STATUS).optional().default('marked'),
  markedAt: dateSchema.nullable().optional(),
  offeredAt: dateSchema.nullable().optional(),
  rulingDate: dateSchema.nullable().optional(),
  rulingNote: z.string().trim().max(2000).optional().default(''),
  notes: z.string().trim().max(4000).optional().default(''),
  sortOrder: z.number().int().optional(),
});

/**
 * GET /api/matters/[id]/exhibits
 * List all exhibits for a matter, ordered by offered_by then label.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id: matterId } = await params;
  const supabase = await getSupabaseServerAuthClient();

  const { data, error } = await supabase
    .from('exhibits')
    .select(
      `id, matter_id, label, offered_by, party_label, parent_exhibit_id,
       title, description, document_date, purpose, file_id,
       status, marked_at, offered_at, ruling_date, ruling_note,
       sort_order, notes, created_by, created_at, updated_at,
       file:files!exhibits_file_id_fkey ( notion_id, name, file_urls )`,
    )
    .eq('matter_id', matterId)
    .order('offered_by', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ exhibits: data ?? [] });
}

/**
 * POST /api/matters/[id]/exhibits
 * Create a new exhibit. RLS enforces matter access + lawyer/admin write role.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!WRITE_ROLES.has(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: matterId } = await params;

  const validation = await validateBody(req, CreateExhibitSchema);
  if (!validation.success) return validation.response;
  const body = validation.data;

  const supabase = await getSupabaseServerAuthClient();

  const { data: inserted, error } = await supabase
    .from('exhibits')
    .insert({
      firm_id: session.firmId,
      matter_id: matterId,
      label: body.label,
      offered_by: body.offeredBy,
      party_label: body.partyLabel ?? '',
      parent_exhibit_id: body.parentExhibitId ?? null,
      title: body.title ?? '',
      description: body.description ?? '',
      document_date: body.documentDate ?? null,
      purpose: body.purpose ?? '',
      file_id: body.fileId ?? null,
      status: body.status ?? 'marked',
      marked_at: body.markedAt ?? null,
      offered_at: body.offeredAt ?? null,
      ruling_date: body.rulingDate ?? null,
      ruling_note: body.rulingNote ?? '',
      notes: body.notes ?? '',
      sort_order: body.sortOrder ?? 0,
      created_by: session.user.notionUserId,
    })
    .select('id, label, offered_by, status')
    .single();

  if (error || !inserted) {
    if (error?.code === '23505') {
      return NextResponse.json(
        { error: `Exhibit "${body.label}" already exists for ${body.offeredBy}` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error?.message ?? 'Failed to create exhibit' },
      { status: 500 },
    );
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'exhibit',
    entityId: inserted.id,
    entityName: `Exh. "${inserted.label}" (${inserted.offered_by})`,
    action: 'created',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  void markMatterArtifactsStale(matterId, session.firmId);

  return NextResponse.json({ ok: true, exhibit: inserted });
}
