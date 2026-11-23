import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { forEachFirmWithFeature } from '@/lib/tenancy/fan-out';
import {
  getCaseById, getTasksByMatterId, getDeliverablesByMatterId,
  getHearingsByMatterId, getFilesByMatterId, getFilingsByMatterId,
} from '@/lib/queries/detail';
import { generateMatterSummary } from '@/lib/ai/claude';

export const maxDuration = 300; // 5 min timeout

/**
 * POST /api/matter-summary/batch
 * Generates summaries for all matters that don't have one yet (or all if force=true).
 * Requires admin session or CRON_SECRET header.
 */
export async function POST(req: Request) {
  // Allow access via cron secret or admin session. The cron path fans out
  // across every active firm; a partner session batches their firm only.
  let sessionFirmId: string | null = null;
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret && cronSecret === process.env.CRON_SECRET) {
    // Authorized via cron secret
  } else {
    const session = await getSession();
    if (!session?.user?.notionUserId || session.user.role !== 'partner') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    sessionFirmId = session.firmId;
  }

  const body = await req.json().catch(() => ({}));
  const force = body.force === true;
  const batchSize = body.batchSize ?? 3;

  if (sessionFirmId) {
    return NextResponse.json(
      await batchForFirm(getServiceDbForFirm(sessionFirmId), sessionFirmId, force, batchSize),
    );
  }

  const firms = await forEachFirmWithFeature('ai_analysis', ({ firm, db }) => batchForFirm(db, firm.id, force, batchSize));
  return NextResponse.json({
    total: firms.reduce((n, f) => n + (f.result?.total ?? 0), 0),
    succeeded: firms.reduce((n, f) => n + (f.result?.succeeded ?? 0), 0),
    failed: firms.reduce((n, f) => n + (f.result?.failed ?? 0), 0),
    failures: firms.flatMap((f) => f.result?.failures ?? []),
    firms: firms.map(({ firmId, slug, ok, error }) => ({ firmId, slug, ok, error })),
  });
}

type BatchResult = {
  message?: string;
  total: number;
  succeeded: number;
  failed: number;
  failures?: { id: string; error: string }[];
};

async function batchForFirm(
  supabase: SupabaseClient,
  firmId: string,
  force: boolean,
  batchSize: number,
): Promise<BatchResult> {
  // Get all matter IDs
  const { data: matters, error: mErr } = await supabase
    .from('matters')
    .select('notion_id, name')
    .order('name');

  if (mErr || !matters) {
    throw new Error('Failed to fetch matters');
  }

  // If not forcing, skip matters that already have summaries
  let matterIds = matters.map((m) => m.notion_id);
  if (!force) {
    const { data: existing } = await supabase
      .from('matter_summaries')
      .select('matter_id');
    const existingSet = new Set((existing || []).map((e) => e.matter_id));
    matterIds = matterIds.filter((id) => !existingSet.has(id));
  }

  if (matterIds.length === 0) {
    return { message: 'All matters already have summaries', total: 0, succeeded: 0, failed: 0 };
  }

  const results: { succeeded: string[]; failed: { id: string; error: string }[] } = {
    succeeded: [],
    failed: [],
  };

  // Process in batches
  for (let i = 0; i < matterIds.length; i += batchSize) {
    const batch = matterIds.slice(i, i + batchSize);
    const promises = batch.map(async (matterId) => {
      try {
        const matter = await getCaseById(matterId, firmId);
        if (!matter) {
          results.failed.push({ id: matterId, error: 'Not found' });
          return;
        }

        const [tasks, deliverables, hearings, files, filings] = await Promise.allSettled([
          getTasksByMatterId(matterId, firmId),
          getDeliverablesByMatterId(matterId, firmId),
          getHearingsByMatterId(matterId, firmId),
          getFilesByMatterId(matterId, firmId),
          getFilingsByMatterId(matterId, firmId),
        ]).then((r) => r.map((x) => (x.status === 'fulfilled' ? x.value : [])));

        const result = await generateMatterSummary(
          { firmId, feature: 'ai_analysis' },
          {
            name: matter.name,
            matterCode: matter.matterCode,
            type: matter.type,
            status: matter.status,
            caseTitle: matter.caseTitle,
            caseNumber: matter.caseNumber,
            court: matter.court,
            clientName: matter.clientName,
          },
          {
            deliverables: (deliverables as any[]).map((d) => ({
              name: d.name, status: d.status, dueDate: d.externalDueDate, createdTime: d.createdTime,
            })),
            hearings: (hearings as any[]).map((h) => ({
              name: h.name, date: h.date, status: h.status, type: h.type,
            })),
            filings: (filings as any[]).map((f) => ({
              name: f.name, date: f.date, status: f.status,
            })),
            files: (files as any[]).map((f) => ({
              name: f.name, dateReceived: f.dateReceived, origin: f.origin,
            })),
            tasks: (tasks as any[]).map((t) => ({
              name: t.name, status: t.status, dueDate: t.dueDate, done: t.done,
            })),
          },
        );

        await supabase.from('matter_summaries').upsert({
          matter_id: matterId,
          summary: result.summary,
          latest_incident: result.latestIncident,
          latest_incident_date: result.latestIncidentDate,
          model_used: result.model,
          token_count_input: result.inputTokens,
          token_count_output: result.outputTokens,
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'matter_id' });

        results.succeeded.push(matterId);
        console.log(`[batch-summary] ✓ ${i + batch.indexOf(matterId) + 1}/${matterIds.length} ${matter.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        results.failed.push({ id: matterId, error: msg });
        console.error(`[batch-summary] ✗ ${matterId}: ${msg}`);
      }
    });

    await Promise.all(promises);
  }

  return {
    total: matterIds.length,
    succeeded: results.succeeded.length,
    failed: results.failed.length,
    failures: results.failed,
  };
}
