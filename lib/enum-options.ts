/**
 * Single registry of dropdown option lists used across the app.
 *
 * Authoritative values live in `public.enum_options` and can be edited by
 * admins via /admin/settings/enums (and by finance for the reimbursements
 * group via /finance/settings/expense-categories). The DEFAULTS map below
 * is the bootstrap fallback used when the DB is empty / unreachable so the
 * UI never renders an empty select.
 *
 * Identifiers (entity, field) match the underlying Supabase column for
 * easy grep — e.g. `meetings.type`, `files.origin`.
 */

import { getServiceDbForFirm } from './tenancy/service-db';

export interface EnumOption {
  id?: number;
  entity: string;
  field: string;
  value: string;
  sort_order: number;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
}

export interface EnumGroupKey {
  entity: string;
  field: string;
}

/** Every (entity, field) group exposed by the editor. */
export const ENUM_GROUPS: Array<EnumGroupKey & { label: string; description?: string }> = [
  { entity: 'matters',        field: 'type',             label: 'Matter Types',           description: 'Drives matter-code numbering. Edit metadata.code on a row to change its numeric prefix.' },
  { entity: 'deliverables',   field: 'type',             label: 'Deliverable Types' },
  { entity: 'deliverables',   field: 'subtype',          label: 'Deliverable Subtypes',   description: 'Pleading / document type (Judicial Affidavit, Motion, …). Drives the affidavit-reviewer hook and document filtering.' },
  { entity: 'meetings',       field: 'type',             label: 'Meeting Types' },
  { entity: 'hearings',       field: 'type',             label: 'Hearing Types' },
  { entity: 'files',          field: 'origin',           label: 'File Origins' },
  { entity: 'trademarks',     field: 'type',             label: 'Trademark Types' },
  { entity: 'ph_holidays',    field: 'type',             label: 'PH Holiday Types' },
  { entity: 'leaves',         field: 'leave_type',       label: 'Leave Types' },
  { entity: 'feedbacks',      field: 'type',             label: 'Feedback Types' },
  { entity: 'reimbursements', field: 'expense_category', label: 'Reimbursement Categories' },
  { entity: 'firm_expenses',  field: 'category',         label: 'Firm Expense Categories', description: 'Categories for the firm’s own operating expenses (rent, payroll, utilities…).' },
];

/** The groups finance (not just admin) is allowed to edit. */
export const FINANCE_EDITABLE: EnumGroupKey[] = [
  { entity: 'reimbursements', field: 'expense_category' },
  { entity: 'firm_expenses', field: 'category' },
];

export function isFinanceEditable(g: EnumGroupKey): boolean {
  return FINANCE_EDITABLE.some((e) => e.entity === g.entity && e.field === g.field);
}

export { DEFAULTS, getDefaultValues } from './enum-defaults';
import { DEFAULTS, getDefaultValues } from './enum-defaults';

/**
 * Server-side fetch of every enum group. Returns a nested map keyed by
 * entity → field → ordered list of active values. Falls back to DEFAULTS
 * for any group the DB returns nothing for.
 */
export async function fetchAllEnumOptions(firmId: string): Promise<Record<string, Record<string, string[]>>> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('enum_options')
    .select('entity, field, value, sort_order, is_active')
    .eq('is_active', true)
    .order('entity', { ascending: true })
    .order('field', { ascending: true })
    .order('sort_order', { ascending: true });

  const out: Record<string, Record<string, string[]>> = {};
  if (!error && data) {
    for (const row of data as Array<Pick<EnumOption, 'entity' | 'field' | 'value'>>) {
      (out[row.entity] ??= {})[row.field] ??= [];
      out[row.entity][row.field].push(row.value);
    }
  }
  for (const [entity, fields] of Object.entries(DEFAULTS)) {
    for (const field of Object.keys(fields)) {
      if (!out[entity]?.[field]?.length) {
        (out[entity] ??= {})[field] = getDefaultValues(entity, field);
      }
    }
  }
  return out;
}

/**
 * Server-side fetch of one group. Used by API routes that need an
 * authoritative list (e.g. matter-code generation reading metadata.code).
 */
export async function fetchEnumOptions(firmId: string, entity: string, field: string): Promise<EnumOption[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('enum_options')
    .select('id, entity, field, value, sort_order, is_active, metadata')
    .eq('entity', entity)
    .eq('field', field)
    .order('sort_order', { ascending: true });
  if (error || !data) return [];
  return data as EnumOption[];
}

/**
 * Server-side fetch of matter-type → numeric-code map. Replaces the
 * hardcoded MATTER_TYPE_CODES record in lib/admin/entity-config.ts for
 * server callers (matter-code generation). Falls back to the entity-config
 * defaults if the DB row is missing metadata.code.
 */
export async function fetchMatterTypeCodes(firmId: string): Promise<Record<string, number>> {
  const rows = await fetchEnumOptions(firmId, 'matters', 'type');
  const out: Record<string, number> = {};
  for (const row of rows) {
    const code = row.metadata && typeof (row.metadata as { code?: unknown }).code === 'number'
      ? (row.metadata as { code: number }).code
      : null;
    if (code != null) out[row.value] = code;
  }
  return out;
}
