import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { sanitizeHandbookHtml } from '@/lib/sanitize-html';
import { reembedLibraryPage } from '@/lib/library/embed';
import { libraryPageCreateSchema } from '@/lib/library/schemas';
import { showsDistilled } from '@/lib/library/scope';
import {
  HANDBOOK_KINDS, RULES_KIND, canAuthorHandbook, isReviewer, slugify, type LibraryPageSummary,
} from '@/lib/library/model';

const LIST_COLUMNS =
  'id, slug, kind, title, summary, status, content_format, generated_by, model_used, author_id, author_name, pinned, version, external_url, visible_to_roles, created_at, updated_at';

/** A PostgREST `or()` value cannot carry its own delimiters. */
function orSafe(q: string): string {
  return q.replace(/[%,()"\\*]/g, ' ').trim();
}

/**
 * GET /api/library/pages?kind=&status=&q=
 *
 * The Library index. RLS scopes the rows to the caller's firm and to the
 * roles a page is limited to; distilled pages follow the firm's `ai_search`
 * switch (lib/library/scope.ts); on top of that, drafts are shown to the people
 * who can act on them: reviewers see every draft, lawyers see handbook drafts
 * (they author those), everyone else sees only what is published.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = session.user.role ?? 'lawyer';

  const params = req.nextUrl.searchParams;
  const kind = params.get('kind')?.trim();
  const status = params.get('status')?.trim();
  const q = orSafe(params.get('q') ?? '');

  const supabase = await getSupabaseServerAuthClient();
  let query = supabase
    .from('kb_pages')
    .select(LIST_COLUMNS)
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(500);

  if (!(await showsDistilled(session.firmId))) {
    query = query.in('kind', [...HANDBOOK_KINDS, RULES_KIND]);
  }
  if (!isReviewer(role)) {
    query = canAuthorHandbook(role)
      ? query.or(`status.eq.published,kind.in.(${HANDBOOK_KINDS.join(',')})`)
      : query.eq('status', 'published');
  }
  if (kind) query = query.eq('kind', kind);
  if (status) query = query.eq('status', status);
  if (q) query = query.or(`title.ilike.%${q}%,summary.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) {
    console.error('[library/pages] List error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // "Distilled from N matters" for the cards.
  const ids = (data ?? []).map((p) => p.id);
  const counts = new Map<number, number>();
  if (ids.length > 0) {
    const { data: links } = await supabase.from('kb_page_matters').select('kb_page_id').in('kb_page_id', ids);
    for (const l of links ?? []) counts.set(l.kb_page_id, (counts.get(l.kb_page_id) ?? 0) + 1);
  }

  const pages: LibraryPageSummary[] = (data ?? []).map((p) => ({
    ...(p as Omit<LibraryPageSummary, 'contributorCount'>),
    contributorCount: counts.get(p.id) ?? 0,
  }));
  return NextResponse.json({ pages });
}

/**
 * POST /api/library/pages — a new handbook page (lawyers and up). Distilled
 * pages are only ever created by the backfill.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = session.user.role ?? 'lawyer';
  if (!canAuthorHandbook(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const validation = await validateBody(req, libraryPageCreateSchema);
  if (!validation.success) return validation.response;
  const body = validation.data;

  const supabase = await getSupabaseServerAuthClient();

  // Slugs are unique per firm, and RLS already narrows this read to the firm.
  const baseSlug = slugify(body.title) || 'page';
  const { data: existing } = await supabase.from('kb_pages').select('slug').like('slug', `${baseSlug}%`);
  const taken = new Set((existing ?? []).map((r) => r.slug));
  let slug = baseSlug;
  for (let i = 2; taken.has(slug); i++) slug = `${baseSlug}-${i}`;

  const { data, error } = await supabase
    .from('kb_pages')
    .insert({
      firm_id: session.firmId,
      slug,
      kind: body.kind,
      title: body.title,
      content_md: sanitizeHandbookHtml(body.content),
      content_format: 'html',
      summary: body.summary,
      jurisdiction: '',
      status: body.status,
      generated_by: 'manual',
      author_id: session.user.notionUserId,
      author_name: session.user.name ?? '',
      pinned: body.pinned,
      external_url: body.external_url ?? null,
      visible_to_roles: body.visible_to_roles?.length ? body.visible_to_roles : null,
    })
    .select(LIST_COLUMNS)
    .single();
  if (error) {
    console.error('[library/pages] Create error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'LibraryPage',
    entityId: String(data.id),
    action: 'created',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  reembedLibraryPage(session.firmId, data.id).catch((err) =>
    console.error('[library/pages] embed failed:', err?.message ?? err),
  );

  return NextResponse.json({ page: { ...data, contributorCount: 0 } }, { status: 201 });
}
