// ── SharePoint Historical Backfill ──────────────────────────────
// Catches up files & finalized deliverables that exist in Supabase
// but were never synced to SharePoint. Processes BATCH_SIZE per
// request so callers can resume via { offset }.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { forEachFirmWithFeature } from '@/lib/tenancy/fan-out';
import { resolveFeature } from '@/lib/firm/features';
import {
  syncDeliverableToSharePoint,
  syncIncomingFileToSharePoint,
} from '@/lib/sharepoint-sync';

export const maxDuration = 300; // 5 minutes per batch

const BATCH_SIZE = 10;

function sharePointOffMessage(reason: string): string {
  return reason === 'credentials_missing' || reason === 'platform_unconfigured'
    ? 'SharePoint is not configured for this firm — add its site and Graph app credentials under integration settings.'
    : 'SharePoint is not enabled for this firm.';
}

type BackfillKind = 'files' | 'deliverables';

export async function POST(req: Request) {
  // Allow webhook/cron calls via CRON_SECRET or authenticated admin users
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  const isWebhook = cronSecret && authHeader === `Bearer ${cronSecret}`;

  let sessionFirmId: string | null = null;
  if (!isWebhook) {
    const session = await getSession();
    const role = session?.user?.role;
    if (!session || !role || (role !== 'admin' && role !== 'super_user')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    sessionFirmId = session.firmId;
  }

  const body = await req.json().catch(() => ({}));
  const offset: number = body.offset ?? 0;
  const kind: BackfillKind = body.kind === 'deliverables' ? 'deliverables' : 'files';

  const run = (db: SupabaseClient, firmId: string) =>
    kind === 'deliverables'
      ? backfillDeliverables(db, firmId, offset)
      : backfillFiles(db, firmId, offset);

  if (sessionFirmId) {
    const state = await resolveFeature(sessionFirmId, 'sharepoint');
    if (!state.available) {
      return NextResponse.json({ error: sharePointOffMessage(state.reason) }, { status: 400 });
    }
    return NextResponse.json(await run(getServiceDbForFirm(sessionFirmId), sessionFirmId));
  }

  const firms = await forEachFirmWithFeature('sharepoint', ({ firm, db }) => run(db, firm.id));
  return NextResponse.json({
    done: firms.every((f) => f.result?.done !== false),
    processed: firms.reduce((n, f) => n + (f.result?.processed ?? 0), 0),
    skipped: firms.reduce((n, f) => n + (f.result?.skipped ?? 0), 0),
    errors: firms.reduce((n, f) => n + (f.result?.errors ?? 0), 0),
    nextOffset: offset + BATCH_SIZE,
    firms,
  });
}

/**
 * GET /api/admin/sharepoint-backfill
 * Cron path (Vercel crons issue GET): runs an incoming-files batch at offset 0
 * across every active firm. Admin session: progress summary.
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  const isWebhook = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (isWebhook) {
    const firms = await forEachFirmWithFeature('sharepoint', ({ firm, db }) =>
      backfillFiles(db, firm.id, 0),
    );
    return NextResponse.json({
      done: firms.every((f) => f.result?.done !== false),
      processed: firms.reduce((n, f) => n + (f.result?.processed ?? 0), 0),
      skipped: firms.reduce((n, f) => n + (f.result?.skipped ?? 0), 0),
      errors: firms.reduce((n, f) => n + (f.result?.errors ?? 0), 0),
      firms,
    });
  }

  let sessionFirmId: string | null = null;
  {
    const session = await getSession();
    const role = session?.user?.role;
    if (!session || !role || (role !== 'admin' && role !== 'super_user')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    sessionFirmId = session.firmId;
  }

  if (!sessionFirmId) {
    const firms = await forEachFirmWithFeature('sharepoint', ({ db }) => backfillProgress(db));
    return NextResponse.json({ firms });
  }
  const state = await resolveFeature(sessionFirmId, 'sharepoint');
  if (!state.available) {
    return NextResponse.json({ error: sharePointOffMessage(state.reason) }, { status: 400 });
  }
  return NextResponse.json(await backfillProgress(getServiceDbForFirm(sessionFirmId)));
}

async function backfillProgress(supabase: SupabaseClient) {
  const [filesTotal, filesSynced, delivTotal, delivSynced] = await Promise.all([
    supabase
      .from('files')
      .select('*', { count: 'exact', head: true })
      .neq('file_urls', '[]'),
    supabase
      .from('files')
      .select('*', { count: 'exact', head: true })
      .neq('file_urls', '[]')
      .not('sharepoint_urls', 'is', null)
      .neq('sharepoint_urls', '[]'),
    supabase
      .from('deliverable_files')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'finalized'),
    supabase
      .from('deliverable_files')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'finalized')
      .not('sharepoint_item_id', 'is', null),
  ]);

  return {
    files: {
      total: filesTotal.count ?? 0,
      synced: filesSynced.count ?? 0,
      remaining: (filesTotal.count ?? 0) - (filesSynced.count ?? 0),
    },
    deliverables: {
      total: delivTotal.count ?? 0,
      synced: delivSynced.count ?? 0,
      remaining: (delivTotal.count ?? 0) - (delivSynced.count ?? 0),
    },
  };
}

// ── Incoming-files backfill ──────────────────────────────────────

type BackfillBatchResult = {
  done: boolean;
  processed: number;
  skipped: number;
  errors: number;
  errorDetails?: unknown[];
  nextOffset?: number;
};

async function backfillFiles(
  supabase: SupabaseClient,
  firmId: string,
  offset: number,
): Promise<BackfillBatchResult> {
  // Find files with attachments that haven't been synced to SharePoint yet.
  // Using the default PostgREST .is('sharepoint_urls', null) OR '[]' filter
  // via two separate queries is cleaner than an .or() which trips on jsonb ops.
  const { data: files, error } = await supabase
    .from('files')
    .select('notion_id, name, file_urls, sharepoint_urls')
    .neq('file_urls', '[]')
    .or('sharepoint_urls.is.null,sharepoint_urls.eq.[]')
    .order('created_time', { ascending: false })
    .range(offset, offset + BATCH_SIZE - 1);

  if (error) {
    throw new Error(error.message);
  }

  if (!files || files.length === 0) {
    return { done: true, processed: 0, skipped: 0, errors: 0 };
  }

  let processed = 0;
  let skipped = 0;
  let errors = 0;
  const errorDetails: { file: string; error: string }[] = [];

  for (const file of files) {
    // Skip rows with no file_urls (defensive)
    const fileUrls: unknown[] =
      typeof file.file_urls === 'string' ? JSON.parse(file.file_urls) : (file.file_urls ?? []);
    if (!Array.isArray(fileUrls) || fileUrls.length === 0) {
      skipped++;
      continue;
    }

    try {
      const result = await syncIncomingFileToSharePoint(firmId, file.notion_id);
      if (result.error) {
        errors++;
        errorDetails.push({ file: file.name ?? file.notion_id, error: result.error });
      } else if (result.skipped) {
        skipped++;
      } else {
        processed++;
      }
    } catch (err) {
      errors++;
      errorDetails.push({
        file: file.name ?? file.notion_id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    // Throttle: 500ms between files
    await new Promise((r) => setTimeout(r, 500));
  }

  return {
    done: files.length < BATCH_SIZE,
    processed,
    skipped,
    errors,
    errorDetails: errorDetails.slice(0, 5),
    nextOffset: offset + BATCH_SIZE,
  };
}

// ── Deliverable-files backfill ───────────────────────────────────

async function backfillDeliverables(
  supabase: SupabaseClient,
  firmId: string,
  offset: number,
): Promise<BackfillBatchResult> {
  // Distinct (deliverable_id, version) pairs that have finalized files
  // but none of them are synced yet.
  const { data: rows, error } = await supabase
    .from('deliverable_files')
    .select('deliverable_id, version, sharepoint_item_id')
    .eq('action', 'finalized')
    .is('sharepoint_item_id', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + BATCH_SIZE * 2 - 1); // fetch more to dedupe

  if (error) {
    throw new Error(error.message);
  }

  if (!rows || rows.length === 0) {
    return { done: true, processed: 0, skipped: 0, errors: 0 };
  }

  // Dedupe by (deliverable_id, version) — syncDeliverableToSharePoint handles
  // all files for a given version in one call.
  const seen = new Set<string>();
  const pairs: { deliverable_id: string; version: number }[] = [];
  for (const r of rows) {
    const key = `${r.deliverable_id}::${r.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ deliverable_id: r.deliverable_id, version: r.version });
    if (pairs.length >= BATCH_SIZE) break;
  }

  let processed = 0;
  let errors = 0;
  const errorDetails: { deliverable: string; error: string }[] = [];

  for (const { deliverable_id, version } of pairs) {
    try {
      const result = await syncDeliverableToSharePoint(firmId, deliverable_id, version);
      if (result.error) {
        errors++;
        errorDetails.push({ deliverable: `${deliverable_id} v${version}`, error: result.error });
      } else {
        processed++;
      }
    } catch (err) {
      errors++;
      errorDetails.push({
        deliverable: `${deliverable_id} v${version}`,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  return {
    done: pairs.length < BATCH_SIZE,
    processed,
    skipped: 0,
    errors,
    errorDetails: errorDetails.slice(0, 5),
    nextOffset: offset + BATCH_SIZE * 2,
  };
}
