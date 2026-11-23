import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabase } from '@/lib/supabase';
import {
  syncDeliverableToSharePoint,
  syncIncomingFileToSharePoint,
  getSharePointStatus,
} from '@/lib/sharepoint-sync';
import { isFeatureAvailable } from '@/lib/firm/features';

const SHAREPOINT_OFF =
  'SharePoint is not enabled for this firm. Turn it on and add the firm\'s own site and Graph app credentials under integration settings.';

async function assertAdmin() {
  const session = await getSession();
  const role = session?.user?.role;
  if (!role || !['admin', 'super_user', 'finance'].includes(role)) return null;
  return session;
}

/**
 * Check for CRON_SECRET Bearer token (used by DB webhooks via pg_net).
 * Returns true if the caller is an authorized webhook — bypasses session auth.
 */
function isWebhookCaller(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Resolve the firm scope for one target row: a session pins it to the
 * caller's firm; a webhook payload may carry firmId; a legacy payload
 * without one is resolved from the row itself. Returns null when the row
 * doesn't exist inside the resolved scope (mismatched firmId → fail-safe 404).
 */
async function resolveFirmId(
  sessionFirmId: string | null,
  payloadFirmId: unknown,
  table: 'deliverables' | 'files',
  id: string,
): Promise<string | null> {
  const pinned = sessionFirmId ?? (typeof payloadFirmId === 'string' ? payloadFirmId : null);
  // firm-resolution lookup: scoped client follows.
  const { data } = await getSupabase()
    .from(table)
    .select('firm_id')
    .eq('notion_id', id)
    .maybeSingle();
  if (!data?.firm_id) return null;
  if (pinned && pinned !== data.firm_id) return null;
  return data.firm_id as string;
}

/**
 * GET /api/admin/sharepoint-sync?deliverableId=xxx
 * Check SharePoint sync status for a deliverable's files.
 */
export async function GET(req: Request) {
  let sessionFirmId: string | null = null;
  if (!isWebhookCaller(req)) {
    const session = await assertAdmin();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    sessionFirmId = session.firmId;
  }

  const { searchParams } = new URL(req.url);
  const deliverableId = searchParams.get('deliverableId');

  if (!deliverableId) {
    return NextResponse.json({ error: 'deliverableId is required' }, { status: 400 });
  }

  const firmId = await resolveFirmId(sessionFirmId, searchParams.get('firmId'), 'deliverables', deliverableId);
  if (!firmId) {
    return NextResponse.json({ configured: false, synced: false, files: [] });
  }
  if (!(await isFeatureAvailable(firmId, 'sharepoint'))) {
    return NextResponse.json({ configured: false, synced: false, files: [] });
  }

  const status = await getSharePointStatus(firmId, deliverableId);
  return NextResponse.json({ configured: true, ...status });
}

/**
 * POST /api/admin/sharepoint-sync
 * Manually trigger SharePoint sync.
 *
 * Body options:
 *   { deliverableId: string, version: number }       — sync finalized deliverable files
 *   { fileNotionId: string }                          — sync incoming file attachments
 */
export async function POST(req: Request) {
  let sessionFirmId: string | null = null;
  if (!isWebhookCaller(req)) {
    const session = await assertAdmin();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    sessionFirmId = session.firmId;
  }

  const body = await req.json();

  // ── Sync incoming file ──────────────────────────────────────
  if (body.fileNotionId) {
    const firmId = await resolveFirmId(sessionFirmId, body.firmId, 'files', body.fileNotionId);
    if (!firmId) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    if (!(await isFeatureAvailable(firmId, 'sharepoint'))) {
      return NextResponse.json({ error: SHAREPOINT_OFF }, { status: 400 });
    }
    const result = await syncIncomingFileToSharePoint(firmId, body.fileNotionId);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      uploaded: result.uploaded?.length ?? 0,
      files: result.uploaded?.map((f) => ({ name: f.name, webUrl: f.webUrl })) ?? [],
    });
  }

  // ── Sync finalized deliverable ──────────────────────────────
  const { deliverableId, version } = body;

  if (!deliverableId || !version) {
    return NextResponse.json(
      { error: 'Provide either { fileNotionId } or { deliverableId, version }' },
      { status: 400 },
    );
  }

  const firmId = await resolveFirmId(sessionFirmId, body.firmId, 'deliverables', deliverableId);
  if (!firmId) {
    return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 });
  }
  if (!(await isFeatureAvailable(firmId, 'sharepoint'))) {
    return NextResponse.json({ error: SHAREPOINT_OFF }, { status: 400 });
  }

  const result = await syncDeliverableToSharePoint(firmId, deliverableId, version);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    docxUrl: result.docx?.webUrl ?? null,
    pdfUrl: result.pdf?.webUrl ?? null,
  });
}
