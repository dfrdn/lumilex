import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/**
 * GET /api/trademark/templates
 * List active DOCX templates available for trademark client reports —
 * i.e. document_templates where category='report' AND
 * subcategory='trademark_report'. Each row carries its `deadline_kind` so
 * the report modal can auto-pick the right one per deadline.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const { data, error } = await supabase
    .from('document_templates')
    .select('id, name, description, deadline_kind, placeholders, template_storage_path')
    .eq('category', 'report')
    .eq('subcategory', 'trademark_report')
    .eq('is_active', true)
    .eq('generation_mode', 'placeholder')
    .order('deadline_kind', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    templates: (data ?? []).map((t) => ({
      id: t.id as number,
      name: t.name as string,
      description: (t.description as string | null) ?? null,
      deadlineKind: (t.deadline_kind as string | null) ?? null,
      placeholders: t.placeholders ?? [],
      hasFile: !!t.template_storage_path,
    })),
  });
}
