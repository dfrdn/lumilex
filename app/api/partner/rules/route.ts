import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { refuseInDemo } from '@/lib/demo/guard';

async function assertAuth() {
  const session = await getSession();
  if (!session?.user) return null;
  return session;
}

function canEdit(role: string | undefined): boolean {
  return ['admin', 'super_user', 'partner'].includes(role ?? '');
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
}

// GET /api/partner/rules — list all rule sets with deadlines
export async function GET(req: NextRequest) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEdit(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = await getSupabaseServerAuthClient();
  // RLS (rule_sets/deadlines_authenticated_select) allows team-wide read.

  const { data, error } = await supabase
    .from('rule_sets')
    .select('*, rule_deadlines(*)')
    .order('name');

  if (error) {
    console.error('[partner/rules] GET error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

// POST /api/partner/rules — create a new custom rule set
export async function POST(req: NextRequest) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEdit(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const demoRefusal = await refuseInDemo(session.firmId, 'Editing rule sets');
  if (demoRefusal) return demoRefusal;

  const body = await req.json();
  const { name, triggerEventLabel, applicableMatterTypes, deadlines } = body;

  if (!name || !triggerEventLabel || !applicableMatterTypes?.length) {
    return NextResponse.json({ error: 'name, triggerEventLabel, and applicableMatterTypes are required' }, { status: 400 });
  }

  const id = `custom_${slugify(name)}_${Date.now()}`;
  const supabase = await getSupabaseServerAuthClient();

  const { error: setError } = await supabase.from('rule_sets').insert({
    id,
    name,
    trigger_event_label: triggerEventLabel,
    applicable_matter_types: applicableMatterTypes,
    is_system_default: false,
    created_by: session.user.notionUserId ?? session.user.email,
  });

  if (setError) {
    console.error('[partner/rules] POST rule_sets error:', setError.message);
    return NextResponse.json({ error: setError.message }, { status: 500 });
  }

  if (deadlines?.length > 0) {
    const rows = deadlines.map((d: Record<string, unknown>, idx: number) => ({
      rule_set_id: id,
      id: d.id || `deadline_${idx}`,
      label: d.label,
      legal_basis: d.legalBasis ?? '',
      days_from_trigger: d.daysFromTrigger,
      calendar_type: d.calendarType ?? 'calendar',
      depends_on: d.dependsOn ?? null,
      entity_type: d.entityType ?? 'deliverable',
      hearing_type: d.hearingType ?? null,
      is_reglementary: d.isReglementary ?? false,
      notes: d.notes ?? '',
      sort_order: idx,
    }));

    const { error: dlError } = await supabase.from('rule_deadlines').insert(rows);
    if (dlError) {
      console.error('[partner/rules] POST rule_deadlines error:', dlError.message);
      // Clean up the rule set
      await supabase.from('rule_sets').delete().eq('id', id);
      return NextResponse.json({ error: dlError.message }, { status: 500 });
    }
  }

  // Return the full rule set
  const { data } = await supabase
    .from('rule_sets')
    .select('*, rule_deadlines(*)')
    .eq('id', id)
    .single();

  return NextResponse.json({ data }, { status: 201 });
}

// PATCH /api/partner/rules — update a custom rule set
export async function PATCH(req: NextRequest) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEdit(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const demoRefusal = await refuseInDemo(session.firmId, 'Editing rule sets');
  if (demoRefusal) return demoRefusal;

  const body = await req.json();
  const { id, name, triggerEventLabel, applicableMatterTypes, deadlines } = body;

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();

  // Check if system default
  const { data: existing } = await supabase
    .from('rule_sets')
    .select('is_system_default')
    .eq('id', id)
    .single();

  if (!existing) return NextResponse.json({ error: 'Rule set not found' }, { status: 404 });
  if (existing.is_system_default) {
    return NextResponse.json({ error: 'Cannot modify system default rule sets' }, { status: 403 });
  }

  // Update rule set
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) updates.name = name;
  if (triggerEventLabel !== undefined) updates.trigger_event_label = triggerEventLabel;
  if (applicableMatterTypes !== undefined) updates.applicable_matter_types = applicableMatterTypes;

  const { error: updateError } = await supabase.from('rule_sets').update(updates).eq('id', id);
  if (updateError) {
    console.error('[partner/rules] PATCH error:', updateError.message);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Replace deadlines if provided
  if (deadlines !== undefined) {
    await supabase.from('rule_deadlines').delete().eq('rule_set_id', id);

    if (deadlines.length > 0) {
      const rows = deadlines.map((d: Record<string, unknown>, idx: number) => ({
        rule_set_id: id,
        id: d.id || `deadline_${idx}`,
        label: d.label,
        legal_basis: d.legalBasis ?? '',
        days_from_trigger: d.daysFromTrigger,
        calendar_type: d.calendarType ?? 'calendar',
        depends_on: d.dependsOn ?? null,
        entity_type: d.entityType ?? 'deliverable',
        hearing_type: d.hearingType ?? null,
        is_reglementary: d.isReglementary ?? false,
        notes: d.notes ?? '',
        sort_order: idx,
      }));

      const { error: dlError } = await supabase.from('rule_deadlines').insert(rows);
      if (dlError) {
        console.error('[partner/rules] PATCH deadlines error:', dlError.message);
        return NextResponse.json({ error: dlError.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/partner/rules — delete a custom rule set
export async function DELETE(req: NextRequest) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEdit(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const demoRefusal = await refuseInDemo(session.firmId, 'Editing rule sets');
  if (demoRefusal) return demoRefusal;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();

  const { data: existing } = await supabase
    .from('rule_sets')
    .select('is_system_default')
    .eq('id', id)
    .single();

  if (!existing) return NextResponse.json({ error: 'Rule set not found' }, { status: 404 });
  if (existing.is_system_default) {
    return NextResponse.json({ error: 'Cannot delete system default rule sets' }, { status: 403 });
  }

  const { error } = await supabase.from('rule_sets').delete().eq('id', id);
  if (error) {
    console.error('[partner/rules] DELETE error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
