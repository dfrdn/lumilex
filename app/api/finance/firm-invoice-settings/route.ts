import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { validateBody, firmInvoiceSettingsSchema } from '@/lib/validation';
import { findFirmInvoiceSettings, EMPTY_FIRM_INVOICE_SETTINGS } from '@/lib/billing/firm-defaults';
import { logAudit, getClientIP } from '@/lib/audit';

const ALLOWED_ROLES = ['admin', 'super_user', 'finance'];

/**
 * GET /api/finance/firm-invoice-settings
 * Returns the firm's invoice letterhead settings (address, VAT TIN, bank,
 * signer, numbering prefix); blank fields when nothing is configured yet.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role ?? 'lawyer';
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const settings = (await findFirmInvoiceSettings(session.firmId)) ?? EMPTY_FIRM_INVOICE_SETTINGS;
  return NextResponse.json({ settings });
}

/**
 * PUT /api/finance/firm-invoice-settings
 * Upserts the firm's invoice settings row.
 */
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role ?? 'lawyer';
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const validation = await validateBody(req, firmInvoiceSettingsSchema);
  if (!validation.success) return validation.response;
  const v = validation.data;

  const supabase = getServiceDbForFirm(session.firmId);
  const { error } = await supabase
    .from('firm_invoice_settings')
    .upsert(
      {
        firm_address: v.firmAddress,
        firm_address2: v.firmAddress2,
        firm_tin: v.firmTIN,
        bank_name: v.bankName,
        bank_account_no: v.bankAccountNo,
        bank_account_name: v.bankAccountName,
        signer_name: v.signerName,
        invoice_prefix: v.invoicePrefix,
        updated_by: session.user.email ?? session.user.notionUserId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'firm_id' },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'FirmInvoiceSettings',
    entityId: session.firmId,
    action: 'updated',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  const settings = (await findFirmInvoiceSettings(session.firmId)) ?? EMPTY_FIRM_INVOICE_SETTINGS;
  return NextResponse.json({ settings });
}
