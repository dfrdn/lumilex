/**
 * Row shapes for the seed pack — the neutral starting content a firm needs on
 * day one, expressed as plain data so a test can validate it without a
 * database and the provisioning script only has to insert it.
 *
 * `firm_id` appears in none of them. Every seed row is stamped by
 * `getServiceDbForFirm(firmId)` at insert time; a seed module that carried its
 * own firm_id would be a foothold for filing one firm's content under another.
 *
 * Where a column has a CHECK constraint, the type here is the same closed union
 * the app already uses, so a bad value is a compile error rather than a 23514
 * partway through provisioning.
 */

import type { FeeScheduleContent } from '@/lib/fee-schedule/types';
import type { ScopeTemplateContent } from '@/lib/scope-library/types';
import type { FirmProfileContent } from '@/lib/firm-profile/types';
import type {
  ResolutionCategory,
  ResolutionKind,
  ResolutionVariableDef,
} from '@/types/corporations';

export type ResolutionVariable = ResolutionVariableDef;

export interface EnumOptionSeed {
  entity: string;
  field: string;
  value: string;
  sort_order: number;
  is_active: boolean;
  /** `matters.type` carries `{ code }` — the numeric prefix deriveMatterCode reads. */
  metadata: Record<string, unknown> | null;
}

export interface BillingRateSeed {
  position: string;
  hourly_rate: number;
  currency: string;
}

export interface FeeScheduleSeed {
  slug: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  content: FeeScheduleContent;
}

export interface ScopeTemplateSeed {
  slug: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  content: ScopeTemplateContent;
}

/** Matches the editor's shape in components/admin/TemplateManager.tsx. */
export interface DocumentPlaceholder {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date';
  required: boolean;
}

export interface DocumentTemplateSeed {
  name: string;
  /** The categories the template picker offers. */
  category: 'legal' | 'letter' | 'form' | 'report' | 'corporate';
  subcategory: string | null;
  description: string;
  /**
   * Only `'ai'` is seedable. A `'placeholder'` template is a DOCX in the
   * `templates` bucket, so it cannot ship as a data module — the firm uploads
   * its own through /admin/templates.
   */
  generation_mode: 'ai';
  ai_prompt: string;
  placeholders: DocumentPlaceholder[];
  /** CHECK-constrained; only meaningful on trademark report templates. */
  deadline_kind: null;
  is_active: boolean;
}

export interface EmailTemplateSeed {
  name: string;
  subject: string;
  body_html: string;
  category:
    | 'general'
    | 'court_filing'
    | 'client_update'
    | 'demand_letter'
    | 'follow_up'
    | 'engagement'
    | 'billing'
    | 'reminder'
    | 'overdue'
    | 'final';
  variables: string[];
  is_category_default: boolean;
}

export interface ResolutionTemplateSeed {
  /**
   * Firm-local key. `resolution_templates.id` is a GLOBAL text primary key, so
   * the provisioning script namespaces this with the firm's slug before
   * inserting — two firms seeding the same catalogue must not collide.
   */
  key: string;
  name: string;
  kind: ResolutionKind;
  category: ResolutionCategory;
  description: string;
  body_template: string;
  variable_schema: ResolutionVariable[];
  sort_order: number;
  is_active: boolean;
}

export interface SeedPack {
  enumOptions: EnumOptionSeed[];
  billingRates: BillingRateSeed[];
  feeSchedules: FeeScheduleSeed[];
  scopeTemplates: ScopeTemplateSeed[];
  documentTemplates: DocumentTemplateSeed[];
  emailTemplates: EmailTemplateSeed[];
  resolutionTemplates: ResolutionTemplateSeed[];
  firmProfile: FirmProfileContent;
}
