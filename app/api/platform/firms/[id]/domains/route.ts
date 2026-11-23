import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireOperator } from '@/lib/platform/auth';
import {
  findFirmForOperator,
  listFirmDomains,
  addFirmDomain,
  removeFirmDomain,
  setPrimaryFirmDomain,
} from '@/lib/platform/firms';
import { ProvisionError } from '@/lib/provisioning/provision';
import { validateBody } from '@/lib/validation';
import { logOperatorAudit, getClientIP } from '@/lib/audit';

/**
 * `firm_domains` for one firm: list, add, promote to primary, remove.
 *
 * A host resolves to a firm *before* anyone authenticates, so adding one goes
 * through the provisioning path's own `assertDomainUnclaimed` — re-pointing a
 * host another firm has claimed would serve that firm's branding and its
 * sign-in page under this firm's name, and no amount of operator intent makes
 * that a safe thing for a form to do silently.
 */
const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .refine((v) => !v.includes('/') && !v.includes('@'), 'Give a bare hostname — no scheme, path, or @')
  .refine((v) => /^[a-z0-9.-]+$/.test(v), 'A hostname may only contain letters, digits, dots, and hyphens');

const addSchema = z.object({ domain: hostname });
const primarySchema = z.object({ domain: hostname });
const removeSchema = z.object({ domain: hostname });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const firm = await findFirmForOperator(id);
  if (!firm) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ domains: await listFirmDomains(firm.id) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { operator } = guard;

  const { id } = await params;
  const firm = await findFirmForOperator(id);
  if (!firm) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const validation = await validateBody(req, addSchema);
  if (!validation.success) return validation.response;

  try {
    const added = await addFirmDomain(firm.id, validation.data.domain);
    logOperatorAudit({
      firmId: firm.id,
      entityType: 'FirmDomain',
      entityId: added.domain,
      entityName: firm.name,
      action: 'created',
      fieldChanged: 'domain',
      newValue: `${added.domain}${added.isPrimary ? ' (primary)' : ''}`,
      operator,
      ipAddress: getClientIP(req),
    });
    return NextResponse.json({ domains: await listFirmDomains(firm.id) });
  } catch (err) {
    if (err instanceof ProvisionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { operator } = guard;

  const { id } = await params;
  const firm = await findFirmForOperator(id);
  if (!firm) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const validation = await validateBody(req, primarySchema);
  if (!validation.success) return validation.response;

  const before = await listFirmDomains(firm.id);

  try {
    await setPrimaryFirmDomain(firm.id, validation.data.domain);
    logOperatorAudit({
      firmId: firm.id,
      entityType: 'FirmDomain',
      entityId: validation.data.domain,
      entityName: firm.name,
      action: 'updated',
      fieldChanged: 'is_primary',
      oldValue: before.find((d) => d.isPrimary)?.domain ?? '(none)',
      newValue: validation.data.domain,
      operator,
      ipAddress: getClientIP(req),
    });
    return NextResponse.json({ domains: await listFirmDomains(firm.id) });
  } catch (err) {
    if (err instanceof ProvisionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { operator } = guard;

  const { id } = await params;
  const firm = await findFirmForOperator(id);
  if (!firm) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const validation = await validateBody(req, removeSchema);
  if (!validation.success) return validation.response;

  try {
    await removeFirmDomain(firm.id, validation.data.domain);
    logOperatorAudit({
      firmId: firm.id,
      entityType: 'FirmDomain',
      entityId: validation.data.domain,
      entityName: firm.name,
      action: 'deleted',
      fieldChanged: 'domain',
      oldValue: validation.data.domain,
      operator,
      ipAddress: getClientIP(req),
    });
    return NextResponse.json({ domains: await listFirmDomains(firm.id) });
  } catch (err) {
    if (err instanceof ProvisionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
