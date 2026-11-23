import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireOperator } from '@/lib/platform/auth';
import { findFirmForOperator, setFirmEntitlement } from '@/lib/platform/firms';
import {
  readFeatureRows,
  setIntegrationEnabled,
  setIntegrationConfig,
  setIntegrationSecrets,
  clearIntegrationSecrets,
} from '@/lib/platform/firm-detail';
import { FEATURE_KEYS } from '@/lib/firm/feature-shape';
import { validateBody } from '@/lib/validation';
import { logOperatorAudit, getClientIP } from '@/lib/audit';

/**
 * One feature for one firm: the entitlement, the switch, the non-secret config
 * and the sealed credentials.
 *
 * The three levels are edited separately because they *are* separate — a firm
 * can be entitled to SharePoint, have the integration switched on, and still
 * have it unavailable because the client secret is missing. The response always
 * carries the recomputed `resolveFeature()` verdict for every key, so the UI
 * shows what actually happened rather than what the operator asked for.
 *
 * Credentials are write-only. They arrive here in plaintext over the same TLS
 * everything else uses, are sealed by `lib/firm/secrets.ts`, and no route ever
 * sends one back — `readFeatureRows` reports which names are set, never their
 * values.
 */
const bodySchema = z
  .object({
    key: z.enum(FEATURE_KEYS),
    /** Level 1 — `firms.settings.features[key]`. */
    entitled: z.boolean().optional(),
    /** Level 2 — the `firm_integrations` switch. */
    enabled: z.boolean().optional(),
    /** Level 3a — the non-secret half. Merged over what is stored. */
    config: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
    /** Level 3b — sealed. An empty string removes that name. */
    secrets: z.record(z.string(), z.string()).optional(),
    /** Drop every stored secret for this integration. */
    clearSecrets: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.entitled !== undefined ||
      v.enabled !== undefined ||
      v.config !== undefined ||
      v.secrets !== undefined ||
      v.clearSecrets === true,
    'Nothing to change',
  );

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const firm = await findFirmForOperator(id);
  if (!firm) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ features: await readFeatureRows(firm.id, firm.features) });
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

  const before = (await readFeatureRows(firm.id, firm.features)).find((f) => f.key === body.key)!;
  const changes: string[] = [];

  if (body.entitled !== undefined && body.entitled !== before.entitled) {
    await setFirmEntitlement(firm.id, body.key, body.entitled);
    changes.push(`entitled ${before.entitled} → ${body.entitled}`);
  }
  if (body.enabled !== undefined && body.enabled !== before.enabled) {
    await setIntegrationEnabled(firm.id, body.key, body.enabled);
    changes.push(`enabled ${before.enabled} → ${body.enabled}`);
  }
  if (body.config) {
    await setIntegrationConfig(firm.id, body.key, body.config);
    changes.push(`config: ${Object.keys(body.config).join(', ')}`);
  }
  if (body.clearSecrets) {
    await clearIntegrationSecrets(firm.id, body.key);
    changes.push('credentials cleared');
  } else if (body.secrets) {
    const named = Object.entries(body.secrets);
    await setIntegrationSecrets(firm.id, body.key, body.secrets);
    // Names only, never values — an audit row is read by the tenant's admins.
    changes.push(
      `credentials set: ${named
        .map(([name, value]) => (value.trim() === '' ? `${name} (removed)` : name))
        .join(', ')}`,
    );
  }

  // The firm row may have changed (entitlement lives in its settings jsonb).
  const fresh = (await findFirmForOperator(firm.id))!;
  const features = await readFeatureRows(fresh.id, fresh.features);
  const after = features.find((f) => f.key === body.key)!;

  if (changes.length > 0) {
    logOperatorAudit({
      firmId: firm.id,
      entityType: 'FirmIntegration',
      entityId: body.key,
      entityName: firm.name,
      action: 'updated',
      fieldChanged: body.key,
      oldValue: `${before.available ? 'available' : before.reason}`,
      newValue: `${changes.join('; ')} → ${after.available ? 'available' : after.reason}`,
      operator,
      ipAddress: getClientIP(req),
    });
  }

  return NextResponse.json({ features });
}
