// Shared write path for scraped issuances. Opens a scrape-run row, dedups and
// inserts each item, fires a best-effort PDF snapshot, then closes the run.
//
// Consumed by both the external POST endpoint (app/api/issuances/scrape-batch)
// and the in-repo scrape cron (app/api/cron/issuances-scrape). Keeping it here
// means there's one write path and no internal HTTP hop between them.
//
// Service-role only: callers are CRON_SECRET-gated, and the issuances tables
// are deny-by-default under RLS (see CLAUDE.md "Crons must stay service-role").

import { after } from 'next/server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { isValidType, type SourceKey } from '@/lib/issuances/sources';
import type { IssuanceItem } from '@/lib/issuances/schema';
import { captureDocument } from '@/lib/issuances/capture';

export interface IngestSummary {
  run_id: number;
  items_found: number;
  items_new: number;
  items_low_conf: number;
  errors: number;
}

/**
 * Issuances are PH-jurisdiction-global content, but the tables are
 * tenant-keyed: callers scrape once and ingest the same batch into each
 * active firm (see app/api/cron/issuances-scrape), so `firmId` scopes every
 * row this writes.
 */
export async function ingestItems(
  firmId: string,
  source: SourceKey,
  items: IssuanceItem[],
  runStartedAt?: string,
): Promise<IngestSummary> {
  const supabase = getServiceDbForFirm(firmId);

  // Open a run row up front so partial failures still leave a trail.
  const { data: runRow, error: runErr } = await supabase
    .from('issuance_scrape_runs')
    .insert({
      source,
      started_at: runStartedAt ?? new Date().toISOString(),
      status: 'running',
      items_found: items.length,
    })
    .select('id')
    .single();
  if (runErr) {
    throw new Error(`Failed to open run row for source "${source}": ${runErr.message}`);
  }

  let itemsNew = 0;
  let itemsLowConf = 0;
  let errors = 0;
  const errorLog: string[] = [];

  for (const item of items) {
    if (!isValidType(source, item.type)) {
      errors++;
      errorLog.push(`Unknown type "${item.type}" for source "${source}"`);
      continue;
    }

    const row = {
      source,
      type: item.type,
      number: item.number ?? null,
      title: item.title,
      subject: item.subject ?? null,
      date_issued: item.date_issued ?? null,
      date_effective: item.date_effective ?? null,
      summary: item.summary ?? null,
      full_text: item.full_text ?? null,
      source_url: item.source_url,
      pdf_path: null,
      metadata: item.metadata ?? {},
      practice_areas: item.practice_areas ?? [],
      tags: item.tags ?? [],
      status: 'published',
      ai_confidence: item.ai_confidence,
      ai_flags: item.ai_flags ?? [],
      added_by: 'scraper',
    };

    // Insert and let UNIQUE(source, type, number) silently dedup. If number
    // is NULL we can't dedup at the DB level, so fall back to a soft check
    // on (source, type, title) — duplicates without a citation number are
    // rare enough that this is acceptable.
    let insertedId: number | null = null;
    if (item.number) {
      const { data: existing } = await supabase
        .from('issuances')
        .select('id')
        .eq('source', source)
        .eq('type', item.type)
        .eq('number', item.number)
        .maybeSingle();
      if (existing) continue;
    } else {
      const { data: existing } = await supabase
        .from('issuances')
        .select('id')
        .eq('source', source)
        .eq('type', item.type)
        .eq('title', item.title)
        .maybeSingle();
      if (existing) continue;
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('issuances')
      .insert(row)
      .select('id')
      .single();
    if (insertErr) {
      // 23505 = duplicate; happens if two runs race the dedup probe above.
      if (insertErr.code === '23505') continue;
      errors++;
      errorLog.push(`${item.type} ${item.number ?? item.title}: ${insertErr.message}`);
      continue;
    }
    insertedId = inserted.id;
    itemsNew++;
    if (item.ai_confidence === 'low') itemsLowConf++;

    // Durability capture (binary snapshot or full-text) runs after the response
    // via after(), so it completes on Vercel without blocking the run. It's
    // best-effort — the row is already usable with just its source_url.
    if (insertedId) {
      const captureItem = {
        source_url: item.source_url,
        pdf_url: item.pdf_url,
        full_text: item.full_text,
      };
      const id = insertedId;
      after(() => captureDocument(firmId, captureItem, id));
    }
  }

  await supabase
    .from('issuance_scrape_runs')
    .update({
      finished_at: new Date().toISOString(),
      status: errors === 0 ? 'success' : itemsNew > 0 ? 'partial' : 'failed',
      items_new: itemsNew,
      items_low_conf: itemsLowConf,
      errors,
      error_log: errorLog.length ? errorLog.join('\n') : null,
    })
    .eq('id', runRow.id);

  return {
    run_id: runRow.id,
    items_found: items.length,
    items_new: itemsNew,
    items_low_conf: itemsLowConf,
    errors,
  };
}
