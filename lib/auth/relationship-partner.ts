import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

export interface RelationshipPartner {
  id: string;
  name: string | null;
  /** `team.active`. An inactive partner can't sign in, so they can't clear. */
  active: boolean;
}

/**
 * The partner who owns the client relationship (clients.relationship_partner_id,
 * a team.person_id). Assigned on the partner Client Management page. `null` means
 * the client has no relationship partner at all.
 *
 * The row is returned even when the partner is inactive so callers can tell
 * "nobody assigned" apart from "assigned to someone who has left" — the second
 * needs a different message, but both block billing.
 *
 * Service-role: `clients` RLS doesn't grant finance a read of every client row,
 * and this is an authorization lookup, not user-facing data. It is still firm
 * scoped — a client name only identifies a client within one firm, and this
 * answer gates who may sign off on that client's bill.
 */
export async function getRelationshipPartner(
  clientName: string,
  firmId: string,
): Promise<RelationshipPartner | null> {
  const supabase = getServiceDbForFirm(firmId);
  const { data: client } = await supabase
    .from('clients')
    .select('relationship_partner_id')
    .eq('name', clientName)
    .maybeSingle();

  return describePartner(client?.relationship_partner_id ?? null, firmId);
}

/**
 * The relationship partner of the client a matter belongs to. Resolves the
 * client by `matters.client_id` first and falls back to `matters.client_name`,
 * since older matter rows carry only the denormalized name.
 */
export async function getRelationshipPartnerForMatter(
  matterId: string,
  firmId: string,
): Promise<RelationshipPartner | null> {
  const supabase = getServiceDbForFirm(firmId);
  const { data: matter } = await supabase
    .from('matters')
    .select('client_id, client_name')
    .eq('notion_id', matterId)
    .maybeSingle();
  if (!matter) return null;

  let partnerId: string | null = null;

  if (matter.client_id) {
    const { data } = await supabase
      .from('clients')
      .select('relationship_partner_id')
      .eq('notion_id', matter.client_id)
      .maybeSingle();
    partnerId = data?.relationship_partner_id ?? null;
  }

  if (!partnerId && matter.client_name) {
    const { data } = await supabase
      .from('clients')
      .select('relationship_partner_id')
      .eq('name', matter.client_name)
      .maybeSingle();
    partnerId = data?.relationship_partner_id ?? null;
  }

  return describePartner(partnerId, firmId);
}

/** A client as referenced from a row that carries both keys (e.g. `invoices`). */
export interface ClientRef {
  client_id?: string | null;
  client_name: string;
}

export interface RelationshipPartnerDetail extends RelationshipPartner {
  email: string | null;
}

/** Stable key for a client reference — the id when the row has one, else the name. */
export function clientRefKey(ref: ClientRef): string {
  return ref.client_id ? `id:${ref.client_id}` : `name:${ref.client_name}`;
}

/**
 * Relationship partners for many clients at once, keyed by `clientRefKey`.
 * A key maps to `null` when that client has no relationship partner assigned.
 *
 * Resolves by `client_id` first and falls back to the denormalized
 * `client_name`, since older rows carry only the name. Inactive partners are
 * returned rather than dropped — a list wants to show "assigned to someone who
 * has left" differently from "nobody assigned".
 */
export async function getRelationshipPartnersForClients(
  refs: ClientRef[],
  firmId: string,
): Promise<Map<string, RelationshipPartnerDetail | null>> {
  const result = new Map<string, RelationshipPartnerDetail | null>();
  if (refs.length === 0) return result;

  const supabase = getServiceDbForFirm(firmId);
  const clientIds = [...new Set(refs.map((r) => r.client_id).filter((v): v is string => !!v))];
  const clientNames = [...new Set(refs.map((r) => r.client_name).filter(Boolean))];

  const partnerIdById = new Map<string, string | null>();
  const partnerIdByName = new Map<string, string | null>();

  if (clientIds.length > 0) {
    const { data } = await supabase
      .from('clients')
      .select('notion_id, relationship_partner_id')
      .in('notion_id', clientIds);
    for (const c of (data ?? []) as { notion_id: string; relationship_partner_id: string | null }[]) {
      partnerIdById.set(c.notion_id, c.relationship_partner_id);
    }
  }

  if (clientNames.length > 0) {
    const { data } = await supabase
      .from('clients')
      .select('name, relationship_partner_id')
      .in('name', clientNames);
    for (const c of (data ?? []) as { name: string; relationship_partner_id: string | null }[]) {
      partnerIdByName.set(c.name, c.relationship_partner_id);
    }
  }

  const partnerIdFor = (ref: ClientRef): string | null =>
    (ref.client_id ? partnerIdById.get(ref.client_id) ?? null : null) ??
    partnerIdByName.get(ref.client_name) ??
    null;

  const partnerIds = [...new Set(refs.map(partnerIdFor).filter((v): v is string => !!v))];

  const teamById = new Map<string, { name: string | null; email: string | null; active: boolean | null }>();
  if (partnerIds.length > 0) {
    const { data } = await supabase
      .from('team')
      .select('person_id, name, email, active')
      .in('person_id', partnerIds);
    for (const row of (data ?? []) as {
      person_id: string; name: string | null; email: string | null; active: boolean | null;
    }[]) {
      teamById.set(row.person_id, { name: row.name, email: row.email, active: row.active });
    }
  }

  for (const ref of refs) {
    const key = clientRefKey(ref);
    if (result.has(key)) continue;
    const id = partnerIdFor(ref);
    if (!id) {
      result.set(key, null);
      continue;
    }
    const member = teamById.get(id);
    result.set(key, {
      id,
      name: member?.name ?? null,
      email: member?.email || null,
      active: member?.active === true,
    });
  }

  return result;
}

async function describePartner(id: string | null, firmId: string): Promise<RelationshipPartner | null> {
  if (!id) return null;

  const { data: member } = await getServiceDbForFirm(firmId)
    .from('team')
    .select('name, active')
    .eq('person_id', id)
    .maybeSingle();

  return { id, name: member?.name ?? null, active: member?.active === true };
}

/**
 * The relationship partner's id only when they can actually act on it. Returns
 * null for both "unassigned" and "assigned to an inactive member" — the gates
 * treat those the same, because in both cases no one is able to clear.
 */
export async function getActiveRelationshipPartnerId(
  clientName: string,
  firmId: string,
): Promise<string | null> {
  const rp = await getRelationshipPartner(clientName, firmId);
  return rp?.active ? rp.id : null;
}

/**
 * Whether `personId` may clear this client's billing bundle. Only the assigned,
 * still-active relationship partner can — being the managing partner is not
 * sufficient, because MP approval and RP clearance are deliberately two distinct
 * signatures.
 *
 * super_user does NOT bypass. Clearance records a named partner's sign-off on a
 * client's bill; a stand-in would forge it. When the assigned partner is
 * unavailable, the fix is to reassign `relationship_partner_id` in Client
 * Management — that's a visible, audited change of who owns the relationship.
 * (Forcing an invoice out in a genuine emergency is still possible: the
 * generation gate in `lib/finance/bundle-gate` is a state check, not an identity
 * one, and keeps its super_user bypass.)
 */
export async function canClearBundle(
  personId: string | null | undefined,
  clientName: string,
  firmId: string,
): Promise<boolean> {
  if (!personId) return false;
  const rp = await getRelationshipPartner(clientName, firmId);
  return !!rp && rp.active && rp.id === personId;
}
