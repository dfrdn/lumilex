import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getRelationshipPartnersForClients,
  clientRefKey,
  type ClientRef,
} from '@/lib/auth/relationship-partner';

export type PartnerCcKind = 'relationship_partner' | 'managing_partner';

export interface PartnerCcRecipient {
  kind: PartnerCcKind;
  personId: string;
  name: string | null;
  email: string;
}

export interface InvoiceCcTarget extends ClientRef {
  id: number;
}

export interface PartnerCcOptions {
  relationshipPartner: boolean;
  managingPartner: boolean;
}

export interface PartnerCcNote {
  kind: PartnerCcKind;
  message: string;
}

export interface PartnerCcResult {
  /** Invoice id → the partners to copy on that invoice's email. */
  byInvoice: Map<number, PartnerCcRecipient[]>;
  /**
   * Invoice id → why a requested copy could not be added. A missing partner
   * never blocks the send; finance sees the reason instead of silently
   * emailing one person fewer than they asked for.
   */
  notes: Map<number, PartnerCcNote[]>;
}

interface TeamRow {
  person_id: string;
  name: string | null;
  email: string | null;
  active: boolean | null;
}

/** The subset of a person's record this module needs to address an email. */
type Addressable = Pick<TeamRow, 'name' | 'email' | 'active'>;

const MANAGING_PARTNER_POSITION = 'Managing Partner';

/**
 * Describe a team row as a CC recipient, or explain why it can't be one.
 *
 * Inactive members are excluded deliberately: a partner who has left the firm
 * still holds `clients.relationship_partner_id` until someone reassigns it, and
 * mailing a deactivated address puts a client's bill somewhere nobody reads.
 */
function toRecipient(
  kind: PartnerCcKind,
  personId: string,
  row: Addressable | undefined,
  label: string,
): { recipient?: PartnerCcRecipient; note?: string } {
  if (!row) return { note: `The ${label} is not on the team list.` };
  const who = row.name ?? 'They';
  if (row.active !== true) return { note: `${who} (${label}) is no longer active.` };
  if (!row.email) return { note: `${who} (${label}) has no email address on file.` };
  return { recipient: { kind, personId, name: row.name, email: row.email } };
}

/**
 * Resolve the partners finance asked to copy on a batch of invoice emails.
 *
 * The relationship partner is per-client (`clients.relationship_partner_id`,
 * a `team.person_id`); the managing partner is the firm-wide holder of that
 * office. Both are looked up service-role — `clients` RLS doesn't grant finance
 * a read of every client row, and these are addressing lookups rather than
 * user-facing data.
 */
export async function resolvePartnerCc(
  supabase: SupabaseClient,
  firmId: string,
  invoices: InvoiceCcTarget[],
  options: PartnerCcOptions,
): Promise<PartnerCcResult> {
  const byInvoice = new Map<number, PartnerCcRecipient[]>();
  const notes = new Map<number, PartnerCcNote[]>();
  for (const inv of invoices) {
    byInvoice.set(inv.id, []);
    notes.set(inv.id, []);
  }

  if (invoices.length === 0 || (!options.relationshipPartner && !options.managingPartner)) {
    return { byInvoice, notes };
  }

  // Managing partner: one lookup for the whole batch.
  let mpRecipients: PartnerCcRecipient[] = [];
  let mpNote: string | null = null;

  if (options.managingPartner) {
    const { data: mpRows } = await supabase
      .from('team')
      .select('person_id, name, email, active')
      .eq('position', MANAGING_PARTNER_POSITION);

    const rows = (mpRows ?? []) as TeamRow[];
    if (rows.length === 0) {
      mpNote = 'No one on the team holds the Managing Partner position.';
    } else {
      const resolved = rows.map((row) =>
        toRecipient('managing_partner', row.person_id, row, 'managing partner')
      );
      mpRecipients = resolved.flatMap((r) => (r.recipient ? [r.recipient] : []));
      if (mpRecipients.length === 0) mpNote = resolved.find((r) => r.note)?.note ?? null;
    }
  }

  // Relationship partner: resolve each client once, then fan back out to invoices.
  const rpByClientKey = new Map<string, { recipient?: PartnerCcRecipient; note?: string }>();

  if (options.relationshipPartner) {
    const partners = await getRelationshipPartnersForClients(invoices, firmId);

    for (const inv of invoices) {
      const key = clientRefKey(inv);
      if (rpByClientKey.has(key)) continue;
      const rp = partners.get(key) ?? null;
      rpByClientKey.set(
        key,
        rp
          ? toRecipient('relationship_partner', rp.id, rp, 'relationship partner')
          : { note: `${inv.client_name} has no relationship partner assigned.` }
      );
    }
  }

  for (const inv of invoices) {
    const recipients = byInvoice.get(inv.id)!;
    const invNotes = notes.get(inv.id)!;

    if (options.relationshipPartner) {
      const rp = rpByClientKey.get(clientRefKey(inv));
      if (rp?.recipient) recipients.push(rp.recipient);
      else if (rp?.note) invNotes.push({ kind: 'relationship_partner', message: rp.note });
    }

    if (options.managingPartner) {
      recipients.push(...mpRecipients);
      if (mpNote) invNotes.push({ kind: 'managing_partner', message: mpNote });
    }
  }

  return { byInvoice, notes };
}

/**
 * Merge partner copies into the invoice's own CC list, dropping duplicates and
 * the client's own address. The managing partner is frequently also the
 * relationship partner, and either may already sit in `billing_settings.ccEmails`
 * — without this the same person is copied two or three times on one email.
 */
export function mergeCcAddresses(
  existing: { address: string }[],
  partners: PartnerCcRecipient[],
  toAddress: string,
): { address: string }[] {
  const seen = new Set<string>([toAddress.trim().toLowerCase()]);
  const merged: { address: string }[] = [];

  for (const address of [...existing.map((e) => e.address), ...partners.map((p) => p.email)]) {
    const key = address.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push({ address: address.trim() });
  }

  return merged;
}
