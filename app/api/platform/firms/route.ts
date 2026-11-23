import { NextResponse, type NextRequest } from 'next/server';
import { requireOperator } from '@/lib/platform/auth';
import { listFirmsForOperator, provisionFirmForOperator } from '@/lib/platform/firms';
import { parseProvisionConfig, ProvisionConfigError } from '@/lib/provisioning/config';
import { ProvisionError } from '@/lib/provisioning/provision';
import { logOperatorAudit, getClientIP } from '@/lib/audit';

/**
 * The cross-tenant firms list, and the front door for creating one.
 *
 * Guarded twice — `proxy.ts` redirects a non-operator before this runs, and
 * `requireOperator()` refuses one that reaches the handler anyway. There is no
 * RLS gate below (the reads are service-role by necessity), so the guard is
 * the boundary rather than a convenience.
 */
export async function GET() {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  // Not audited, for the reason spelled out in app/platform/page.tsx: the
  // roster is a platform-level fact, and a row per firm on every poll of a
  // list drowns each tenant's log in noise. Opening a firm is the act that
  // reads its configuration, and that is what /platform/firms/[id] records.
  return NextResponse.json({ firms: await listFirmsForOperator() });
}

/**
 * POST — create a firm.
 *
 * The body is the provisioning config, the same shape
 * `scripts/provision-firm.ts` reads from a JSON file, parsed by the same
 * `parseProvisionConfig`. The work is `provisionFirmForOperator`, which is
 * `provisionFirm` — so this route validates the slug and invoice prefix
 * against the database's own CHECK regexes, refuses a domain another firm has
 * claimed, and writes the deliberately-incomplete invoice row and the
 * all-disabled integrations, because that function does. Nothing about "what a
 * valid firm is" is decided here.
 *
 * The first admin's password is returned once and never stored anywhere this
 * surface can read back.
 */
export async function POST(req: NextRequest) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { operator } = guard;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const body = (raw ?? {}) as Record<string, unknown>;
  const adminPassword =
    typeof body.adminPassword === 'string' && body.adminPassword.trim()
      ? body.adminPassword
      : undefined;
  delete body.adminPassword;

  try {
    const config = parseProvisionConfig(body);
    const result = await provisionFirmForOperator(config, adminPassword);

    // Into the new firm's own log: the tenant should be able to see that the
    // platform operator created it, and when.
    logOperatorAudit({
      firmId: result.firmId,
      entityType: 'Firm',
      entityId: result.firmId,
      entityName: config.name,
      action: 'created',
      newValue: `slug ${config.slug}, host ${config.primaryDomain}, invoices ${config.invoicePrefix}`,
      operator,
      ipAddress: getClientIP(req),
    });

    return NextResponse.json({
      firmId: result.firmId,
      slug: config.slug,
      steps: result.steps,
      admin: { email: result.admin.email, password: result.admin.password },
    });
  } catch (err) {
    if (err instanceof ProvisionConfigError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof ProvisionError) {
      // A refusal the operator can act on — a claimed domain, a slug the
      // database will not take — not a server fault.
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
