import './load-env';
import { getSupabase } from '../lib/supabase';
import { getServiceDbForFirm } from '../lib/tenancy/service-db';
import { SEED_RESOLUTION_TEMPLATES, resolutionTemplateId } from '../lib/provisioning/seed-pack';

/**
 * Re-seed one firm's resolution catalogue from the seed pack.
 *
 *   npx tsx scripts/seed-resolution-templates.ts <firmId> <firmSlug>
 *
 * scripts/provision-firm.ts already does this for a new firm; this script is
 * for topping an existing firm up after the catalogue in
 * lib/provisioning/seed-pack/resolution-templates.ts gains a template.
 *
 * It takes a firm explicitly and inserts only what is missing. Both matter:
 * `resolution_templates.id` is a GLOBAL text primary key with no (firm_id, id)
 * unique behind it, so the ids are namespaced `<slug>:<key>` — an un-namespaced
 * upsert on the bare keys would land on whichever firm seeded first and rewrite
 * its catalogue. And an existing row is left alone: a firm that has edited a
 * template's wording keeps its edit.
 */

async function main() {
  const [firmId, firmSlug] = process.argv.slice(2);
  if (!firmId || !firmSlug) {
    console.error('Usage: npx tsx scripts/seed-resolution-templates.ts <firmId> <firmSlug>');
    process.exit(1);
  }

  const raw = getSupabase();
  const { data: firm } = await raw.from('firms').select('slug, name').eq('id', firmId).maybeSingle();
  if (!firm) {
    console.error(`No firm with id ${firmId}.`);
    process.exit(1);
  }
  if (firm.slug !== firmSlug) {
    console.error(
      `Firm ${firmId} has slug "${firm.slug}", not "${firmSlug}". The slug namespaces the ` +
        'template ids, so seeding with the wrong one would write unreachable rows.',
    );
    process.exit(1);
  }

  const supabase = getServiceDbForFirm(firmId, raw);
  const { data: existingRows } = await supabase.from('resolution_templates').select('id');
  const existing = new Set((existingRows ?? []).map((r) => r.id as string));

  const missing = SEED_RESOLUTION_TEMPLATES.filter(
    (t) => !existing.has(resolutionTemplateId(firmSlug, t.key)),
  );

  if (missing.length === 0) {
    console.log(`[seed] ${firm.name}: all ${SEED_RESOLUTION_TEMPLATES.length} templates present`);
    return;
  }

  const { error } = await supabase.from('resolution_templates').insert(
    missing.map((t) => ({
      id: resolutionTemplateId(firmSlug, t.key),
      name: t.name,
      kind: t.kind,
      category: t.category,
      description: t.description,
      body_template: t.body_template,
      variable_schema: t.variable_schema,
      is_active: t.is_active,
      sort_order: t.sort_order,
    })),
  );
  if (error) {
    console.error('[seed] insert failed', error);
    process.exit(1);
  }

  console.log(
    `[seed] ${firm.name}: inserted ${missing.length} of ${SEED_RESOLUTION_TEMPLATES.length} resolution templates`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
