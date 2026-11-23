import { Resend } from 'resend';
import { getFirmConfig, firmBaseUrl } from '@/lib/firm/config';
import { brandAssetUrl } from '@/lib/firm/brand-shape';
import { formatManilaSchedule } from '@/lib/dates';
import { wrapBrandedEmail as wrapEmailChrome, type EmailBrand } from '@/lib/email-chrome';

// Constructed lazily — Resend throws at construction when RESEND_API_KEY is
// absent, and importing this module must never throw.
let resendClient: Resend | null = null;
function getResend(): Resend {
  resendClient ??= new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

/* ── Per-firm sending identity ───────────────────────────────── */

/**
 * Who an outbound notification is *from*, per firm. The Resend account is the
 * platform's (one API key, many tenants); the address, the name on it, and the
 * mark in the header belong to the firm whose work triggered the mail.
 *
 * There is no configured-address fallback. A firm that has not set one does not
 * get mail sent under someone else's address — the send is refused and logged,
 * and the senders that report back to a person return the reason so it surfaces
 * in the UI instead of dying in a log nobody reads.
 */
interface EmailIdentity {
  /** RFC 5322 `From`. */
  from: string;
  /** Display name for the header wordmark and footer. Blank renders neither. */
  firmName: string;
  /** Absolute URL of the firm's reversed-out mark, or null for a text wordmark. */
  logoUrl: string | null;
  appUrl: string;
}

/**
 * The firm's name and mark for an email it sends a client, without needing a
 * sending address — what a page needs to preview an email as it will look.
 */
export async function loadEmailBrand(firmId: string): Promise<EmailBrand> {
  const config = await getFirmConfig(firmId);
  const firmName = config.branding.documentName.trim() || config.name.trim();
  const hasMark = (config.branding.logoLightPath || config.branding.logoPath).trim().length > 0;
  return { firmName, logoUrl: hasMark ? `${await firmBaseUrl(firmId)}${brandAssetUrl(firmId, 'logo-light')}` : null };
}

function missingIdentityReason(firmId: string): string {
  return `Firm ${firmId} has no settings.email.fromAddress configured — set it under the firm's email settings before sending.`;
}

async function loadEmailIdentity(firmId: string): Promise<EmailIdentity | null> {
  const config = await getFirmConfig(firmId);
  const address = config.email.fromAddress.trim();
  if (!address) return null;

  const firmName = config.branding.documentName.trim() || config.name.trim();
  const senderName = config.email.fromName.trim() || firmName;
  const appUrl = await firmBaseUrl(firmId);
  const hasMark = (config.branding.logoLightPath || config.branding.logoPath).trim().length > 0;

  return {
    // Quote the display name: firm names carry commas and periods, both of
    // which are RFC 5322 specials that break an unquoted address.
    from: senderName ? `"${senderName.replace(/["\\]/g, '')}" <${address}>` : address,
    firmName,
    logoUrl: hasMark ? `${appUrl}${brandAssetUrl(firmId, 'logo-light')}` : null,
    appUrl,
  };
}

/* ── Client-facing mail ──────────────────────────────────────── */

/** Attachment shape shared with lib/finance/invoice-attachments.ts. */
export interface ClientMailAttachment {
  name: string;
  contentType: string;
  /** base64 */
  contentBytes: string;
}

export interface SendClientMailArgs {
  firmId: string;
  /**
   * The firm's own address this goes out as — its billing box for statements,
   * its IP box for trademark reports. Never defaulted: an invoice sent from
   * another tenant's address is also an invoice *replied to* at that address.
   */
  fromAddress: string;
  /** Display name on the From header. Falls back to the firm's own name. */
  fromName?: string;
  subject: string;
  bodyHtml: string;
  to: { name?: string; address: string }[];
  cc?: { name?: string; address: string }[];
  /** Blind copies — the firm's own mailbox, so what went out lands there too. */
  bcc?: { name?: string; address: string }[];
  replyTo?: { name?: string; address: string }[];
  attachments?: ClientMailAttachment[];
  importance?: 'low' | 'normal' | 'high';
}

/** Raised when a client-facing send could not be attempted or was rejected. */
export class ClientMailError extends Error {}

/**
 * Send a client-facing email — a billing statement, a payment reminder, a
 * trademark report — as the firm, through Resend.
 *
 * This replaces the Microsoft Graph `sendMail` path these routes used to take.
 * The delegation machinery that came with it is gone too: Graph app-only mail
 * cannot use a Microsoft 365 Group as a send principal, so a firm whose
 * `finance@` was a Group had to nominate a real staff mailbox holding Exchange
 * "Send As" rights and send through that. Resend sends from an address on a
 * verified domain, so the address is simply the address.
 *
 * The operational cost moved rather than vanishing: `fromAddress`'s domain has
 * to be verified in the platform's Resend account, or the send is rejected.
 * That is two DNS records for the firm, once — against an Entra app
 * registration and a mailbox delegation before.
 *
 * Throws rather than logging-and-continuing, unlike the notification senders
 * above: every caller reports the outcome to a person who is waiting to know
 * whether their client received it.
 */
export async function sendClientMail(args: SendClientMailArgs): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    throw new ClientMailError('RESEND_API_KEY is not set — the platform cannot send mail.');
  }
  const address = args.fromAddress.trim();
  if (!address) {
    throw new ClientMailError(missingIdentityReason(args.firmId));
  }

  const config = await getFirmConfig(args.firmId);
  const name = (args.fromName ?? config.branding.documentName ?? '').trim() || config.name.trim();
  // Quote the display name: firm names carry commas and periods, both RFC 5322
  // specials that break an unquoted address.
  const from = name ? `"${name.replace(/["\\]/g, '')}" <${address}>` : address;

  const format = (list?: { name?: string; address: string }[]) =>
    list?.length ? list.map((r) => (r.name ? `${r.name} <${r.address}>` : r.address)) : undefined;

  const { error } = await getResend().emails.send({
    from,
    to: format(args.to) ?? [],
    cc: format(args.cc),
    bcc: format(args.bcc),
    replyTo: format(args.replyTo),
    subject: args.subject,
    html: args.bodyHtml,
    attachments: args.attachments?.map((a) => ({
      filename: a.name,
      content: a.contentBytes,
      contentType: a.contentType,
    })),
    headers:
      args.importance === 'high'
        ? { Importance: 'high', 'X-Priority': '1' }
        : args.importance === 'low'
          ? { Importance: 'low', 'X-Priority': '5' }
          : undefined,
  });

  if (error) {
    // Resend's message names the rejected address or domain, which is exactly
    // what the person who pressed Send needs to see.
    throw new ClientMailError(error.message || 'Resend rejected the message.');
  }
}

interface DeadlineItem {
  name: string;
  dueDate: string;
  matterName?: string;
}

interface HearingItem {
  name: string;
  date: string;
  time: string;
  matterName?: string;
}

interface MeetingItem {
  name: string;
  date: string;
  time: string;
  matterName?: string;
}

export interface BrieferData {
  todayDeadlines: DeadlineItem[];
  tomorrowDeadlines: DeadlineItem[];
  todayHearings: HearingItem[];
  tomorrowHearings: HearingItem[];
  todayMeetings: MeetingItem[];
  tomorrowMeetings: MeetingItem[];
  unreadCount: number;
}

function hasContent(data: BrieferData): boolean {
  return (
    data.todayDeadlines.length > 0 ||
    data.tomorrowDeadlines.length > 0 ||
    data.todayHearings.length > 0 ||
    data.tomorrowHearings.length > 0 ||
    data.todayMeetings.length > 0 ||
    data.tomorrowMeetings.length > 0
  );
}

function buildSection(title: string, items: { primary: string; secondary?: string }[]): string {
  if (items.length === 0) return '';
  const rows = items
    .map(
      (item) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#1a1a1a">${item.primary}</td><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#6b7280">${item.secondary || ''}</td></tr>`,
    )
    .join('');
  return `
    <div style="margin-bottom:24px">
      <h3 style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 8px 0">${title}</h3>
      <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        ${rows}
      </table>
    </div>`;
}

/* ── Shared Branded Email Chrome ─────────────────────────────── */

function wrapBrandedEmail({ inner, identity }: { inner: string; identity: EmailIdentity }): string {
  return wrapEmailChrome({ inner, brand: identity });
}

function buildBrieferInner(name: string, data: BrieferData, appUrl: string): string {
  const firstName = name.split(' ')[0];
  const dateStr = new Date().toLocaleDateString('en-PH', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });

  const sections = [
    buildSection(
      "Today's Deadlines",
      data.todayDeadlines.map((d) => ({ primary: d.name, secondary: d.matterName })),
    ),
    buildSection(
      "Tomorrow's Deadlines",
      data.tomorrowDeadlines.map((d) => ({ primary: d.name, secondary: d.matterName })),
    ),
    buildSection(
      "Today's Hearings",
      data.todayHearings.map((h) => ({ primary: `${h.name} — ${h.time}`, secondary: h.matterName })),
    ),
    buildSection(
      "Tomorrow's Hearings",
      data.tomorrowHearings.map((h) => ({ primary: `${h.name} — ${h.time}`, secondary: h.matterName })),
    ),
    buildSection(
      "Today's Meetings",
      data.todayMeetings.map((m) => ({ primary: `${m.name} — ${m.time}`, secondary: m.matterName })),
    ),
    buildSection(
      "Tomorrow's Meetings",
      data.tomorrowMeetings.map((m) => ({ primary: `${m.name} — ${m.time}`, secondary: m.matterName })),
    ),
  ].join('');

  const unreadNote =
    data.unreadCount > 0
      ? `<p style="font-size:13px;color:#6b7280;margin:0 0 24px 0">You have <strong style="color:#1a1a1a">${data.unreadCount}</strong> unread notification${data.unreadCount !== 1 ? 's' : ''}.</p>`
      : '';

  return `
      <div style="margin-bottom:24px">
        <h1 style="font-size:20px;font-weight:700;color:#1a1a1a;margin:0 0 4px 0">Good morning, ${firstName}</h1>
        <p style="font-size:13px;color:#9ca3af;margin:0">${dateStr}</p>
      </div>
      ${unreadNote}
      ${sections}
      <div style="text-align:center;margin-top:32px">
        <a href="${appUrl}/dashboard" style="display:inline-block;padding:12px 28px;background:#1e293b;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;border-radius:8px">Open Dashboard</a>
      </div>`;
}

export async function sendBrieferEmail(
  to: string,
  name: string,
  data: BrieferData,
  firmId: string,
) {
  if (!hasContent(data) && data.unreadCount === 0) return;
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping email');
    return;
  }

  const identity = await loadEmailIdentity(firmId);
  if (!identity) {
    console.error(`[email] ${missingIdentityReason(firmId)}`);
    return;
  }
  const { appUrl } = identity;
  const inner = buildBrieferInner(name, data, appUrl);
  const html = wrapBrandedEmail({ inner, identity });

  const { error } = await getResend().emails.send({
    from: identity.from,
    to,
    subject: `Your morning briefer — ${new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })}`,
    html,
  });

  if (error) {
    console.error(`[email] Failed to send to ${to}:`, error);
  }
}

/* ── Deliverable Transfer Email ─────────────────────────────── */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Per-file and per-email size caps, leaving headroom under Resend's ~40MB message limit
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB per file
const MAX_TOTAL_ATTACHMENT_BYTES = 35 * 1024 * 1024; // ~35MB across all attachments

async function fetchAttachment(
  url: string,
  name: string,
): Promise<{ filename: string; content: Buffer } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[email] Attachment fetch failed (${res.status}): ${name}`);
      return null;
    }
    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength && contentLength > MAX_ATTACHMENT_BYTES) {
      console.warn(`[email] Attachment too large, skipping: ${name} (${contentLength} bytes)`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_ATTACHMENT_BYTES) {
      console.warn(`[email] Attachment too large, skipping: ${name} (${buf.byteLength} bytes)`);
      return null;
    }
    return { filename: name, content: buf };
  } catch (err) {
    console.warn(`[email] Attachment fetch error for ${name}:`, err);
    return null;
  }
}

export async function sendDeliverableTransferEmail({
  to,
  cc,
  firstName,
  deliverableName,
  matterCode,
  matterName,
  performerName,
  status,
  comment,
  files,
  href,
  firmId,
}: {
  to: string;
  cc?: string[];
  firstName: string;
  deliverableName: string;
  matterCode?: string;
  matterName?: string;
  performerName: string;
  status?: string;
  comment?: string;
  files?: { url: string; name: string; size?: number }[];
  href: string;
  firmId: string;
}) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping transfer email');
    return;
  }

  const identity = await loadEmailIdentity(firmId);
  if (!identity) {
    console.error(`[email] ${missingIdentityReason(firmId)}`);
    return;
  }
  const { appUrl } = identity;
  const fullHref = href.startsWith('http') ? href : `${appUrl}${href}`;

  const safeDeliverable = escapeHtml(deliverableName);
  const safeMatterName = matterName ? escapeHtml(matterName) : '';
  const safeMatterCode = matterCode ? escapeHtml(matterCode) : '';
  const safePerformer = escapeHtml(performerName);
  const safeFirst = escapeHtml(firstName);
  const safeStatus = status ? escapeHtml(status) : '';
  const safeComment = comment ? escapeHtml(comment) : '';

  // Try to attach the latest-version files, respecting per-file and total-size caps
  const attachments: { filename: string; content: Buffer }[] = [];
  const skippedFileNames = new Set<string>();
  let totalBytes = 0;
  if (files && files.length > 0) {
    for (const f of files) {
      if (totalBytes >= MAX_TOTAL_ATTACHMENT_BYTES) {
        skippedFileNames.add(f.name);
        continue;
      }
      const attached = await fetchAttachment(f.url, f.name);
      if (!attached) {
        skippedFileNames.add(f.name);
        continue;
      }
      if (totalBytes + attached.content.byteLength > MAX_TOTAL_ATTACHMENT_BYTES) {
        console.warn(
          `[email] Total attachment size would exceed cap, skipping: ${f.name}`,
        );
        skippedFileNames.add(f.name);
        continue;
      }
      attachments.push(attached);
      totalBytes += attached.content.byteLength;
    }
  }

  const matterLine = safeMatterName
    ? `<p style="font-size:13px;color:#6b7280;margin:0 0 12px 0">${safeMatterCode ? `<span style="display:inline-block;padding:2px 8px;background:#f1f5f9;color:#1e293b;border-radius:4px;font-size:11px;font-weight:600;margin-right:8px">${safeMatterCode}</span>` : ''}${safeMatterName}</p>`
    : '';

  const statusLine = safeStatus
    ? `<p style="font-size:13px;color:#6b7280;margin:0">Status: <strong style="color:#1a1a1a">${safeStatus}</strong></p>`
    : '';

  const commentBlock = safeComment
    ? `<div style="background:#ffffff;border:1px solid #e5e7eb;border-left:3px solid #1e293b;border-radius:6px;padding:14px 18px;margin-bottom:20px">
         <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 6px 0">Note from ${safePerformer}</p>
         <p style="font-size:14px;color:#1a1a1a;margin:0;white-space:pre-wrap;line-height:1.5">${safeComment}</p>
       </div>`
    : '';

  const fileBlock = files && files.length > 0
    ? (() => {
        const label = files.length === 1 ? 'Attached file' : `Attached files (${files.length})`;
        const rows = files
          .map((f) => {
            const skipped = skippedFileNames.has(f.name);
            const name = escapeHtml(f.name);
            const note = skipped
              ? ' <span style="font-size:11px;color:#9ca3af">(too large — open in app)</span>'
              : '';
            return `<li style="font-size:14px;color:#1a1a1a;margin:0 0 4px 0;list-style:none"><a href="${fullHref}" style="color:#1e293b;text-decoration:underline">${name}</a>${note}</li>`;
          })
          .join('');
        return `<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:6px;padding:14px 18px;margin-bottom:20px">
         <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 8px 0">${label}</p>
         <ul style="margin:0;padding:0">${rows}</ul>
       </div>`;
      })()
    : '';

  const subjectCodePart = matterCode ? `[${matterCode}] ` : '';
  const subject = `${subjectCodePart}${deliverableName}`;

  const inner = `
      <div style="margin-bottom:20px">
        <h1 style="font-size:20px;font-weight:700;color:#1a1a1a;margin:0 0 6px 0">Hi ${safeFirst},</h1>
        <p style="font-size:14px;color:#374151;margin:0;line-height:1.5"><strong>${safePerformer}</strong> transferred a deliverable to you.</p>
      </div>

      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:18px 22px;margin-bottom:20px">
        <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 6px 0">Deliverable</p>
        <p style="font-size:16px;font-weight:600;color:#1a1a1a;margin:0 0 10px 0;line-height:1.35">${safeDeliverable}</p>
        ${matterLine}
        ${statusLine}
      </div>

      ${commentBlock}
      ${fileBlock}

      <div style="text-align:center;margin-top:28px">
        <a href="${fullHref}" style="display:inline-block;padding:12px 28px;background:#1e293b;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;border-radius:8px">Open Deliverable</a>
      </div>`;

  const html = wrapBrandedEmail({ inner, identity });

  // Dedupe cc against the `to` recipient (and against itself) so no address
  // ever appears twice on the same email.
  const ccDeduped = cc
    ? [...new Set(cc.filter((e) => !!e && e.toLowerCase() !== to.toLowerCase()))]
    : [];

  const { error } = await getResend().emails.send({
    from: identity.from,
    to,
    subject,
    html,
    ...(ccDeduped.length > 0 ? { cc: ccDeduped } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  });

  if (error) {
    console.error(`[email] Failed to send transfer email to ${to}:`, error);
  }
}

/* ── Deliverable Finalized Email ─────────────────────────────── */

export async function sendDeliverableFinalizedEmail({
  to,
  firstName,
  deliverableName,
  matterCode,
  matterName,
  performerName,
  href,
  firmId,
}: {
  to: string;
  firstName: string;
  deliverableName: string;
  matterCode?: string;
  matterName?: string;
  performerName: string;
  href: string;
  firmId: string;
}) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping finalized email');
    return;
  }

  const identity = await loadEmailIdentity(firmId);
  if (!identity) {
    console.error(`[email] ${missingIdentityReason(firmId)}`);
    return;
  }
  const { appUrl } = identity;
  const fullHref = href.startsWith('http') ? href : `${appUrl}${href}`;

  const safeDeliverable = escapeHtml(deliverableName);
  const safeMatterName = matterName ? escapeHtml(matterName) : '';
  const safeMatterCode = matterCode ? escapeHtml(matterCode) : '';
  const safePerformer = escapeHtml(performerName);
  const safeFirst = escapeHtml(firstName);

  const matterLine = safeMatterName
    ? `<p style="font-size:13px;color:#6b7280;margin:0 0 12px 0">${safeMatterCode ? `<span style="display:inline-block;padding:2px 8px;background:#f1f5f9;color:#1e293b;border-radius:4px;font-size:11px;font-weight:600;margin-right:8px">${safeMatterCode}</span>` : ''}${safeMatterName}</p>`
    : '';

  const subjectCodePart = matterCode ? `[${matterCode}] ` : '';
  const subject = `${subjectCodePart}Finalized: ${deliverableName}`;

  const inner = `
      <div style="margin-bottom:20px">
        <h1 style="font-size:20px;font-weight:700;color:#1a1a1a;margin:0 0 6px 0">Hi ${safeFirst},</h1>
        <p style="font-size:14px;color:#374151;margin:0;line-height:1.5"><strong>${safePerformer}</strong> finalized a deliverable you worked on. It's now ready to be sent out.</p>
      </div>

      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:18px 22px;margin-bottom:20px">
        <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 6px 0">Deliverable</p>
        <p style="font-size:16px;font-weight:600;color:#1a1a1a;margin:0 0 10px 0;line-height:1.35">${safeDeliverable}</p>
        ${matterLine}
        <p style="font-size:13px;color:#6b7280;margin:0">Status: <strong style="color:#1a1a1a">Ready to send out</strong></p>
      </div>

      <div style="text-align:center;margin-top:28px">
        <a href="${fullHref}" style="display:inline-block;padding:12px 28px;background:#1e293b;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;border-radius:8px">Open Deliverable</a>
      </div>`;

  const html = wrapBrandedEmail({ inner, identity });

  const { error } = await getResend().emails.send({
    from: identity.from,
    to,
    subject,
    html,
  });

  if (error) {
    console.error(`[email] Failed to send finalized email to ${to}:`, error);
  }
}

/* ── Meeting / Hearing Attendee Invite Email ─────────────────── */

export async function sendAttendeeInviteEmail({
  to,
  firstName,
  kind,
  title,
  startIso,
  endIso,
  type,
  matterCode,
  matterName,
  performerName,
  href,
  firmId,
}: {
  to: string;
  firstName: string;
  kind: 'meeting' | 'hearing';
  title: string;
  startIso?: string | null;
  endIso?: string | null;
  type?: string | null;
  matterCode?: string;
  matterName?: string;
  performerName: string;
  href: string;
  firmId: string;
}) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping attendee invite email');
    return;
  }

  const identity = await loadEmailIdentity(firmId);
  if (!identity) {
    console.error(`[email] ${missingIdentityReason(firmId)}`);
    return;
  }
  const { appUrl } = identity;
  const fullHref = href.startsWith('http') ? href : `${appUrl}${href}`;

  const safeTitle = escapeHtml(title || `Untitled ${kind}`);
  const safeMatterName = matterName ? escapeHtml(matterName) : '';
  const safeMatterCode = matterCode ? escapeHtml(matterCode) : '';
  const safePerformer = escapeHtml(performerName);
  const safeFirst = escapeHtml(firstName);
  const safeType = type ? escapeHtml(type) : '';

  const whenLine = formatManilaSchedule(startIso ?? null, endIso);

  const matterLine = safeMatterName
    ? `<p style="font-size:13px;color:#6b7280;margin:0 0 12px 0">${safeMatterCode ? `<span style="display:inline-block;padding:2px 8px;background:#f1f5f9;color:#1e293b;border-radius:4px;font-size:11px;font-weight:600;margin-right:8px">${safeMatterCode}</span>` : ''}${safeMatterName}</p>`
    : '';

  const whenBlock = whenLine
    ? `<p style="font-size:13px;color:#6b7280;margin:0 0 6px 0">When: <strong style="color:#1a1a1a">${escapeHtml(whenLine)}</strong></p>`
    : '';

  const typeBlock = safeType
    ? `<p style="font-size:13px;color:#6b7280;margin:0">Type: <strong style="color:#1a1a1a">${safeType}</strong></p>`
    : '';

  const kindLabel = kind === 'meeting' ? 'Meeting' : 'Hearing';
  const subjectCodePart = matterCode ? `[${matterCode}] ` : '';
  const subject = `${subjectCodePart}${kindLabel}: ${title || `Untitled ${kind}`}`;
  const cta = kind === 'meeting' ? 'Open Meeting' : 'Open Hearing';

  const inner = `
      <div style="margin-bottom:20px">
        <h1 style="font-size:20px;font-weight:700;color:#1a1a1a;margin:0 0 6px 0">Hi ${safeFirst},</h1>
        <p style="font-size:14px;color:#374151;margin:0;line-height:1.5"><strong>${safePerformer}</strong> added you as an attendee on a ${kind}.</p>
      </div>

      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:18px 22px;margin-bottom:20px">
        <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 6px 0">${kindLabel}</p>
        <p style="font-size:16px;font-weight:600;color:#1a1a1a;margin:0 0 10px 0;line-height:1.35">${safeTitle}</p>
        ${matterLine}
        ${whenBlock}
        ${typeBlock}
      </div>

      <div style="text-align:center;margin-top:28px">
        <a href="${fullHref}" style="display:inline-block;padding:12px 28px;background:#1e293b;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;border-radius:8px">${cta}</a>
      </div>`;

  const html = wrapBrandedEmail({ inner, identity });

  const { error } = await getResend().emails.send({
    from: identity.from,
    to,
    subject,
    html,
  });

  if (error) {
    console.error(`[email] Failed to send ${kind} invite email to ${to}:`, error);
  }
}

/* ── Leave Request / Action Email ─────────────────────────────── */

function formatLeaveDate(d: string | null | undefined): string {
  if (!d) return '';
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

export async function sendLeaveNotificationEmail({
  to,
  recipientName,
  mode,
  applicantName,
  leaveType,
  periodStart,
  periodEnd,
  reason,
  reviewerName,
  status,
  href,
  firmId,
}: {
  to: string;
  recipientName: string;
  mode: 'request' | 'action';
  applicantName: string;
  leaveType: string;
  periodStart: string | null;
  periodEnd?: string | null;
  reason?: string;
  reviewerName?: string;
  status?: 'Approved' | 'Rejected';
  href: string;
  firmId: string;
}) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping leave email');
    return;
  }

  const identity = await loadEmailIdentity(firmId);
  if (!identity) {
    console.error(`[email] ${missingIdentityReason(firmId)}`);
    return;
  }
  const { appUrl } = identity;
  const fullHref = href.startsWith('http') ? href : `${appUrl}${href}`;

  const safeFirst = escapeHtml(recipientName.split(' ')[0] || 'there');
  const safeApplicant = escapeHtml(applicantName || 'A teammate');
  const safeType = escapeHtml(leaveType || 'Leave');
  const safeReason = reason ? escapeHtml(reason) : '';
  const safeReviewer = reviewerName ? escapeHtml(reviewerName) : '';
  const dateRange = (() => {
    const a = formatLeaveDate(periodStart);
    const b = formatLeaveDate(periodEnd ?? null);
    if (a && b && a !== b) return `${a} — ${b}`;
    return a;
  })();

  const isAction = mode === 'action';
  const headline = isAction
    ? `Your leave was ${status === 'Approved' ? 'approved' : 'declined'}`
    : `New leave request from ${safeApplicant}`;
  const intro = isAction
    ? `${safeReviewer || 'A partner'} ${status === 'Approved' ? 'approved' : 'declined'} your ${safeType.toLowerCase()} request.`
    : `${safeApplicant} requested ${safeType.toLowerCase()}.`;
  const cta = isAction ? 'View Leave' : 'Review Request';
  const subjectVerb = isAction
    ? (status === 'Approved' ? 'Approved' : 'Declined')
    : 'New';
  const subject = isAction
    ? `${subjectVerb}: your ${leaveType} request`
    : `${subjectVerb} leave request — ${applicantName}`;

  const reasonBlock = safeReason
    ? `<div style="background:#ffffff;border:1px solid #e5e7eb;border-left:3px solid #1e293b;border-radius:6px;padding:14px 18px;margin-bottom:20px">
         <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 6px 0">Reason</p>
         <p style="font-size:14px;color:#1a1a1a;margin:0;white-space:pre-wrap;line-height:1.5">${safeReason}</p>
       </div>`
    : '';

  const inner = `
      <div style="margin-bottom:20px">
        <h1 style="font-size:20px;font-weight:700;color:#1a1a1a;margin:0 0 6px 0">Hi ${safeFirst},</h1>
        <p style="font-size:14px;color:#374151;margin:0;line-height:1.5">${intro}</p>
      </div>

      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:18px 22px;margin-bottom:20px">
        <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 6px 0">${headline}</p>
        <p style="font-size:16px;font-weight:600;color:#1a1a1a;margin:0 0 10px 0;line-height:1.35">${safeType}${dateRange ? ` &middot; ${dateRange}` : ''}</p>
        ${isAction ? `<p style="font-size:13px;color:#6b7280;margin:0">Status: <strong style="color:#1a1a1a">${status}</strong></p>` : ''}
      </div>

      ${reasonBlock}

      <div style="text-align:center;margin-top:28px">
        <a href="${fullHref}" style="display:inline-block;padding:12px 28px;background:#1e293b;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;border-radius:8px">${cta}</a>
      </div>`;

  const html = wrapBrandedEmail({ inner, identity });

  const { error } = await getResend().emails.send({
    from: identity.from,
    to,
    subject,
    html,
  });

  if (error) {
    console.error(`[email] Failed to send leave email to ${to}:`, error);
  }
}

/* ── Feedback Submission / Response Email ─────────────────────────────── */

export async function sendFeedbackNotificationEmail({
  to,
  recipientName,
  mode,
  subject,
  feedbackType,
  message,
  response,
  reviewerName,
  href,
  firmId,
}: {
  to: string;
  recipientName: string;
  mode: 'submit' | 'response';
  subject: string;
  feedbackType: string;
  message?: string;
  response?: string;
  reviewerName?: string;
  href: string;
  firmId: string;
}) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping feedback email');
    return;
  }

  const identity = await loadEmailIdentity(firmId);
  if (!identity) {
    console.error(`[email] ${missingIdentityReason(firmId)}`);
    return;
  }
  const { appUrl } = identity;
  const fullHref = href.startsWith('http') ? href : `${appUrl}${href}`;

  const safeFirst = escapeHtml(recipientName.split(' ')[0] || 'there');
  const safeSubject = escapeHtml(subject);
  const safeType = escapeHtml(feedbackType || 'General');
  const safeReviewer = reviewerName ? escapeHtml(reviewerName) : '';
  const safeMessage = message ? escapeHtml(message) : '';
  const safeResponse = response ? escapeHtml(response) : '';

  // Submit mode goes to partners and MUST stay anonymous — the submitter's
  // identity is deliberately withheld from the title, intro, and subject.

  const isResponse = mode === 'response';
  const intro = isResponse
    ? `${safeReviewer || 'A partner'} responded to your feedback.`
    : 'New feedback was submitted anonymously.';
  const cta = isResponse ? 'View Feedback' : 'View & Respond';
  const emailSubject = isResponse
    ? `Response to your feedback: ${subject}`
    : `New ${feedbackType.toLowerCase()}: ${subject}`;

  const messageBlock = !isResponse && safeMessage
    ? `<div style="background:#ffffff;border:1px solid #e5e7eb;border-left:3px solid #1e293b;border-radius:6px;padding:14px 18px;margin-bottom:20px">
         <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 6px 0">Message</p>
         <p style="font-size:14px;color:#1a1a1a;margin:0;white-space:pre-wrap;line-height:1.5">${safeMessage}</p>
       </div>`
    : '';

  const responseBlock = isResponse && safeResponse
    ? `<div style="background:#ffffff;border:1px solid #e5e7eb;border-left:3px solid #059669;border-radius:6px;padding:14px 18px;margin-bottom:20px">
         <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 6px 0">Response</p>
         <p style="font-size:14px;color:#1a1a1a;margin:0;white-space:pre-wrap;line-height:1.5">${safeResponse}</p>
       </div>`
    : '';

  const inner = `
      <div style="margin-bottom:20px">
        <h1 style="font-size:20px;font-weight:700;color:#1a1a1a;margin:0 0 6px 0">Hi ${safeFirst},</h1>
        <p style="font-size:14px;color:#374151;margin:0;line-height:1.5">${intro}</p>
      </div>

      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:18px 22px;margin-bottom:20px">
        <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 6px 0">${safeType}</p>
        <p style="font-size:16px;font-weight:600;color:#1a1a1a;margin:0;line-height:1.35">${safeSubject}</p>
      </div>

      ${messageBlock}
      ${responseBlock}

      <div style="text-align:center;margin-top:28px">
        <a href="${fullHref}" style="display:inline-block;padding:12px 28px;background:#1e293b;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;border-radius:8px">${cta}</a>
      </div>`;

  const html = wrapBrandedEmail({ inner, identity });

  const { error } = await getResend().emails.send({
    from: identity.from,
    to,
    subject: emailSubject,
    html,
  });

  if (error) {
    console.error(`[email] Failed to send feedback email to ${to}:`, error);
  }
}

/* ── Client Portal Invite (resend) Email ─────────────────────────── */

export async function sendPortalInviteEmail({
  to,
  name,
  actionLink,
  firmId,
}: {
  to: string;
  name: string;
  actionLink: string;
  firmId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping portal invite email');
    return { ok: false, reason: 'RESEND_API_KEY not configured' };
  }

  const identity = await loadEmailIdentity(firmId);
  if (!identity) {
    const reason = missingIdentityReason(firmId);
    console.error(`[email] ${reason}`);
    return { ok: false, reason };
  }
  const safeEmail = escapeHtml(to);
  const safeName = escapeHtml(name || 'there');
  const portalLabel = identity.firmName ? `the ${identity.firmName} client portal` : 'the client portal';

  const inner = `
      <div style="margin-bottom:20px">
        <h1 style="font-size:20px;font-weight:700;color:#1a1a1a;margin:0 0 6px 0">Hi ${safeName},</h1>
        <p style="font-size:14px;color:#374151;margin:0;line-height:1.5">You've been invited to ${escapeHtml(portalLabel)} — see your matters, deliverables, and status updates anytime.</p>
      </div>

      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:18px 22px;margin-bottom:20px">
        <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 6px 0">Invitation</p>
        <p style="font-size:16px;font-weight:600;color:#1a1a1a;margin:0;line-height:1.35">${safeEmail}</p>
      </div>

      <p style="font-size:13px;color:#6b7280;margin:0 0 24px 0">Accept the invitation below to finish setting up your account.</p>

      <div style="text-align:center;margin-top:28px">
        <a href="${actionLink}" style="display:inline-block;padding:12px 28px;background:#1e293b;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;border-radius:8px">Accept invitation</a>
      </div>

      <p style="font-size:12px;color:#9ca3af;margin:28px 0 0 0;line-height:1.5">If the button doesn't work, paste this URL into your browser:<br /><a href="${actionLink}" style="color:#1e293b;text-decoration:underline;word-break:break-all">${escapeHtml(actionLink)}</a></p>`;

  const html = wrapBrandedEmail({ inner, identity });

  const { error } = await getResend().emails.send({
    from: identity.from,
    to,
    subject: `You've been invited to ${portalLabel}`,
    html,
  });

  if (error) {
    console.error(`[email] Failed to send portal invite to ${to}:`, error);
    return { ok: false, reason: error.message ?? 'Email send failed' };
  }
  return { ok: true };
}

/* ── File Request Email (team → client) ──────────────────────────── */

export async function sendFileRequestEmail({
  to,
  clientName,
  matterName,
  matterCode,
  requesterName,
  description,
  dueAt,
  portalLink,
  firmId,
}: {
  to: string;
  clientName: string;
  matterName: string;
  matterCode?: string | null;
  requesterName: string;
  description: string;
  dueAt?: string | null;
  portalLink: string;
  firmId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping file request email');
    return { ok: false, reason: 'RESEND_API_KEY not configured' };
  }

  const identity = await loadEmailIdentity(firmId);
  if (!identity) {
    const reason = missingIdentityReason(firmId);
    console.error(`[email] ${reason}`);
    return { ok: false, reason };
  }
  const safeName = escapeHtml(clientName || 'there');
  const safeMatterName = escapeHtml(matterName);
  const safeMatterCode = matterCode ? escapeHtml(matterCode) : '';
  const safeRequester = escapeHtml(requesterName);
  const safeDescription = escapeHtml(description);
  const dueLine = dueAt
    ? `<p style="font-size:13px;color:#374151;margin:6px 0 0 0">Needed by <strong style="color:#1a1a1a">${escapeHtml(
        new Date(dueAt).toLocaleDateString('en-PH', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: 'Asia/Manila',
        }),
      )}</strong></p>`
    : '';

  const inner = `
      <div style="margin-bottom:20px">
        <h1 style="font-size:20px;font-weight:700;color:#1a1a1a;margin:0 0 6px 0">Hi ${safeName},</h1>
        <p style="font-size:14px;color:#374151;margin:0;line-height:1.5">${safeRequester} from your legal team has requested some documents for your matter.</p>
      </div>

      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:18px 22px;margin-bottom:20px">
        <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 6px 0">${safeMatterCode ? safeMatterCode + ' &middot; ' : ''}${safeMatterName}</p>
        <p style="font-size:15px;color:#1a1a1a;margin:0;line-height:1.45;white-space:pre-wrap">${safeDescription}</p>
        ${dueLine}
      </div>

      <p style="font-size:13px;color:#6b7280;margin:0 0 24px 0">Open the portal to send the files directly &mdash; everything stays attached to your matter.</p>

      <div style="text-align:center;margin-top:28px">
        <a href="${portalLink}" style="display:inline-block;padding:12px 28px;background:#1e293b;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;border-radius:8px">Open in portal</a>
      </div>

      <p style="font-size:12px;color:#9ca3af;margin:28px 0 0 0;line-height:1.5">If the button doesn't work, paste this URL into your browser:<br /><a href="${portalLink}" style="color:#1e293b;text-decoration:underline;word-break:break-all">${escapeHtml(portalLink)}</a></p>`;

  const html = wrapBrandedEmail({ inner, identity });

  const subject = `Action requested${matterCode ? ` on ${matterCode}` : ''}: ${matterName}`;
  const { error } = await getResend().emails.send({
    from: identity.from,
    to,
    subject,
    html,
  });

  if (error) {
    console.error(`[email] Failed to send file request email to ${to}:`, error);
    return { ok: false, reason: error.message ?? 'Email send failed' };
  }
  return { ok: true };
}
