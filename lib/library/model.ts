import { KB_KIND_LABELS, type KbKind, type KbStatus } from '@/lib/ai/kb-types';

/**
 * The Library is one table (kb_pages) holding two kinds of page: the firm
 * handbook, written by lawyers in the rich-text editor, and the pages the
 * system distilled from closed matters. This module holds the vocabulary and
 * the rules both the API and the UI apply, free of Supabase and React.
 */

export const HANDBOOK_KINDS = ['guide', 'policy', 'reference', 'announcement'] as const;
export type HandbookKind = (typeof HANDBOOK_KINDS)[number];
export const RULES_KIND = 'rules_of_court' as const;
export const CODE_KIND = 'legal_code' as const;
export type LibraryKind = KbKind | HandbookKind | typeof RULES_KIND | typeof CODE_KIND;
export type LibraryStatus = KbStatus;
export type ContentFormat = 'md' | 'html';

export const LIBRARY_KIND_LABELS: Record<LibraryKind, string> = {
  ...KB_KIND_LABELS,
  guide: 'Guide',
  policy: 'Policy',
  reference: 'Reference',
  announcement: 'Announcement',
  rules_of_court: 'Rules of Court',
  legal_code: 'Code',
};

export type LibrarySection = 'handbook' | 'distilled' | 'rules';

export const SECTION_LABELS: Record<LibrarySection, string> = {
  handbook: 'Firm handbook',
  distilled: 'From our matters',
  rules: 'Codes & Rules of Court',
};

/** Kinds shown under each section, in display order. */
export const SECTION_KINDS: Record<LibrarySection, LibraryKind[]> = {
  handbook: ['guide', 'policy', 'reference', 'announcement'],
  distilled: ['doctrine', 'template_clause', 'playbook', 'evidence_rule', 'court', 'judge', 'opposing_counsel', 'opposing_party', 'general'],
  rules: [CODE_KIND, RULES_KIND],
};

export const STATUS_LABELS: Record<LibraryStatus, string> = {
  draft: 'Draft',
  review: 'In review',
  published: 'Published',
  stale: 'Stale',
  archived: 'Archived',
};

export function isHandbookKind(kind: string): kind is HandbookKind {
  return (HANDBOOK_KINDS as readonly string[]).includes(kind);
}

/** The law itself: a code or a book of the Rules of Court. Its text changes by re-import, never by hand. */
export function isRulesKind(kind: string): boolean {
  return kind === RULES_KIND || kind === CODE_KIND;
}

export function sectionOf(kind: string): LibrarySection {
  if (isRulesKind(kind)) return 'rules';
  return isHandbookKind(kind) ? 'handbook' : 'distilled';
}

export function kindLabel(kind: string): string {
  return (LIBRARY_KIND_LABELS as Record<string, string>)[kind] ?? kind;
}

export function needsReview(status: string): boolean {
  return status === 'draft' || status === 'review';
}

/** Partners and admins review and publish everything; super_user passes every role check. */
export const REVIEWER_ROLES = ['partner', 'admin', 'super_user'] as const;
/** Lawyers author handbook pages too; every write is audited and versioned. */
export const AUTHOR_ROLES = ['lawyer', 'partner', 'admin', 'super_user'] as const;

export function isReviewer(role: string | null | undefined): boolean {
  return (REVIEWER_ROLES as readonly string[]).includes(role ?? '');
}

export function canAuthorHandbook(role: string | null | undefined): boolean {
  return (AUTHOR_ROLES as readonly string[]).includes(role ?? '');
}

/** Who may edit the content of a page of this kind. */
export function canEditKind(role: string | null | undefined, kind: string): boolean {
  // The codes and the Rules are the law's own text; they change by re-import, never by hand.
  if (isRulesKind(kind)) return false;
  return isHandbookKind(kind) ? canAuthorHandbook(role) : isReviewer(role);
}

/** Who may publish a page of this kind. Handbook pages publish by their authors; distilled pages need a reviewer. */
export function canPublishKind(role: string | null | undefined, kind: string): boolean {
  if (isRulesKind(kind)) return false;
  return isHandbookKind(kind) ? canAuthorHandbook(role) : isReviewer(role);
}

/** Deleting is the one action history cannot walk back; it stays with reviewers and covers handbook pages only. */
export function canDeleteKind(role: string | null | undefined, kind: string): boolean {
  return isHandbookKind(kind) && isReviewer(role);
}

/** Restoring a revision is an edit made by a reviewer: it can undo anyone's change. */
export function canRestoreKind(role: string | null | undefined, kind: string): boolean {
  return canEditKind(role, kind) && isReviewer(role);
}

/**
 * Why a page cannot be published right now, or null when it can. A page the
 * system wrote must cite its sources; a page a person wrote is their word.
 */
export function publishBlockedReason(page: { generated_by: string; kind: string }, citationCount: number): string | null {
  if (isHandbookKind(page.kind)) return null;
  if (page.generated_by === 'manual') return null;
  if (citationCount > 0) return null;
  return 'This page has no citations. A page the system drafted cannot be published until every claim is grounded in a source.';
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

/** Text for the embedding index: the page as a reader would hear it, whatever the format. */
export function plainText(content: string, format: ContentFormat): string {
  if (format !== 'html') return content;
  return content
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Strip the inline [M1][M2] grounding tags a generated page carries; the citations sidebar is the reader-facing trust layer. */
export function stripCitationTags(md: string): string {
  return md.replace(/ *\[M\d+\](?:\[M\d+\])*/g, '');
}

// ── Row shapes shared by the API and the UI ──

export interface LibraryPageSummary {
  id: number;
  slug: string;
  kind: LibraryKind;
  title: string;
  summary: string;
  status: LibraryStatus;
  content_format: ContentFormat;
  generated_by: string;
  model_used: string | null;
  author_id: string | null;
  author_name: string | null;
  pinned: boolean;
  version: number;
  external_url: string | null;
  visible_to_roles: string[] | null;
  created_at: string;
  updated_at: string;
  contributorCount: number;
}

export interface LibraryPageFull extends LibraryPageSummary {
  content_md: string;
  jurisdiction: string;
  last_generated_at: string | null;
}

export interface LibraryCitation {
  id: number;
  source_type: string;
  matter_id: string | null;
  matter_name: string | null;
  excerpt: string;
  confidence: number;
}

export interface LibraryContributor {
  matter_id: string;
  matter_name: string;
  matter_code: string | null;
}
