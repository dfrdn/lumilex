import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { scopeTemplateSaveSchema } from '@/lib/scope-library/schema';
import { loadScopeTemplates } from '@/lib/scope-library/load';
import { nextSortOrder } from '@/lib/scope-library/order';

// The scope library is a partner tool, not a finance one — it moved out of
// /admin alongside the proposal pipeline it feeds.
const EDIT_ROLES = new Set(['partner', 'admin', 'super_user']);

/**
 * Anyone on the team may read the library — the proposal builder lists it for
 * the partner drafting. Editing stays with the roles that own firm-wide
 * published documents, mirroring the fee-schedule CMS.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ templates: await loadScopeTemplates(session.firmId) });
}

/**
 * Save a scope line by its slug (insert on first save, update thereafter).
 *
 * Not an upsert: the two paths write different columns. `sort_order` is the
 * catalogue order the letter prints service lines in, so it is chosen once at
 * insert and never rewritten by an edit that didn't ask to move the line —
 * letting the column default to 0 sent the first line anyone edited to the top
 * of every proposal drafted afterwards. `created_by` likewise stays with whoever
 * added the line.
 */
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!EDIT_ROLES.has(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const validation = await validateBody(req, scopeTemplateSaveSchema);
  if (!validation.success) return validation.response;
  const { content, name, isActive, sortOrder } = validation.data;

  const supabase = getServiceDbForFirm(session.firmId);
  const { data: rows } = await supabase
    .from('scope_templates')
    .select('slug, sort_order')
    .returns<{ slug: string; sort_order: number }[]>();

  const existing = (rows ?? []).find((r) => r.slug === content.slug);

  const fields = {
    name: name ?? content.name,
    content,
    ...(isActive === undefined ? {} : { is_active: isActive }),
    updated_at: new Date().toISOString(),
  };

  const update = () =>
    supabase
      .from('scope_templates')
      .update({ ...fields, ...(sortOrder === undefined ? {} : { sort_order: sortOrder }) })
      .eq('slug', content.slug)
      .select('*')
      .single();

  let { data, error } = existing
    ? await update()
    : await supabase
        .from('scope_templates')
        .insert({
          ...fields,
          slug: content.slug,
          sort_order: sortOrder ?? nextSortOrder(content.slug, rows ?? []),
          created_by: session.user.notionUserId,
        })
        .select('*')
        .single();

  // Two partners adding the same new line at once: the loser's insert trips the
  // slug unique index. It is still a save, so land it as an edit.
  if (error?.code === '23505') ({ data, error } = await update());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'ScopeTemplate',
    entityId: content.slug,
    action: 'updated',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ template: data });
}
