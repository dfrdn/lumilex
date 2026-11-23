import { cache } from 'react';
import 'server-only';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

/**
 * Look up an entity's display name for a browser-tab title in `generateMetadata`.
 * Uses the authed (RLS-scoped) client, so a user who can't see the row gets the
 * fallback rather than a leaked name. Never throws — a missing name or denied
 * read resolves to `null`. Wrapped in React `cache()` so repeat lookups of the
 * same row within one request collapse to a single query.
 */
export const fetchEntityName = cache(async (
  table: string,
  idColumn: string,
  id: string,
  nameColumn: string,
): Promise<string | null> => {
  try {
    const supabase = await getSupabaseServerAuthClient();
    const { data } = await supabase
      .from(table)
      .select(nameColumn)
      .eq(idColumn, id)
      .maybeSingle();
    const value = (data as Record<string, unknown> | null)?.[nameColumn];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
});

/** Resolve an entity's tab title, falling back to a generic label. */
export async function entityTitle(opts: {
  table: string;
  idColumn: string;
  id: string;
  nameColumn: string;
  fallback: string;
}): Promise<string> {
  const name = await fetchEntityName(opts.table, opts.idColumn, opts.id, opts.nameColumn);
  return name ?? opts.fallback;
}

/**
 * Title specs for the dynamic `[entity]/[id]` detail routes, kept in one place
 * so the admin and dashboard variants don't each carry their own copy.
 */
type DetailTitleSpec = { idColumn: string; nameColumn: string; fallback: string; table?: string };

const DETAIL_ENTITY_TITLES: Record<string, DetailTitleSpec> = {
  announcements: { idColumn: 'notion_id', nameColumn: 'name', fallback: 'Announcement' },
  tasks: { idColumn: 'notion_id', nameColumn: 'name', fallback: 'Task' },
  meetings: { idColumn: 'notion_id', nameColumn: 'name', fallback: 'Meeting' },
  deliverables: { idColumn: 'notion_id', nameColumn: 'name', fallback: 'Deliverable' },
  hearings: { idColumn: 'notion_id', nameColumn: 'name', fallback: 'Hearing' },
  // A filing is a deliverable; the `filings` view is retired.
  filings: { table: 'deliverables', idColumn: 'notion_id', nameColumn: 'name', fallback: 'Filing' },
  clients: { idColumn: 'notion_id', nameColumn: 'name', fallback: 'Client' },
  matters: { idColumn: 'notion_id', nameColumn: 'name', fallback: 'Matter' },
  files: { idColumn: 'notion_id', nameColumn: 'name', fallback: 'File' },
  trademarks: { idColumn: 'id', nameColumn: 'mark', fallback: 'Trademark' },
};

/** Tab title for a dynamic `[entity]/[id]` detail route; unknown entity → 'Detail'. */
export async function detailRouteTitle(entity: string, id: string): Promise<string> {
  const spec = DETAIL_ENTITY_TITLES[entity];
  if (!spec) return 'Detail';
  return entityTitle({ table: spec.table ?? entity, idColumn: spec.idColumn, id, nameColumn: spec.nameColumn, fallback: spec.fallback });
}
