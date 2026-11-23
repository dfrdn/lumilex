// Shared types for the firm-wide Knowledge Base (KMS).

export type KbKind =
  | 'doctrine'
  | 'template_clause'
  | 'judge'
  | 'court'
  | 'opposing_counsel'
  | 'opposing_party'
  | 'playbook'
  | 'general'
  | 'evidence_rule';

export type KbStatus = 'draft' | 'review' | 'published' | 'stale' | 'archived';

/** One observation a single matter contributes about one knowledge entity. */
export interface KbSignal {
  kind: KbKind;
  /** Canonical key — kebab-case slug used to group the same entity across matters. */
  key: string;
  /** Human title for the entity (e.g. "Forum Shopping", "Hon. Maria Santos"). */
  title: string;
  /** What THIS matter teaches about the entity — the citable observation. */
  observation: string;
  confidence: number; // 0..1
}

/** A signal tagged with the matter + source it came from (for citations). */
export interface KbSignalWithSource extends KbSignal {
  matterId: string;
  matterName: string;
  sourceType: 'matter_summary' | 'file_analysis' | 'deliverable_version';
  sourceId: string;
}

export interface KbExtractionResult {
  doctrineTags: string[];
  signals: KbSignal[];
  model: string;
}

/** A citation the page-writer grounds a claim in. */
export interface KbCitation {
  matterId: string;
  sourceType: 'matter_summary' | 'file_analysis' | 'deliverable_version';
  sourceId: string;
  excerpt: string;
  confidence: number;
}

export interface KbPageDraft {
  contentMd: string;
  summary: string;
  citations: KbCitation[];
  model: string;
}

export const KB_KIND_LABELS: Record<KbKind, string> = {
  doctrine: 'Doctrine',
  template_clause: 'Template Clause',
  judge: 'Judge',
  court: 'Court',
  opposing_counsel: 'Opposing Counsel',
  opposing_party: 'Opposing Party',
  playbook: 'Playbook',
  general: 'General',
  evidence_rule: 'Evidence Rule',
};

/** Normalize a free-text entity name into a stable kebab-case key. */
export function kbKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

/** Slug for a page: kind + key, globally unique. */
export function kbSlug(kind: KbKind, key: string): string {
  return `${kind}--${key}`;
}
