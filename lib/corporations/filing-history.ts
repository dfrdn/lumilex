import type { CorporationFile } from '@/types/corporations';
import { isFinalized } from '@/lib/deliverable-status';

/**
 * The reportorial filing record, one row per (filing, year).
 *
 * The obligation and the evidence live in different tables — the deadline is a
 * deliverable, the filed copy is a corporation_file — and nothing joined them,
 * so "what did we file in 2024 and where is it?" could only be answered by
 * cross-referencing two tabs by eye. This joins them on year.
 */

export type FilingKind = 'GIS' | 'AFS';

/** Deliverable fields this needs; the table row is wider than this. */
export interface FilingDeliverable {
  notionId: string;
  name: string;
  type: string;
  externalDueDate: string | null;
  status: string;
}

export interface FilingRow {
  kind: FilingKind;
  year: number;
  dueDate: string | null;
  /** Status of the obligation, when one is tracked. */
  status: string | null;
  deliverableId: string | null;
  documents: CorporationFile[];
  /** Tracked and marked done, but nobody attached the filed copy. */
  filedWithoutDocument: boolean;
  /** A document exists for a year no obligation was ever raised. */
  documentWithoutObligation: boolean;
}

export function isFiled(status: string | null | undefined): boolean {
  return isFinalized((status ?? '').trim());
}

const KIND_BY_DELIVERABLE_TYPE: Record<string, FilingKind> = {
  'SEC GIS': 'GIS',
  'SEC AFS': 'AFS',
};

/**
 * Pull the year out of a generated deadline name — "… (2025)" or "… (FY 2025)".
 *
 * Falls back to the due date's year minus one, because a GIS or AFS is always
 * filed in the year following the one it covers.
 */
export function yearOf(d: FilingDeliverable): number | null {
  const m = d.name.match(/\((?:FY\s*)?(\d{4})\)\s*$/i);
  if (m) return Number(m[1]);
  if (d.externalDueDate) {
    const y = Number(d.externalDueDate.slice(0, 4));
    if (Number.isFinite(y)) return y - 1;
  }
  return null;
}

export function buildFilingHistory(
  deliverables: FilingDeliverable[],
  files: CorporationFile[],
): FilingRow[] {
  const rows = new Map<string, FilingRow>();

  const rowFor = (kind: FilingKind, year: number): FilingRow => {
    const key = `${kind}|${year}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        kind,
        year,
        dueDate: null,
        status: null,
        deliverableId: null,
        documents: [],
        filedWithoutDocument: false,
        documentWithoutObligation: false,
      };
      rows.set(key, row);
    }
    return row;
  };

  for (const d of deliverables) {
    const kind = KIND_BY_DELIVERABLE_TYPE[d.type];
    if (!kind) continue;
    const year = yearOf(d);
    if (year === null) continue;
    const row = rowFor(kind, year);
    // A year can carry more than one deliverable after a double-spawn; the one
    // that's been acted on is the truthful record.
    if (row.deliverableId === null || (!isFiled(row.status) && isFiled(d.status))) {
      row.deliverableId = d.notionId;
      row.dueDate = d.externalDueDate;
      row.status = d.status;
    }
  }

  for (const f of files) {
    if (f.category !== 'GIS' && f.category !== 'AFS') continue;
    if (f.filingYear == null) continue;
    rowFor(f.category as FilingKind, f.filingYear).documents.push(f);
  }

  for (const row of rows.values()) {
    row.filedWithoutDocument = isFiled(row.status) && row.documents.length === 0;
    row.documentWithoutObligation = row.deliverableId === null && row.documents.length > 0;
  }

  // Most recent year first — that's what anyone is looking for.
  return [...rows.values()].sort((a, b) => b.year - a.year || a.kind.localeCompare(b.kind));
}

/** Years with a GIS obligation already on file, for the generator's year picker. */
export function filedYears(rows: FilingRow[], kind: FilingKind): Set<number> {
  return new Set(rows.filter((r) => r.kind === kind && isFiled(r.status)).map((r) => r.year));
}
