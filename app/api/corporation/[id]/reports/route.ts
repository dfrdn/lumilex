import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { FINALIZED_STATUSES } from '@/lib/deliverable-status';
import { COMPLIANCE_TYPES } from '@/lib/corporations/client-report-server';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { signStoragePaths } from '@/lib/storage-sign';
import { addDays, manilaToday } from '@/lib/dates';
import { rowToCorporation } from '@/lib/corporation-row';
import { CORPORATION_SELECT } from '@/lib/corporations/matter-links';
import { CORPORATE_REPORT_EVENTS, corporateReportLabel, itemShortName, recordedRegistrations, type CorporateReportEvent } from '@/lib/corporations/client-report';
import { companyName } from '@/lib/corporations/obligations';

/** How far back the page offers a report on an item. */
const ITEM_WINDOW_DAYS = 365;
const MEETING_LABEL: Record<string, string> = {
  Organizational: 'Organizational meeting',
  'Regular Board': 'Regular board meeting',
  'Special Board': 'Special board meeting',
  'Annual Stockholders': 'Annual stockholders’ meeting',
  'Special Stockholders': 'Special stockholders’ meeting',
};

/**
 * GET /api/corporation/[id]/reports
 * What can be reported to the client — the company's recorded registrations,
 * and the past year's filed compliance items, held meetings and signed
 * resolutions — each with the report sent on it, if any; and the reports
 * sent, newest first, with links to what went.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const authed = await getSupabaseServerAuthClient();
  const { data: row } = await authed.from('corporations').select(CORPORATION_SELECT).eq('id', id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const corporation = rowToCorporation(row);

  const today = manilaToday();
  const since = addDays(today, -ITEM_WINDOW_DAYS);
  const [filings, meetings, resolutions, sentRows] = await Promise.all([
    authed.from('deliverables').select('notion_id, name, date_done')
      .eq('subject_id', id).in('type', COMPLIANCE_TYPES).in('status', [...FINALIZED_STATUSES]).gte('date_done', since)
      .order('date_done', { ascending: false }).limit(20),
    authed.from('corporation_meetings').select('id, meeting_type, meeting_date')
      .eq('corporation_id', id).lte('meeting_date', today).gte('meeting_date', since)
      .order('meeting_date', { ascending: false }).limit(10),
    authed.from('resolutions').select('id, title, kind, date_of_resolution')
      .eq('corporation_id', id).eq('status', 'Signed').gte('date_of_resolution', since)
      .order('date_of_resolution', { ascending: false }).limit(10),
    getServiceDbForFirm(session.firmId).from('corporation_client_reports')
      .select('id, event, item_id, event_date, sent_at, sent_by, recipient_email, cc_emails, subject, attachment_paths')
      .eq('corporation_id', id).order('sent_at', { ascending: false }).limit(50),
  ]);
  const error = filings.error ?? meetings.error ?? resolutions.error ?? sentRows.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const reportable: { event: CorporateReportEvent; itemId: string | null; label: string; date: string }[] = [
    ...recordedRegistrations(corporation).map((r) => ({ ...r, itemId: null, label: CORPORATE_REPORT_EVENTS[r.event].label })),
    ...(filings.data ?? []).map((d) => ({ event: 'compliance' as const, itemId: d.notion_id as string, label: corporateReportLabel('compliance', itemShortName(d.name as string, companyName(corporation))), date: String(d.date_done).slice(0, 10) })),
    ...(meetings.data ?? []).map((m) => ({ event: 'meeting' as const, itemId: m.id as string, label: `${CORPORATE_REPORT_EVENTS.meeting.label} — ${MEETING_LABEL[m.meeting_type as string] ?? 'Meeting'}`, date: String(m.meeting_date).slice(0, 10) })),
    ...(resolutions.data ?? []).map((r) => ({ event: 'resolution' as const, itemId: r.id as string, label: corporateReportLabel('resolution', r.title as string), date: String(r.date_of_resolution).slice(0, 10) })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const sentData = sentRows.data ?? [];
  const service = getServiceDbForFirm(session.firmId);
  const senderIds = [...new Set(sentData.map((r) => r.sent_by as string).filter(Boolean))];
  const { data: people } = senderIds.length
    ? await service.from('team').select('person_id, name').in('person_id', senderIds)
    : { data: [] };
  const senderName = new Map((people ?? []).map((p) => [p.person_id as string, p.name as string]));
  const signed = await signStoragePaths(service, 'files', sentData.flatMap((r) => (r.attachment_paths as string[] | null) ?? []), 60 * 60, { download: true });

  const sent = sentData.map((r) => ({
    id: r.id as number,
    event: r.event as CorporateReportEvent,
    itemId: (r.item_id as string | null) ?? null,
    eventDate: r.event_date as string,
    sentAt: r.sent_at as string,
    sentBy: senderName.get(r.sent_by as string) ?? null,
    recipientEmail: r.recipient_email as string,
    ccEmails: (r.cc_emails as string[] | null) ?? [],
    subject: r.subject as string,
    attachments: ((r.attachment_paths as string[] | null) ?? []).map((p) => ({ name: p.split('/').pop()?.replace(/^\d+-/, '') ?? p, url: signed.get(p) ?? null })),
  }));
  const keyOf = (x: { event: string; itemId: string | null; date?: string; eventDate?: string }) => `${x.event}|${x.itemId ?? ''}|${x.date ?? x.eventDate}`;
  const lastSent = new Map<string, (typeof sent)[number]>();
  for (const s of sent) if (!lastSent.has(keyOf(s))) lastSent.set(keyOf(s), s);

  return NextResponse.json({
    reportable: reportable.map((r) => {
      const s = lastSent.get(keyOf(r));
      return { ...r, sent: s ? { sentAt: s.sentAt, recipientEmail: s.recipientEmail } : null };
    }),
    sent,
  });
}
