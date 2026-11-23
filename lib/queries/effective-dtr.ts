import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

// ── Types ──────────────────────────────────────────────────────────

/** Snapshot of editable DTR fields, shared by raw rows, revision snapshots, and effective rows. */
export interface DTRSnapshot {
  hours: number;
  minutes: number;
  date: string | null;
  lawyerName: string;
  /** team.person_id of the author — stable across renames, so position and rate
   *  resolve even when the display name has moved on. Null (or absent) for rows
   *  with no resolvable author and for finance-added revision snapshots
   *  (dtr_revisions records only a name); callers fall back to lawyerName. */
  lawyerPersonId?: string | null;
  withIds: string[];
  withNames: string[];
  task: string;
  remarks: string;
  matterId: string | null;
  clientName: string;
  billed: boolean;
  nonBillable: boolean;
  /** Attendee lawyer-names whose fanned line is waived (shown but billed ₱0).
   *  Waive is per-attendee: waiving one lawyer on a multi-attendee DTR must not
   *  waive the co-attendees. Empty = nothing waived. Distinct from exclude,
   *  which drops the whole entry. */
  waivedWith: string[];
}

/** A raw DTR row with raw-only audit fields. */
export interface RawDTR extends DTRSnapshot {
  notionId: string;
  notionUrl: string;
  createdTime: string | null;
  updatedAt: string;
}

/** Latest revision applied to a logical entity within a bundle. */
export interface RevisionMeta {
  id: number;
  action: 'set' | 'exclude' | 'waive';
  editedBy: string;
  editedAt: string;
  /** True when raw.updated_at > revision.edited_at — surfaces the "raw moved underneath us" warning. */
  rawIsNewerThanRevision: boolean;
}

/** A single logical entity in a (billing_month, client_name) bundle, with raw+revision+effective views. */
export interface DTRBundleEntry {
  /** Identity. Exactly one of rawId / createdEntryKey is non-null. */
  rawId: string | null;
  createdEntryKey: string | null;

  /** Bundle scope. */
  billingMonth: string;
  clientName: string;

  /** Raw DTR snapshot, or null for finance-created entries. */
  raw: RawDTR | null;
  /** Latest revision metadata, or null when no revision exists. */
  revision: RevisionMeta | null;
  /** Effective snapshot — what gets billed / shown to finance + partners. Null when revision excludes. */
  effective: DTRSnapshot | null;
}

export interface GetBundleEntriesOpts {
  /** 'YYYY-MM' */
  billingMonth: string;
  /** Limit to specific clients. Omit for all clients with activity in the month. */
  clientNames?: string[];
  /** Default true. When false, non-billable rows are dropped from effective output. */
  includeNonBillable?: boolean;
}

// ── Internal row shapes (snake_case from Supabase) ───────────────────

interface RawDTRRow {
  notion_id: string;
  notion_url: string;
  remarks: string;
  task: string;
  hours: number;
  minutes: number;
  date: string | null;
  lawyer_name: string;
  lawyer_person_id: string | null;
  with_ids: string[] | null;
  with_names: string[] | null;
  client_name: string;
  matter_id: string | null;
  billed: boolean;
  non_billable: boolean;
  created_time: string | null;
  updated_at: string;
}

interface RevisionRow {
  id: number;
  billing_month: string;
  client_name: string;
  original_dtr_id: string | null;
  created_entry_key: string | null;
  action: 'set' | 'exclude' | 'waive';
  hours: number | null;
  minutes: number | null;
  date: string | null;
  lawyer_name: string | null;
  with_ids: string[] | null;
  with_names: string[] | null;
  task: string | null;
  remarks: string | null;
  matter_id: string | null;
  billed: boolean | null;
  non_billable: boolean | null;
  waived_with: string[] | null;
  edited_by: string;
  edited_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────

function monthBounds(billingMonth: string): { start: string; end: string } {
  const [yStr, mStr] = billingMonth.split('-');
  const y = parseInt(yStr);
  const m = parseInt(mStr);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    start: `${yStr}-${mStr}-01`,
    end: `${yStr}-${mStr}-${String(lastDay).padStart(2, '0')}`,
  };
}

function rawRowToDTR(r: RawDTRRow): RawDTR {
  return {
    notionId: r.notion_id,
    notionUrl: r.notion_url,
    hours: r.hours ?? 0,
    minutes: r.minutes ?? 0,
    date: r.date,
    lawyerName: r.lawyer_name ?? '',
    lawyerPersonId: r.lawyer_person_id ?? null,
    withIds: r.with_ids ?? [],
    withNames: r.with_names ?? [],
    task: r.task ?? '',
    remarks: r.remarks ?? '',
    matterId: r.matter_id,
    clientName: r.client_name ?? '',
    billed: !!r.billed,
    nonBillable: !!r.non_billable,
    waivedWith: [],
    createdTime: r.created_time,
    updatedAt: r.updated_at,
  };
}

function revisionToSnapshot(rev: RevisionRow, fallbackClient: string): DTRSnapshot {
  return {
    hours: rev.hours ?? 0,
    minutes: rev.minutes ?? 0,
    date: rev.date,
    lawyerName: rev.lawyer_name ?? '',
    // dtr_revisions stores only a name. Inherited from the raw row in
    // getDTRBundleEntries when the revision left the lawyer alone.
    lawyerPersonId: null,
    withIds: rev.with_ids ?? [],
    withNames: rev.with_names ?? [],
    task: rev.task ?? '',
    remarks: rev.remarks ?? '',
    matterId: rev.matter_id,
    clientName: fallbackClient,
    billed: !!rev.billed,
    nonBillable: !!rev.non_billable,
    // Per-attendee waive: the listed names are waived. A legacy 'waive' revision
    // with no waived_with means the whole entry (all attendees) is waived.
    waivedWith: rev.action === 'waive'
      ? (rev.waived_with ?? [rev.lawyer_name, ...(rev.with_names ?? [])].filter((n): n is string => !!n))
      : [],
  };
}

// ── Main query ──────────────────────────────────────────────────────

/**
 * Returns one DTRBundleEntry per logical entity in the (billing_month, client_name)
 * bundle(s). Each entry exposes its raw, latest revision, and effective view so
 * callers can render diffs (review UIs) or just consume the effective snapshot
 * (export, invoice generation, analytics).
 *
 * Logical entities are identified by either the raw `dtr.notion_id` (when finance
 * is editing an existing row) or by a `created_entry_key` (when finance has added
 * a new row that doesn't exist in `dtr`). Multiple revisions per entity are
 * collapsed to the latest by `edited_at`.
 */
export async function getDTRBundleEntries(firmId: string, opts: GetBundleEntriesOpts): Promise<DTRBundleEntry[]> {
  const { billingMonth, clientNames, includeNonBillable = true } = opts;
  if (!/^\d{4}-\d{2}$/.test(billingMonth)) {
    throw new Error(`billingMonth must be YYYY-MM, got ${billingMonth}`);
  }

  const { start, end } = monthBounds(billingMonth);
  const supabase = getServiceDbForFirm(firmId);

  // ── Fetch raw + revisions in parallel ──
  const rawQuery = supabase
    .from('dtr')
    .select(
      'notion_id, notion_url, remarks, task, hours, minutes, date, lawyer_name, lawyer_person_id, with_ids, with_names, client_name, matter_id, billed, non_billable, created_time, updated_at'
    )
    .gte('date', start)
    .lte('date', end);
  if (clientNames && clientNames.length > 0) {
    rawQuery.in('client_name', clientNames);
  }

  const revQuery = supabase
    .from('dtr_revisions')
    .select(
      'id, billing_month, client_name, original_dtr_id, created_entry_key, action, hours, minutes, date, lawyer_name, with_ids, with_names, task, remarks, matter_id, billed, non_billable, waived_with, edited_by, edited_at'
    )
    .eq('billing_month', billingMonth);
  if (clientNames && clientNames.length > 0) {
    revQuery.in('client_name', clientNames);
  }

  const [{ data: rawData, error: rawErr }, { data: revData, error: revErr }] = await Promise.all([
    rawQuery,
    revQuery,
  ]);
  if (rawErr) throw rawErr;
  if (revErr) throw revErr;

  const rawRows = (rawData ?? []) as RawDTRRow[];
  const revRows = (revData ?? []) as RevisionRow[];

  // ── Collapse revisions: keep latest per (bundle, entity) ──
  // Key shape: `${billing_month}|${client_name}|orig:${notion_id}` or `${...}|new:${created_entry_key}`
  const latestRev = new Map<string, RevisionRow>();
  const keyFor = (
    billingMonth: string,
    clientName: string,
    originalDtrId: string | null,
    createdEntryKey: string | null
  ) =>
    originalDtrId !== null
      ? `${billingMonth}|${clientName}|orig:${originalDtrId}`
      : `${billingMonth}|${clientName}|new:${createdEntryKey ?? ''}`;

  for (const rev of revRows) {
    const k = keyFor(rev.billing_month, rev.client_name, rev.original_dtr_id, rev.created_entry_key);
    const prev = latestRev.get(k);
    if (!prev || rev.edited_at > prev.edited_at) {
      latestRev.set(k, rev);
    }
  }

  // ── Merge ──
  const entries: DTRBundleEntry[] = [];
  const seenKeys = new Set<string>();

  // Walk raw rows first; pair with their latest revision (if any) under the same bundle scope.
  for (const r of rawRows) {
    const bundleClient = r.client_name ?? '';
    const k = keyFor(billingMonth, bundleClient, r.notion_id, null);
    seenKeys.add(k);

    const raw = rawRowToDTR(r);
    const rev = latestRev.get(k);

    let revisionMeta: RevisionMeta | null = null;
    let effective: DTRSnapshot | null = raw;

    if (rev) {
      revisionMeta = {
        id: rev.id,
        action: rev.action,
        editedBy: rev.edited_by,
        editedAt: rev.edited_at,
        rawIsNewerThanRevision: r.updated_at > rev.edited_at,
      };
      effective = rev.action === 'exclude' ? null : revisionToSnapshot(rev, bundleClient);
      // A revision that didn't reassign the entry keeps the raw row's author key.
      if (effective && effective.lawyerName === raw.lawyerName) {
        effective.lawyerPersonId = raw.lawyerPersonId;
      }
    }

    if (!includeNonBillable && effective?.nonBillable) {
      effective = null;
    }

    entries.push({
      rawId: r.notion_id,
      createdEntryKey: null,
      billingMonth,
      clientName: bundleClient,
      raw,
      revision: revisionMeta,
      effective,
    });
  }

  // ── Net-new entries: revisions keyed by created_entry_key with no raw counterpart. ──
  for (const [k, rev] of latestRev) {
    if (seenKeys.has(k)) continue;
    if (!rev.created_entry_key) continue; // skip orphaned revisions whose raw was deleted

    let effective: DTRSnapshot | null =
      rev.action === 'exclude' ? null : revisionToSnapshot(rev, rev.client_name);
    if (!includeNonBillable && effective?.nonBillable) effective = null;

    entries.push({
      rawId: null,
      createdEntryKey: rev.created_entry_key,
      billingMonth,
      clientName: rev.client_name,
      raw: null,
      revision: {
        id: rev.id,
        action: rev.action,
        editedBy: rev.edited_by,
        editedAt: rev.edited_at,
        rawIsNewerThanRevision: false,
      },
      effective,
    });
  }

  return entries;
}

/**
 * Convenience wrapper returning only the effective snapshots (drops excluded entries
 * and entries dropped by includeNonBillable). Used by dtr-export, invoice generation,
 * and partner analytics.
 */
export async function getEffectiveDTRs(
  firmId: string,
  opts: GetBundleEntriesOpts
): Promise<{ entry: DTRBundleEntry; snapshot: DTRSnapshot }[]> {
  const entries = await getDTRBundleEntries(firmId, opts);
  const out: { entry: DTRBundleEntry; snapshot: DTRSnapshot }[] = [];
  for (const e of entries) {
    if (e.effective) out.push({ entry: e, snapshot: e.effective });
  }
  return out;
}
