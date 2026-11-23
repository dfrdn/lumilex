import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSession } from '@/lib/session';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { forEachFirmWithFeature } from '@/lib/tenancy/fan-out';
import {
  generateEmbeddingsForFileAnalysis,
  generateEmbeddingsForMatterSummary,
  generateEmbeddingsForEntity,
  embedEntityTexts,
  type SourceType,
} from '@/lib/ai/embeddings';
import { isVoyageConfigured } from '@/lib/ai/voyage';

export const maxDuration = 300;

/**
 * POST /api/embeddings/generate
 *
 * Body options:
 *   { analysisId: number }   — generate embeddings for a single file analysis (webhook)
 *   { matterId: string }     — generate embeddings for all entities in a matter
 *   { backfill: true }       — admin-only batch backfill of all existing data
 */
export async function POST(req: Request) {
  // Allow webhook calls via CRON_SECRET or authenticated users
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  const isWebhook = cronSecret && authHeader === `Bearer ${cronSecret}`;

  let sessionFirmId: string | null = null;
  if (!isWebhook) {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    sessionFirmId = session.firmId;
  }

  if (!isVoyageConfigured()) {
    return NextResponse.json(
      { error: 'Voyage AI not configured. Set VOYAGE_API_KEY.' },
      { status: 400 },
    );
  }

  const body = await req.json();
  const payloadFirmId = typeof body.firmId === 'string' ? body.firmId : null;

  // ── Single analysis mode (from webhook) ────────────────────────
  if (body.analysisId) {
    // Fail-safe scoping: verify the analysis exists inside the resolved firm
    // before generating. A payload firmId that doesn't match the row's real
    // firm finds nothing and 404s instead of writing.
    const scoped = sessionFirmId ?? payloadFirmId;
    let firmId: string;
    if (scoped) {
      const { data: row } = await getServiceDbForFirm(scoped)
        .from('file_analyses')
        .select('id')
        .eq('id', body.analysisId)
        .maybeSingle();
      if (!row) return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
      firmId = scoped;
    } else {
      // firm-resolution lookup: scoped client follows. A legacy trigger
      // payload carries no firmId, so the row's own firm is read unscoped and
      // then scopes the generation.
      const { data: row } = await getSupabase()
        .from('file_analyses')
        .select('id, firm_id')
        .eq('id', body.analysisId)
        .maybeSingle();
      if (!row?.firm_id) return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
      firmId = row.firm_id as string;
    }

    try {
      await generateEmbeddingsForFileAnalysis(body.analysisId, firmId);
      return NextResponse.json({ ok: true, analysisId: body.analysisId });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      console.error(`[embeddings] Webhook failed for analysis ${body.analysisId}:`, message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // ── Backfill mode (admin only) ──────────────────────────────────
  if (body.backfill) {
    if (!isWebhook) {
      const session = await getSession();
      const role = session?.user?.role;
      if (role !== 'admin' && role !== 'super_user') {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
    }

    if (sessionFirmId) {
      return NextResponse.json({ ok: true, stats: await backfillFirm(getServiceDbForFirm(sessionFirmId), sessionFirmId) });
    }
    const firms = await forEachFirmWithFeature('ai_search', ({ firm, db }) => backfillFirm(db, firm.id));
    return NextResponse.json({ ok: true, firms });
  }

  // ── Matter-scoped generation ────────────────────────────────────
  const { matterId } = body;
  if (!matterId) {
    return NextResponse.json(
      { error: 'Provide { analysisId }, { matterId } or { backfill: true }' },
      { status: 400 },
    );
  }

  let firmId = sessionFirmId ?? payloadFirmId;
  if (!firmId) {
    // firm-resolution lookup: scoped client follows.
    const { data: owner } = await getSupabase()
      .from('matters')
      .select('firm_id')
      .eq('notion_id', matterId)
      .single();
    if (!owner?.firm_id) {
      return NextResponse.json({ error: 'Matter not found' }, { status: 404 });
    }
    firmId = owner.firm_id as string;
  }
  const supabase = getServiceDbForFirm(firmId);

  const stats = { analyses: 0, summary: 0, entities: 0 };

  // File analyses for this matter's files
  const { data: matterFiles } = await supabase
    .from('files')
    .select('notion_id')
    .eq('matter_id', matterId);

  if (matterFiles) {
    const fileIds = matterFiles.map((f: { notion_id: string }) => f.notion_id);
    if (fileIds.length > 0) {
      const { data: analyses } = await supabase
        .from('file_analyses')
        .select('id')
        .in('file_id', fileIds)
        .eq('status', 'completed');

      if (analyses) {
        for (const a of analyses) {
          try {
            await generateEmbeddingsForFileAnalysis(a.id, firmId);
            stats.analyses++;
          } catch { /* skip */ }
        }
      }
    }
  }

  // Matter summary
  try {
    const count = await generateEmbeddingsForMatterSummary(matterId, firmId);
    stats.summary = count;
  } catch { /* skip */ }

  // Structured entities for this matter
  stats.entities = await embedMatterEntities(supabase, firmId, matterId);

  return NextResponse.json({ ok: true, matterId, stats });
}

// ── Helpers ──────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function backfillFirm(supabase: SupabaseClient, firmId: string) {
  const stats = { analyses: 0, summaries: 0, entities: 0, errors: 0 };

  // 1. File analyses
  const { data: analyses } = await supabase
    .from('file_analyses')
    .select('id')
    .eq('status', 'completed')
    .not('extracted_text', 'is', null);

  if (analyses) {
    for (const a of analyses) {
      try {
        await generateEmbeddingsForFileAnalysis(a.id, firmId);
        stats.analyses++;
        await delay(300);
      } catch {
        stats.errors++;
      }
    }
  }

  // 2. Matter summaries
  const { data: summaries } = await supabase
    .from('matter_summaries')
    .select('matter_id');

  if (summaries) {
    for (const s of summaries) {
      try {
        await generateEmbeddingsForMatterSummary(s.matter_id, firmId);
        stats.summaries++;
        await delay(300);
      } catch {
        stats.errors++;
      }
    }
  }

  // 3. Structured entities
  stats.entities = await embedAllEntities(supabase, firmId);

  return stats;
}

/**
 * Collect all entities for a matter and embed them in one batch API call
 * to minimize Voyage rate limit hits.
 */
async function embedMatterEntities(
  supabase: SupabaseClient,
  firmId: string,
  matterId: string,
): Promise<number> {
  // Collect all entity texts + metadata in a single pass
  const entities: { sourceType: SourceType; sourceId: string; text: string; metadata: Record<string, unknown> }[] = [];

  // Matter itself
  const { data: matter } = await supabase
    .from('matters')
    .select('notion_id, name, matter_code, client_name, type, status, case_title, court, remarks')
    .eq('notion_id', matterId)
    .single();

  if (matter) {
    entities.push({
      sourceType: 'matter',
      sourceId: matter.notion_id,
      text: [matter.name, matter.case_title && `Case: ${matter.case_title}`, matter.court && `Court: ${matter.court}`, matter.type && `Type: ${matter.type}`, matter.remarks && `Remarks: ${matter.remarks}`].filter(Boolean).join(' | '),
      metadata: { name: matter.name, matterCode: matter.matter_code, clientName: matter.client_name },
    });
  }

  // Deliverables
  const { data: deliverables } = await supabase
    .from('deliverables')
    .select('notion_id, name, type, status, external_due_date')
    .eq('matter_id', matterId);

  if (deliverables) {
    for (const d of deliverables) {
      entities.push({
        sourceType: 'deliverable',
        sourceId: d.notion_id,
        text: [d.name, d.type && `Type: ${d.type}`, d.status && `Status: ${d.status}`, d.external_due_date && `Due: ${d.external_due_date}`].filter(Boolean).join(' | '),
        metadata: { name: d.name, type: d.type, status: d.status },
      });
    }
  }

  // Hearings
  const { data: hearings } = await supabase
    .from('hearings')
    .select('notion_id, name, date, type, status')
    .eq('matter_id', matterId);

  if (hearings) {
    for (const h of hearings) {
      entities.push({
        sourceType: 'hearing',
        sourceId: h.notion_id,
        text: [h.name, h.date && `Date: ${h.date}`, h.type && `Type: ${h.type}`, h.status && `Status: ${h.status}`].filter(Boolean).join(' | '),
        metadata: { name: h.name, date: h.date, type: h.type },
      });
    }
  }

  // Files (metadata only)
  const { data: files } = await supabase
    .from('files')
    .select('notion_id, name, origin, action_taken, date_received')
    .eq('matter_id', matterId);

  if (files) {
    for (const f of files) {
      entities.push({
        sourceType: 'file',
        sourceId: f.notion_id,
        text: [f.name, f.origin && `Origin: ${f.origin}`, f.action_taken && `Action: ${f.action_taken}`, f.date_received && `Received: ${f.date_received}`].filter(Boolean).join(' | '),
        metadata: { name: f.name, origin: f.origin },
      });
    }
  }

  if (entities.length === 0) return 0;

  // Batch embed ALL entity texts in one Voyage API call
  const texts = entities.map((e) => e.text);
  // Routed through the gated helper rather than `@/lib/ai/voyage` directly:
  // this is a write path, so a firm that has not opted into `ai_search` is
  // refused before any text leaves.
  const vectors = await embedEntityTexts(firmId, texts);

  // Delete existing entity embeddings for this matter
  await supabase
    .from('embeddings')
    .delete()
    .eq('matter_id', matterId)
    .in('source_type', ['matter', 'deliverable', 'hearing', 'file']);

  // Insert all at once
  const rows = entities.map((e, i) => ({
    source_type: e.sourceType,
    source_id: e.sourceId,
    matter_id: matterId,
    chunk_index: 0,
    chunk_text: e.text,
    embedding: JSON.stringify(vectors[i]),
    metadata: e.metadata,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from('embeddings').upsert(rows, {
    onConflict: 'source_type,source_id,chunk_index',
  });
  if (error) {
    console.error(`[embeddings] Batch insert failed for matter ${matterId}:`, error.message);
    return 0;
  }

  console.log(`[embeddings] Batch embedded ${rows.length} entities for matter ${matterId}`);
  return rows.length;
}

async function embedAllEntities(
  supabase: SupabaseClient,
  firmId: string,
): Promise<number> {
  // Get all distinct matter_ids
  const { data: matters } = await supabase
    .from('matters')
    .select('notion_id');

  if (!matters) return 0;

  let total = 0;
  for (const m of matters) {
    try {
      total += await embedMatterEntities(supabase, firmId, m.notion_id);
      await delay(500); // Throttle between matters to avoid rate limits
    } catch { /* skip */ }
  }
  return total;
}
