import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { recordRevision } from '@/lib/content-revisions';
import { deleteEmbeddingsForSource } from '@/lib/ai/embeddings';
import { sanitizeHandbookHtml } from '@/lib/sanitize-html';
import { reembedLibraryPage } from '@/lib/library/embed';
import { loadLibraryPage } from '@/lib/library/load';
import { libraryPagePatchSchema } from '@/lib/library/schemas';
import { isOutOfScope } from '@/lib/library/scope';
import {
  canDeleteKind, canEditKind, canPublishKind, isHandbookKind, publishBlockedReason, slugify,
} from '@/lib/library/model';

function pageId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = pageId((await params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const loaded = await loadLibraryPage(id);
  if (!loaded || (await isOutOfScope(session.firmId, loaded.page.kind))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(loaded);
}

/**
 * PATCH /api/library/pages/[id] — edits and status changes for either kind
 * of page. A content edit on a distilled page marks it manually curated so
 * the backfill leaves it alone; every content change is a new version, is
 * snapshotted, and re-embeds.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = session.user.role ?? 'lawyer';
  const id = pageId((await params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const validation = await validateBody(req, libraryPagePatchSchema);
  if (!validation.success) return validation.response;
  const body = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  const { data: existing } = await supabase.from('kb_pages').select('*').eq('id', id).maybeSingle();
  if (!existing || (await isOutOfScope(session.firmId, existing.kind))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!canEditKind(role, existing.kind)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (body.kind && !isHandbookKind(existing.kind)) {
    return NextResponse.json({ error: 'Only handbook pages can change kind' }, { status: 400 });
  }
  if (body.status === 'published') {
    if (!canPublishKind(role, existing.kind)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { count } = await supabase
      .from('kb_page_citations')
      .select('id', { count: 'exact', head: true })
      .eq('kb_page_id', id);
    const blocked = publishBlockedReason(existing, count ?? 0);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });
  }

  const content = body.content == null
    ? undefined
    : existing.content_format === 'html' ? sanitizeHandbookHtml(body.content) : body.content;
  const contentChanged = content != null && content !== existing.content_md;
  const titleChanged = body.title != null && body.title !== existing.title;

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status) update.status = body.status;
  if (body.title != null) update.title = body.title;
  if (body.summary != null) update.summary = body.summary;
  if (body.kind) update.kind = body.kind;
  if (typeof body.pinned === 'boolean') update.pinned = body.pinned;
  if (content != null) update.content_md = content;
  if (body.external_url !== undefined) update.external_url = body.external_url;
  if (body.visible_to_roles !== undefined) {
    update.visible_to_roles = body.visible_to_roles?.length ? body.visible_to_roles : null;
  }
  if (contentChanged || titleChanged) {
    update.version = (existing.version ?? 1) + 1;
    if (!isHandbookKind(existing.kind)) {
      update.generated_by = 'manual';
      update.author_id = session.user.notionUserId;
      update.author_name = session.user.name ?? existing.author_name;
    }
  }
  if (titleChanged && isHandbookKind(existing.kind)) {
    const base = slugify(body.title!) || existing.slug;
    const { data: others } = await supabase.from('kb_pages').select('id, slug').like('slug', `${base}%`);
    const taken = new Set((others ?? []).filter((r) => r.id !== id).map((r) => r.slug));
    let slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
    update.slug = slug;
  }

  const { data: updated, error } = await supabase.from('kb_pages').update(update).eq('id', id).select('*').maybeSingle();
  if (error) {
    console.error('[library/pages] Patch error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // RLS does not deny an UPDATE, it matches nothing. Say so instead of
  // reporting a save that did not happen.
  if (!updated) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Snapshot the pre-edit state only once the write has landed, so history
  // never asserts an edit that did not happen.
  await recordRevision({
    firmId: session.firmId,
    entityType: 'kb_page',
    entityId: id,
    before: existing,
    after: update,
    editedBy: session.user.notionUserId,
  });

  logAudit({
    firmId: session.firmId,
    entityType: 'LibraryPage',
    entityId: String(id),
    action: body.status ? `status_${body.status}` : 'edited',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  if (contentChanged || titleChanged) {
    reembedLibraryPage(session.firmId, id).catch((err) =>
      console.error('[library/pages] re-embed failed:', err?.message ?? err),
    );
  }

  return NextResponse.json({ page: updated });
}

/** DELETE /api/library/pages/[id] — handbook pages only, reviewers only; the page is snapshotted first. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = session.user.role ?? 'lawyer';
  const id = pageId((await params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { data: doomed } = await supabase.from('kb_pages').select('*').eq('id', id).maybeSingle();
  if (!doomed) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canDeleteKind(role, doomed.kind)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: deleted, error } = await supabase.from('kb_pages').delete().eq('id', id).select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!deleted?.length) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // A deletion leaves no row for the revision table to describe afterwards,
  // so the page is snapshotted whole: every tracked field reads as changed.
  await recordRevision({
    firmId: session.firmId,
    entityType: 'kb_page',
    entityId: id,
    before: doomed,
    after: { title: null, summary: null, content_md: null, status: null, kind: null, jurisdiction: null, pinned: null },
    editedBy: session.user.notionUserId,
  });

  // Search must stop serving the text of a page that no longer exists.
  await deleteEmbeddingsForSource('kb_page', String(id), session.firmId).catch((err) =>
    console.error('[library/pages] embedding cleanup failed:', err?.message ?? err),
  );

  logAudit({
    firmId: session.firmId,
    entityType: 'LibraryPage',
    entityId: String(id),
    action: 'deleted',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true });
}
