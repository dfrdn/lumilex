import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendBrieferEmail, type BrieferData } from '@/lib/email';
import { forEachActiveFirm } from '@/lib/tenancy/fan-out';
import { manilaDate, manilaToday, toManilaDay } from '@/lib/dates';

export const maxDuration = 60;

export async function GET(req: Request) {
  console.log('[email-briefer] Cron triggered at', new Date().toISOString());

  // Validate cron secret
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.log('[email-briefer] Auth failed — CRON_SECRET mismatch');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = manilaToday();
  const tomorrow = manilaDate(1);

  const results = await forEachActiveFirm(({ firm, db }) => briefFirm(firm.id, db, today, tomorrow));

  const sent = results.reduce((sum, r) => sum + (r.result?.sent ?? 0), 0);
  console.log(`[email-briefer] Done — sent ${sent} email(s) across ${results.length} firm(s) for ${today}`);
  return NextResponse.json({ ok: true, sent, date: today, firms: results });
}

async function briefFirm(
  firmId: string,
  supabase: SupabaseClient,
  today: string,
  tomorrow: string,
): Promise<{ sent: number; eligible: number; reason?: string }> {
  // Get active team members who opted into email briefer
  const { data: teamMembers } = await supabase
    .from('team')
    .select('person_id, name, email')
    .eq('active', true)
    .not('email', 'is', null);

  if (!teamMembers || teamMembers.length === 0) {
    return { sent: 0, eligible: 0, reason: 'no active team members' };
  }

  // Check preferences
  const emails = teamMembers.map((m) => m.email).filter(Boolean);
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select('email, notify_email_briefer')
    .in('email', emails);

  const optedOut = new Set(
    (prefs ?? []).filter((p) => p.notify_email_briefer === false).map((p) => p.email),
  );

  const eligibleMembers = teamMembers.filter((m) => m.email && !optedOut.has(m.email));

  if (eligibleMembers.length === 0) {
    return { sent: 0, eligible: 0, reason: 'all opted out' };
  }

  // Fetch today's and tomorrow's deadlines
  const { data: deadlineDeliverables } = await supabase
    .from('deliverables')
    .select('notion_id, name, external_due_date, currently_with_ids, drafter_ids, matter_name')
    .in('external_due_date', [today, tomorrow])
    .not('status', 'in', '("Completed","Filed","Cancelled")');

  // Fetch today's and tomorrow's hearings
  const { data: hearings } = await supabase
    .from('hearings')
    .select('notion_id, name, date, matter_name, attendee_ids')
    .gte('date', `${today}T00:00:00+08:00`)
    .lt('date', `${tomorrow}T24:00:00+08:00`);

  // Fetch today's and tomorrow's meetings
  const { data: meetings } = await supabase
    .from('meetings')
    .select('notion_id, name, date_start, matter_name, attendee_ids')
    .gte('date_start', `${today}T00:00:00+08:00`)
    .lt('date_start', `${tomorrow}T24:00:00+08:00`);

  let sentCount = 0;

  for (const member of eligibleMembers) {
    const personId = member.person_id;

    // Filter deadlines relevant to this person
    const myDeadlines = (deadlineDeliverables ?? []).filter((d) => {
      const involved = [...(d.currently_with_ids ?? []), ...(d.drafter_ids ?? [])];
      return involved.includes(personId);
    });

    const todayDeadlines = myDeadlines
      .filter((d) => d.external_due_date === today)
      .map((d) => ({ name: d.name || 'Untitled', dueDate: d.external_due_date!, matterName: d.matter_name || undefined }));

    const tomorrowDeadlines = myDeadlines
      .filter((d) => d.external_due_date === tomorrow)
      .map((d) => ({ name: d.name || 'Untitled', dueDate: d.external_due_date!, matterName: d.matter_name || undefined }));

    // Filter hearings relevant to this person
    const myHearings = (hearings ?? []).filter((h) =>
      (h.attendee_ids ?? []).includes(personId),
    );

    const todayHearings = myHearings
      .filter((h) => toManilaDay(h.date) === today)
      .map((h) => ({
        name: h.name || 'Untitled',
        date: h.date,
        time: new Date(h.date).toLocaleTimeString('en-PH', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Manila',
        }),
        matterName: h.matter_name || undefined,
      }));

    const tomorrowHearings = myHearings
      .filter((h) => toManilaDay(h.date) === tomorrow)
      .map((h) => ({
        name: h.name || 'Untitled',
        date: h.date,
        time: new Date(h.date).toLocaleTimeString('en-PH', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Manila',
        }),
        matterName: h.matter_name || undefined,
      }));

    // Filter meetings relevant to this person
    const myMeetings = (meetings ?? []).filter((m) =>
      (m.attendee_ids ?? []).includes(personId),
    );

    const todayMeetings = myMeetings
      .filter((m) => toManilaDay(m.date_start) === today)
      .map((m) => ({
        name: m.name || 'Untitled',
        date: m.date_start,
        time: new Date(m.date_start).toLocaleTimeString('en-PH', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Manila',
        }),
        matterName: m.matter_name || undefined,
      }));

    const tomorrowMeetings = myMeetings
      .filter((m) => toManilaDay(m.date_start) === tomorrow)
      .map((m) => ({
        name: m.name || 'Untitled',
        date: m.date_start,
        time: new Date(m.date_start).toLocaleTimeString('en-PH', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Manila',
        }),
        matterName: m.matter_name || undefined,
      }));

    // Get unread notification count
    const { count: unreadCount } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('person_id', personId)
      .eq('read', false);

    const data: BrieferData = {
      todayDeadlines,
      tomorrowDeadlines,
      todayHearings,
      tomorrowHearings,
      todayMeetings,
      tomorrowMeetings,
      unreadCount: unreadCount ?? 0,
    };

    // Only send if there's something to report
    const hasContent = todayDeadlines.length > 0 || tomorrowDeadlines.length > 0 || todayHearings.length > 0 || tomorrowHearings.length > 0 || todayMeetings.length > 0 || tomorrowMeetings.length > 0 || (unreadCount ?? 0) > 0;

    if (hasContent) {
      try {
        await sendBrieferEmail(member.email, member.name, data, firmId);
        sentCount++;
        console.log(`[email-briefer] ✓ Sent to ${member.name} (${member.email})`);
      } catch (err) {
        console.error(`[email-briefer] ✗ Failed for ${member.name}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  return { sent: sentCount, eligible: eligibleMembers.length };
}
