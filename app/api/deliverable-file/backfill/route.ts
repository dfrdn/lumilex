import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { forEachFirmWithFeature } from '@/lib/tenancy/fan-out';
import {
  processDeliverableVersionAnalysis,
  cleanupZombieAnalyses,
  getLatestVersionFiles,
} from '@/lib/ai/auto-analyze';
import { FINALIZED_STATUSES } from '@/lib/deliverable-status';
import { isSupportedFileType } from '@/lib/ai/document-parser';

export const maxDuration = 300; // 5 minutes per batch

/**
 * POST /api/deliverable-file/backfill
 *
 * Analyze every file of the latest version of every finalized deliverable.
 * Admin-only. Processes synchronously with throttling to stay within Claude limits.
 *
 * Body: { dryRun?: boolean }
 * Returns: { processed, skipped, errors, candidates }
 */
export async function POST(req: Request) {
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
  const dryRun: boolean = !!body.dryRun;

  if (sessionFirmId) {
    return NextResponse.json(await backfillFirm(getServiceDbForFirm(sessionFirmId), sessionFirmId, dryRun));
  }

  const firms = await forEachFirmWithFeature('ai_analysis', ({ firm, db }) => backfillFirm(db, firm.id, dryRun));
  return NextResponse.json({
    dryRun,
    candidateCount: firms.reduce((n, f) => n + (f.result?.candidateCount ?? 0), 0),
    processed: firms.reduce((n, f) => n + (f.result?.processed ?? 0), 0),
    errors: firms.reduce((n, f) => n + (f.result?.errors ?? 0), 0),
    firms,
  });
}

type BackfillFirmResult = {
  dryRun?: boolean;
  candidateCount: number;
  candidates?: unknown[];
  processed?: number;
  errors?: number;
};

async function backfillFirm(
  supabase: SupabaseClient,
  firmId: string,
  dryRun: boolean,
): Promise<BackfillFirmResult> {
  await cleanupZombieAnalyses(firmId).catch(() => { /* best-effort */ });

  // PostgREST caps a response at 1,000 rows, so page until a short page.
  const PAGE = 1000;
  const filedDeliverables: { notion_id: string; name: string | null; matter_id: string | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: dErr } = await supabase
      .from('deliverables')
      .select('notion_id, name, matter_id')
      .in('status', FINALIZED_STATUSES)
      .order('notion_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (dErr) throw new Error(dErr.message);
    filedDeliverables.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const candidates: {
    deliverable_id: string;
    deliverable_name: string | null;
    deliverable_file_id: number;
    file_name: string;
    version: number;
  }[] = [];

  for (const d of filedDeliverables) {
    for (const latest of await getLatestVersionFiles(supabase, d.notion_id)) {
      if (!isSupportedFileType(latest.file_name)) continue;

      // Skip if already analyzed / in-flight / permanently skipped.
      const { data: existing } = await supabase
        .from('file_analyses')
        .select('id, status, error_message')
        .eq('deliverable_file_id', latest.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        if (existing.status !== 'failed') continue;
        const err = existing.error_message ?? '';
        if (err.includes('Unsupported file type')) continue;
        if (err.startsWith('Permanent skip:')) continue;
        // transient — fall through to retry
      }

      candidates.push({
        deliverable_id: d.notion_id,
        deliverable_name: d.name,
        deliverable_file_id: latest.id,
        file_name: latest.file_name,
        version: latest.version,
      });
    }
  }

  if (dryRun) {
    return {
      dryRun: true,
      candidateCount: candidates.length,
      candidates,
    };
  }

  let processed = 0;
  let errors = 0;

  for (const c of candidates) {
    // Resolve fresh signed URL for the storage path.
    const { data: latest } = await supabase
      .from('deliverable_files')
      .select('file_url, file_name')
      .eq('id', c.deliverable_file_id)
      .single();

    if (!latest) { errors++; continue; }

    let attachmentUrl = latest.file_url;
    if (latest.file_url && !latest.file_url.startsWith('http')) {
      const { data: signData } = await supabase.storage
        .from('files')
        .createSignedUrl(latest.file_url, 60 * 60);
      if (signData?.signedUrl) attachmentUrl = signData.signedUrl;
    }

    // Insert pending file_analyses row and process synchronously (with throttle).
    const { data: row, error: insertErr } = await supabase
      .from('file_analyses')
      .insert({
        deliverable_file_id: c.deliverable_file_id,
        attachment_name: latest.file_name,
        attachment_url: attachmentUrl,
        status: 'pending',
        analyzed_by: 'backfill',
      })
      .select('id')
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') continue; // already exists
      errors++;
      console.error(`[df-backfill] insert failed for df=${c.deliverable_file_id}:`, insertErr.message);
      continue;
    }

    try {
      await processDeliverableVersionAnalysis(row.id, c.deliverable_file_id, firmId);
      processed++;
      console.log(`[df-backfill] ✓ ${c.deliverable_name} v${c.version} (${c.file_name})`);
      await new Promise((r) => setTimeout(r, 1000)); // throttle
    } catch (err) {
      errors++;
      console.error(`[df-backfill] ✗ df=${c.deliverable_file_id}:`, err instanceof Error ? err.message : err);
    }
  }

  return {
    candidateCount: candidates.length,
    processed,
    errors,
  };
}
