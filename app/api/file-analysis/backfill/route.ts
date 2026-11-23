import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { forEachActiveFirm, forEachFirmWithFeature } from '@/lib/tenancy/fan-out';
import { processAnalysisBackground, cleanupZombieAnalyses } from '@/lib/ai/auto-analyze';
import { isSupportedFileType } from '@/lib/ai/document-parser';

export const maxDuration = 300; // 5 minutes per batch

const BATCH_SIZE = 10; // Process 10 files per request to stay within time limits

/**
 * POST /api/file-analysis/backfill
 * Backfill file analyses for all files with attachments that haven't been analyzed.
 * Processes BATCH_SIZE files per call — call repeatedly until done.
 *
 * Body: { offset?: number }
 * Returns: { processed, skipped, errors, remaining, nextOffset }
 */
export async function POST(req: Request) {
  // Allow webhook/cron calls via CRON_SECRET or authenticated admin users.
  // The cron path fans out across every active firm; an admin session
  // backfills their firm only.
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
  const offset = body.offset ?? 0;

  if (sessionFirmId) {
    return NextResponse.json(await backfillBatchForFirm(getServiceDbForFirm(sessionFirmId), sessionFirmId, offset));
  }

  const firms = await forEachFirmWithFeature('ai_analysis', ({ firm, db }) => backfillBatchForFirm(db, firm.id, offset));
  return NextResponse.json({
    done: firms.every((f) => f.result?.done !== false),
    processed: firms.reduce((n, f) => n + (f.result?.processed ?? 0), 0),
    skipped: firms.reduce((n, f) => n + (f.result?.skipped ?? 0), 0),
    errors: firms.reduce((n, f) => n + (f.result?.errors ?? 0), 0),
    nextOffset: offset + BATCH_SIZE,
    firms,
  });
}

type BackfillBatch = {
  done: boolean;
  processed: number;
  skipped?: number;
  errors?: number;
  message?: string;
  nextOffset?: number;
  totalFiles?: number;
  totalAnalyzed?: number;
};

async function backfillBatchForFirm(
  supabase: SupabaseClient,
  firmId: string,
  offset: number,
): Promise<BackfillBatch> {
  await cleanupZombieAnalyses(firmId).catch(() => { /* best-effort */ });

  // Get files with attachments that DON'T have a completed analysis yet
  const { data: files, error: queryErr } = await supabase
    .from('files')
    .select('notion_id, name, matter_name, file_urls')
    .neq('file_urls', '[]')
    .order('created_time', { ascending: false })
    .range(offset, offset + BATCH_SIZE - 1);

  if (queryErr) {
    throw new Error(queryErr.message);
  }

  if (!files || files.length === 0) {
    return { done: true, processed: 0, message: 'All files processed' };
  }

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    const fileUrls: { name: string; url: string; path?: string }[] =
      typeof file.file_urls === 'string' ? JSON.parse(file.file_urls) : (file.file_urls ?? []);

    if (fileUrls.length === 0) {
      skipped++;
      continue;
    }

    for (const raw of fileUrls) {
      const urlForCheck = raw.path || raw.url;
      if (!urlForCheck || !isSupportedFileType(urlForCheck)) {
        skipped++;
        continue;
      }

      // Check if already analyzed or permanently failed
      const { data: existing } = await supabase
        .from('file_analyses')
        .select('id, status, error_message')
        .eq('file_id', file.notion_id)
        .eq('attachment_name', raw.name)
        .in('status', ['completed', 'processing', 'pending', 'failed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        // Skip completed/processing/pending as before
        if (existing.status !== 'failed') {
          skipped++;
          continue;
        }
        // Skip permanently-failed files (too large, unsupported format)
        // — retrying these will always fail
        const err = existing.error_message ?? '';
        // 'too large' is no longer permanent — we split large PDFs now.
        const isPermanent = err.includes('Unsupported file type');
        if (isPermanent) {
          skipped++;
          continue;
        }
        // Transient failures (timeout, 502, abort) can be retried
      }

      // Resolve signed URL
      let attachmentUrl = raw.url;
      if (raw.path) {
        const { data: signData } = await supabase.storage
          .from('files')
          .createSignedUrl(raw.path, 60 * 60);
        attachmentUrl = signData?.signedUrl ?? raw.url;
      }

      if (!attachmentUrl) {
        skipped++;
        continue;
      }

      // Insert pending row
      const { data: row, error: insertErr } = await supabase
        .from('file_analyses')
        .insert({
          file_id: file.notion_id,
          attachment_name: raw.name,
          attachment_url: attachmentUrl,
          status: 'pending',
          analyzed_by: 'backfill',
        })
        .select('id')
        .single();

      if (insertErr) {
        if (insertErr.code === '23505') { skipped++; continue; }
        errors++;
        continue;
      }

      // Process synchronously (with throttling) so we don't overwhelm the API
      try {
        await processAnalysisBackground(
          row.id,
          file.notion_id,
          { name: raw.name, url: attachmentUrl },
          file.name || raw.name,
          file.matter_name || '',
          firmId,
        );
        processed++;
        console.log(`[backfill] ✓ ${file.name} / ${raw.name}`);

        // Throttle: wait 1s between files to avoid rate limits
        await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        errors++;
        console.error(`[backfill] ✗ ${file.name} / ${raw.name}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  // Count remaining
  const { count } = await supabase
    .from('files')
    .select('*', { count: 'exact', head: true })
    .neq('file_urls', '[]');

  const { count: analyzedCount } = await supabase
    .from('file_analyses')
    .select('*', { count: 'exact', head: true })
    .in('status', ['completed', 'processing', 'pending']);

  return {
    done: files.length < BATCH_SIZE,
    processed,
    skipped,
    errors,
    nextOffset: offset + BATCH_SIZE,
    totalFiles: count ?? 0,
    totalAnalyzed: analyzedCount ?? 0,
  };
}

/**
 * GET /api/file-analysis/backfill
 * Cron path (Vercel crons issue GET): runs a backfill batch at offset 0 across
 * every active firm. Admin session: progress check.
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  const isWebhook = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (isWebhook) {
    const firms = await forEachFirmWithFeature('ai_analysis', ({ firm, db }) => backfillBatchForFirm(db, firm.id, 0));
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
    const firms = await forEachActiveFirm(({ db }) => backfillProgressForFirm(db));
    return NextResponse.json({ firms });
  }
  return NextResponse.json(await backfillProgressForFirm(getServiceDbForFirm(sessionFirmId)));
}

async function backfillProgressForFirm(supabase: SupabaseClient) {
  const { count: totalFiles } = await supabase
    .from('files')
    .select('*', { count: 'exact', head: true })
    .neq('file_urls', '[]');

  const { data: statusCounts } = await supabase
    .from('file_analyses')
    .select('status')
    .then(({ data }) => {
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        counts[row.status] = (counts[row.status] ?? 0) + 1;
      }
      return { data: counts };
    });

  return {
    totalFilesWithAttachments: totalFiles ?? 0,
    analyses: statusCounts ?? {},
  };
}
