import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { mintId } from '@/lib/ids';
import { logAudit, getClientIP } from '@/lib/audit';
import { notifyAttendeesAddedToHearing } from '@/lib/notifications';
import { toManilaInstant } from '@/lib/dates';

function canEdit(role: string | undefined): boolean {
  return ['admin', 'super_user', 'partner'].includes(role ?? '');
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { name, matterId, date, type, attendeeIds } = await req.json();

  if (!name || !date || !type) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const supabase = await getSupabaseServerAuthClient();

    // Resolve matter name
    let matterName = '';
    if (matterId) {
      const { data: matterRow } = await supabase
        .from('matters')
        .select('name')
        .eq('notion_id', matterId)
        .single();
      matterName = matterRow?.name ?? '';
    }

    const newId = mintId('hearing');
    const { error: dbErr } = await supabase
      .from('hearings')
      .insert({
        firm_id: session.firmId,
        notion_id: newId,
        notion_url: '',
        name,
        date: toManilaInstant(date),
        matter_id: matterId ?? null,
        matter_name: matterName,
        type,
        status: 'Scheduled',
        attendee_ids: attendeeIds ?? [],
        is_attended: false,
        is_filed: false,
        created_time: new Date().toISOString(),
        notion_last_edited_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      });

    if (dbErr) {
      console.error('[hearing] Supabase insert error:', dbErr.message);
      if (dbErr.code === '42501') {
        return NextResponse.json(
          { error: 'You cannot create this hearing because you are not part of the matter.' },
          { status: 403 },
        );
      }
      return NextResponse.json({ error: dbErr.message }, { status: 500 });
    }

    if (attendeeIds && attendeeIds.length > 0) {
      notifyAttendeesAddedToHearing({
        firmId: session.firmId,
        hearingId: newId,
        newAttendeeIds: attendeeIds,
        previousAttendeeIds: [],
        performedBy: session.user.notionUserId,
      }).catch((err) =>
        console.error('[hearing] attendee notify failed:', (err as Error).message),
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[hearing] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH — partial update of a hearing's title, date, and/or attendees.
 * Gated to admin / super_user / partner. One audit_log row is written per
 * changed field.
 */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!canEdit(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, name, date, attendeeIds } = await req.json();
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const nameProvided = typeof name === 'string';
  const dateProvided = date !== undefined; // null is an explicit clear
  const attendeesProvided = Array.isArray(attendeeIds);

  if (!nameProvided && !dateProvided && !attendeesProvided) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  try {
    // Fetch existing row for audit-oldValue + existence check
    const { data: existing, error: fetchErr } = await supabase
      .from('hearings')
      .select('notion_id, name, date, attendee_ids')
      .eq('notion_id', id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Hearing not found' }, { status: 404 });
    }

    // Build partial Supabase update
    const update: Record<string, unknown> = {};
    if (nameProvided) update.name = name;
    if (dateProvided) update.date = date ? toManilaInstant(date) : date;
    if (attendeesProvided) update.attendee_ids = attendeeIds;

    const { error: updateErr } = await supabase
      .from('hearings')
      .update(update)
      .eq('notion_id', id);

    if (updateErr) {
      console.error('[hearing] Supabase update error:', updateErr.message);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Audit — one row per changed field
    const ip = getClientIP(req);
    const performer = session.user.notionUserId;
    if (nameProvided && name !== existing.name) {
      logAudit({
        firmId: session.firmId,
        entityType: 'hearing',
        entityId: id,
        entityName: name,
        action: 'edited',
        fieldChanged: 'name',
        oldValue: existing.name ?? undefined,
        newValue: name,
        performedBy: performer,
        ipAddress: ip,
      });
    }
    if (dateProvided && date !== existing.date) {
      logAudit({
        firmId: session.firmId,
        entityType: 'hearing',
        entityId: id,
        entityName: nameProvided ? name : existing.name ?? undefined,
        action: 'edited',
        fieldChanged: 'date',
        oldValue: existing.date ?? undefined,
        newValue: date ?? undefined,
        performedBy: performer,
        ipAddress: ip,
      });
    }
    if (attendeesProvided) {
      const oldList = (existing.attendee_ids ?? []) as string[];
      const newList = attendeeIds as string[];
      const changed =
        oldList.length !== newList.length ||
        oldList.some((v, i) => v !== newList[i]);
      if (changed) {
        logAudit({
          firmId: session.firmId,
          entityType: 'hearing',
          entityId: id,
          entityName: nameProvided ? name : existing.name ?? undefined,
          action: 'edited',
          fieldChanged: 'attendee_ids',
          oldValue: oldList.join(','),
          newValue: newList.join(','),
          performedBy: performer,
          ipAddress: ip,
        });

        notifyAttendeesAddedToHearing({
          firmId: session.firmId,
          hearingId: id,
          newAttendeeIds: newList,
          previousAttendeeIds: oldList,
          performedBy: performer,
        }).catch((err) =>
          console.error('[hearing] attendee notify failed:', (err as Error).message),
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[hearing] PATCH error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
