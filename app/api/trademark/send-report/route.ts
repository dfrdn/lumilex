import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { sendClientMail, ClientMailError } from '@/lib/email';
import { TRADEMARK_SELECT, rowToTrademark } from '@/lib/trademark-row';
import { owedDues, type DeadlineKind } from '@/lib/trademark-deadlines';
import { buildTrademarkPlaceholders } from '@/lib/trademark-report-context';
import { substituteDocxPlaceholders } from '@/lib/docx/placeholder-substitution';
import { loadOutboundIdentity, mailboxNotConfigured } from '@/lib/firm/outbound-identity';
import type { Trademark } from '@/types/notion';

const ALLOWED_ROLES = new Set(['admin', 'lawyer', 'partner', 'super_user']);

interface DeadlineRequest {
  trademarkId: string;
  kind: DeadlineKind;
  due: string; // YYYY-MM-DD — must match server-computed value
}

interface Recipient {
  name?: string;
  address: string;
}

interface RequestBody {
  deadlines: DeadlineRequest[];
  to: Recipient[];
  cc?: Recipient[];
  subject: string;
  bodyHtml: string;
  attachmentFileIds?: number[];
  /** Per-deadline override of which template to use. Keyed by `${tid}|${kind}|${due}`. */
  templateOverrides?: Record<string, number>;
  /** Per-deadline extra placeholder values (for placeholders not auto-filled). */
  placeholderOverrides?: Record<string, Record<string, string>>;
}

function deadlineKey(d: DeadlineRequest): string {
  return `${d.trademarkId}|${d.kind}|${d.due}`;
}

function safeFileSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60);
}

interface TemplateRow {
  id: number;
  name: string;
  deadline_kind: DeadlineKind | null;
  template_storage_path: string | null;
}

interface PerDeadlineGenResult {
  deadline: DeadlineRequest;
  attachment?: { name: string; contentType: string; contentBytes: string };
  storagePath?: string;
  templateName?: string;
  /** Soft warning to surface back to the user when no DOCX could be generated. */
  warning?: string;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role ?? 'lawyer';
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as RequestBody | null;
  if (!body?.deadlines?.length || !body.to?.length || !body.subject || !body.bodyHtml) {
    return NextResponse.json({ error: 'deadlines, to, subject, bodyHtml are required' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);

  const identity = await loadOutboundIdentity(session.firmId);
  if (!identity.ipAddress) {
    return NextResponse.json(
      { error: mailboxNotConfigured('trademark mailbox (settings.email.ipAddress)') },
      { status: 400 },
    );
  }

  // Fetch all referenced trademarks in one round-trip
  const tmIds = [...new Set(body.deadlines.map((d) => d.trademarkId))];
  const { data: tmRows, error: tmErr } = await supabase
    .from('trademarks').select(TRADEMARK_SELECT).in('id', tmIds);
  if (tmErr) return NextResponse.json({ error: tmErr.message }, { status: 500 });
  const trademarksById = new Map<string, Trademark>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tmRows ?? []).map((r: any) => [r.id, rowToTrademark(r)]),
  );

  // Validate each deadline against current server-side state
  for (const d of body.deadlines) {
    const t = trademarksById.get(d.trademarkId);
    if (!t) {
      return NextResponse.json({ error: `Trademark ${d.trademarkId} not found` }, { status: 404 });
    }
    const owed = owedDues(t, d.kind);
    if (owed.length === 0) {
      return NextResponse.json(
        { error: `Deadline ${d.kind} on "${t.mark}" is no longer pending — refresh the page.` },
        { status: 409 },
      );
    }
    if (!owed.includes(d.due)) {
      return NextResponse.json(
        { error: `Deadline ${d.kind} on "${t.mark}" has shifted to ${owed.join(', ')} — refresh the page.` },
        { status: 409 },
      );
    }
  }

  // Load all relevant trademark report templates in one query.
  const { data: templateRows } = await supabase
    .from('document_templates')
    .select('id, name, deadline_kind, template_storage_path')
    .eq('category', 'report')
    .eq('subcategory', 'trademark_report')
    .eq('is_active', true)
    .eq('generation_mode', 'placeholder');

  const templates = (templateRows ?? []) as TemplateRow[];
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const templateByKind = new Map<DeadlineKind, TemplateRow>();
  for (const t of templates) {
    if (t.deadline_kind && !templateByKind.has(t.deadline_kind)) {
      templateByKind.set(t.deadline_kind, t);
    }
  }

  // For each deadline, resolve template + render DOCX. Failures are soft.
  const senderName = session.user.name ?? '';
  const perDeadline: PerDeadlineGenResult[] = [];
  const attachments: { name: string; contentType: string; contentBytes: string }[] = [];

  for (const d of body.deadlines) {
    const t = trademarksById.get(d.trademarkId)!;
    const overrideId = body.templateOverrides?.[deadlineKey(d)];
    const template = overrideId ? templateById.get(overrideId) : templateByKind.get(d.kind);

    if (!template) {
      perDeadline.push({
        deadline: d,
        warning: `No template configured for ${d.kind} (set one in /admin/templates).`,
      });
      continue;
    }
    if (!template.template_storage_path) {
      perDeadline.push({
        deadline: d,
        warning: `Template "${template.name}" has no DOCX uploaded.`,
      });
      continue;
    }

    try {
      const { data: fileData, error: dlErr } = await supabase.storage
        .from('templates')
        .download(template.template_storage_path);
      if (dlErr || !fileData) throw new Error(dlErr?.message ?? 'template not found in storage');

      const templateBuffer = Buffer.from(await fileData.arrayBuffer());
      const placeholders = {
        ...buildTrademarkPlaceholders({
          trademark: t, deadlineKind: d.kind, deadlineDue: d.due, senderName,
          firmName: identity.firmName,
        }),
        ...(body.placeholderOverrides?.[deadlineKey(d)] ?? {}),
      };
      const docxBuffer = await substituteDocxPlaceholders(templateBuffer, placeholders);

      const fileName = `${safeFileSegment(t.mark || 'mark')}-${safeFileSegment(d.kind)}-${d.due}.docx`;
      const storagePath = firmStoragePath(session.firmId, `trademarks/${t.id}/reports/${Date.now()}-${fileName}`);

      const { error: upErr } = await supabase.storage
        .from('files')
        .upload(storagePath, docxBuffer, {
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          upsert: false,
        });
      if (upErr) throw new Error(upErr.message);

      const attachment = {
        name: fileName,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        contentBytes: docxBuffer.toString('base64'),
      };
      attachments.push(attachment);
      perDeadline.push({ deadline: d, attachment, storagePath, templateName: template.name });
    } catch (e) {
      perDeadline.push({
        deadline: d,
        warning: `Failed to render template "${template.name}": ${e instanceof Error ? e.message : 'unknown error'}`,
      });
    }
  }

  // Optional ad-hoc attachments from trademark_files
  if (body.attachmentFileIds?.length) {
    const { data: fileRows } = await supabase
      .from('trademark_files')
      .select('id, name, mime_type, storage_path')
      .in('id', body.attachmentFileIds);
    for (const f of (fileRows ?? []) as Array<{
      id: number; name: string; mime_type: string | null; storage_path: string;
    }>) {
      const { data } = await supabase.storage.from('files').download(f.storage_path);
      if (!data) continue;
      const buf = Buffer.from(await data.arrayBuffer());
      attachments.push({
        name: f.name,
        contentType: f.mime_type ?? 'application/octet-stream',
        contentBytes: buf.toString('base64'),
      });
    }
  }

  try {
    await sendClientMail({
      firmId: session.firmId,
      fromAddress: identity.ipAddress,
      fromName: identity.firmName,
      subject: body.subject,
      bodyHtml: body.bodyHtml,
      to: body.to,
      cc: body.cc,
      attachments: attachments.length ? attachments : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Email send failed' },
      // A ClientMailError is a configuration answer (no key, no from-address,
      // unverified domain); anything else is Resend or the network failing.
      { status: e instanceof ClientMailError ? 503 : 502 },
    );
  }

  // Audit rows — one per deadline. Each row records its own generated DOCX
  // path (if any) so we can re-download exactly what was attached.
  const recipientPrimary = body.to[0]?.address ?? '';
  const ccAddresses = (body.cc ?? []).map((c) => c.address);
  const auditRows = perDeadline.map((p) => ({
    trademark_id: p.deadline.trademarkId,
    deadline_kind: p.deadline.kind,
    deadline_due: p.deadline.due,
    sent_by: session.user.notionUserId!,
    recipient_email: recipientPrimary,
    cc_emails: ccAddresses,
    subject: body.subject,
    body_html: body.bodyHtml,
    attachment_paths: p.storagePath ? [p.storagePath] : [],
  }));

  const { data: insertedRows, error: insErr } = await supabase
    .from('trademark_client_reports')
    .insert(auditRows)
    .select('id');

  const warnings = perDeadline
    .filter((p) => p.warning)
    .map((p) => p.warning as string);

  if (insErr) {
    return NextResponse.json({
      ok: true,
      sent: true,
      auditError: insErr.message,
      reportIds: [],
      warnings,
    });
  }

  return NextResponse.json({
    ok: true,
    sent: true,
    reportIds: (insertedRows ?? []).map((r: { id: number }) => r.id),
    warnings,
    attachmentsGenerated: perDeadline.filter((p) => p.attachment).length,
  });
}
