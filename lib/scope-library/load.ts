/**
 * Reading the firm's scope library. Shared by the admin CMS, the proposal
 * builder's line picker, and the drafting route that assembles section 1 —
 * all three must see the same text, or a partner picks a line whose wording
 * differs from the one the letter prints.
 *
 * Saved rows win; anything the firm hasn't edited yet falls back to the in-code
 * defaults, so a fresh database still drafts a correct scope section.
 */

import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { DEFAULT_SCOPE_TEMPLATES } from './default';
import type { LoadedScopeTemplate, ScopeTemplateContent, ScopeTemplateRow } from './types';

function fromDefault(content: ScopeTemplateContent, index: number): LoadedScopeTemplate {
  return {
    id: null,
    slug: content.slug,
    name: content.name,
    content,
    isActive: true,
    sortOrder: index,
    isTemplate: true,
  };
}

/**
 * Every scope line the firm publishes, saved rows layered over the defaults.
 * Service-role: a firm-wide reference document with no per-user scoping, read
 * on the drafting path where the assembly runs before any user-scoped write.
 */
export async function loadScopeTemplates(firmId: string): Promise<LoadedScopeTemplate[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('scope_templates')
    .select('*')
    .order('sort_order', { ascending: true })
    .returns<ScopeTemplateRow[]>();

  const saved = new Map((data ?? []).map((row) => [row.slug, row]));
  const merged: LoadedScopeTemplate[] = DEFAULT_SCOPE_TEMPLATES.map((content, i) => {
    const row = saved.get(content.slug);
    if (!row) return fromDefault(content, i);
    saved.delete(content.slug);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      content: row.content,
      isActive: row.is_active,
      sortOrder: row.sort_order,
      isTemplate: false,
    };
  });

  // Lines the firm added beyond the shipped defaults.
  for (const row of saved.values()) {
    merged.push({
      id: row.id,
      slug: row.slug,
      name: row.name,
      content: row.content,
      isActive: row.is_active,
      sortOrder: row.sort_order,
      isTemplate: false,
    });
  }

  return merged.sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));
}
