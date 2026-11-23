import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

/**
 * GET /api/templates
 * List all active document templates. Optionally filter by category.
 * Query params: ?category=Pleadings
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = req.nextUrl;
  const category = url.searchParams.get('category')?.trim();
  const includeInactive = url.searchParams.get('includeInactive') === 'true';
  const role = session.user.role ?? 'lawyer';
  const isAdmin = ['partner', 'admin', 'super_user'].includes(role);

  const supabase = await getSupabaseServerAuthClient();
  // RLS allows team-wide read; writes gated to creator + admin/super_user.

  let query = supabase
    .from('document_templates')
    .select('id, name, category, subcategory, description, generation_mode, ai_prompt, placeholders, template_storage_path, deadline_kind, is_active, created_by, created_at, updated_at')
    .order('category')
    .order('name');

  if (!(includeInactive && isAdmin)) {
    query = query.eq('is_active', true);
  }

  if (category) {
    query = query.eq('category', category);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[templates] List error:', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

/**
 * POST /api/templates
 * Create a new document template.
 * Body: { name, category, subcategory?, description?, generation_mode, ai_prompt?, placeholders? }
 * Restricted to partner, admin, super_user roles.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.role || !['partner', 'admin', 'super_user'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, category, subcategory, description, generation_mode, ai_prompt, placeholders, deadline_kind } = body;

    if (!name || !category) {
      return NextResponse.json({ error: 'name and category are required' }, { status: 400 });
    }

    const mode = generation_mode || 'ai';
    if (!['ai', 'placeholder'].includes(mode)) {
      return NextResponse.json({ error: 'generation_mode must be "ai" or "placeholder"' }, { status: 400 });
    }

    if (mode === 'ai' && !ai_prompt) {
      return NextResponse.json({ error: 'ai_prompt is required for AI mode templates' }, { status: 400 });
    }

    const supabase = await getSupabaseServerAuthClient();

    const { data, error } = await supabase
      .from('document_templates')
      .insert({
        firm_id: session.firmId,
        name,
        category,
        subcategory: subcategory || null,
        description: description || null,
        generation_mode: mode,
        ai_prompt: ai_prompt || null,
        placeholders: placeholders || [],
        deadline_kind: deadline_kind || null,
        is_active: true,
        created_by: session.user.notionUserId,
      })
      .select()
      .single();

    if (error) {
      console.error('[templates] Create error:', error.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[templates] Create error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/templates
 * Update an existing document template.
 * Body: { id: number, ...fieldsToUpdate }
 * Restricted to partner, admin, super_user roles.
 */
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.role || !['partner', 'admin', 'super_user'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // Only allow known fields to be updated
    const allowedFields = ['name', 'category', 'subcategory', 'description', 'generation_mode', 'ai_prompt', 'placeholders', 'template_storage_path', 'deadline_kind', 'is_active'];
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };

    for (const key of allowedFields) {
      if (key in updates) {
        payload[key] = updates[key];
      }
    }

    if (payload.generation_mode && !['ai', 'placeholder'].includes(payload.generation_mode as string)) {
      return NextResponse.json({ error: 'generation_mode must be "ai" or "placeholder"' }, { status: 400 });
    }

    const supabase = await getSupabaseServerAuthClient();

    const { data, error } = await supabase
      .from('document_templates')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[templates] Update error:', error.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[templates] Update error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/templates
 * Soft-delete a template by setting is_active = false.
 * Body: { id: number }
 * Restricted to partner, admin, super_user roles.
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.role || !['partner', 'admin', 'super_user'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Support both query param and body for id
    let id: number | null = null;
    const qId = req.nextUrl.searchParams.get('id');
    if (qId) {
      id = parseInt(qId);
    } else {
      const body = await req.json().catch(() => ({}));
      id = body.id ?? null;
    }

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const supabase = await getSupabaseServerAuthClient();

    const { error } = await supabase
      .from('document_templates')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[templates] Delete error:', error.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[templates] Delete error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
