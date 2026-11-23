import { NextResponse, type NextRequest } from 'next/server';
import { requireOperator } from '@/lib/platform/auth';
import { findFirmForOperator } from '@/lib/platform/firms';
import { readInvoiceSettings, saveInvoiceSettings } from '@/lib/platform/firm-detail';
import { validateBody, firmInvoiceSettingsSchema } from '@/lib/validation';
import { logOperatorAudit, getClientIP } from '@/lib/audit';

/**
 * The firm's `firm_invoice_settings` row.
 *
 * The same schema and the same upsert the firm's own finance surface uses, so
 * the two agree on what a valid row is; the difference is only who is allowed
 * to write it. "Incomplete" stays `missingInvoiceSettings()` — the rule
 * `getFirmInvoiceSettings` already throws on — so the operator sees exactly the
 * fields that will stop an invoice, not a second opinion about them.
 *
 * `updated_by` records the operator's email rather than a `team.person_id`: an
 * operator has no person_id, and borrowing that namespace would make this row
 * look like a staff member's edit.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const firm = await findFirmForOperator(id);
  if (!firm) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ invoice: await readInvoiceSettings(firm.id) });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { operator } = guard;

  const { id } = await params;
  const firm = await findFirmForOperator(id);
  if (!firm) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const validation = await validateBody(req, firmInvoiceSettingsSchema);
  if (!validation.success) return validation.response;

  const before = await readInvoiceSettings(firm.id);
  const invoice = await saveInvoiceSettings(firm.id, validation.data, operator.email);

  logOperatorAudit({
    firmId: firm.id,
    entityType: 'FirmInvoiceSettings',
    entityId: firm.id,
    entityName: firm.name,
    action: before.present ? 'updated' : 'created',
    fieldChanged: 'firm_invoice_settings',
    oldValue: `prefix ${before.settings.invoicePrefix || '(unset)'}; missing: ${
      before.missing.join(', ') || 'none'
    }`,
    newValue: `prefix ${invoice.settings.invoicePrefix}; missing: ${
      invoice.missing.join(', ') || 'none'
    }`,
    operator,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ invoice });
}
