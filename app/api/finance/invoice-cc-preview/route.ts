import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { resolvePartnerCc, type PartnerCcRecipient } from '@/lib/finance/invoice-cc';

interface ClientPreview {
  clientName: string;
  invoiceCount: number;
  relationshipPartner: { name: string | null; email: string } | null;
  note: string | null;
}

/**
 * POST /api/finance/invoice-cc-preview
 *
 * Who would be copied if finance ticked "relationship partner" / "managing
 * partner" on this set of invoices. Resolves both regardless of which is
 * ticked, so the send modal can render either toggle without a refetch.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  if (!['admin', 'super_user', 'finance'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { invoiceIds } = await req.json();
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    return NextResponse.json({ error: 'invoiceIds required' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, client_id, client_name')
    .in('id', invoiceIds);

  if (!invoices || invoices.length === 0) {
    return NextResponse.json({ error: 'No invoices found' }, { status: 404 });
  }

  const rows = invoices as { id: number; client_id: string | null; client_name: string }[];
  const { byInvoice, notes } = await resolvePartnerCc(supabase, session.firmId, rows, {
    relationshipPartner: true,
    managingPartner: true,
  });

  const describe = (r: PartnerCcRecipient) => ({ name: r.name, email: r.email });

  // The managing partner is the same for every invoice — read it off the first.
  const allRecipients = [...byInvoice.values()].flat();
  const managingPartner = allRecipients.find((r) => r.kind === 'managing_partner');
  const allNotes = [...notes.values()].flat();
  const managingPartnerNote = allNotes.find((n) => n.kind === 'managing_partner')?.message ?? null;

  const byClient = new Map<string, ClientPreview>();
  for (const inv of rows) {
    const existing = byClient.get(inv.client_name);
    if (existing) {
      existing.invoiceCount += 1;
      continue;
    }
    const rp = (byInvoice.get(inv.id) ?? []).find((r) => r.kind === 'relationship_partner');
    const rpNote = (notes.get(inv.id) ?? []).find((n) => n.kind === 'relationship_partner')?.message ?? null;
    byClient.set(inv.client_name, {
      clientName: inv.client_name,
      invoiceCount: 1,
      relationshipPartner: rp ? describe(rp) : null,
      note: rp ? null : rpNote,
    });
  }

  return NextResponse.json({
    managingPartner: managingPartner ? describe(managingPartner) : null,
    managingPartnerNote: managingPartner ? null : managingPartnerNote,
    clients: [...byClient.values()],
  });
}
