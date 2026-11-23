import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { loadOutboundIdentity } from '@/lib/firm/outbound-identity';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { signStoragePaths } from '@/lib/storage-sign';
import { attachmentName } from '@/lib/trademarks/report-attachments';

/**
 * GET /api/trademark/[id]/reports/[reportId]
 * One sent client report as it went out: the email body, who it went to, and
 * its attachments — each with a link to view it and one to download it.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; reportId: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id, reportId } = await params;

  // The mark is read on the person's JWT: one they can't see has no reports to show.
  const authed = await getSupabaseServerAuthClient();
  const { data: mark } = await authed.from('trademarks').select('id').eq('id', id).maybeSingle();
  if (!mark) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const service = getServiceDbForFirm(session.firmId);
  const { data: r } = await service
    .from('trademark_client_reports')
    .select('id, event, event_date, deadline_kind, deadline_due, sent_at, sent_by, recipient_email, cc_emails, subject, body_html, attachment_paths, sent_outside, title, notes')
    .eq('trademark_id', id)
    .eq('id', Number(reportId))
    .maybeSingle();
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const paths = (r.attachment_paths as string[] | null) ?? [];
  const [view, download, { data: sender }, identity] = await Promise.all([
    signStoragePaths(service, 'files', paths, 60 * 60),
    signStoragePaths(service, 'files', paths, 60 * 60, { download: true }),
    service.from('team').select('name').eq('person_id', r.sent_by as string).maybeSingle(),
    loadOutboundIdentity(session.firmId),
  ]);

  return NextResponse.json({
    report: {
      id: r.id,
      subject: r.subject,
      bodyHtml: (r.body_html as string | null) ?? null,
      sentAt: r.sent_at,
      sentByName: sender?.name ?? null,
      from: identity.ipAddress,
      recipientEmail: r.recipient_email,
      ccEmails: (r.cc_emails as string[] | null) ?? [],
      sentOutside: (r.sent_outside as boolean | null) ?? false,
      notes: (r.notes as string | null) ?? null,
      attachments: paths.map((path) => ({
        name: attachmentName(path),
        isPdf: /\.pdf$/i.test(path),
        isImage: /\.(png|jpe?g|gif|webp)$/i.test(path),
        viewUrl: view.get(path) ?? null,
        downloadUrl: download.get(path) ?? null,
      })),
    },
  });
}
