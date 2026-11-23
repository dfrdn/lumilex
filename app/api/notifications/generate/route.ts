import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createNotificationsBatch } from '@/lib/notifications';
import { forEachActiveFirm } from '@/lib/tenancy/fan-out';
import { CLOSED_STATUSES } from '@/lib/deliverable-status';
import { pgInList } from '@/lib/postgrest';
import { manilaDate, manilaToday, toManilaDay } from '@/lib/dates';

export const maxDuration = 60;

export async function GET(req: Request) {
  // Validate cron secret
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = manilaToday();
  const tomorrow = manilaDate(1);

  const results = await forEachActiveFirm(({ firm, db }) =>
    generateForFirm(db, firm.id, { today, tomorrow }),
  );

  return NextResponse.json({
    ok: true,
    generated: results.reduce((sum, r) => sum + (r.result ?? 0), 0),
    date: today,
    firms: results,
  });
}

async function generateForFirm(
  supabase: SupabaseClient,
  firmId: string,
  { today, tomorrow }: { today: string; tomorrow: string },
): Promise<number> {
  let totalGenerated = 0;

  // ── Deadline notifications ──────────────────────────────────
  const { data: deadlineDeliverables } = await supabase
    .from('deliverables')
    .select('notion_id, name, external_due_date, currently_with_ids, drafter_ids')
    .in('external_due_date', [today, tomorrow])
    .not('status', 'in', pgInList(CLOSED_STATUSES));

  if (deadlineDeliverables && deadlineDeliverables.length > 0) {
    // Collect all person_ids involved
    const allPersonIds = new Set<string>();
    for (const d of deadlineDeliverables) {
      for (const id of d.currently_with_ids ?? []) allPersonIds.add(id);
      for (const id of d.drafter_ids ?? []) allPersonIds.add(id);
    }

    // Check preferences
    const { optedOutPersonIds } = await getOptedOutPersonIds(
      supabase,
      [...allPersonIds],
      'notify_deadlines',
    );

    // Check for existing notifications to deduplicate
    const entityIds = deadlineDeliverables.map((d) => d.notion_id);
    const { data: existing } = await supabase
      .from('notifications')
      .select('entity_id, person_id')
      .in('entity_id', entityIds)
      .eq('type', 'deadline')
      .gte('created_at', `${today}T00:00:00+08:00`);

    const existingSet = new Set(
      (existing ?? []).map((e) => `${e.entity_id}:${e.person_id}`),
    );

    const rows: { person_id: string; type: 'deadline'; title: string; body: string; href: string; entity_id: string }[] = [];

    for (const d of deadlineDeliverables) {
      const isToday = d.external_due_date === today;
      const recipients = new Set<string>();
      for (const id of d.currently_with_ids ?? []) recipients.add(id);
      for (const id of d.drafter_ids ?? []) recipients.add(id);

      for (const personId of recipients) {
        if (optedOutPersonIds.has(personId)) continue;
        if (existingSet.has(`${d.notion_id}:${personId}`)) continue;

        rows.push({
          person_id: personId,
          type: 'deadline',
          title: `${d.name || 'Untitled'} — due ${isToday ? 'today' : 'tomorrow'}`,
          body: `Deadline: ${d.external_due_date}`,
          href: `/dashboard/deliverables/${d.notion_id}`,
          entity_id: d.notion_id,
        });
      }
    }

    if (rows.length > 0) {
      // Insert first, collapse after: deleting yesterday's reminders before an
      // insert that can fail would leave people with NO reminder on the due
      // day. The collapse's created_at < today guard protects the fresh rows.
      if (await createNotificationsBatch(rows, firmId)) {
        await collapseStaleReminders(supabase, 'deadline', rows, today);
      }
      totalGenerated += rows.length;
    }
  }

  // ── Hearing notifications ───────────────────────────────────
  const { data: upcomingHearings } = await supabase
    .from('hearings')
    .select('notion_id, name, date, matter_name, attendee_ids')
    .gte('date', `${today}T00:00:00+08:00`)
    .lt('date', `${tomorrow}T24:00:00+08:00`);

  if (upcomingHearings && upcomingHearings.length > 0) {
    const allPersonIds = new Set<string>();
    for (const h of upcomingHearings) {
      for (const id of h.attendee_ids ?? []) allPersonIds.add(id);
    }

    const { optedOutPersonIds } = await getOptedOutPersonIds(
      supabase,
      [...allPersonIds],
      'notify_hearings',
    );

    const entityIds = upcomingHearings.map((h) => h.notion_id);
    const { data: existing } = await supabase
      .from('notifications')
      .select('entity_id, person_id')
      .in('entity_id', entityIds)
      .eq('type', 'hearing')
      .gte('created_at', `${today}T00:00:00+08:00`);

    const existingSet = new Set(
      (existing ?? []).map((e) => `${e.entity_id}:${e.person_id}`),
    );

    const rows: { person_id: string; type: 'hearing'; title: string; body: string; href: string; entity_id: string }[] = [];

    for (const h of upcomingHearings) {
      const hearingDate = new Date(h.date);
      const isToday = toManilaDay(hearingDate) === today;
      const timeStr = hearingDate.toLocaleTimeString('en-PH', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Manila',
      });

      for (const personId of h.attendee_ids ?? []) {
        if (optedOutPersonIds.has(personId)) continue;
        if (existingSet.has(`${h.notion_id}:${personId}`)) continue;

        rows.push({
          person_id: personId,
          type: 'hearing',
          title: `Hearing ${isToday ? 'today' : 'tomorrow'}: ${h.name || 'Untitled'}`,
          body: `${h.matter_name || ''} — ${timeStr}`,
          href: `/dashboard/hearings/${h.notion_id}`,
          entity_id: h.notion_id,
        });
      }
    }

    if (rows.length > 0) {
      if (await createNotificationsBatch(rows, firmId)) {
        await collapseStaleReminders(supabase, 'hearing', rows, today);
      }
      totalGenerated += rows.length;
    }
  }

  // ── Meeting notifications ──────────────────────────────────
  const { data: upcomingMeetings } = await supabase
    .from('meetings')
    .select('notion_id, name, date_start, matter_name, attendee_ids')
    .gte('date_start', `${today}T00:00:00+08:00`)
    .lt('date_start', `${tomorrow}T24:00:00+08:00`);

  if (upcomingMeetings && upcomingMeetings.length > 0) {
    const allPersonIds = new Set<string>();
    for (const m of upcomingMeetings) {
      for (const id of m.attendee_ids ?? []) allPersonIds.add(id);
    }

    const { optedOutPersonIds } = await getOptedOutPersonIds(
      supabase,
      [...allPersonIds],
      'notify_meetings',
    );

    const entityIds = upcomingMeetings.map((m) => m.notion_id);
    const { data: existing } = await supabase
      .from('notifications')
      .select('entity_id, person_id')
      .in('entity_id', entityIds)
      .eq('type', 'meeting')
      .gte('created_at', `${today}T00:00:00+08:00`);

    const existingSet = new Set(
      (existing ?? []).map((e) => `${e.entity_id}:${e.person_id}`),
    );

    const rows: { person_id: string; type: 'meeting'; title: string; body: string; href: string; entity_id: string }[] = [];

    for (const m of upcomingMeetings) {
      const meetingDate = new Date(m.date_start);
      const isToday = toManilaDay(meetingDate) === today;
      const timeStr = meetingDate.toLocaleTimeString('en-PH', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Manila',
      });

      for (const personId of m.attendee_ids ?? []) {
        if (optedOutPersonIds.has(personId)) continue;
        if (existingSet.has(`${m.notion_id}:${personId}`)) continue;

        rows.push({
          person_id: personId,
          type: 'meeting',
          title: `Meeting ${isToday ? 'today' : 'tomorrow'}: ${m.name || 'Untitled'}`,
          body: `${m.matter_name || ''} — ${timeStr}`,
          href: `/dashboard/meetings/${m.notion_id}`,
          entity_id: m.notion_id,
        });
      }
    }

    if (rows.length > 0) {
      if (await createNotificationsBatch(rows, firmId)) {
        await collapseStaleReminders(supabase, 'meeting', rows, today);
      }
      totalGenerated += rows.length;
    }
  }

  // Orphan sweep: the pair-exact collapse above only cleans reminders for
  // pairs re-notified today, so a reminder for someone rotated off an entity
  // (or opted out) would otherwise sit unread forever. Any rolling reminder
  // created before yesterday is definitionally expired — its "today/tomorrow"
  // due date has passed — so clear unread ones; read ones stay as history.
  const yesterdayStart = manilaDate(-1);
  await supabase
    .from('notifications')
    .delete()
    .in('type', ['deadline', 'hearing', 'meeting'])
    .eq('read', false)
    .lt('created_at', `${yesterdayStart}T00:00:00+08:00`);

  return totalGenerated;
}

/**
 * Before writing today's rolling reminder, delete any earlier reminder of the
 * same type for the same (entity, person) pairs created on a previous day — so
 * a deadline/hearing/meeting that fired "due tomorrow" yesterday collapses into
 * one live "due today" entry instead of stacking a second row in the bell.
 */
async function collapseStaleReminders(
  supabase: SupabaseClient,
  type: 'deadline' | 'hearing' | 'meeting',
  rows: { person_id: string; entity_id: string }[],
  today: string,
) {
  // Exact (person, entity) pairs only — a cross-product .in()/.in() delete
  // would also erase reminders for people NOT re-notified today (e.g. someone
  // reassigned off the entity overnight), leaving them with no reminder at all.
  const pairs = [
    ...new Map(rows.map((r) => [`${r.person_id}:${r.entity_id}`, r])).values(),
  ];
  const CHUNK = 50;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const orFilter = pairs
      .slice(i, i + CHUNK)
      .map((p) => `and(person_id.eq.${p.person_id},entity_id.eq.${p.entity_id})`)
      .join(',');
    await supabase
      .from('notifications')
      .delete()
      .eq('type', type)
      .or(orFilter)
      .lt('created_at', `${today}T00:00:00+08:00`);
  }
}

/**
 * Given a list of person_ids and a preference column, return the set of person_ids that opted out.
 */
async function getOptedOutPersonIds(
  supabase: SupabaseClient,
  personIds: string[],
  prefColumn: 'notify_deadlines' | 'notify_hearings' | 'notify_meetings',
) {
  if (personIds.length === 0) return { optedOutPersonIds: new Set<string>() };

  // Map person_ids to emails
  const { data: teamMembers } = await supabase
    .from('team')
    .select('person_id, email')
    .in('person_id', personIds)
    .eq('active', true);

  if (!teamMembers || teamMembers.length === 0) {
    return { optedOutPersonIds: new Set(personIds) };
  }

  const emails = teamMembers.map((m) => m.email).filter(Boolean);
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select(`email, ${prefColumn}`)
    .in('email', emails);

  const optedOutEmails = new Set(
    (prefs ?? []).filter((p) => (p as Record<string, boolean>)[prefColumn] === false).map((p) => p.email),
  );

  const emailToPersonId = new Map(teamMembers.map((m) => [m.email, m.person_id]));
  const optedOutPersonIds = new Set<string>();
  for (const [email, personId] of emailToPersonId) {
    if (optedOutEmails.has(email)) optedOutPersonIds.add(personId);
  }

  return { optedOutPersonIds };
}
