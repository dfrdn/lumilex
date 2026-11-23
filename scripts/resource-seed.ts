import './load-env';
import { getSupabase } from '../lib/supabase';
import { getServiceDbForFirm } from '../lib/tenancy/service-db';
import type { HandbookKind } from '../lib/library/model';
import { sanitizeHandbookHtml } from '../lib/sanitize-html';

/**
 * Shared front end for the Library handbook seed scripts (guides, playbooks,
 * protocols, style guide). They write handbook pages into `kb_pages`, the one
 * Library table since `20260928_library_merge.sql` folded `resources` into it.
 *
 * Each of those scripts is a body of content plus one insert, and every one of
 * them wrote through a raw service-role client with no firm. That worked while
 * `firm_id` had a transitional default and has raised 23502 since it was
 * dropped (`20260823_drop_transitional_firm_defaults.sql`). Ten near-copies
 * of the same fix is how one of them drifts, so the firm argument, the
 * resolution, the scoped client and the idempotency rule live here once and the
 * scripts supply only their content.
 *
 * Shape follows scripts/seed-fee-schedules.ts and
 * scripts/seed-resolution-templates.ts: a required firm argument, writes through
 * `getServiceDbForFirm` (which stamps `firm_id`), and inserts only what is
 * missing. An existing row is left alone — a firm that has edited a guide keeps
 * its edit — so a second run is a no-op. `--force` overwrites, which is what the
 * update-only scripts used to do unconditionally.
 *
 *   npx tsx scripts/seed-<name>.ts <firmIdOrSlug> [--force]
 */

export interface SeedResource {
  /** Firm-local identifier. Unique per `kb_pages_firm_slug_key (firm_id, slug)`. */
  slug: string;
  title: string;
  /** The card summary. */
  excerpt: string;
  /** Rich-text HTML, as the Library editor writes it. */
  content?: string;
  /** For pages that link out to an asset rather than holding prose. */
  external_url?: string;
  category?: HandbookKind;
  is_published?: boolean;
  pinned?: boolean;
  visible_to_roles?: string[];
}

interface Firm {
  id: string;
  slug: string;
  name: string;
}

async function resolveFirm(scriptName: string, requested: string | undefined): Promise<Firm> {
  if (!requested) {
    console.error(`Usage: npx tsx scripts/${scriptName}.ts <firmIdOrSlug> [--force]`);
    process.exit(1);
  }

  const { data } = await getSupabase().from('firms').select('id, slug, name').order('slug');
  const firms = (data ?? []) as Firm[];
  const hit = firms.find((f) => f.id === requested || f.slug === requested);
  if (!hit) {
    console.error(
      `No firm matching "${requested}". Known firms: ${firms.map((f) => f.slug).join(', ') || '(none)'}`,
    );
    process.exit(1);
  }
  return hit;
}

/**
 * Seed one handbook page into one firm's Library.
 *
 * `author_name` is the firm's own name rather than a constant: these rows are
 * displayed to that firm's staff, and the scripts previously stamped the origin
 * firm's name into every tenant that ran them.
 */
export async function seedResource(scriptName: string, resource: SeedResource): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const firm = await resolveFirm(scriptName, args.find((a) => !a.startsWith('--')));

  const supabase = getServiceDbForFirm(firm.id);
  const { data: existing } = await supabase
    .from('kb_pages')
    .select('id')
    .eq('slug', resource.slug)
    .maybeSingle();

  const row = {
    title: resource.title,
    summary: resource.excerpt,
    content_md: sanitizeHandbookHtml(resource.content ?? ''),
    content_format: 'html',
    external_url: resource.external_url ?? null,
    kind: resource.category ?? 'guide',
    status: (resource.is_published ?? true) ? 'published' : 'draft',
    pinned: resource.pinned ?? false,
    visible_to_roles: resource.visible_to_roles ?? null,
  };

  if (existing) {
    if (!force) {
      console.log(
        `[seed] ${firm.name}: "${resource.title}" already present (id=${existing.id}) — left alone. Pass --force to overwrite.`,
      );
      return;
    }
    const { error } = await supabase
      .from('kb_pages')
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) {
      console.error('[seed] update failed', error);
      process.exit(1);
    }
    console.log(`[seed] ${firm.name}: overwrote "${resource.title}" (id=${existing.id})`);
    return;
  }

  const { data, error } = await supabase
    .from('kb_pages')
    .insert({
      ...row,
      slug: resource.slug,
      jurisdiction: '',
      generated_by: 'manual',
      author_id: 'system',
      author_name: firm.name,
    })
    .select('id')
    .single();
  if (error) {
    console.error('[seed] insert failed', error);
    process.exit(1);
  }
  console.log(`[seed] ${firm.name}: created "${resource.title}" (id=${data.id})`);
}

/** Wrap a seed script's entry point so a throw exits non-zero rather than warning. */
export function runSeed(scriptName: string, resource: SeedResource): void {
  seedResource(scriptName, resource).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
