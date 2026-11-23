import ts from 'typescript';
import { DELIVERABLE_STATUSES } from './deliverable-status';

/**
 * The rule behind `npm run verify:status-literal`: no string literal equal to a
 * deliverable status outside lib/deliverable-status.ts, unless it is counted
 * here with a reason.
 *
 * It exists because the vocabulary drifted when every file spelled it out:
 * six different answers to "what counts as done", three admin option lists
 * with three different subsets, and filters on statuses no deliverable has
 * ever held. A new literal fails until it is routed through the module or
 * named below.
 *
 * Several of the twelve strings are also other entities' values —
 * `matters.status` holds 'Archived', `corporations.esparc_status` holds
 * 'Drafting', `tasks.status` holds 'Not started' — so those uses are allowed
 * per file, with a count, rather than rewritten into deliverable constants
 * they have nothing to do with. The count is what makes this a ratchet: a new
 * literal in an allowlisted file still fails.
 *
 * Pure: the IO is scripts/audit-status-literals.ts.
 */

const VOCABULARY: ReadonlySet<string> = new Set(DELIVERABLE_STATUSES);

/**
 * The values a string literal names: itself, or — for a PostgREST list such
 * as `("Filed or Sent out","Archived")` passed to `.not('status', 'in', …)` —
 * each quoted item. Most of the drifted "open work" filters took that form,
 * so a rule that only matched whole literals would not see them.
 */
const PGRST_LIST = /^\(\s*"[^"]*"(\s*,\s*"[^"]*")*\s*\)$/;
function literalValues(text: string): string[] {
  if (!PGRST_LIST.test(text)) return [text];
  return [...text.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

export interface StatusLiteralHit {
  literal: string;
  line: number;
}

/**
 * Every string literal in the source whose whole value is a deliverable
 * status. Parsed, not grepped, so comments and a status quoted inside longer
 * text or a template do not count.
 */
export function findStatusLiterals(source: string, fileName = 'file.tsx'): StatusLiteralHit[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const hits: StatusLiteralHit[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      for (const value of literalValues(node.text)) {
        if (VOCABULARY.has(value)) hits.push({ literal: value, line });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

export type AllowlistEntry = { count: number; reason: string };
export type Allowlist = Readonly<Record<string, Readonly<Record<string, AllowlistEntry>>>>;

export interface Evaluation {
  /** Literals over their file's allowance — each one a failure. */
  violations: { file: string; literal: string; lines: number[]; allowed: number }[];
  /** Allowances now larger than what the file holds — shrink them. */
  stale: { file: string; literal: string; allowed: number; found: number }[];
}

export function evaluateStatusLiterals(
  hitsByFile: Readonly<Record<string, StatusLiteralHit[]>>,
  allowlist: Allowlist,
): Evaluation {
  const violations: Evaluation['violations'] = [];
  const stale: Evaluation['stale'] = [];

  for (const [file, hits] of Object.entries(hitsByFile)) {
    const byLiteral = new Map<string, number[]>();
    for (const h of hits) byLiteral.set(h.literal, [...(byLiteral.get(h.literal) ?? []), h.line]);
    for (const [literal, lines] of byLiteral) {
      const allowed = allowlist[file]?.[literal]?.count ?? 0;
      if (lines.length > allowed) violations.push({ file, literal, lines, allowed });
    }
  }

  for (const [file, literals] of Object.entries(allowlist)) {
    for (const [literal, entry] of Object.entries(literals)) {
      const found = (hitsByFile[file] ?? []).filter((h) => h.literal === literal).length;
      if (found < entry.count) stale.push({ file, literal, allowed: entry.count, found });
    }
  }

  return { violations, stale };
}

// ── The allowlist ──────────────────────────────────────────────────
//
// Grouped by what the string actually is. Every entry must say why it is not
// a deliverable status; "it was already there" is not a reason.

const ESPARC = 'corporations.esparc_status — the SEC registration pipeline, not a deliverable';
const COPY = 'UI copy that happens to spell a status word, not a stored value';
const SHARED_ARCHIVE =
  "the admin table's generic archive: the value it writes and tests for on any entity with a " +
  "status column, which is 'Archived' for matters and deliverables alike";

export const ALLOWED_STATUS_LITERALS: Allowlist = {
  'app/dashboard/partner/matters/MattersManagementPage.tsx': {
    Archived: { count: 2, reason: `${COPY}: the Archived tab label and KPI label` },
  },
  'app/dashboard/matters/MattersTable.tsx': {
    Archived: { count: 1, reason: `${COPY}: the Archived summary card's label, for matters` },
  },
  'app/portal/PortalLandingView.tsx': {
    Archived: { count: 2, reason: `${COPY}: the client-facing label for archived matters` },
  },
  'components/admin/AdminDataTable.tsx': {
    Archived: { count: 2, reason: `${SHARED_ARCHIVE} (pill colour, and the one constant every archive path writes and tests for)` },
  },
  'components/detail/CorporationComplianceTab.tsx': {
    Submitted: { count: 1, reason: `${COPY}: the compliance view says "Submitted" for a filed item` },
  },
  'components/detail/ComplianceGrid.tsx': {
    'Not started': { count: 1, reason: `${COPY}: the label of a compliance item's state (not_started), not a deliverable status` },
  },
  'components/detail/CorporationOverviewTab.tsx': {
    Drafting: { count: 1, reason: ESPARC },
  },
  'components/finance/DTRReviewDashboard.tsx': {
    Submitted: { count: 1, reason: `${COPY}: past tense of the finance "Submit" action` },
  },
  'lib/library/model.ts': {
    Archived: { count: 1, reason: `${COPY}: the label for kb_pages.status 'archived', a Library page state` },
  },
  'components/partner-lawyers/UtilizationTab.tsx': {
    Submitted: { count: 1, reason: `${COPY}: a utilization tally label` },
  },
};
