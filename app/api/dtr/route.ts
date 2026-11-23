import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { mintId } from '@/lib/ids';
import { createDTRSchema, validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';

const EDITABLE_FIELDS: Record<string, string> = {
  remarks: 'remarks',
  task: 'task',
  hours: 'hours',
  minutes: 'minutes',
  date: 'date',
  withIds: 'with_ids',
};

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validation = await validateBody(req, createDTRSchema);
  if (!validation.success) return validation.response;
  const { remarks, task, date, hours, minutes, withIds, matterId } = validation.data;

  const personId = session.user.notionUserId;

  try {
    const supabase = await getSupabaseServerAuthClient();
    // Cross-team lookups (other team members, matter client_name) run on the
    // firm-scoped service client — the caller's RLS can't see all team rows.
    const service = getServiceDbForFirm(session.firmId);

    // Resolve current user's team name. Reads own row via team_self_select.
    const { data: lawyerRow } = await supabase
      .from('team')
      .select('name')
      .eq('person_id', personId)
      .eq('active', true)
      .limit(1)
      .single();

    const lawyerName = lawyerRow?.name ?? '';

    // Resolve "With" names — service-role for cross-team read.
    let withNames: string[] = [];
    if (withIds && withIds.length > 0) {
      const { data: people } = await service
        .from('team')
        .select('person_id, name')
        .in('person_id', withIds);
      withNames = (people ?? []).map((p: { name: string }) => p.name).filter(Boolean);
    }

    // Resolve client name from matter — service-role; matter RLS lands in PR 5.
    let clientName = '';
    let matterName = '';
    if (matterId) {
      const { data: matterRow } = await service
        .from('matters')
        .select('client_name, name')
        .eq('notion_id', matterId)
        .single();
      clientName = matterRow?.client_name ?? '';
      matterName = matterRow?.name ?? '';
    }

    const newId = mintId('dtr');

    const { error: dbErr } = await supabase
      .from('dtr')
      .insert({
        firm_id: session.firmId,
        notion_id: newId,
        notion_url: '',
        remarks,
        task,
        hours: hours ?? 1,
        minutes: minutes ?? 0,
        date,
        lawyer_name: lawyerName,
        // Stable author key — lawyer_name is a display snapshot that a rename
        // invalidates; this is what resolves the author's position and rate.
        lawyer_person_id: personId,
        with_ids: withIds ?? [],
        with_names: withNames,
        client_name: clientName,
        matter_id: matterId ?? null,
        billed: false,
        synced_at: new Date().toISOString(),
      });

    if (dbErr) {
      console.error('[dtr] Supabase insert error:', dbErr.message);
      return NextResponse.json({ error: dbErr.message }, { status: 500 });
    }

    // Fire-and-forget audit log
    logAudit({
      firmId: session.firmId,
      entityType: 'dtr',
      entityId: newId,
      action: 'create',
      entityName: remarks,
      performedBy: session.user.notionUserId,
      ipAddress: getClientIP(req),
    });

    // Return the created row so the client can append it without a refresh.
    // Shape mirrors MyDTREntry from lib/queries/my-dtr.ts.
    const entry = {
      id: newId,
      url: '',
      remarks,
      task,
      hours: hours ?? 1,
      minutes: minutes ?? 0,
      date,
      lawyerName,
      withIds: withIds ?? [],
      withNames,
      matterId: matterId ?? null,
      matterName,
      clientName,
      lastEditedAt: null,
    };

    return NextResponse.json({ ok: true, entry });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[dtr] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/dtr — delete a DTR entry */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { notionId } = await req.json();
  if (!notionId) {
    return NextResponse.json({ error: 'notionId is required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  try {
    // RLS (dtr_own_modify) ensures only the owner (or admin) can delete.
    const { data: deleted, error: dbErr } = await supabase
      .from('dtr')
      .delete()
      .eq('notion_id', notionId)
      .select('notion_id');

    if (dbErr) {
      console.error('[dtr-delete] Supabase error:', dbErr.message);
      return NextResponse.json({ error: dbErr.message }, { status: 500 });
    }
    // RLS filters rather than refuses: no row back means it isn't the caller's to delete.
    if (!deleted?.length) {
      return NextResponse.json({ error: 'Entry not found, or only its author can delete it' }, { status: 403 });
    }

    // Fire-and-forget audit log
    logAudit({
      firmId: session.firmId,
      entityType: 'dtr',
      entityId: notionId,
      action: 'delete',
      performedBy: session.user.notionUserId,
      ipAddress: getClientIP(req),
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[dtr-delete] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PATCH /api/dtr — update a single field on a DTR entry */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { notionId, field, value } = await req.json();
  if (!notionId || !field) {
    return NextResponse.json({ error: 'notionId and field are required' }, { status: 400 });
  }

  const supabaseCol = EDITABLE_FIELDS[field];
  if (!supabaseCol) {
    return NextResponse.json({ error: `Field "${field}" is not editable` }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const service = getServiceDbForFirm(session.firmId);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatePayload: Record<string, any> = { [supabaseCol]: value };

    // For people field, resolve names via service-role (cross-team read).
    if (field === 'withIds' && Array.isArray(value)) {
      const { data: people } = await service
        .from('team')
        .select('person_id, name')
        .in('person_id', value);
      updatePayload.with_names = (people ?? []).map((p: { name: string }) => p.name).filter(Boolean);
    }

    const { data: updated, error: dbErr } = await supabase
      .from('dtr')
      .update(updatePayload)
      .eq('notion_id', notionId)
      .select('notion_id');

    if (dbErr) {
      console.error('[dtr-patch] Supabase error:', dbErr.message);
      return NextResponse.json({ error: dbErr.message }, { status: 500 });
    }
    // RLS filters rather than refuses: no row back means it isn't the caller's to edit.
    if (!updated?.length) {
      return NextResponse.json({ error: 'Entry not found, or only its author can edit it' }, { status: 403 });
    }

    return NextResponse.json({ ok: true, withNames: updatePayload.with_names });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[dtr-patch] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
