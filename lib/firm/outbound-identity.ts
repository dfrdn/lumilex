/**
 * The firm's client-facing sending identity: billing statements out of the
 * finance box, trademark reports out of the IP box, company reports out of
 * the compliance box. Both now go through
 * `sendClientMail` in `lib/email.ts`, which sends them on Resend as this
 * address; the contract is unchanged from the Graph-delegated path it replaced
 * — the address is the firm's own or the send is refused. The old constants
 * (`finance@…`, `ip@…`) meant every tenant's invoices were sent from, and
 * replied to, one firm's inbox.
 *
 * `firmName` is the value the `{{firmName}}` placeholder resolves to in the
 * editable email templates, and the name in the sign-off of the built-in ones.
 * The templates carry the placeholder, not a name — a firm that renames itself
 * should not have to re-edit four templates.
 */

import { getFirmConfig } from '@/lib/firm/config';

export interface OutboundIdentity {
  /** Display name for `{{firmName}}` and sign-offs. Blank when unconfigured. */
  firmName: string;
  /** Billing mailbox. Blank when unconfigured — callers must refuse to send. */
  financeAddress: string;
  /** Trademark/IP mailbox. Blank when unconfigured. */
  ipAddress: string;
  /** Corporate/compliance mailbox, for reports on a client's companies. Blank when unconfigured. */
  complianceAddress: string;
}

export async function loadOutboundIdentity(firmId: string): Promise<OutboundIdentity> {
  const config = await getFirmConfig(firmId);
  return {
    firmName: config.branding.documentName.trim() || config.name.trim(),
    financeAddress: config.email.financeAddress.trim(),
    ipAddress: config.email.ipAddress.trim(),
    complianceAddress: config.email.complianceAddress.trim(),
  };
}

/** The error a route returns when the mailbox it needs has not been set. */
export function mailboxNotConfigured(setting: string): string {
  return `This firm has no ${setting} configured — set it in the firm's email settings before sending.`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The closing block of a client-facing email. A firm with no configured name
 * gets the department line alone — an unsigned letter, rather than one signed by
 * somebody else.
 */
export function signOff(firmName: string, department: string): string {
  const nameLine = firmName ? `<strong>${escapeHtml(firmName)}</strong><br/>` : '';
  return `<p>Best regards,<br/>${nameLine}${department}</p>`;
}
