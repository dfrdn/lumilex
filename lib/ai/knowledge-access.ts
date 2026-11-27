import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Access scoping for knowledge search results.
 *
 * The vector query runs on the firm-scoped service client (the embeddings
 * table has no policies), so it sees every chunk in the firm. Before results
 * reach a person they are narrowed to what that person could open on the
 * site: matter-scoped sources need `has_matter_access`, Library pages need
 * the page itself — some are limited to roles, and an unpublished page is not
 * an answer yet — and firm-wide sources (incoming files and their analyses,
 * the Rules of Court and the codes) pass as-is, the same split the RLS policies on those
 * tables make.
 */

/** Source types every active team member can read regardless of matter. */
export const FIRM_WIDE_SOURCE_TYPES: ReadonlySet<string> = new Set(['file', 'file_analysis', 'court_rule', 'code_provision']);

/** Library pages: checked page by page against the viewer's own RLS. */
export const LIBRARY_SOURCE_TYPES: ReadonlySet<string> = new Set(['kb_page']);

export interface AccessScope {
  /** Matters the viewer can read (RLS-filtered). */
  matterIds: ReadonlySet<string>;
  /** Published Library pages the viewer can read (RLS-filtered). */
  pageIds: ReadonlySet<string>;
}

export interface AccessCheckable {
  sourceType: string;
  sourceId: string;
  matterId: string | null;
}

/** Anything not known to be firm-wide or a Library page is treated as matter-scoped, so a new source type fails closed. */
export function isVisibleTo(item: AccessCheckable, scope: AccessScope): boolean {
  if (FIRM_WIDE_SOURCE_TYPES.has(item.sourceType)) return true;
  if (LIBRARY_SOURCE_TYPES.has(item.sourceType)) return scope.pageIds.has(item.sourceId);
  return item.matterId != null && scope.matterIds.has(item.matterId);
}

export function filterVisible<T extends AccessCheckable>(items: T[], scope: AccessScope): T[] {
  return items.filter((item) => isVisibleTo(item, scope));
}

/**
 * Probe the viewer's RLS-scoped client for the matters and Library pages the
 * candidate results reference. Rows the policies hide simply don't come back.
 */
export async function resolveAccessScope(
  viewer: SupabaseClient,
  items: AccessCheckable[],
): Promise<AccessScope> {
  const matterIds = [
    ...new Set(
      items
        .filter((i) => !FIRM_WIDE_SOURCE_TYPES.has(i.sourceType) && !LIBRARY_SOURCE_TYPES.has(i.sourceType))
        .map((i) => i.matterId)
        .filter((id): id is string => !!id),
    ),
  ];
  const pageIds = [
    ...new Set(
      items
        .filter((i) => LIBRARY_SOURCE_TYPES.has(i.sourceType))
        .map((i) => Number(i.sourceId))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];

  const [matters, pages] = await Promise.all([
    matterIds.length > 0
      ? viewer.from('matters').select('notion_id').in('notion_id', matterIds)
      : Promise.resolve({ data: [] as { notion_id: string }[] }),
    pageIds.length > 0
      ? viewer.from('kb_pages').select('id').in('id', pageIds).eq('status', 'published')
      : Promise.resolve({ data: [] as { id: number }[] }),
  ]);

  return {
    matterIds: new Set((matters.data ?? []).map((m: { notion_id: string }) => m.notion_id)),
    pageIds: new Set((pages.data ?? []).map((p: { id: number }) => String(p.id))),
  };
}
