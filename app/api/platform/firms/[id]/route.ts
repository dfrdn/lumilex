import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireOperator } from '@/lib/platform/auth';
import {
  findFirmForOperator,
  updateFirmIdentity,
  updateFirmBranding,
  updateFirmEmailIdentity,
  updateFirmDocumentRoots,
  setFirmStatus,
} from '@/lib/platform/firms';
import { brandingSchema, emailSchema, documentsSchema } from '@/lib/firm/config';
import { ProvisionError } from '@/lib/provisioning/provision';
import { validateBody } from '@/lib/validation';
import { logOperatorAudit, getClientIP } from '@/lib/audit';

/**
 * Per-firm editing: identity, branding, email identity, document roots, status.
 *
 * One route with a `section` discriminator rather than five, because the
 * differences are the payload and the audit line, not the authorization or the
 * lookup. Every section validates through the schema `lib/firm/config.ts`
 * parses the column with — that module is the single source of shape truth for
 * `firms.branding` and `firms.settings`, and an editor with its own idea of the
 * shape would write fields the loader reads back as defaults.
 */
const bodySchema = z.discriminatedUnion('section', [
  z.object({
    section: z.literal('identity'),
    name: z.string().trim().min(1).max(200),
    shortName: z.string().trim().min(1).max(40),
  }),
  z.object({ section: z.literal('branding'), branding: brandingSchema.partial() }),
  z.object({ section: z.literal('email'), email: emailSchema }),
  z.object({ section: z.literal('documents'), documents: documentsSchema }),
  z.object({ section: z.literal('status'), status: z.enum(['active', 'suspended']) }),
]);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const firm = await findFirmForOperator(id);
  if (!firm) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ firm });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { operator } = guard;

  const { id } = await params;
  const firm = await findFirmForOperator(id);
  if (!firm) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const validation = await validateBody(req, bodySchema);
  if (!validation.success) return validation.response;
  const body = validation.data;

  const audit = (fieldChanged: string, oldValue: string, newValue: string) =>
    logOperatorAudit({
      firmId: firm.id,
      entityType: 'Firm',
      entityId: firm.id,
      entityName: firm.name,
      action: 'updated',
      fieldChanged,
      oldValue,
      newValue,
      operator,
      ipAddress: getClientIP(req),
    });

  try {
    switch (body.section) {
      case 'identity': {
        await updateFirmIdentity(firm.id, { name: body.name, shortName: body.shortName });
        audit(
          'identity',
          `${firm.name} · ${firm.shortName}`,
          `${body.name} · ${body.shortName}`,
        );
        break;
      }
      case 'branding': {
        const branding = await updateFirmBranding(firm.id, body.branding, firm.branding);
        audit('branding', JSON.stringify(firm.branding), JSON.stringify(branding));
        break;
      }
      case 'email': {
        const email = await updateFirmEmailIdentity(firm.id, body.email);
        audit('settings.email', JSON.stringify(firm.email), JSON.stringify(email));
        break;
      }
      case 'documents': {
        const documents = await updateFirmDocumentRoots(firm.id, body.documents);
        audit('settings.documents', JSON.stringify(firm.documents), JSON.stringify(documents));
        break;
      }
      case 'status': {
        await setFirmStatus(firm.id, body.status);
        logOperatorAudit({
          firmId: firm.id,
          entityType: 'Firm',
          entityId: firm.id,
          entityName: firm.name,
          action: body.status === 'suspended' ? 'suspended' : 'reactivated',
          fieldChanged: 'status',
          oldValue: firm.status,
          newValue: body.status,
          operator,
          ipAddress: getClientIP(req),
        });
        break;
      }
    }
  } catch (err) {
    if (err instanceof ProvisionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  const updated = await findFirmForOperator(firm.id);
  return NextResponse.json({ firm: updated });
}
