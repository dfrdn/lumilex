import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

const FINANCE_CATEGORIES = ['billing', 'reminder', 'overdue', 'final'];

/**
 * GET /api/finance/email-templates
 * List email templates. Optional ?category=billing filter.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  if (!['admin', 'super_user', 'finance', 'partner'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const category = req.nextUrl.searchParams.get('category');

  let query = supabase
    .from('email_templates')
    .select('*')
    .in('category', FINANCE_CATEGORIES)
    .order('category')
    .order('is_category_default', { ascending: false })
    .order('name');

  if (category && FINANCE_CATEGORIES.includes(category)) {
    query = query.eq('category', category);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ templates: data ?? [] });
}

/**
 * POST /api/finance/email-templates
 * Create a new email template.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  if (!['admin', 'super_user', 'finance'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { name, category, subject, body, isDefault } = await req.json();
  if (!name || !category || !subject || !body) {
    return NextResponse.json({ error: 'name, category, subject, and body are required' }, { status: 400 });
  }
  if (!FINANCE_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: `category must be one of: ${FINANCE_CATEGORIES.join(', ')}` }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);

  // If setting as default, unset existing default for this category
  if (isDefault) {
    await supabase
      .from('email_templates')
      .update({ is_category_default: false, updated_at: new Date().toISOString() })
      .eq('category', category)
      .eq('is_category_default', true);
  }

  const { data, error } = await supabase
    .from('email_templates')
    .insert({
      name,
      category,
      subject,
      body_html: body,
      is_category_default: !!isDefault,
      created_by: session.user.email ?? session.user.notionUserId,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

/**
 * PUT /api/finance/email-templates
 * Update an existing email template.
 */
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  if (!['admin', 'super_user', 'finance'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, name, category, subject, body, isDefault } = await req.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const supabase = getServiceDbForFirm(session.firmId);

  // If setting as default, unset existing default for this category
  if (isDefault && category) {
    await supabase
      .from('email_templates')
      .update({ is_category_default: false, updated_at: new Date().toISOString() })
      .eq('category', category)
      .eq('is_category_default', true)
      .neq('id', id);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) updates.name = name;
  if (category !== undefined) updates.category = category;
  if (subject !== undefined) updates.subject = subject;
  if (body !== undefined) updates.body_html = body;
  if (isDefault !== undefined) updates.is_category_default = isDefault;

  const { data, error } = await supabase
    .from('email_templates')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

/**
 * DELETE /api/finance/email-templates
 * Delete a template by id (query param).
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  if (!['admin', 'super_user', 'finance'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

  const supabase = getServiceDbForFirm(session.firmId);
  const { error } = await supabase.from('email_templates').delete().eq('id', parseInt(id));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
