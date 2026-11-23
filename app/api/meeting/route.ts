import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { mintId } from '@/lib/ids';
import { logAudit, getClientIP } from '@/lib/audit';
import { notifyAttendeesAddedToMeeting } from '@/lib/notifications';
import { toManilaInstant } from '@/lib/dates';

function canEdit(role: string | undefined): boolean {
  return ['admin', 'super_user', 'partner'].includes(role ?? '');
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { name, matterId, type, date, attendeeIds } = await req.json();

  if (!name || !type || !date) {
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

    const newId = mintId('meeting');
    const { error: dbErr } = await supabase
      .from('meetings')
      .insert({
        firm_id: session.firmId,
        notion_id: newId,
        notion_url: '',
        name,
        date_start: toManilaInstant(date),
        date_end: null,
        matter_id: matterId ?? null,
        matter_name: matterName,
        type,
        attendee_ids: attendeeIds ?? [],
        is_attended: false,
        location: '',
        duration: null,
        created_time: new Date().toISOString(),
        notion_last_edited_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      });

    if (dbErr) {
      console.error('[meeting] Supabase insert error:', dbErr.message);
      if (dbErr.code === '42501') {
        return NextResponse.json(
          { error: 'You cannot create this meeting because you are not part of the matter.' },
          { status: 403 },
        );
      }
      return NextResponse.json({ error: dbErr.message }, { status: 500 });
    }

    // Fire-and-forget attendee invite notifications (in-app + email).
    // Everyone in the initial attendee list is "newly added"; the function
    // filters out the performer.
    if (attendeeIds && attendeeIds.length > 0) {
      notifyAttendeesAddedToMeeting({
        firmId: session.firmId,
        meetingId: newId,
        newAttendeeIds: attendeeIds,
        previousAttendeeIds: [],
        performedBy: session.user.notionUserId,
      }).catch((err) =>
        console.error('[meeting] attendee notify failed:', (err as Error).message),
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[meeting] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH — partial update of a meeting's title, date, and/or attendees.
 * Gated to admin / super_user / partner. One audit_log row is written per
 * changed field.
 */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id, name, date, endDate, attendeeIds, notes, notesVersion } = await req.json();
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const nameProvided = typeof name === 'string';
  const dateProvided = date !== undefined;
  const endDateProvided = endDate !== undefined;
  const attendeesProvided = Array.isArray(attendeeIds);
  const notesProvided = typeof notes === 'string';
  if (notesProvided && notes.length > 20000) {
    return NextResponse.json({ error: 'Notes are too long' }, { status: 400 });
  }
  if (notesProvided && !(Number.isInteger(notesVersion) && notesVersion >= 0)) {
    return NextResponse.json({ error: 'Missing notesVersion' }, { status: 400 });
  }

  if (!nameProvided && !dateProvided && !endDateProvided && !attendeesProvided && !notesProvided) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }
  // Anyone on the team may keep the notes; the meeting itself is the editors'.
  if ((nameProvided || dateProvided || endDateProvided || attendeesProvided) && !canEdit(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = await getSupabaseServerAuthClient();
  let notesSavedVersion: number | null = null;

  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('meetings')
      .select('notion_id, name, date_start, date_end, attendee_ids')
      .eq('notion_id', id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    const update: Record<string, unknown> = {};
    if (nameProvided) update.name = name;
    if (dateProvided) update.date_start = date ? toManilaInstant(date) : date;
    if (endDateProvided) update.date_end = endDate ? toManilaInstant(endDate) : endDate;
    if (attendeesProvided) update.attendee_ids = attendeeIds;

    const { error: updateErr } = Object.keys(update).length > 0
      ? await supabase.from('meetings').update(update).eq('notion_id', id)
      : { error: null };

    if (updateErr) {
      console.error('[meeting] Supabase update error:', updateErr.message);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    const ip = getClientIP(req);
    const performer = session.user.notionUserId;
    if (nameProvided && name !== existing.name) {
      logAudit({
        firmId: session.firmId,
        entityType: 'meeting',
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
    if (dateProvided && date !== existing.date_start) {
      logAudit({
        firmId: session.firmId,
        entityType: 'meeting',
        entityId: id,
        entityName: nameProvided ? name : existing.name ?? undefined,
        action: 'edited',
        fieldChanged: 'date_start',
        oldValue: existing.date_start ?? undefined,
        newValue: date ?? undefined,
        performedBy: performer,
        ipAddress: ip,
      });
    }
    if (endDateProvided && endDate !== existing.date_end) {
      logAudit({
        firmId: session.firmId,
        entityType: 'meeting',
        entityId: id,
        entityName: nameProvided ? name : existing.name ?? undefined,
        action: 'edited',
        fieldChanged: 'date_end',
        oldValue: existing.date_end ?? undefined,
        newValue: endDate ?? undefined,
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
          entityType: 'meeting',
          entityId: id,
          entityName: nameProvided ? name : existing.name ?? undefined,
          action: 'edited',
          fieldChanged: 'attendee_ids',
          oldValue: oldList.join(','),
          newValue: newList.join(','),
          performedBy: performer,
          ipAddress: ip,
        });

        // Fire-and-forget notify newly-added attendees (in-app + email).
        notifyAttendeesAddedToMeeting({
          firmId: session.firmId,
          meetingId: id,
          newAttendeeIds: newList,
          previousAttendeeIds: oldList,
          performedBy: performer,
        }).catch((err) =>
          console.error('[meeting] attendee notify failed:', (err as Error).message),
        );
      }
    }

    if (notesProvided) {
      // Their own table: the notes are the team's, and nothing the portal reads carries them.
      // A save names the version it was written over; if someone saved since,
      // nothing is written and the page merges against what they saved.
      const row = { body: notes, updated_at: new Date().toISOString(), updated_by: performer, version: notesVersion + 1 };
      const { data: written, error: notesErr } =
        notesVersion === 0
          ? await supabase.from('meeting_notes').insert({ firm_id: session.firmId, meeting_id: id, ...row }).select('version')
          : await supabase.from('meeting_notes').update(row).eq('meeting_id', id).eq('version', notesVersion).select('version');
      if (notesErr && notesErr.code !== '23505') {
        console.error('[meeting] notes save error:', notesErr.message);
        return NextResponse.json({ error: notesErr.message }, { status: 500 });
      }
      if (!written?.length) {
        const { data: latest } = await supabase
          .from('meeting_notes')
          .select('body, version, updated_at, updated_by')
          .eq('meeting_id', id)
          .maybeSingle();
        return NextResponse.json({ error: 'Someone saved the notes first', latest }, { status: 409 });
      }
      notesSavedVersion = written[0].version as number;
      logAudit({
        firmId: session.firmId,
        entityType: 'meeting',
        entityId: id,
        entityName: nameProvided ? name : existing.name ?? undefined,
        action: 'edited',
        fieldChanged: 'notes',
        performedBy: performer,
        ipAddress: ip,
      });
    }

    return NextResponse.json(notesSavedVersion === null ? { ok: true } : { ok: true, notesVersion: notesSavedVersion });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[meeting] PATCH error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
