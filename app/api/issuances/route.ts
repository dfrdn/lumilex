import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { logAudit, getClientIP } from '@/lib/audit';
import { validateBody } from '@/lib/validation';
import { SOURCE_KEYS, isValidSource, isValidType, type SourceKey } from '@/lib/issuances/sources';

const CURATOR_ROLES = ['partner', 'admin', 'super_user'];

const LIST_COLUMNS =
  'id, source, type, number, title, subject, date_issued, date_effective, ' +
  'summary, source_url, pdf_path, practice_areas, tags, status, pinned, ' +
  'ai_confidence, ai_flags, added_by, reviewed_by, reviewed_at, ' +
  'created_at, updated_at';

// ── GET ──────────────────────────────────────────────────────────────
// /api/issuances                          → list with filters
// /api/issuances?id=123                   → single row
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const role = session.user.role ?? 'lawyer';
  const isCurator = CURATOR_ROLES.includes(role);

  const idParam = req.nextUrl.searchParams.get('id');
  if (idParam) {
    const id = Number(idParam);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const { data, error } = await supabase
      .from('issuances')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(data);
  }

  const params = req.nextUrl.searchParams;
  const source = params.get('source');
  const type = params.get('type');
  const practiceArea = params.get('practice_area');
  const status = params.get('status');
  const search = params.get('search')?.trim();
  const confidence = params.get('confidence');
  const limitRaw = Number(params.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 200;

  let query = supabase
    .from('issuances')
    .select(LIST_COLUMNS)
    .order('pinned', { ascending: false })
    .order('date_issued', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (source && isValidSource(source)) query = query.eq('source', source);
  if (type) query = query.eq('type', type);
  if (practiceArea) query = query.contains('practice_areas', [practiceArea]);
  if (confidence && ['high', 'medium', 'low'].includes(confidence)) {
    query = query.eq('ai_confidence', confidence);
  }

  // Non-curators never see archived/rejected. RLS already hides rejected, but
  // archived is a curator-only view.
  if (!isCurator) {
    query = query.eq('status', 'published');
  } else if (status && ['published', 'archived', 'rejected'].includes(status)) {
    query = query.eq('status', status);
  }

  if (search) {
    // Postgres `or` filter with ilike across title/subject/number/summary.
    const pat = `%${search.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    query = query.or(
      `title.ilike.${pat},subject.ilike.${pat},number.ilike.${pat},summary.ilike.${pat}`,
    );
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// ── POST ─────────────────────────────────────────────────────────────
// Manual add. Curators only.
const upsertSchema = z.object({
  source: z.enum(SOURCE_KEYS as [string, ...string[]]),
  type: z.string().min(1).max(120),
  number: z.string().trim().max(120).nullable().optional(),
  title: z.string().trim().min(1).max(500),
  subject: z.string().trim().max(500).nullable().optional(),
  date_issued: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
    .nullable()
    .optional(),
  date_effective: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
    .nullable()
    .optional(),
  summary: z.string().max(20000).nullable().optional(),
  full_text: z.string().nullable().optional(),
  source_url: z.string().url().max(1000),
  pdf_path: z.string().max(500).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  practice_areas: z.array(z.string()).max(20).optional(),
  tags: z.array(z.string()).max(20).optional(),
  pinned: z.boolean().optional(),
  visible_to_roles: z.array(z.string()).max(10).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role ?? 'lawyer';
  if (!CURATOR_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const validation = await validateBody(req, upsertSchema);
  if (!validation.success) return validation.response;
  const body = validation.data;

  // Zod enum has narrowed body.source to one of SOURCE_KEYS at runtime.
  const sourceKey = body.source as SourceKey;
  if (!isValidType(sourceKey, body.type)) {
    return NextResponse.json(
      { error: `Invalid type "${body.type}" for source "${sourceKey}"` },
      { status: 400 },
    );
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('issuances')
    .insert({
      firm_id: session.firmId,
      source: body.source,
      type: body.type,
      number: body.number ?? null,
      title: body.title,
      subject: body.subject ?? null,
      date_issued: body.date_issued ?? null,
      date_effective: body.date_effective ?? null,
      summary: body.summary ?? null,
      full_text: body.full_text ?? null,
      source_url: body.source_url,
      pdf_path: body.pdf_path ?? null,
      metadata: body.metadata ?? {},
      practice_areas: body.practice_areas ?? [],
      tags: body.tags ?? [],
      pinned: body.pinned ?? false,
      visible_to_roles: body.visible_to_roles ?? null,
      added_by: session.user.notionUserId,
      status: 'published',
      ai_confidence: null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'An issuance with that source, type, and number already exists' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'Issuance',
    entityId: String(data.id),
    entityName: `${data.source.toUpperCase()} ${data.number ?? data.title}`,
    action: 'created',
    performedBy: session.user.notionUserId,
    performedByName: session.user.name ?? undefined,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json(data, { status: 201 });
}

// ── PATCH ────────────────────────────────────────────────────────────
// Edit. Curators only. Also handles archive/unarchive and "mark reviewed".
const patchSchema = upsertSchema.partial().extend({
  id: z.number().int().positive(),
  status: z.enum(['published', 'archived', 'rejected']).optional(),
  mark_reviewed: z.boolean().optional(),
  ai_confidence: z.enum(['high', 'medium', 'low']).nullable().optional(),
  ai_flags: z.array(z.string()).optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role ?? 'lawyer';
  if (!CURATOR_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const validation = await validateBody(req, patchSchema);
  if (!validation.success) return validation.response;
  const { id, mark_reviewed, ...rest } = validation.data;

  if (rest.source && rest.type && !isValidType(rest.source as SourceKey, rest.type)) {
    return NextResponse.json(
      { error: `Invalid type "${rest.type}" for source "${rest.source}"` },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() };
  if (mark_reviewed) {
    updates.reviewed_by = session.user.notionUserId;
    updates.reviewed_at = new Date().toISOString();
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('issuances')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'An issuance with that source, type, and number already exists' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'Issuance',
    entityId: String(id),
    entityName: `${data.source.toUpperCase()} ${data.number ?? data.title}`,
    action: 'updated',
    performedBy: session.user.notionUserId,
    performedByName: session.user.name ?? undefined,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json(data);
}

// ── DELETE ───────────────────────────────────────────────────────────
// Soft-delete via status='rejected' (so RLS hides it from team).
// ?hard=1 → hard delete (super_user only).
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role ?? 'lawyer';
  if (!CURATOR_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const idParam = req.nextUrl.searchParams.get('id');
  const id = Number(idParam);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  const hard = req.nextUrl.searchParams.get('hard') === '1';
  if (hard && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = await getSupabaseServerAuthClient();

  if (hard) {
    const { error } = await supabase.from('issuances').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from('issuances')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'Issuance',
    entityId: String(id),
    action: hard ? 'hard_deleted' : 'rejected',
    performedBy: session.user.notionUserId,
    performedByName: session.user.name ?? undefined,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true });
}
