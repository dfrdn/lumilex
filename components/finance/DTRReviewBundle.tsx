'use client';

import { useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Loader2, AlertCircle, CheckCircle2, Clock, XCircle, Send, Plus, Edit2, MinusCircle,
  RotateCcw, MessageSquare, ChevronDown, ChevronUp, Save, X, Search, Check, FileDown, Strikethrough,
  ShieldAlert, ShieldCheck, ShieldQuestion,
} from 'lucide-react';
import type { DTRBundleEntry, DTRSnapshot } from '@/lib/queries/effective-dtr';
import DatePickerInput from '@/components/DatePickerInput';
import HoverTooltip from '@/components/HoverTooltip';
import {
  ActionLoggerSection,
  MilestoneTogglerSection,
  type ActionContextRow,
  type MilestoneContextRow,
} from '@/components/finance/InvoiceFeeEditors';
import { getSeniorityRank } from '@/lib/billing/seniority';
import { formatBalanceLabel, formatLetterDate } from '@/lib/billing/letter-format';
import { computeDepositSettlement } from '@/lib/finance/deposit-settlement';
import { toDecimal } from '@/lib/dtr-utils';
import { FORMER_MEMBER } from '@/lib/former-member';

// ── Lookups ──────────────────────────────────────────

const TASK_OPTIONS = [
  'Study',
  'Correspondence',
  'Draft',
  'Review and Revise',
  'Finalize',
  'Hearing',
  'Meeting',
  'Internal Discussion',
  'Research',
  'TM',
  'Bail Processing',
  'Others',
] as const;

interface Lawyer {
  personId: string;
  name: string;
  initials: string;
  position: string;
}
interface Matter {
  id: string;
  name: string;
  code: string;
  clientId: string;
}
interface ClientLite {
  id: string;
  name: string;
}
interface Lookups {
  lawyers: Lawyer[];
  matters: Matter[];
  clients: ClientLite[];
}

// ── Types ─────────────────────────────────────────────

interface BundleFees {
  totalLegalFees: number;
  monthlyRetainer: number;
  hourlyExcess: number;
  totalHours: number;
  withinRetainerHours: number;
  beyondRetainerHours: number;
  retainerHoursCap: number | null;
  currency: 'PHP';
  /** Attendees with no `team` row — their hours were priced off a fallback
   *  position, so these totals are provisional. See computeBundleFees. */
  unresolvedLawyers?: string[];
}

interface InvoiceFeeLine {
  kind: 'retainer' | 'fixed_fee' | 'acceptance' | 'action' | 'milestone' | 'informational_hours' | 'discount' | 'adhoc';
  matterId: string | null;
  matterName: string | null;
  description: string;
  amount: number;
  quantity?: number;
}
interface InvoiceExpense {
  id: string;
  date: string;
  category: string;
  expense: string;
  amount: number;
  matterName: string | null;
  source: 'reimbursement' | 'finance';
}
interface ExpenseView {
  date: string | null;
  category: string | null;
  expense: string | null;
  amount: number;
  matterName: string | null;
}
interface InvoiceExpenseEntry {
  key: string;
  source: 'reimbursement' | 'finance';
  raw: ExpenseView;
  revision: { action: 'set' | 'exclude' | 'waive' } | null;
  effective: ExpenseView | null;
}
interface InvoicePreview {
  feeLines: InvoiceFeeLine[];
  expenses: InvoiceExpense[];
  expenseEntries: InvoiceExpenseEntry[];
  totalHours: number;
  totalFees: number;
  totalExpenses: number;
  grandTotal: number;
  clientReceivables: number | null;
  clientReceivablesUpdatedAt: string | null;
  clientDepositOnHand?: number;
  settleFromDeposit?: boolean;
}

interface BundleResponse {
  billingMonth: string;
  clientName: string;
  entries: DTRBundleEntry[];
  /**
   * Partner who must clear the bundle. `null` = none assigned; `active: false` =
   * assigned to someone who has left. Both block billing until reassigned.
   */
  relationshipPartner: { id: string; name: string | null; active: boolean } | null;
  review: {
    id: number;
    status: 'pending' | 'approved' | 'rejected';
    clearanceStatus: 'cleared' | 'declined' | null;
    clearanceNotes: string;
    clearedBy: string | null;
    clearedAt: string | null;
    clearanceOverrideBy: string | null;
    clearanceOverrideAt: string | null;
    clearanceOverrideReason: string | null;
    notes: string;
    submittedBy: string | null;
    submittedAt: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
    invoiceSettingsOverride: Record<string, unknown> | null;
    invoiceGenInvoiceId: number | null;
    invoiceGenInvoiceNumber: string | null;
  } | null;
  comments: Comment[];
  fees: BundleFees;
  rawFees: BundleFees;
  invoicePreview: InvoicePreview | null;
  matterDefaults: {
    billingType: string | null;
    monthlyRetainer: number | null;
    retainerHoursCap: number | null;
    hourlyRateOverride: number | null;
    settings: Record<string, unknown>;
  } | null;
  /** Finance's optional letter paragraphs, to switch on or off for this invoice. */
  letterParagraphs?: { key: string; label: string; archived: boolean }[];
  actionContexts: ActionContextRow[];
  milestoneContexts: MilestoneContextRow[];
}

interface Comment {
  id: number;
  revisionId: number;
  authorId: string;
  authorRole: string;
  body: string;
  createdAt: string;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

interface Props {
  billingMonth: string;
  clientName: string;
  currentUserId: string;
  /** 'finance' = inline editing, submit; 'partner' = read-only, approve/reject (if managing partner). */
  mode?: 'finance' | 'partner';
  /** True when the current user is the managing partner. Only meaningful in 'partner' mode. */
  isManagingPartner?: boolean;
  onMutate: () => void;
}

// ── Helpers ───────────────────────────────────────────

function entryKey(e: DTRBundleEntry): string {
  return e.rawId ? `raw:${e.rawId}` : `new:${e.createdEntryKey ?? ''}`;
}

function snapshotsEqual(a: DTRSnapshot | null, b: DTRSnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.hours === b.hours &&
    a.minutes === b.minutes &&
    a.date === b.date &&
    a.lawyerName === b.lawyerName &&
    a.task === b.task &&
    a.remarks === b.remarks &&
    a.matterId === b.matterId &&
    a.nonBillable === b.nonBillable &&
    (a.withNames ?? []).join(',') === (b.withNames ?? []).join(',')
  );
}

/** Attendee names waived on this entry (per-attendee; empty = none). */
function entryWaivedWith(e: DTRBundleEntry): string[] {
  return (e.effective ?? e.raw)?.waivedWith ?? [];
}

function entryStatus(e: DTRBundleEntry): 'raw' | 'revised' | 'excluded' | 'added' {
  if (!e.revision) return 'raw';
  if (e.revision.action === 'exclude') return 'excluded';
  if (!e.rawId) return 'added';
  // Latest revision exists but its effective snapshot matches raw — treat as raw (post-revert).
  if (snapshotsEqual(e.raw, e.effective)) return 'raw';
  return 'revised';
}

function emptySnapshot(): DTRSnapshot {
  return {
    hours: 0,
    minutes: 0,
    date: null,
    lawyerName: '',
    withIds: [],
    withNames: [],
    task: '',
    remarks: '',
    matterId: null,
    clientName: '',
    billed: false,
    nonBillable: false,
    waivedWith: [],
  };
}

function matterLabel(matterId: string | null, matterById: Map<string, Matter>): string {
  if (!matterId) return '—';
  const m = matterById.get(matterId);
  return m ? `${m.name}${m.code ? ` (${m.code})` : ''}` : matterId;
}

function fieldDiff(raw: DTRSnapshot | null, eff: DTRSnapshot | null, matterById: Map<string, Matter>) {
  const changes: { label: string; raw: string; revised: string }[] = [];
  if (!raw || !eff) return changes;
  const fields: { key: keyof DTRSnapshot; label: string; render: (v: unknown) => string }[] = [
    { key: 'date', label: 'Date', render: (v) => (v as string) ?? '—' },
    { key: 'hours', label: 'Hours', render: (v) => String(v ?? 0) },
    { key: 'minutes', label: 'Minutes', render: (v) => String(v ?? 0) },
    { key: 'lawyerName', label: 'Lawyer', render: (v) => (v as string) || '—' },
    { key: 'task', label: 'Task', render: (v) => (v as string) || '—' },
    { key: 'remarks', label: 'Remarks', render: (v) => (v as string) || '—' },
    { key: 'nonBillable', label: 'Non-billable', render: (v) => (v ? 'yes' : 'no') },
  ];
  for (const f of fields) {
    const a = JSON.stringify(raw[f.key]);
    const b = JSON.stringify(eff[f.key]);
    if (a !== b) {
      changes.push({ label: f.label, raw: f.render(raw[f.key]), revised: f.render(eff[f.key]) });
    }
  }
  if (raw.matterId !== eff.matterId) {
    changes.push({
      label: 'Matter',
      raw: matterLabel(raw.matterId, matterById),
      revised: matterLabel(eff.matterId, matterById),
    });
  }
  // with_names is array — separate compare
  const rawWith = (raw.withNames ?? []).join(', ');
  const effWith = (eff.withNames ?? []).join(', ');
  if (rawWith !== effWith) {
    changes.push({ label: 'With', raw: rawWith || '—', revised: effWith || '—' });
  }
  return changes;
}

// ── Main component ────────────────────────────────────

type EditableField = 'date' | 'lawyerName' | 'hours' | 'task' | 'remarks' | 'matterId';
interface EditingCell {
  entryKey: string;
  field: EditableField;
}

export default function DTRReviewBundle({
  billingMonth, clientName, currentUserId,
  mode = 'finance', isManagingPartner = false, onMutate,
}: Props) {
  // Partners other than the Managing Partner are read-only. The MP can edit
  // cells directly so they don't have to bounce changes back through finance
  // for small corrections.
  const readOnly = mode === 'partner' && !isManagingPartner;
  const [data, setData] = useState<BundleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [submitNotes, setSubmitNotes] = useState('');
  const [showDecisionDialog, setShowDecisionDialog] = useState<'approve' | 'reject' | null>(null);
  const [autoGenResult, setAutoGenResult] = useState<
    | { pending: true }
    | { ok: true; invoiceId?: number; invoiceNumber?: string; skipped?: boolean }
    | { ok: false; error: string }
    | null
  >(null);
  const [retryingGen, setRetryingGen] = useState(false);
  const [downloadingBreakdown, setDownloadingBreakdown] = useState(false);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [showClearanceDialog, setShowClearanceDialog] = useState<'clear' | 'decline' | 'override' | null>(null);
  const [clearanceNotes, setClearanceNotes] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [lookups, setLookups] = useState<Lookups>({ lawyers: [], matters: [], clients: [] });
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  // Discount %s reflected in the live invoice preview. Seeded from the saved
  // override (falling back to the matter default), then updated as finance edits
  // the override panel so the preview total responds to discount changes
  // immediately — persist-invoice applies the same discounts when generating.
  const [previewDiscounts, setPreviewDiscounts] = useState<{ hourly: string; total: string }>({ hourly: '', total: '' });
  useEffect(() => {
    const ov = (data?.review?.invoiceSettingsOverride ?? {}) as Record<string, unknown>;
    const def = (data?.matterDefaults?.settings ?? {}) as Record<string, unknown>;
    const pick = (k: string): string => {
      const o = ov[k];
      if (typeof o === 'string' && o.trim()) return o;
      const d = def[k];
      if (typeof d === 'string' && d.trim()) return d;
      return '';
    };
    setPreviewDiscounts({ hourly: pick('hourlyDiscountPercent'), total: pick('totalDiscountPercent') });
  }, [data?.review?.invoiceSettingsOverride, data?.matterDefaults]);

  // Fetch lookups once on mount — used by editor pickers
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cm, pp] = await Promise.all([
          fetch('/api/clients-matters').then((r) => r.json()),
          fetch('/api/people?role=lawyers').then((r) => r.json()),
        ]);
        if (cancelled) return;
        const lawyers: Lawyer[] = (pp.people ?? []).map((p: { person_id: string; name: string; initials: string; position?: string }) => ({
          personId: p.person_id,
          name: p.name,
          initials: p.initials,
          position: p.position ?? '',
        }));
        setLookups({
          lawyers,
          matters: (cm.matters ?? []) as Matter[],
          clients: (cm.clients ?? []) as ClientLite[],
        });
      } catch {
        // Silent — editor will fall back to text inputs if lookups fail
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const matterById = useMemo(() => {
    const m = new Map<string, Matter>();
    for (const x of lookups.matters) m.set(x.id, x);
    return m;
  }, [lookups.matters]);

  // Resolve current bundle's clientId from name to filter matters
  const bundleClientId = useMemo(() => {
    return lookups.clients.find((c) => c.name === clientName)?.id ?? null;
  }, [lookups.clients, clientName]);

  const filteredMatters = useMemo(() => {
    if (!bundleClientId) return lookups.matters;
    return lookups.matters.filter((m) => m.clientId === bundleClientId);
  }, [lookups.matters, bundleClientId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/finance/dtr-review/bundle?month=${billingMonth}&client=${encodeURIComponent(clientName)}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load bundle');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [billingMonth, clientName]);

  useEffect(() => {
    load();
  }, [load]);

  // While the draft invoice generates in the background (kicked off by the
  // relationship partner's clearance), poll until it reports success/skipped/failed.
  // The decision GET is the shared read of invoice_gen_* on the review row.
  const isGenPending = autoGenResult != null && 'pending' in autoGenResult;
  useEffect(() => {
    if (!isGenPending) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/finance/dtr-review/decision?month=${billingMonth}&client=${encodeURIComponent(clientName)}`,
        );
        const json = await res.json();
        if (cancelled || !res.ok) return;
        if (json.invoiceGen && !('pending' in json.invoiceGen)) {
          setAutoGenResult(json.invoiceGen);
          await load();
        }
      } catch {
        // Transient — keep polling.
      }
    };
    const interval = setInterval(poll, 2500);
    poll();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isGenPending, billingMonth, clientName, load]);

  // Group entries by attendee (principal + each with_name), sorted by
  // seniority. Mirrors the XLSX billing breakdown's fan-out so finance/MP
  // can review hours per-lawyer at a glance instead of scanning a flat list.
  // An entry attended by N lawyers shows up in N groups — edits to a cell
  // mutate the underlying entry and reflect in all groups it appears in.
  const lawyerGroups = useMemo(() => {
    if (!data) return [];
    const positionByName = new Map<string, string>();
    for (const l of lookups.lawyers) positionByName.set(l.name, l.position);

    interface Group {
      name: string;
      position: string;
      rank: number;
      totalHours: number;
      rows: Array<{ entry: DTRBundleEntry; isPrincipal: boolean }>;
    }
    const groups = new Map<string, Group>();
    const ensure = (name: string): Group => {
      let g = groups.get(name);
      if (!g) {
        const position = positionByName.get(name) ?? '';
        g = {
          name,
          position,
          rank: getSeniorityRank(position),
          totalHours: 0,
          rows: [],
        };
        groups.set(name, g);
      }
      return g;
    };

    for (const e of data.entries) {
      const eff = e.effective ?? e.raw ?? null;
      if (!eff) continue;
      const principal = eff.lawyerName ?? '';
      const withNames = eff.withNames ?? [];
      const attendees: string[] = [];
      if (principal) attendees.push(principal);
      for (const n of withNames) {
        if (n && !attendees.includes(n)) attendees.push(n);
      }
      if (attendees.length === 0) attendees.push(''); // unassigned bucket

      // Hours count toward the billed total unless the entry is excluded, or THIS
      // attendee's line is waived (per-attendee). Excluded is hidden; waived still
      // shows (struck) but contributes 0. Both appear so finance can restore.
      const excluded = e.revision?.action === 'exclude';
      const waivedWith = eff.waivedWith ?? [];
      const fullDec = toDecimal(eff.hours ?? 0, eff.minutes ?? 0);

      for (const name of attendees) {
        const g = ensure(name);
        const zero = excluded || waivedWith.includes(name);
        g.totalHours += zero ? 0 : fullDec;
        g.rows.push({ entry: e, isPrincipal: name === principal });
      }
    }

    return [...groups.values()].sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.name.localeCompare(b.name);
    });
  }, [data, lookups.lawyers]);

  const counts = useMemo(() => {
    if (!data) return { total: 0, revised: 0, excluded: 0, waived: 0, added: 0, stale: 0 };
    let revised = 0, excluded = 0, waived = 0, added = 0, stale = 0;
    for (const e of data.entries) {
      const s = entryStatus(e);
      if (s === 'revised') revised++;
      else if (s === 'excluded') excluded++;
      else if (s === 'added') added++;
      // Waive is per-attendee and can coexist with any status; count separately.
      if (entryWaivedWith(e).length > 0) waived++;
      if (e.revision?.rawIsNewerThanRevision) stale++;
    }
    return { total: data.entries.length, revised, excluded, waived, added, stale };
  }, [data]);

  // Treat override-only stub rows (submittedAt=null) as "not submitted" for
  // the UI — the database has status='pending' on them but they haven't
  // been formally sent for partner review.
  const status = data?.review?.submittedAt ? (data.review.status ?? null) : null;
  const isApproved = status === 'approved';
  const clearanceStatus = status ? (data?.review?.clearanceStatus ?? null) : null;
  const isCleared = isApproved && clearanceStatus === 'cleared';
  // Only the client's assigned relationship partner may clear. Being the
  // managing partner isn't enough — the two signatures are deliberately distinct.
  const canClear = mode === 'partner' && data?.relationshipPartner?.id === currentUserId;
  const awaitingMyClearance = canClear && isApproved && clearanceStatus !== 'cleared';
  // The managing partner can clear over a relationship partner who isn't acting.
  // Not offered when the MP *is* that partner — they'd just clear normally.
  const canOverrideClearance =
    mode === 'partner' && isManagingPartner && isApproved && clearanceStatus !== 'cleared' && !canClear;
  const wasOverridden = isCleared && !!data?.review?.clearanceOverrideBy;

  async function submitForReview() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/finance/dtr-review/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingMonth, clientName, notes: submitNotes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to submit');
      setShowSubmitDialog(false);
      setSubmitNotes('');
      await load();
      onMutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  async function saveRevision(opts: {
    originalDtrId?: string | null;
    createdEntryKey?: string | null;
    action: 'set' | 'exclude' | 'waive';
    snapshot?: DTRSnapshot;
    /** For action='waive': the attendee names whose line is waived. */
    waivedWith?: string[];
  }) {
    const body: Record<string, unknown> = {
      billingMonth,
      clientName,
      action: opts.action,
    };
    if (opts.originalDtrId) body.originalDtrId = opts.originalDtrId;
    if (opts.createdEntryKey) body.createdEntryKey = opts.createdEntryKey;
    if (opts.action === 'waive') body.waivedWith = opts.waivedWith ?? [];
    if ((opts.action === 'set' || opts.action === 'waive') && opts.snapshot) {
      Object.assign(body, {
        hours: opts.snapshot.hours,
        minutes: opts.snapshot.minutes,
        date: opts.snapshot.date,
        lawyerName: opts.snapshot.lawyerName,
        withIds: opts.snapshot.withIds,
        withNames: opts.snapshot.withNames,
        task: opts.snapshot.task,
        remarks: opts.snapshot.remarks,
        matterId: opts.snapshot.matterId,
        billed: opts.snapshot.billed,
        nonBillable: opts.snapshot.nonBillable,
      });
    }
    const res = await fetch('/api/finance/dtr-review/revision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Failed to save');
    await load();
    onMutate();
  }

  /** Save a single-field cell edit. Builds a full snapshot from the entry's current
   *  effective view + the changed field, then writes one new revision. Used by inline
   *  cell editors. */
  async function saveCellChange(entry: DTRBundleEntry, change: Partial<DTRSnapshot>) {
    const base = entry.effective ?? entry.raw ?? emptySnapshot();
    const next: DTRSnapshot = { ...base, ...change };
    const cellKey = `${entryKey(entry)}|${Object.keys(change).join(',')}`;
    setSavingCells((s) => new Set(s).add(cellKey));
    try {
      await saveRevision({
        originalDtrId: entry.rawId ?? undefined,
        createdEntryKey: entry.createdEntryKey ?? undefined,
        action: 'set',
        snapshot: next,
      });
    } finally {
      setSavingCells((s) => {
        const n = new Set(s);
        n.delete(cellKey);
        return n;
      });
    }
  }

  /** Revert an entry to its raw values. For added entries (no raw), exclude them. */
  async function revertEntry(entry: DTRBundleEntry) {
    if (entry.raw) {
      // Restore raw snapshot
      await saveRevision({
        originalDtrId: entry.rawId ?? undefined,
        action: 'set',
        snapshot: entry.raw,
      });
    } else if (entry.createdEntryKey) {
      // Net-new entry — drop it from the bundle
      await saveRevision({
        createdEntryKey: entry.createdEntryKey,
        action: 'exclude',
      });
    }
  }

  /** Waive ONE attendee's line on an entry — keep it on the invoice (struck
   *  through, "waived") but bill it at ₱0, without touching the co-attendees.
   *  Merges the lawyer into the entry's existing waived set. Snapshots the
   *  current effective values so they persist. */
  async function waiveEntry(entry: DTRBundleEntry, lawyerName: string) {
    const snap = entry.effective ?? entry.raw ?? emptySnapshot();
    const next = Array.from(new Set([...(snap.waivedWith ?? []), lawyerName].filter(Boolean)));
    await saveRevision({
      originalDtrId: entry.rawId ?? undefined,
      createdEntryKey: entry.createdEntryKey ?? undefined,
      action: 'waive',
      snapshot: snap,
      waivedWith: next,
    });
  }

  /** Un-waive ONE attendee. If it was the last waived attendee, drop the waive
   *  revision entirely (revert to raw / set); otherwise keep the others waived. */
  async function unwaiveEntry(entry: DTRBundleEntry, lawyerName: string) {
    const snap = entry.effective ?? entry.raw ?? emptySnapshot();
    const next = (snap.waivedWith ?? []).filter((n) => n !== lawyerName);
    if (next.length === 0) {
      // Last attendee un-waived: keep the entry billable with its CURRENT
      // (possibly edited) values via a plain 'set' — reverting to raw would
      // silently drop any edits made before it was waived, and would exclude a
      // finance-added (net-new) entry entirely.
      await saveRevision({
        originalDtrId: entry.rawId ?? undefined,
        createdEntryKey: entry.createdEntryKey ?? undefined,
        action: 'set',
        snapshot: snap,
      });
      return;
    }
    await saveRevision({
      originalDtrId: entry.rawId ?? undefined,
      createdEntryKey: entry.createdEntryKey ?? undefined,
      action: 'waive',
      snapshot: snap,
      waivedWith: next,
    });
  }

  /** Managing partner: approve or reject the bundle. Approval hands it to the
   *  client's relationship partner — no invoice is generated until they clear it,
   *  unless the MP IS that partner, in which case approval does both. */
  async function submitDecision(decision: 'approve' | 'reject') {
    setDeciding(true);
    try {
      const res = await fetch('/api/finance/dtr-review/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingMonth, clientName, decision, notes: decisionNotes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to record decision');
      setShowDecisionDialog(null);
      setDecisionNotes('');
      if (json.invoiceGen) setAutoGenResult(json.invoiceGen);
      await load();
      onMutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setDeciding(false);
    }
  }

  /** Relationship partner: clear or decline an approved bundle. Clearance is the
   *  last gate before billing, so it's what kicks off invoice generation; the
   *  result shows as a banner so the partner sees whether the draft was created.
   *  'override' is the managing partner clearing in the relationship partner's
   *  place — same generation path, and the partner is notified. */
  async function submitClearance(decision: 'clear' | 'decline' | 'override') {
    setDeciding(true);
    try {
      const res = await fetch('/api/finance/dtr-review/clearance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingMonth, clientName, decision, notes: clearanceNotes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to record clearance');
      setShowClearanceDialog(null);
      setClearanceNotes('');
      if (decision !== 'decline' && json.invoiceGen) {
        setAutoGenResult(json.invoiceGen);
      }
      await load();
      onMutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setDeciding(false);
    }
  }

  /** Generate (or regenerate) the draft invoice for this bundle on demand —
   *  the explicit "Review & Generate" action. Runs the same server pipeline as
   *  MP-approval auto-gen; the endpoint detects an existing invoice and
   *  regenerates it in place. */
  async function generateInvoice() {
    // The endpoint is synchronous and returns the final result, so we drive the
    // button spinner off `retryingGen` and set the result from the response —
    // NOT an optimistic { pending: true }, which would re-arm the approval-poll
    // effect and momentarily flash the prior auto-gen's stale invoice number.
    setRetryingGen(true);
    try {
      const res = await fetch('/api/finance/dtr-review/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName, billingMonth }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Generation failed');
      setAutoGenResult(json.invoiceGen ?? { ok: false, error: 'No result' });
      load();
    } catch (err) {
      setAutoGenResult({ ok: false, error: err instanceof Error ? err.message : 'Generation failed' });
    } finally {
      setRetryingGen(false);
    }
  }

  /** Download the billing breakdown PDF on demand — works even before approval.
   *  Unapproved bundles come back stamped with a "DRAFT" watermark. */
  async function downloadBreakdown() {
    setDownloadingBreakdown(true);
    setError('');
    try {
      const res = await fetch('/api/finance/dtr-review/breakdown-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingMonth, clientName }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Could not generate the breakdown PDF');
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] || `${clientName} - ${billingMonth} - Breakdown.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download the breakdown');
    } finally {
      setDownloadingBreakdown(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-12 text-center">
        <Loader2 className="w-6 h-6 mx-auto animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-xl px-4 py-3">
        <AlertCircle className="w-4 h-4 shrink-0" /> {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{clientName}</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {new Date(`${billingMonth}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              {' · '}
              {counts.total} entr{counts.total === 1 ? 'y' : 'ies'}
              {counts.revised > 0 && ` · ${counts.revised} revised`}
              {counts.excluded > 0 && ` · ${counts.excluded} excluded`}
              {counts.waived > 0 && ` · ${counts.waived} waived`}
              {counts.added > 0 && ` · ${counts.added} added`}
            </p>
          </div>
          <StatusPill status={status} clearance={clearanceStatus} />
        </div>

        {data.fees && <FeesPanel fees={data.fees} rawFees={data.rawFees} legalFeesTotal={data.invoicePreview?.totalFees} />}

        {data.invoicePreview && (
          <InvoicePreviewPanel
            preview={data.invoicePreview}
            clientName={data.clientName}
            hourlyFees={data.fees?.totalLegalFees ?? 0}
            hourlyExcess={data.fees?.hourlyExcess ?? 0}
            hourlyDiscountPercent={previewDiscounts.hourly}
            totalDiscountPercent={previewDiscounts.total}
          />
        )}

        {/* Per-invoice settings override — finance/MP can tweak discount,
            recipient, signer etc. for THIS bundle without changing the
            matter's saved defaults. */}
        {!readOnly && (
          <InvoiceOverridePanel
            billingMonth={data.billingMonth}
            clientName={data.clientName}
            matterDefaults={data.matterDefaults}
            letterParagraphs={data.letterParagraphs ?? []}
            initialOverride={data.review?.invoiceSettingsOverride ?? null}
            clientReceivables={data.invoicePreview?.clientReceivables ?? null}
            clientReceivablesUpdatedAt={data.invoicePreview?.clientReceivablesUpdatedAt ?? null}
            onSaved={load}
            onDiscountsChange={setPreviewDiscounts}
          />
        )}

        {/* Ad-hoc one-off charges for THIS invoice — works for any billing
            type, mirroring how per-action matters log occurrences. Always
            visible so it's discoverable, not buried in the override panel. */}
        {!readOnly && (
          <div className="mt-4">
            <AdHocItemsSection
              billingMonth={data.billingMonth}
              clientName={data.clientName}
              initialItems={readAdHocItems(data.review?.invoiceSettingsOverride)}
              existingOverride={data.review?.invoiceSettingsOverride ?? null}
              onSaved={load}
            />
          </div>
        )}

        {/* Bundle-scoped expense edits — adjust an out-of-pocket expense's
            amount/details or drop it from THIS invoice, mirroring DTR editing.
            The source reimbursement / matter_expense row is left untouched. */}
        {!readOnly && (data.invoicePreview?.expenseEntries?.length ?? 0) > 0 && (
          <div className="mt-4">
            <ExpensesEditor
              billingMonth={data.billingMonth}
              clientName={data.clientName}
              entries={data.invoicePreview!.expenseEntries}
              onSaved={load}
            />
          </div>
        )}

        {/* Inline editors so finance can log actions / mark milestones from
            the review page itself — no detour to each matter's detail page. */}
        {!readOnly && (data.actionContexts?.length ?? 0) > 0 && (
          <div className="mt-4">
            <ActionLoggerSection
              contexts={data.actionContexts}
              month={data.billingMonth}
              onChanged={load}
            />
          </div>
        )}
        {!readOnly && (data.milestoneContexts?.length ?? 0) > 0 && (
          <div className="mt-4">
            <MilestoneTogglerSection
              contexts={data.milestoneContexts}
              onChanged={load}
            />
          </div>
        )}

        {data.review?.notes && status === 'rejected' && data.review.clearanceStatus !== 'declined' && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
            <p className="text-xs font-medium text-red-700 dark:text-red-300 mb-1">Managing partner requested changes:</p>
            <p className="text-sm text-red-700 dark:text-red-200 whitespace-pre-wrap">{data.review.notes}</p>
          </div>
        )}

        {counts.stale > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-200">
              {counts.stale} raw DTR{counts.stale === 1 ? ' has' : 's have'} been edited since you revised
              {counts.stale === 1 ? ' it' : ' them'}. Re-check the affected rows below.
            </p>
          </div>
        )}

        {data.review?.notes && status === 'approved' && mode === 'partner' && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mb-1">Approval note:</p>
            <p className="text-sm text-emerald-700 dark:text-emerald-200 whitespace-pre-wrap">{data.review.notes}</p>
          </div>
        )}

        {/* Where the bundle sits in the two-signature chain. */}
        {isApproved && clearanceStatus !== 'cleared' && (
          <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 flex items-start gap-2">
            <ShieldQuestion className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <p className="text-sm text-blue-800 dark:text-blue-200">
              {awaitingMyClearance
                ? 'Approved by the managing partner. Clear it for billing to generate the draft invoice, or decline with a note to send it back to finance.'
                : `Approved by the managing partner, awaiting clearance from ${data.relationshipPartner?.name ?? 'the relationship partner'}. No invoice is generated until they clear it.`}
              {canOverrideClearance && (
                <span className="block mt-1 opacity-90">
                  If they can&apos;t get to it, you can clear it yourself — {data.relationshipPartner?.name ?? 'they'} will
                  be notified, and the bundle is recorded as cleared by override.
                </span>
              )}
            </p>
          </div>
        )}

        {isCleared && data.review?.clearedAt && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-sm text-emerald-800 dark:text-emerald-200">
              <p>
                {wasOverridden
                  ? `Cleared for billing by the managing partner, overriding ${data.relationshipPartner?.name ?? 'the relationship partner'}'s clearance, on `
                  : `Cleared for billing by ${data.relationshipPartner?.name ?? 'the relationship partner'} on `}
                {new Date(data.review.clearedAt).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' })}.
                {wasOverridden && data.relationshipPartner?.active &&
                  ` ${data.relationshipPartner.name ?? 'The relationship partner'} was notified.`}
              </p>
              {data.review.clearanceNotes && (
                <p className="mt-1 whitespace-pre-wrap opacity-90">
                  {wasOverridden ? `Reason: ${data.review.clearanceNotes}` : data.review.clearanceNotes}
                </p>
              )}
            </div>
          </div>
        )}

        {status === 'rejected' && data.review?.clearanceStatus === 'declined' && data.review.clearanceNotes && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
            <p className="text-xs font-medium text-red-700 dark:text-red-300 mb-1">
              {data.relationshipPartner?.name ?? 'The relationship partner'} declined clearance:
            </p>
            <p className="text-sm text-red-700 dark:text-red-200 whitespace-pre-wrap">{data.review.clearanceNotes}</p>
          </div>
        )}

        {/* No one can clear this bundle — shown to everyone, since the fix
            (reassigning the client) is a partner action, not a finance one. */}
        {!data.relationshipPartner?.active && (
          <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-200">
              {data.relationshipPartner
                ? `${clientName}'s relationship partner (${data.relationshipPartner.name ?? 'unknown'}) is no longer active, so nobody can clear this bundle. Reassign the client in Client Management.`
                : `${clientName} has no relationship partner assigned, so this bundle can't be submitted or billed. Assign one in Client Management.`}
            </p>
          </div>
        )}

        {/* Auto-generation result banner (shown right after the relationship partner clears) */}
        {autoGenResult && 'pending' in autoGenResult && (
          <div className="mt-4 p-3 rounded-lg bg-stone-50 dark:bg-stone-500/10 border border-stone-200 dark:border-stone-500/20 flex items-start gap-2">
            <Loader2 className="w-4 h-4 text-stone-500 dark:text-stone-400 shrink-0 mt-0.5 animate-spin" />
            <p className="text-sm text-stone-700 dark:text-stone-300">
              Clearance recorded. Generating the draft invoice in the background — this can take a moment. You can leave this page; it&apos;ll appear in <a href="/finance/invoices" className="underline">Invoices</a> when done.
            </p>
          </div>
        )}
        {autoGenResult && 'ok' in autoGenResult && autoGenResult.ok && !autoGenResult.skipped && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-sm text-emerald-800 dark:text-emerald-200 flex-1">
              <p className="font-medium">Draft invoice generated: {autoGenResult.invoiceNumber}</p>
              <a href="/finance/invoices" className="text-xs underline opacity-80 hover:opacity-100">
                Open in Invoices →
              </a>
            </div>
          </div>
        )}
        {autoGenResult && 'ok' in autoGenResult && autoGenResult.ok && autoGenResult.skipped && (
          <div className="mt-4 p-3 rounded-lg bg-stone-50 dark:bg-stone-500/10 border border-stone-200 dark:border-stone-500/20 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-stone-600 dark:text-stone-400 shrink-0 mt-0.5" />
            <p className="text-sm text-stone-700 dark:text-stone-300">
              Clearance recorded. No invoice was generated because there are no billable items yet (no DTRs, expenses, or matter-config-driven fees). Log items, then use <strong>Generate draft invoice</strong> below when ready.
            </p>
          </div>
        )}
        {autoGenResult && 'ok' in autoGenResult && !autoGenResult.ok && (
          <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 flex-1">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium">Clearance recorded, but invoice generation failed.</p>
                <p className="text-xs opacity-80 mt-0.5">{autoGenResult.error}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={generateInvoice}
              disabled={retryingGen}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 shrink-0"
            >
              {retryingGen ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              Retry
            </button>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          {/* Download the breakdown PDF — available in every state. Before the
              bundle is approved it comes back watermarked "DRAFT". */}
          <button
            type="button"
            onClick={downloadBreakdown}
            disabled={downloadingBreakdown}
            title={isCleared ? 'Download the breakdown PDF' : 'Download a draft (watermarked) breakdown PDF'}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--subtle-bg)] hover:bg-[var(--border-color)] text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {downloadingBreakdown ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            {isCleared ? 'Download breakdown' : 'Download draft breakdown'}
          </button>

          {/* Finance: submit-for-review */}
          {mode === 'finance' && !isApproved && (
            <button
              onClick={() => setShowSubmitDialog(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            >
              <Send className="w-4 h-4" />
              {status === 'pending' ? 'Re-submit for review' : 'Submit for review'}
            </button>
          )}

          {/* Finance: explicit Generate / Regenerate the draft invoice (once the
              bundle is approved AND cleared). Same pipeline as clearance auto-gen. */}
          {mode === 'finance' && isCleared && (
            <button
              type="button"
              onClick={generateInvoice}
              disabled={retryingGen}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-navy-900 dark:bg-gold-400 text-white dark:text-navy-950 hover:bg-navy-800 dark:hover:bg-gold-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {retryingGen ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              {data.review?.invoiceGenInvoiceNumber ? 'Regenerate draft invoice' : 'Generate draft invoice'}
            </button>
          )}

          {/* Managing partner: approve / reject (first signature) */}
          {mode === 'partner' && isManagingPartner && status === 'pending' && (
            <>
              <button
                onClick={() => { setDecisionNotes(''); setShowDecisionDialog('reject'); }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                <XCircle className="w-4 h-4" />
                Request changes
              </button>
              <button
                onClick={() => { setDecisionNotes(''); setShowDecisionDialog('approve'); }}
                title={canClear ? `You're also ${clientName}'s relationship partner — this approves and clears in one step.` : undefined}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
              >
                {canClear ? <ShieldCheck className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                {canClear ? 'Approve & clear' : 'Approve'}
              </button>
            </>
          )}

          {/* Relationship partner: clear / decline (second signature) */}
          {awaitingMyClearance && (
            <>
              <button
                onClick={() => { setClearanceNotes(''); setShowClearanceDialog('decline'); }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                <XCircle className="w-4 h-4" />
                Decline clearance
              </button>
              <button
                onClick={() => { setClearanceNotes(''); setShowClearanceDialog('clear'); }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
              >
                <ShieldCheck className="w-4 h-4" />
                Clear for billing
              </button>
            </>
          )}

          {/* Managing partner: clear without the relationship partner's signature */}
          {canOverrideClearance && (
            <button
              onClick={() => { setClearanceNotes(''); setShowClearanceDialog('override'); }}
              title={`Clear ${clientName}'s bundle without waiting for ${data.relationshipPartner?.name ?? 'the relationship partner'}.`}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white transition-colors"
            >
              <ShieldAlert className="w-4 h-4" />
              Clear without their sign-off
            </button>
          )}

          {mode === 'partner' && status === null && (
            <span className="text-xs text-[var(--text-muted)]">Awaiting submission from finance.</span>
          )}
        </div>
      </div>

      {/* Entries table */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Entries</h3>
          {!readOnly && (
            <button
              onClick={() => {
                const k = entryKey({ rawId: null, createdEntryKey: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } as DTRBundleEntry);
                setExpanded(`__add__:${k}`);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--subtle-bg)] hover:bg-[var(--border-color)] text-foreground transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add entry
            </button>
          )}
        </div>

        {/* "Add entry" form when triggered (finance only) */}
        {!readOnly && expanded?.startsWith('__add__:') && (
          <div className="border-b border-[var(--border-color)] bg-[var(--subtle-bg)]/30 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">New entry</h4>
            <RevisionEditor
              initial={emptySnapshot()}
              lawyers={lookups.lawyers}
              matters={filteredMatters}
              busyLabel="Adding..."
              saveLabel="Add entry"
              onCancel={() => setExpanded(null)}
              onSave={async (snap) => {
                const key = expanded.split(':').slice(1).join(':') || `new-${Date.now()}`;
                await saveRevision({ createdEntryKey: key, action: 'set', snapshot: snap });
                setExpanded(null);
              }}
            />
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--subtle-bg)]/50 text-[var(--text-muted)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-left px-4 py-2 font-medium">Lawyer</th>
                <th className="text-right px-4 py-2 font-medium">Hours</th>
                <th className="text-left px-4 py-2 font-medium">Task</th>
                <th className="text-left px-4 py-2 font-medium">Remarks</th>
                <th className="text-left px-4 py-2 font-medium">Matter</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            {data.entries.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                    No entries.
                  </td>
                </tr>
              </tbody>
            ) : (
              lawyerGroups.map((g) => (
                <tbody key={g.name || '__unassigned__'} className="divide-y divide-[var(--border-color)]">
                  <tr className="bg-[var(--subtle-bg)]/70">
                    <td colSpan={7} className="px-4 py-2">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {g.name || 'Unassigned'}
                        </span>
                        {g.position && (
                          <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                            {g.position}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right text-xs font-semibold tabular-nums text-foreground">
                      {(Math.round(g.totalHours * 100) / 100).toFixed(2)} h
                    </td>
                  </tr>
                  {g.rows.map(({ entry: e, isPrincipal }) => {
                    const k = entryKey(e);
                    // rowKey uniquely identifies this rendering of the entry
                    // under this particular lawyer's group. Two rows (principal
                    // + co-attendee) share the same `entry` but have distinct
                    // rowKeys so only the clicked row enters edit mode. Saving
                    // mutates the underlying entry — both rows re-render the
                    // new value automatically.
                    const rowKey = `${g.name}::${k}`;
                    return (
                      <EntryRow
                        key={rowKey}
                        entry={e}
                        entryKeyStr={rowKey}
                        readOnly={readOnly}
                        expanded={expanded === rowKey}
                        onToggle={() => setExpanded((prev) => (prev === rowKey ? null : rowKey))}
                        comments={data.comments.filter((c) => c.revisionId === e.revision?.id)}
                        lawyers={lookups.lawyers}
                        matters={filteredMatters}
                        matterById={matterById}
                        editingCell={editingCell?.entryKey === rowKey ? editingCell : null}
                        setEditingCell={setEditingCell}
                        savingCells={savingCells}
                        onSaveCell={(change) => saveCellChange(e, change)}
                        onExclude={() =>
                          saveRevision({
                            originalDtrId: e.rawId ?? undefined,
                            createdEntryKey: e.createdEntryKey ?? undefined,
                            action: 'exclude',
                          })
                        }
                        onWaive={() => waiveEntry(e, g.name)}
                        onUnwaive={() => unwaiveEntry(e, g.name)}
                        onRestore={() => revertEntry(e)}
                        onRevert={() => revertEntry(e)}
                        onCommentAdded={load}
                        isPrincipal={isPrincipal}
                        rowLawyer={g.name}
                      />
                    );
                  })}
                </tbody>
              ))
            )}
          </table>
        </div>
      </div>

      {/* Approve/Reject dialog (managing partner) */}
      {showDecisionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowDecisionDialog(null)}>
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-elevated)] w-full max-w-md p-5" onClick={(ev) => ev.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-1">
              {showDecisionDialog === 'approve' ? 'Approve bundle' : 'Request changes'}
            </h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              {showDecisionDialog === 'reject'
                ? 'Describe what finance should change. Required.'
                : canClear
                  ? `You're also ${clientName}'s relationship partner, so approving clears the bundle too and generates the draft invoice.`
                  : `Approving passes the bundle to ${data.relationshipPartner?.name ?? 'the relationship partner'} for clearance. The invoice is generated once they clear it.`}
            </p>
            <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
              Note {showDecisionDialog === 'approve' ? '(optional)' : '(required)'}
            </label>
            <textarea
              rows={4}
              value={decisionNotes}
              onChange={(ev) => setDecisionNotes(ev.target.value)}
              placeholder={showDecisionDialog === 'approve' ? 'Anything to flag for finance…' : 'e.g., "Reduce hours on matter X — overlapping with another lawyer."'}
              className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowDecisionDialog(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--subtle-bg)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => submitDecision(showDecisionDialog)}
                disabled={deciding || (showDecisionDialog === 'reject' && !decisionNotes.trim())}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors ${
                  showDecisionDialog === 'approve'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {deciding ? <Loader2 className="w-4 h-4 animate-spin" /> : (showDecisionDialog === 'approve' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />)}
                {showDecisionDialog === 'reject' ? 'Request changes' : canClear ? 'Approve & clear' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear/Decline dialog (relationship partner) */}
      {showClearanceDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowClearanceDialog(null)}>
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-elevated)] w-full max-w-md p-5" onClick={(ev) => ev.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-1">
              {showClearanceDialog === 'clear'
                ? 'Clear for billing'
                : showClearanceDialog === 'override'
                  ? 'Clear without their sign-off'
                  : 'Decline clearance'}
            </h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              {showClearanceDialog === 'clear'
                ? `You're signing off on ${clientName}'s bill as their relationship partner. This generates the draft invoice for finance to send.`
                : showClearanceDialog === 'override'
                  ? `This clears ${clientName}'s bundle without ${data.relationshipPartner?.name ?? 'the relationship partner'}'s clearance and generates the draft invoice. They'll be notified with your reason, and the bundle is recorded as cleared by managing-partner override.`
                  : 'Describe what needs to change. The bundle goes back to finance and the invoice is not generated. Required.'}
            </p>
            <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
              {showClearanceDialog === 'override' ? 'Reason (required)' : `Note ${showClearanceDialog === 'clear' ? '(optional)' : '(required)'}`}
            </label>
            <textarea
              rows={4}
              value={clearanceNotes}
              onChange={(ev) => setClearanceNotes(ev.target.value)}
              placeholder={
                showClearanceDialog === 'clear'
                  ? 'Anything to flag for finance…'
                  : showClearanceDialog === 'override'
                    ? 'e.g., "Partner is on leave and the client needs this billed before month-end."'
                    : 'e.g., "Client agreed to a courtesy discount this month — rework before sending."'
              }
              className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowClearanceDialog(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--subtle-bg)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => submitClearance(showClearanceDialog)}
                disabled={deciding || (showClearanceDialog !== 'clear' && !clearanceNotes.trim())}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors ${
                  showClearanceDialog === 'clear'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : showClearanceDialog === 'override'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {deciding
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : showClearanceDialog === 'clear'
                    ? <ShieldCheck className="w-4 h-4" />
                    : showClearanceDialog === 'override'
                      ? <ShieldAlert className="w-4 h-4" />
                      : <XCircle className="w-4 h-4" />}
                {showClearanceDialog === 'clear' ? 'Clear for billing' : showClearanceDialog === 'override' ? 'Clear by override' : 'Decline'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submit dialog */}
      {showSubmitDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowSubmitDialog(false)}>
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-elevated)] w-full max-w-md p-5" onClick={(ev) => ev.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-1">Submit for review</h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              The managing partner will review your edits before invoices for this client can be generated.
            </p>
            <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
              Note (optional)
            </label>
            <textarea
              rows={4}
              value={submitNotes}
              onChange={(ev) => setSubmitNotes(ev.target.value)}
              placeholder="Anything the managing partner should know about your edits…"
              className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowSubmitDialog(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--subtle-bg)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitForReview}
                disabled={submitting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-colors"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────

function fmtPHP(amount: number): string {
  return `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtHours(h: number): string {
  return h.toLocaleString('en-PH', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function FeesPanel({ fees, rawFees, legalFeesTotal }: { fees: BundleFees; rawFees: BundleFees; legalFeesTotal?: number }) {
  const hasRetainer = fees.retainerHoursCap != null && fees.monthlyRetainer > 0;
  const writeDown = rawFees.totalLegalFees - fees.totalLegalFees;
  // `fees.totalLegalFees` is the DTR/retainer slice only (monthlyRetainer +
  // hourlyExcess). The headline figure must be the full bill — including
  // per-action, fixed-fee, milestone and acceptance lines — so it matches the
  // invoice preview's "Legal Fees" and the generated invoice. invoicePreview
  // .totalFees is that all-in figure (computeCapAwareFees().legalFees); fall
  // back to the DTR slice only when no preview is available.
  const displayTotal = legalFeesTotal ?? fees.totalLegalFees;
  const unresolved = fees.unresolvedLawyers ?? [];

  return (
    <>
    {unresolved.length > 0 && (
      // A name with no team row has no position, so its hours were priced off
      // the junior card as a placeholder. Generation refuses until it is fixed.
      <p className="mt-4 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>
          {unresolved.join(', ')} {unresolved.length === 1 ? 'is' : 'are'} on billable time but{' '}
          {unresolved.length === 1 ? 'matches' : 'match'} no team member, so the hours are priced at the
          junior rate as a placeholder. These totals are provisional, and the invoice can&apos;t be
          generated until the name is fixed.
        </span>
      </p>
    )}
    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3 rounded-lg bg-[var(--subtle-bg)]/50 border border-[var(--border-color)]">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium">Total legal fees</p>
        <p className="text-lg font-semibold text-foreground tabular-nums">{fmtPHP(displayTotal)}</p>
        {Math.abs(writeDown) > 0.01 && (
          <p className={`text-[11px] mt-0.5 tabular-nums ${writeDown > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {writeDown > 0 ? '−' : '+'}{fmtPHP(Math.abs(writeDown))} vs raw
          </p>
        )}
      </div>

      {hasRetainer ? (
        <>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium">Monthly retainer</p>
            <p className="text-sm font-medium text-foreground tabular-nums">{fmtPHP(fees.monthlyRetainer)}</p>
            <p className="text-[11px] text-[var(--text-muted)]">
              Cap: {fees.retainerHoursCap}h
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium">Within retainer</p>
            <p className="text-sm font-medium text-foreground tabular-nums">{fmtHours(fees.withinRetainerHours)}h</p>
            <p className="text-[11px] text-[var(--text-muted)]">covered by retainer</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium">Beyond retainer</p>
            <p className="text-sm font-medium text-foreground tabular-nums">{fmtHours(fees.beyondRetainerHours)}h</p>
            <p className="text-[11px] text-[var(--text-muted)] tabular-nums">{fmtPHP(fees.hourlyExcess)} hourly excess</p>
          </div>
        </>
      ) : (
        <>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium">Billable hours</p>
            <p className="text-sm font-medium text-foreground tabular-nums">{fmtHours(fees.totalHours)}h</p>
            <p className="text-[11px] text-[var(--text-muted)]">all billed hourly</p>
          </div>
          <div className="sm:col-span-2 lg:col-span-2">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium">Arrangement</p>
            <p className="text-sm font-medium text-foreground">No retainer cap</p>
            <p className="text-[11px] text-[var(--text-muted)]">
              Hours billed at lawyer rate (or matter override)
            </p>
          </div>
        </>
      )}
    </div>
    </>
  );
}

/**
 * Full invoice preview — mirrors the data persistInvoice will produce when the
 * bundle is approved. Surfaces acceptance fees, fixed fees, per-action
 * aggregates, milestones, expenses, deposit/outstanding balance, and the
 * eventual grand total so reviewers see exactly what'll be billed.
 */
// ── Bundle-scoped expense editor (mirrors DTR editing) ─────────────────

function ExpensesEditor({
  billingMonth,
  clientName,
  entries,
  onSaved,
}: {
  billingMonth: string;
  clientName: string;
  entries: InvoiceExpenseEntry[];
  onSaved: () => void;
}) {
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function post(body: Record<string, unknown>) {
    const res = await fetch('/api/finance/dtr-review/expense-revision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billingMonth, clientName, ...body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Failed to save');
  }
  async function del(expenseKey: string) {
    const params = new URLSearchParams({ billingMonth, clientName, expenseKey });
    const res = await fetch(`/api/finance/dtr-review/expense-revision?${params.toString()}`, {
      method: 'DELETE',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Failed to revert');
  }

  async function run(key: string, fn: () => Promise<void>) {
    setSavingKey(key);
    setError('');
    try {
      await fn();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--subtle-bg)]/50">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Out-of-Pocket Expenses
        </p>
        <p className="text-xs text-[var(--text-secondary)]">
          Edit an amount or detail, or exclude an expense from this invoice. The original expense record is left unchanged.
        </p>
      </div>
      {error && <p className="px-4 py-2 text-xs text-rose-600">{error}</p>}
      <div className="divide-y divide-[var(--border-color)]">
        {entries.map((e) => (
          <ExpenseEditorRow
            key={e.key}
            entry={e}
            saving={savingKey === e.key}
            onSave={(snap) => run(e.key, () => post({ expenseKey: e.key, action: 'set', ...snap }))}
            onExclude={() => run(e.key, () => post({ expenseKey: e.key, action: 'exclude' }))}
            onWaive={() => {
              const v = e.effective ?? e.raw;
              return run(e.key, () => post({
                expenseKey: e.key, action: 'waive',
                amount: v.amount, description: v.expense ?? '', category: v.category ?? '', expenseDate: v.date ?? null,
              }));
            }}
            onRevert={() => run(e.key, () => del(e.key))}
          />
        ))}
      </div>
    </div>
  );
}

function ExpenseEditorRow({
  entry,
  saving,
  onSave,
  onExclude,
  onWaive,
  onRevert,
}: {
  entry: InvoiceExpenseEntry;
  saving: boolean;
  onSave: (snap: { amount: number; description: string; category: string; expenseDate: string | null }) => void;
  onExclude: () => void;
  onWaive: () => void;
  onRevert: () => void;
}) {
  const excluded = entry.revision?.action === 'exclude';
  const waived = entry.revision?.action === 'waive';
  const edited = !excluded && !waived && entry.revision != null;
  const base = entry.effective ?? entry.raw;

  const [date, setDate] = useState<string | null>(base.date);
  const [category, setCategory] = useState<string>(base.category ?? '');
  const [expense, setExpense] = useState<string>(base.expense ?? '');
  const [amount, setAmount] = useState<string>(String(base.amount ?? ''));

  // Re-sync the draft when the bundle reloads after a save.
  useEffect(() => {
    const b = entry.effective ?? entry.raw;
    setDate(b.date);
    setCategory(b.category ?? '');
    setExpense(b.expense ?? '');
    setAmount(String(b.amount ?? ''));
  }, [entry]);

  function saveSnapshot(over?: Partial<{ date: string | null; category: string; expense: string; amount: string }>) {
    const d = over && 'date' in over ? over.date ?? null : date;
    const c = over?.category ?? category;
    const x = over?.expense ?? expense;
    const a = over?.amount ?? amount;
    const amt = Number(a);
    if (!Number.isFinite(amt)) return;
    const eff = entry.effective ?? entry.raw;
    const unchanged =
      (d || null) === (eff.date ?? null) &&
      c === (eff.category ?? '') &&
      x === (eff.expense ?? '') &&
      amt === Number(eff.amount ?? 0);
    if (unchanged) return;
    onSave({ amount: amt, description: x, category: c, expenseDate: d || null });
  }

  if (excluded) {
    return (
      <div className="px-4 py-2.5 flex items-center gap-3 opacity-70">
        <div className="flex-1 min-w-0">
          <p className="text-xs line-through text-[var(--text-secondary)] truncate">
            {entry.raw.expense || '—'}
            {entry.raw.matterName ? ` · ${entry.raw.matterName}` : ''}
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">Excluded from this invoice</p>
        </div>
        <span className="text-xs tabular-nums line-through text-[var(--text-muted)]">{fmtPHP(entry.raw.amount)}</span>
        <button
          type="button"
          disabled={saving}
          onClick={onRevert}
          className="shrink-0 text-xs px-2 py-1 rounded border border-[var(--border-color)] hover:bg-[var(--subtle-bg)] disabled:opacity-50"
        >
          Restore
        </button>
      </div>
    );
  }

  if (waived) {
    const v = entry.effective ?? entry.raw;
    return (
      <div className="px-4 py-2.5 flex items-center gap-3 opacity-80">
        <div className="flex-1 min-w-0">
          <p className="text-xs line-through text-[var(--text-secondary)] truncate">
            {v.expense || '—'}
            {entry.raw.matterName ? ` · ${entry.raw.matterName}` : ''}
          </p>
          <p className="text-[10px] text-amber-700 dark:text-amber-300">Waived — shown on the invoice, billed ₱0</p>
        </div>
        <span className="text-xs tabular-nums line-through text-[var(--text-muted)]">{fmtPHP(v.amount)}</span>
        <button
          type="button"
          disabled={saving}
          onClick={onRevert}
          className="shrink-0 text-xs px-2 py-1 rounded border border-[var(--border-color)] hover:bg-[var(--subtle-bg)] disabled:opacity-50"
        >
          Restore
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-start gap-2">
        <div className="w-28 shrink-0">
          <DatePickerInput
            value={date}
            onChange={(v) => {
              setDate(v);
              saveSnapshot({ date: v });
            }}
            placeholder="Date"
          />
        </div>
        <input
          value={expense}
          onChange={(e) => setExpense(e.target.value)}
          onBlur={() => saveSnapshot()}
          placeholder="Description"
          className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--background)] focus:outline-none focus:ring-1 focus:ring-gold-300"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          onBlur={() => saveSnapshot()}
          placeholder="Category"
          className="w-28 shrink-0 px-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--background)] focus:outline-none focus:ring-1 focus:ring-gold-300"
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => saveSnapshot()}
          inputMode="decimal"
          placeholder="0.00"
          className="w-24 shrink-0 px-2 py-1 text-xs text-right tabular-nums rounded border border-[var(--border-color)] bg-[var(--background)] focus:outline-none focus:ring-1 focus:ring-gold-300"
        />
        <button
          type="button"
          disabled={saving}
          onClick={onWaive}
          title="Waive — shown on the invoice, struck through, billed ₱0"
          className="shrink-0 text-xs px-2 py-1 rounded border border-[var(--border-color)] hover:bg-[var(--subtle-bg)] disabled:opacity-50"
        >
          Waive
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onExclude}
          title="Exclude — removed from the invoice entirely"
          className="shrink-0 text-xs px-2 py-1 rounded border border-[var(--border-color)] hover:bg-[var(--subtle-bg)] disabled:opacity-50"
        >
          Exclude
        </button>
      </div>
      <div className="mt-1 flex items-center gap-2 pl-[7.5rem]">
        <span className="text-[10px] text-[var(--text-muted)]">
          {entry.source === 'reimbursement'
            ? `Reimbursement${entry.raw.matterName ? ` · ${entry.raw.matterName}` : ''}`
            : 'Finance expense'}
        </span>
        {edited && (
          <>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              edited · was {fmtPHP(entry.raw.amount)}
            </span>
            <button
              type="button"
              disabled={saving}
              onClick={onRevert}
              className="text-[10px] underline text-[var(--text-muted)] hover:text-foreground disabled:opacity-50"
            >
              revert
            </button>
          </>
        )}
        {saving && <span className="text-[10px] text-[var(--text-muted)]">saving…</span>}
      </div>
    </div>
  );
}

function InvoicePreviewPanel({
  preview,
  clientName,
  hourlyFees,
  hourlyExcess,
  hourlyDiscountPercent,
  totalDiscountPercent,
}: {
  preview: InvoicePreview;
  /** Client name as printed on the invoice. */
  clientName: string;
  /** Total *charged* legal fees from the DTR side — already cap-aware (this
   *  is `BundleFees.totalLegalFees`, which is monthlyRetainer + hourlyExcess).
   *  Used as the authoritative DTR/retainer subtotal here so we don't
   *  double-count retainer-absorbed hours that `fetchBillingData.totalFees`
   *  doesn't subtract. */
  hourlyFees: number;
  /** The hourly-billed portion of `hourlyFees` (beyond-cap hours). The hourly
   *  discount applies only to this — retainer-absorbed hours have no rate. */
  hourlyExcess: number;
  /** Discount %s from the override panel, applied here the same way
   *  persist-invoice will when the invoice is generated. */
  hourlyDiscountPercent: string;
  totalDiscountPercent: string;
}) {
  const acceptanceFees = preview.feeLines.filter((f) => f.kind === 'acceptance');
  const fixedFees = preview.feeLines.filter((f) => f.kind === 'fixed_fee');
  const actionFees = preview.feeLines.filter((f) => f.kind === 'action');
  const milestoneFees = preview.feeLines.filter((f) => f.kind === 'milestone');
  const adHocFees = preview.feeLines.filter((f) => f.kind === 'adhoc');
  const informational = preview.feeLines.filter((f) => f.kind === 'informational_hours');

  // Discounts are entered as %s on the override panel and applied here exactly
  // as persist-invoice will: the hourly discount cuts only the hourly-billed
  // portion (retainer-absorbed hours have no rate to discount), and the total
  // discount comes off (fees + expenses).
  const parsePct = (v: string): number => {
    const n = parseFloat(v);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(100, n);
  };
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  const hourlyPct = parsePct(hourlyDiscountPercent);
  const totalPct = parsePct(totalDiscountPercent);
  const hourlyDiscountAmount = round2(hourlyExcess * (hourlyPct / 100));

  const hasExtras =
    acceptanceFees.length > 0 ||
    fixedFees.length > 0 ||
    actionFees.length > 0 ||
    milestoneFees.length > 0 ||
    adHocFees.length > 0 ||
    informational.length > 0 ||
    hourlyPct > 0 ||
    totalPct > 0 ||
    preview.expenses.length > 0 ||
    (preview.clientReceivables ?? 0) !== 0;

  if (!hasExtras && hourlyFees === 0) return null;

  const balance = preview.clientReceivables ?? 0;
  // Charged fee lines not already folded into hourlyFees.
  const extrasTotal =
    acceptanceFees.reduce((s, f) => s + f.amount, 0) +
    fixedFees.reduce((s, f) => s + f.amount, 0) +
    actionFees.reduce((s, f) => s + f.amount, 0) +
    milestoneFees.reduce((s, f) => s + f.amount, 0) +
    adHocFees.reduce((s, f) => s + f.amount, 0);
  // hourlyFees is the gross DTR fee (retainer + hourly); the hourly discount cuts
  // the hourly slice, then the total discount comes off (fees + expenses + ad-hoc).
  const subtotalFees = hourlyFees - hourlyDiscountAmount + extrasTotal;
  const totalDiscountAmount = round2((subtotalFees + preview.totalExpenses) * (totalPct / 100));
  const legalFees = subtotalFees - totalDiscountAmount;
  const grandTotal = legalFees + preview.totalExpenses + balance;

  // Settle-from-deposit preview. Mirrors persistInvoice: the applied amount caps
  // at the CURRENT bill (fees + expenses), never the carried previous balance,
  // which is settled against its own invoices. This on-screen figure is pre-VAT
  // like the rest of this card — the breakdown PDF stays the definitive amount.
  const currentBillGross = round2(legalFees + preview.totalExpenses);
  const settlement = preview.settleFromDeposit
    ? computeDepositSettlement(currentBillGross, preview.clientDepositOnHand ?? 0)
    : null;
  const amountDue = settlement ? round2(grandTotal - settlement.applied) : grandTotal;

  return (
    <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--subtle-bg)]/50 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Invoice preview
          </p>
          <p className="text-xs text-[var(--text-secondary)]">
            What {clientName} will see on their bill once this bundle is cleared.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Grand Total</p>
          <p className="text-lg font-semibold text-foreground tabular-nums">{fmtPHP(grandTotal)}</p>
        </div>
      </div>

      <div className="divide-y divide-[var(--border-color)]">
        {hourlyFees > 0 && (
          <PreviewSection
            title="DTR-Based Fees (retainer + hourly)"
            rows={[{ left: 'See lawyer breakdown + retainer math above', right: '', amount: hourlyFees }]}
          />
        )}
        {acceptanceFees.length > 0 && (
          <PreviewSection title="Acceptance Fees" rows={acceptanceFees.map((f) => ({ left: f.matterName ?? '—', right: f.description, amount: f.amount }))} />
        )}
        {fixedFees.length > 0 && (
          <PreviewSection title="Fixed Fees" rows={fixedFees.map((f) => ({ left: f.matterName ?? '—', right: f.description, amount: f.amount }))} />
        )}
        {actionFees.length > 0 && (
          <PreviewSection title="Per-Action Fees" rows={actionFees.map((f) => ({ left: f.matterName ?? '—', right: f.description, amount: f.amount }))} />
        )}
        {milestoneFees.length > 0 && (
          <PreviewSection title="Milestones" rows={milestoneFees.map((f) => ({ left: f.matterName ?? '—', right: f.description, amount: f.amount }))} />
        )}
        {adHocFees.length > 0 && (
          <PreviewSection title="Additional Items" rows={adHocFees.map((f) => ({ left: f.description, right: f.matterName ?? '', amount: f.amount }))} />
        )}
        {informational.length > 0 && (
          <PreviewSection
            title="Informational (not charged)"
            rows={informational.map((f) => ({ left: f.matterName ?? '—', right: f.description, amount: 0 }))}
            muted
          />
        )}
        {hourlyDiscountAmount > 0 && (
          <PreviewSection
            title="Hourly Discount"
            rows={[{ left: `${hourlyPct}% off hourly fees`, right: '', amount: -hourlyDiscountAmount }]}
            highlight="credit"
          />
        )}
        {totalDiscountAmount > 0 && (
          <PreviewSection
            title="Discount"
            rows={[{ left: `${totalPct}% off subtotal`, right: '', amount: -totalDiscountAmount }]}
            highlight="credit"
          />
        )}
        {preview.expenses.length > 0 && (
          <PreviewSection
            title="Out-of-Pocket Expenses"
            rows={preview.expenses.map((e) => ({
              left: e.date,
              right: `${e.expense}${e.matterName ? ` — ${e.matterName}` : ''}`,
              amount: e.amount,
            }))}
          />
        )}
        {balance !== 0 && (
          <PreviewSection
            title={balance > 0 ? 'Previous Outstanding Balance' : 'Advance Deposit (credit)'}
            rows={[{
              // Same wording + DD Mmm YYYY date the generated letter uses, so the
              // preview matches the invoice exactly.
              left: formatBalanceLabel(preview.clientReceivablesUpdatedAt, balance)
                .replace(/^./, (c) => c.toUpperCase()),
              right: '',
              amount: balance,
            }]}
            highlight={balance < 0 ? 'credit' : 'debit'}
          />
        )}
        {settlement && (
          <PreviewSection
            title="Less: Applied Against Advance Deposit"
            rows={[{
              left: `Charged to advance deposit on hand (${fmtPHP(preview.clientDepositOnHand ?? 0)})`,
              right: settlement.remaining > 0
                ? `${fmtPHP(settlement.remaining)} deposit remaining after this bill`
                : 'Exhausts the advance deposit on hand',
              amount: -settlement.applied,
            }]}
            highlight="credit"
          />
        )}
      </div>

      {settlement && (
        <div className="px-4 py-2.5 bg-navy-900 dark:bg-navy-900/60 flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/80">
            Amount Due {amountDue <= 0.005 ? '(settled from deposit)' : 'after deposit'}
          </p>
          <p className="text-base font-semibold text-white tabular-nums">{fmtPHP(Math.max(0, amountDue))}</p>
        </div>
      )}

      <div className="px-4 py-2 bg-[var(--subtle-bg)]/30 border-t border-[var(--border-color)] grid grid-cols-3 text-xs">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Legal Fees</p>
          <p className="font-medium text-foreground tabular-nums">{fmtPHP(legalFees)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Expenses</p>
          <p className="font-medium text-foreground tabular-nums">{fmtPHP(preview.totalExpenses)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Total Hours</p>
          <p className="font-medium text-foreground tabular-nums">{fmtHours(preview.totalHours)}h</p>
        </div>
      </div>
    </div>
  );
}

function PreviewSection({
  title,
  rows,
  muted,
  highlight,
}: {
  title: string;
  rows: { left: string; right: string; amount: number }[];
  muted?: boolean;
  highlight?: 'credit' | 'debit';
}) {
  const amountColor =
    highlight === 'credit'
      ? 'text-indigo-600 dark:text-indigo-400'
      : muted
        ? 'text-[var(--text-muted)]'
        : 'text-foreground';
  return (
    <div className="px-4 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
        {title}
      </p>
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start justify-between gap-3 text-xs">
            <div className="min-w-0 flex-1">
              <p className={`font-medium ${muted ? 'text-[var(--text-muted)]' : 'text-foreground'}`}>{r.left}</p>
              {r.right && <p className="text-[var(--text-muted)] truncate">{r.right}</p>}
            </div>
            <p className={`tabular-nums shrink-0 ${amountColor}`}>
              {muted ? '—' : fmtPHP(r.amount)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Parse the persisted ad-hoc items off a bundle's invoice_settings_override. */
function readAdHocItems(override: Record<string, unknown> | null | undefined): Array<{ description: string; amount: number }> {
  const raw = (override?.adHocItems ?? []) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}))
    .map((r) => ({ description: String(r.description ?? ''), amount: Math.round(Number(r.amount) * 100) / 100 }))
    .filter((r) => r.description.trim() && Number.isFinite(r.amount));
}

/**
 * Always-visible card for free-form one-off charges on THIS invoice — the
 * any-billing-type analogue of the per-action "+ Log" card. Persists to the
 * bundle's invoice_settings_override.adHocItems via a read-merge-write so it
 * never clobbers the override panel's other fields; the generator + preview
 * pick the items up from there.
 */
function AdHocItemsSection({
  billingMonth,
  clientName,
  initialItems,
  existingOverride,
  onSaved,
}: {
  billingMonth: string;
  clientName: string;
  initialItems: Array<{ description: string; amount: number }>;
  existingOverride: Record<string, unknown> | null;
  onSaved: () => void;
}) {
  const initialKey = JSON.stringify(initialItems);
  const [items, setItems] = useState<Array<{ description: string; amount: string }>>(
    () => initialItems.map((it) => ({ description: it.description, amount: String(it.amount) })),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState('');

  // Mirror the persisted set into local state after a reload / client switch.
  // Fires only when the SAVED items change — never mid-edit, since initialItems
  // is stable until the next load().
  useEffect(() => {
    setItems(initialItems.map((it) => ({ description: it.description, amount: String(it.amount) })));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey]);

  const mutate = (next: Array<{ description: string; amount: string }>) => {
    setItems(next);
    setDirty(true);
    setSavedAt(null);
  };
  const addItem = () => mutate([...items, { description: '', amount: '' }]);
  const updateItem = (i: number, patch: Partial<{ description: string; amount: string }>) =>
    mutate(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const removeItem = (i: number) => mutate(items.filter((_, idx) => idx !== i));

  const cleaned = items
    .map((it) => ({ description: it.description.trim(), amount: Math.round(parseFloat(it.amount) * 100) / 100 }))
    .filter((it) => it.description && Number.isFinite(it.amount) && it.amount !== 0);
  const total = Math.round(cleaned.reduce((s, it) => s + it.amount, 0) * 100) / 100;

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      // Read-merge-write: preserve every other override field, replace only the
      // ad-hoc items. existingOverride is re-read on each load() so it's fresh.
      // Always send an explicit adHocItems (possibly []) so the endpoint sets or
      // clears them rather than preserving the old set.
      const next: Record<string, unknown> = { ...(existingOverride ?? {}), adHocItems: cleaned };
      const res = await fetch('/api/finance/dtr-review/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billingMonth,
          clientName,
          override: Object.keys(next).length > 0 ? next : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      setDirty(false);
      setSavedAt(Date.now());
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Additional Items</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            One-off charges added to this invoice — works for any billing type. Flows into the preview total and the breakdown.
          </p>
        </div>
        <button
          type="button"
          onClick={addItem}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-gold-50 text-gold-700 hover:bg-gold-100 border border-gold-200/60 dark:bg-gold-500/10 dark:text-gold-400 dark:border-gold-500/30 dark:hover:bg-gold-500/20 cursor-pointer shrink-0"
        >
          + Add item
        </button>
      </div>
      <div className="px-5 py-3 space-y-2">
        {items.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">No additional items. Click &ldquo;Add item&rdquo; to bill a one-off charge on this invoice.</p>
        ) : (
          items.map((it, i) => (
            <div key={i} className="flex items-start gap-2">
              <input
                value={it.description}
                onChange={(e) => updateItem(i, { description: e.target.value })}
                placeholder="Description"
                className="flex-1 px-2.5 py-1.5 text-xs rounded-md bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400/20"
              />
              <input
                type="number"
                step="0.01"
                value={it.amount}
                onChange={(e) => updateItem(i, { amount: e.target.value })}
                placeholder="Amount (₱)"
                className="w-32 px-2.5 py-1.5 text-xs rounded-md bg-[var(--background)] border border-[var(--border-color)] text-foreground tabular-nums focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400/20"
              />
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="px-2 py-1.5 text-[11px] rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 border border-[var(--border-color)] cursor-pointer shrink-0"
                title="Remove item"
              >
                Remove
              </button>
            </div>
          ))
        )}

        {(items.length > 0 || dirty) && (
          <div className="flex items-center justify-end gap-3 pt-1">
            {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
            {savedAt && !saving && !error && !dirty && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>
            )}
            {cleaned.length > 0 && (
              <span className="text-[11px] text-[var(--text-muted)] tabular-nums">Total {fmtPHP(total)}</span>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-navy-900 dark:bg-gold-400 text-white dark:text-navy-950 hover:bg-navy-800 dark:hover:bg-gold-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save items'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Per-invoice settings override panel — surfaces the matter's saved defaults
 * (signer, attn, bank, discount, …) read-only and lets finance/MP override
 * specific fields just for this bundle. Persists into
 * dtr_revision_reviews.invoice_settings_override.
 */
const OVERRIDE_TEXT_KEYS = [
  'clientAddress', 'attnName', 'attnTitle', 'throughName', 'salutation', 'engagementDate',
  'retainerCap', 'retainerHoursCap', 'monthlyRetainer', 'previousBalance', 'previousBalanceLabel',
  'bankName', 'bankAccountNo', 'bankAccountName', 'hourlyDiscountPercent', 'totalDiscountPercent',
  'earlyPaymentDiscountPercent', 'earlyPaymentDays',
  'clientEmail', 'ccEmails',
] as const;

function InvoiceOverridePanel({
  billingMonth,
  clientName,
  matterDefaults,
  letterParagraphs,
  initialOverride,
  clientReceivables,
  clientReceivablesUpdatedAt,
  onSaved,
  onDiscountsChange,
}: {
  billingMonth: string;
  clientName: string;
  matterDefaults: BundleResponse['matterDefaults'];
  letterParagraphs: { key: string; label: string; archived: boolean }[];
  initialOverride: Record<string, unknown> | null;
  clientReceivables: number | null;
  clientReceivablesUpdatedAt: string | null;
  onSaved: () => void;
  /** Mirrors the live discount inputs (override value, or matter default when
   *  blank) up to the invoice preview so its total responds as finance types. */
  onDiscountsChange?: (d: { hourly: string; total: string }) => void;
}) {
  const defaults = (matterDefaults?.settings ?? {}) as Record<string, string | undefined>;
  const initial = (initialOverride ?? {}) as Record<string, string | undefined>;

  const get = (k: string): string =>
    typeof initial[k] === 'string' ? (initial[k] as string) : '';
  // Matter default for a field. previousBalance/Label come from the LIVE running
  // balance (formatBalanceLabel) — the exact value the generated letter uses —
  // not the matter config.
  const dflt = (k: string): string => {
    if (k === 'previousBalance') return clientReceivables != null ? String(clientReceivables) : '';
    if (k === 'previousBalanceLabel') return clientReceivables != null ? formatBalanceLabel(clientReceivablesUpdatedAt, clientReceivables) : '';
    return typeof defaults[k] === 'string' ? (defaults[k] as string) : '';
  };

  const [expanded, setExpanded] = useState(false);
  const [over, setOver] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const k of OVERRIDE_TEXT_KEYS) o[k] = get(k);
    return o;
  });
  const setField = (k: string, v: string) => setOver((p) => ({ ...p, [k]: v }));
  // Surface the effective discount %s (override value, else matter default) to
  // the invoice preview so its total updates as finance edits the fields. Fires
  // on mount too, so a saved override is reflected immediately.
  useEffect(() => {
    onDiscountsChange?.({
      hourly: (over.hourlyDiscountPercent ?? '').trim() || dflt('hourlyDiscountPercent'),
      total: (over.totalDiscountPercent ?? '').trim() || dflt('totalDiscountPercent'),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over.hourlyDiscountPercent, over.totalDiscountPercent]);
  // Booleans are tri-state: '' = use matter default, 'true'/'false' = override.
  const [vat, setVat] = useState(get('includeVAT'));
  const [lessen, setLessen] = useState(get('includeLessenFeesNote'));
  const [settleDeposit, setSettleDeposit] = useState(get('settleFromDeposit'));
  const [initialStatement, setInitialStatement] = useState(get('initialStatement'));
  // One tri-state per optional paragraph: '' = the client's choice.
  const [paragraphs, setParagraphs] = useState<Record<string, string>>(() =>
    Object.fromEntries(letterParagraphs.map((p) => [p.key, get(`optional:${p.key}`)])));
  const clientParagraphs = new Set(Array.isArray(defaults.optionalParagraphs) ? (defaults.optionalParagraphs as unknown as string[]) : []);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      // Only send fields the user filled in (≠ blank). Blank → unset, so the
      // matter default (or live balance) wins at generation time.
      const override: Record<string, unknown> = {};
      for (const k of OVERRIDE_TEXT_KEYS) {
        const v = (over[k] ?? '').trim();
        if (v) override[k] = v;
      }
      if (vat) override.includeVAT = vat;
      if (lessen) override.includeLessenFeesNote = lessen;
      if (settleDeposit) override.settleFromDeposit = settleDeposit;
      if (initialStatement) override.initialStatement = initialStatement;
      for (const [key, v] of Object.entries(paragraphs)) if (v) override[`optional:${key}`] = v;
      // Ad-hoc items live in their own "Additional Items" card. We don't send
      // them here — the override endpoint preserves any saved items when a save
      // doesn't mention them, so this panel can't wipe them.
      const res = await fetch('/api/finance/dtr-review/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billingMonth,
          clientName,
          override: Object.keys(override).length > 0 ? override : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      setSavedAt(Date.now());
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const cfg = matterDefaults;
  const fmtMoney = (n: number | null | undefined) =>
    n == null ? '—' : `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0 })}`;

  return (
    <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-[var(--subtle-bg)]/50 hover:bg-[var(--subtle-bg)] transition-colors cursor-pointer text-left"
        aria-expanded={expanded}
      >
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Invoice settings (override)
          </p>
          <p className="text-xs text-[var(--text-secondary)]">
            Override any letter setting for this one invoice. Blank = use the matter default (shown as a hint).
          </p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-[var(--text-muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />}
      </button>
      {expanded && (
        <div className="px-4 py-4 space-y-4">
          {/* Read-only defaults summary */}
          {cfg && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Type</p>
                <p className="text-foreground">{cfg.billingType ?? '—'}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Monthly</p>
                <p className="text-foreground tabular-nums">{fmtMoney(cfg.monthlyRetainer)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Hours Cap</p>
                <p className="text-foreground tabular-nums">{cfg.retainerHoursCap ?? '—'}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Rate Override</p>
                <p className="text-foreground tabular-nums">{fmtMoney(cfg.hourlyRateOverride)}</p>
              </div>
            </div>
          )}
          {/* Editable overrides — blank uses the matter default (shown as a hint). */}
          <div className="space-y-4">
            <FieldGroup title="Letter Details">
              <OverrideField label="Client Address" value={over.clientAddress} onChange={(v) => setField('clientAddress', v)} defaultText={dflt('clientAddress')} multiline />
              <OverrideField label="Attn" value={over.attnName} onChange={(v) => setField('attnName', v)} defaultText={dflt('attnName')} />
              <OverrideField label="Attn Title" value={over.attnTitle} onChange={(v) => setField('attnTitle', v)} defaultText={dflt('attnTitle')} />
              <OverrideField label="Through" value={over.throughName} onChange={(v) => setField('throughName', v)} defaultText={dflt('throughName')} />
              <OverrideField label="Salutation" value={over.salutation} onChange={(v) => setField('salutation', v)} defaultText={dflt('salutation')} />
              <OverrideField label="Engagement Date" value={over.engagementDate} onChange={(v) => setField('engagementDate', v)} defaultText={dflt('engagementDate')} />
            </FieldGroup>
            <FieldGroup title="Retainer & Balance">
              <OverrideField label="Retainer Cap (₱)" value={over.retainerCap} onChange={(v) => setField('retainerCap', v)} defaultText={dflt('retainerCap')} type="number" />
              <OverrideField label="Retainer Hours Cap" value={over.retainerHoursCap} onChange={(v) => setField('retainerHoursCap', v)} defaultText={dflt('retainerHoursCap')} type="number" />
              <OverrideField label="Monthly Retainer (₱)" value={over.monthlyRetainer} onChange={(v) => setField('monthlyRetainer', v)} defaultText={dflt('monthlyRetainer')} type="number" />
              <OverrideField label="Previous Balance (₱)" value={over.previousBalance} onChange={(v) => setField('previousBalance', v)} defaultText={dflt('previousBalance')} type="number" />
              <OverrideField label="Previous Balance Label" value={over.previousBalanceLabel} onChange={(v) => setField('previousBalanceLabel', v)} defaultText={dflt('previousBalanceLabel')} multiline />
            </FieldGroup>
            <FieldGroup title="Bank">
              <OverrideField label="Bank" value={over.bankName} onChange={(v) => setField('bankName', v)} defaultText={dflt('bankName')} />
              <OverrideField label="Account No." value={over.bankAccountNo} onChange={(v) => setField('bankAccountNo', v)} defaultText={dflt('bankAccountNo')} />
              <OverrideField label="Account Name" value={over.bankAccountName} onChange={(v) => setField('bankAccountName', v)} defaultText={dflt('bankAccountName')} />
            </FieldGroup>
            <FieldGroup title="Discounts & Recipient">
              <OverrideField label="Hourly Discount (%)" value={over.hourlyDiscountPercent} onChange={(v) => setField('hourlyDiscountPercent', v)} defaultText={dflt('hourlyDiscountPercent')} type="number" />
              <OverrideField label="Total Discount (%)" value={over.totalDiscountPercent} onChange={(v) => setField('totalDiscountPercent', v)} defaultText={dflt('totalDiscountPercent')} type="number" />
              <OverrideField label="Early-Payment Discount (%)" value={over.earlyPaymentDiscountPercent} onChange={(v) => setField('earlyPaymentDiscountPercent', v)} defaultText={dflt('earlyPaymentDiscountPercent')} type="number" />
              <OverrideField label="If Paid Within (days)" value={over.earlyPaymentDays} onChange={(v) => setField('earlyPaymentDays', v)} defaultText={dflt('earlyPaymentDays')} type="number" />
              <OverrideField label="Client Email" value={over.clientEmail} onChange={(v) => setField('clientEmail', v)} defaultText={dflt('clientEmail')} type="email" />
              <OverrideField label="CC (comma-sep)" value={over.ccEmails} onChange={(v) => setField('ccEmails', v)} defaultText={dflt('ccEmails')} />
            </FieldGroup>
            <FieldGroup title="Toggles">
              <BooleanOverride label="Include VAT" value={vat} onChange={setVat} defaultBool={dflt('includeVAT') === 'true'} />
              <BooleanOverride label={'Add "lessen fees" note'} value={lessen} onChange={setLessen} defaultBool={dflt('includeLessenFeesNote') === 'true'} />
              <BooleanOverride label="Settle from advance deposit" value={settleDeposit} onChange={setSettleDeposit} defaultBool={dflt('settleFromDeposit') !== 'false'} />
              <BooleanOverride label="Open as initial billing statement" value={initialStatement} onChange={setInitialStatement} defaultBool={dflt('initialStatement') === 'true'} />
              {letterParagraphs.filter((p) => !p.archived || clientParagraphs.has(p.key)).map((p) => (
                <BooleanOverride
                  key={p.key}
                  label={`Paragraph: ${p.label}`}
                  value={paragraphs[p.key] ?? ''}
                  onChange={(v) => setParagraphs((prev) => ({ ...prev, [p.key]: v }))}
                  defaultBool={clientParagraphs.has(p.key)}
                />
              ))}
            </FieldGroup>
          </div>
          <div className="flex items-center justify-end gap-3">
            {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
            {savedAt && !saving && !error && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-navy-900 dark:bg-gold-400 text-white dark:text-navy-950 hover:bg-navy-800 dark:hover:bg-gold-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save override'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">{title}</p>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function OverrideField({
  label,
  value,
  onChange,
  defaultText,
  type = 'text',
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  defaultText: string;
  type?: string;
  multiline?: boolean;
}) {
  const cls = "w-full px-2.5 py-1.5 text-xs rounded-md bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400/20";
  return (
    <div className={multiline ? 'col-span-2' : ''}>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          placeholder={defaultText ? `default: ${defaultText}` : ''}
          className={`${cls} resize-none`}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={defaultText ? `default: ${defaultText}` : ''}
          className={cls}
        />
      )}
    </div>
  );
}

/** Tri-state boolean override: blank = use matter default, On/Off = override. */
function BooleanOverride({
  label, value, onChange, defaultBool,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  defaultBool: boolean;
}) {
  const opts = [
    { v: '', t: `Default (${defaultBool ? 'On' : 'Off'})` },
    { v: 'true', t: 'On' },
    { v: 'false', t: 'Off' },
  ];
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">{label}</label>
      <div className="inline-flex rounded-md border border-[var(--border-color)] overflow-hidden">
        {opts.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`px-2.5 py-1 text-[11px] transition-colors ${
              value === o.v
                ? 'bg-navy-900 dark:bg-gold-400 text-white dark:text-navy-950'
                : 'bg-[var(--background)] text-[var(--text-secondary)] hover:bg-[var(--subtle-bg)]'
            }`}
          >
            {o.t}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusPill({
  status,
  clearance = null,
}: {
  status: 'pending' | 'approved' | 'rejected' | null;
  clearance?: 'cleared' | 'declined' | null;
}) {
  const map = {
    approved: { label: 'Approved', icon: CheckCircle2, classes: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30' },
    cleared: { label: 'Cleared', icon: ShieldCheck, classes: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30' },
    awaiting: { label: 'Awaiting clearance', icon: ShieldQuestion, classes: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 ring-blue-500/30' },
    pending: { label: 'Pending review', icon: Clock, classes: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30' },
    rejected: { label: 'Changes requested', icon: XCircle, classes: 'bg-red-500/15 text-red-700 dark:text-red-300 ring-red-500/30' },
    declined: { label: 'Clearance declined', icon: XCircle, classes: 'bg-red-500/15 text-red-700 dark:text-red-300 ring-red-500/30' },
    null: { label: 'Not submitted', icon: Edit2, classes: 'bg-[var(--subtle-bg)] text-[var(--text-muted)] ring-[var(--border-color)]' },
  } as const;
  const cfg =
    status === 'approved'
      ? (clearance === 'cleared' ? map.cleared : map.awaiting)
      : status === 'rejected'
        ? (clearance === 'declined' ? map.declined : map.rejected)
        : status
          ? map[status]
          : map.null;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ring-1 ring-inset ${cfg.classes}`}>
      <Icon className="w-3.5 h-3.5" />
      {cfg.label}
    </span>
  );
}

const ROW_BADGE = {
  raw: { label: 'Raw', classes: 'bg-[var(--subtle-bg)] text-[var(--text-muted)]' },
  revised: { label: 'Revised', classes: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' },
  excluded: { label: 'Excluded', classes: 'bg-red-500/15 text-red-700 dark:text-red-300' },
  waived: { label: 'Waived', classes: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  added: { label: 'Added', classes: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
} as const;

function EntryRow({
  entry, entryKeyStr, readOnly, expanded, onToggle, comments, lawyers, matters, matterById,
  editingCell, setEditingCell, savingCells, onSaveCell, onExclude, onWaive, onUnwaive, onRestore, onRevert, onCommentAdded,
  isPrincipal = true, rowLawyer = '',
}: {
  entry: DTRBundleEntry;
  entryKeyStr: string;
  readOnly: boolean;
  expanded: boolean;
  onToggle: () => void;
  comments: Comment[];
  lawyers: Lawyer[];
  matters: Matter[];
  matterById: Map<string, Matter>;
  editingCell: EditingCell | null;
  setEditingCell: (c: EditingCell | null) => void;
  savingCells: Set<string>;
  onSaveCell: (change: Partial<DTRSnapshot>) => Promise<void>;
  onExclude: () => Promise<void>;
  onWaive: () => Promise<void>;
  onUnwaive: () => Promise<void>;
  onRestore: () => Promise<void>;
  onRevert: () => Promise<void>;
  onCommentAdded: () => void;
  /** True when the current lawyer group is the entry's principal lawyer.
   *  False when this row is duplicated under a co-attendee group (via with_names). */
  isPrincipal?: boolean;
  /** The lawyer whose fanned line this row represents — used for per-attendee waive. */
  rowLawyer?: string;
}) {
  const status = entryStatus(entry);
  const effective = entry.effective ?? entry.raw;
  const stale = !!entry.revision?.rawIsNewerThanRevision;
  const isExcluded = status === 'excluded';
  // Waive is per-attendee: this row is waived only if ITS lawyer is in the set.
  const isWaived = !isExcluded && (effective?.waivedWith ?? []).some((w) => w.trim() === rowLawyer.trim());
  const badge = isWaived ? ROW_BADGE.waived : ROW_BADGE[status];
  // Excluded and waived rows are both "locked" — not inline-editable. Restore first.
  const locked = isExcluded || isWaived;
  const [confirmingRevert, setConfirmingRevert] = useState(false);
  const [reverting, setReverting] = useState(false);

  const revertDiff = useMemo(() => {
    // What will change if the user confirms revert. For 'added' entries there
    // is no raw, so we show the snapshot they're about to drop.
    if (status === 'added') return [] as ReturnType<typeof fieldDiff>;
    return fieldDiff(entry.raw, entry.effective, matterById);
  }, [entry, matterById, status]);

  const lawyersByName = useMemo(() => {
    const m = new Map<string, Lawyer>();
    for (const l of lawyers) m.set(l.name, l);
    return m;
  }, [lawyers]);

  function isEditing(field: EditableField) {
    return editingCell?.entryKey === entryKeyStr && editingCell.field === field;
  }
  function startEdit(field: EditableField) {
    if (readOnly || locked) return;
    setEditingCell({ entryKey: entryKeyStr, field });
  }
  function isSaving(field: EditableField) {
    return savingCells.has(`${entryKeyStr}|${field}`);
  }

  const cellWrapClass = (extra = '') =>
    `px-4 py-2.5 ${readOnly || locked ? '' : 'cursor-text hover:bg-[var(--subtle-bg)]/40'} ${extra}`.trim();

  return (
    <>
      <tr className={`${expanded ? 'bg-[var(--subtle-bg)]/30' : ''} ${isExcluded ? 'opacity-60' : ''} ${isWaived ? 'opacity-70 [&_td]:line-through' : ''}`}>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-md ${badge.classes}`}>
              {badge.label}
            </span>
            {stale && (
              <HoverTooltip content="The original DTR was edited after this revision — re-check the row.">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              </HoverTooltip>
            )}
            {comments.length > 0 && (
              <span title={`${comments.length} comment${comments.length === 1 ? '' : 's'}`} className="inline-flex items-center gap-0.5 text-[10px] text-[var(--text-muted)]">
                <MessageSquare className="w-3 h-3" />
                {comments.length}
              </span>
            )}
          </div>
        </td>

        {/* Date */}
        <td className={cellWrapClass()} onClick={() => !isEditing('date') && startEdit('date')}>
          {isEditing('date') ? (
            <DatePickerInput
              value={effective?.date ?? null}
              onChange={async (v) => {
                setEditingCell(null);
                if (v !== effective?.date) await onSaveCell({ date: v });
              }}
              placeholder="Pick date"
            />
          ) : (
            <span className="text-foreground">{effective?.date ?? '—'}</span>
          )}
          {isSaving('date') && <Loader2 className="inline w-3 h-3 ml-1 animate-spin text-[var(--text-muted)]" />}
        </td>

        {/* Lawyer */}
        <td className={cellWrapClass()} onClick={() => !isEditing('lawyerName') && startEdit('lawyerName')}>
          {isEditing('lawyerName') ? (
            <PickerDropdown
              autoOpen
              placeholder="Select lawyer"
              value={lawyersByName.get(effective?.lawyerName ?? '')?.personId ?? null}
              displayValue={effective?.lawyerName ?? ''}
              onSelect={async (id) => {
                const l = lawyers.find((x) => x.personId === id);
                setEditingCell(null);
                if (l && l.name !== effective?.lawyerName) await onSaveCell({ lawyerName: l.name });
              }}
              onClose={() => setEditingCell(null)}
              options={lawyers.map((l) => ({ id: l.personId, label: l.name, sublabel: l.initials }))}
            />
          ) : (
            <span className="text-foreground">
              {effective?.lawyerName || '—'}
              {!isPrincipal && (
                <span
                  className="ml-1.5 inline-flex items-center px-1 py-0.5 text-[9px] font-medium rounded uppercase tracking-wider bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
                  title="Co-attendee — this entry was logged by the lawyer named here, and is fanned out under the current group"
                >
                  with
                </span>
              )}
            </span>
          )}
          {isSaving('lawyerName') && <Loader2 className="inline w-3 h-3 ml-1 animate-spin text-[var(--text-muted)]" />}
        </td>

        {/* Hours */}
        <td className={cellWrapClass('text-right tabular-nums')} onClick={() => !isEditing('hours') && startEdit('hours')}>
          {isEditing('hours') ? (
            <HoursMinutesInline
              hours={effective?.hours ?? 0}
              minutes={effective?.minutes ?? 0}
              onCommit={async (h, m) => {
                setEditingCell(null);
                if (h !== effective?.hours || m !== effective?.minutes) {
                  await onSaveCell({ hours: h, minutes: m });
                }
              }}
              onCancel={() => setEditingCell(null)}
            />
          ) : (
            <span className="text-foreground">
              {effective ? `${effective.hours}:${String(effective.minutes ?? 0).padStart(2, '0')}` : '—'}
            </span>
          )}
          {(isSaving('hours')) && <Loader2 className="inline w-3 h-3 ml-1 animate-spin text-[var(--text-muted)]" />}
        </td>

        {/* Task */}
        <td className={cellWrapClass()} onClick={() => !isEditing('task') && startEdit('task')}>
          {isEditing('task') ? (
            <PickerDropdown
              autoOpen
              placeholder="Select task"
              value={effective?.task || null}
              displayValue={effective?.task ?? ''}
              onSelect={async (id) => {
                setEditingCell(null);
                if (id !== effective?.task) await onSaveCell({ task: id });
              }}
              onClose={() => setEditingCell(null)}
              options={TASK_OPTIONS.map((t) => ({ id: t, label: t }))}
            />
          ) : (
            <span className="text-foreground">{effective?.task || '—'}</span>
          )}
          {isSaving('task') && <Loader2 className="inline w-3 h-3 ml-1 animate-spin text-[var(--text-muted)]" />}
        </td>

        {/* Remarks */}
        <td className={cellWrapClass('max-w-[24rem]')} onClick={() => !isEditing('remarks') && startEdit('remarks')}>
          {isEditing('remarks') ? (
            <RemarksInline
              value={effective?.remarks ?? ''}
              onCommit={async (v) => {
                setEditingCell(null);
                if (v !== effective?.remarks) await onSaveCell({ remarks: v });
              }}
              onCancel={() => setEditingCell(null)}
            />
          ) : (
            <p className="truncate text-sm text-foreground">{effective?.remarks || '—'}</p>
          )}
          {isSaving('remarks') && <Loader2 className="inline w-3 h-3 ml-1 animate-spin text-[var(--text-muted)]" />}
        </td>

        {/* Matter */}
        <td className={cellWrapClass('max-w-[18rem]')} onClick={() => !isEditing('matterId') && startEdit('matterId')}>
          {isEditing('matterId') ? (
            <PickerDropdown
              autoOpen
              placeholder={matters.length === 0 ? 'No matters' : 'Select matter'}
              value={effective?.matterId ?? null}
              displayValue={effective?.matterId ? matterById.get(effective.matterId)?.name ?? effective.matterId : ''}
              onSelect={async (id) => {
                setEditingCell(null);
                if (id !== effective?.matterId) await onSaveCell({ matterId: id });
              }}
              onClear={async () => {
                setEditingCell(null);
                if (effective?.matterId) await onSaveCell({ matterId: null });
              }}
              onClose={() => setEditingCell(null)}
              options={matters.map((m) => ({ id: m.id, label: m.name, sublabel: m.code }))}
            />
          ) : (
            <span className="truncate text-foreground text-sm block">
              {effective?.matterId ? matterById.get(effective.matterId)?.name ?? effective.matterId : '—'}
            </span>
          )}
          {isSaving('matterId') && <Loader2 className="inline w-3 h-3 ml-1 animate-spin text-[var(--text-muted)]" />}
        </td>

        {/* Actions */}
        <td className="px-4 py-2.5">
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={onToggle}
              title={expanded ? 'Close' : 'View diff / comments / with'}
              className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {!readOnly && (status === 'revised' || status === 'added') && !locked && (
              <button
                onClick={() => setConfirmingRevert(true)}
                title={status === 'added' ? 'Remove this added entry' : 'Revert to raw'}
                className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-amber-600 hover:bg-amber-500/10 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            {!readOnly && (locked ? (
              <button
                onClick={isWaived ? onUnwaive : onRestore}
                title={isWaived ? `Restore ${rowLawyer || 'this lawyer'} to billable` : 'Restore to billable'}
                className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            ) : (
              <>
                <button
                  onClick={onWaive}
                  title={`Waive ${rowLawyer || 'this lawyer'}'s line — shown, struck through, billed ₱0`}
                  className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-amber-600 hover:bg-amber-500/10 transition-colors"
                >
                  <Strikethrough className="w-4 h-4" />
                </button>
                <button
                  onClick={onExclude}
                  title="Exclude — removed from the invoice entirely"
                  className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-red-600 hover:bg-red-500/10 transition-colors"
                >
                  <MinusCircle className="w-4 h-4" />
                </button>
              </>
            ))}
          </div>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={8} className="bg-[var(--subtle-bg)]/30 px-4 py-4 border-t border-[var(--border-color)]">
            <ExpandedEntry
              entry={entry}
              comments={comments}
              lawyers={lawyers}
              matterById={matterById}
              readOnly={readOnly}
              onSaveCell={onSaveCell}
              onCommentAdded={onCommentAdded}
            />
          </td>
        </tr>
      )}

      {/* Revert confirmation dialog — portaled so it escapes the table's
          overflow-x-auto and any modal nesting. */}
      {confirmingRevert && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => !reverting && setConfirmingRevert(false)}
        >
          <div
            className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-elevated)] w-full max-w-md p-5"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-foreground mb-1">
              {status === 'added' ? 'Remove this added entry?' : 'Revert this revision?'}
            </h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              {status === 'added'
                ? 'This entry was added by finance and will be removed from the bundle. The action is itself reversible by re-adding the entry.'
                : 'Finance’s revision will be discarded and the row will roll back to the lawyer’s originally logged values.'}
            </p>
            {revertDiff.length > 0 && (
              <div className="mb-4 rounded-lg border border-[var(--border-color)] bg-[var(--subtle-bg)]/50 overflow-hidden">
                <div className="px-3 py-2 border-b border-[var(--border-color)]">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Changes that will be discarded
                  </p>
                </div>
                <ul className="divide-y divide-[var(--border-color)]">
                  {revertDiff.map((d) => (
                    <li key={d.label} className="px-3 py-2 text-xs">
                      <p className="font-medium text-foreground mb-0.5">{d.label}</p>
                      <p className="text-[var(--text-muted)]">
                        <span className="line-through">{d.revised}</span>
                        <span className="mx-1.5">→</span>
                        <span className="text-foreground">{d.raw}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={reverting}
                onClick={() => setConfirmingRevert(false)}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--background)] text-[var(--text-secondary)] hover:bg-stone-100 dark:hover:bg-stone-800 border border-[var(--border-color)] cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reverting}
                onClick={async () => {
                  setReverting(true);
                  try {
                    await onRevert();
                    setConfirmingRevert(false);
                  } finally {
                    setReverting(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 cursor-pointer disabled:opacity-50"
              >
                {reverting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                {status === 'added' ? 'Remove' : 'Revert'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Inline editors for Hours and Remarks ─────────────────────────

function HoursMinutesInline({
  hours, minutes, onCommit, onCancel,
}: {
  hours: number;
  minutes: number;
  onCommit: (h: number, m: number) => void;
  onCancel: () => void;
}) {
  const [h, setH] = useState(hours);
  const [m, setM] = useState(minutes);
  const hRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => hRef.current?.select());
  }, []);

  return (
    <div
      className="inline-flex items-center gap-1"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter') onCommit(h, m);
      }}
    >
      <input
        ref={hRef}
        type="number"
        min={0}
        value={h}
        onChange={(e) => setH(parseInt(e.target.value) || 0)}
        onBlur={(e) => {
          // Commit only when focus leaves the whole hours/minutes group
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) {
            onCommit(h, m);
          }
        }}
        className="w-12 text-right text-sm rounded-md bg-[var(--background)] border border-gold-400 ring-1 ring-gold-400/20 px-1.5 py-1 focus:outline-none"
      />
      <span className="text-foreground">:</span>
      <input
        type="number"
        min={0}
        max={59}
        value={m}
        onChange={(e) => setM(parseInt(e.target.value) || 0)}
        onBlur={(e) => {
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) {
            onCommit(h, m);
          }
        }}
        className="w-12 text-right text-sm rounded-md bg-[var(--background)] border border-gold-400 ring-1 ring-gold-400/20 px-1.5 py-1 focus:outline-none"
      />
    </div>
  );
}

function RemarksInline({
  value, onCommit, onCancel,
}: {
  value: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => ref.current?.select());
  }, []);

  return (
    <input
      ref={ref}
      type="text"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter') onCommit(v);
      }}
      className="w-full text-sm rounded-md bg-[var(--background)] border border-gold-400 ring-1 ring-gold-400/20 px-2 py-1 focus:outline-none"
    />
  );
}

function ExpandedEntry({
  entry, comments, lawyers, matterById, readOnly, onSaveCell, onCommentAdded,
}: {
  entry: DTRBundleEntry;
  comments: Comment[];
  lawyers: Lawyer[];
  matterById: Map<string, Matter>;
  readOnly: boolean;
  onSaveCell: (change: Partial<DTRSnapshot>) => Promise<void>;
  onCommentAdded: () => void;
}) {
  const diff = fieldDiff(entry.raw, entry.effective, matterById);
  const eff = entry.effective ?? entry.raw;

  // Resolve current "with" lawyer ids — prefer stored ids, otherwise look up by name
  const lawyersByName = useMemo(() => {
    const m = new Map<string, Lawyer>();
    for (const l of lawyers) m.set(l.name, l);
    return m;
  }, [lawyers]);
  const lawyersById = useMemo(() => {
    const m = new Map<string, Lawyer>();
    for (const l of lawyers) m.set(l.personId, l);
    return m;
  }, [lawyers]);

  const withSelectedIds = useMemo(() => {
    const ids = eff?.withIds ?? [];
    if (ids.length > 0) return ids;
    return (eff?.withNames ?? [])
      .map((n) => lawyersByName.get(n)?.personId)
      .filter((x): x is string => !!x);
  }, [eff, lawyersByName]);

  async function setWith(ids: string[]) {
    const names = ids.map((id) => lawyersById.get(id)?.name).filter((n): n is string => !!n);
    await onSaveCell({ withIds: ids, withNames: names });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: diff + with multi-select */}
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Changes from raw</p>
          {entry.raw && entry.effective && diff.length > 0 ? (
            <table className="w-full text-xs">
              <thead className="text-[var(--text-muted)]">
                <tr>
                  <th className="text-left py-1">Field</th>
                  <th className="text-left py-1">Raw</th>
                  <th className="text-left py-1">Revised</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-color)]">
                {diff.map((d) => (
                  <tr key={d.label}>
                    <td className="py-1.5 font-medium text-foreground pr-3">{d.label}</td>
                    <td className="py-1.5 text-[var(--text-muted)] line-through pr-3 break-all">{d.raw}</td>
                    <td className="py-1.5 text-foreground break-all">{d.revised}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : entry.raw && !entry.effective ? (
            <p className="text-xs text-[var(--text-muted)]">Excluded from billing for this client/month.</p>
          ) : !entry.raw && entry.effective ? (
            <p className="text-xs text-[var(--text-muted)]">Added by finance — no raw counterpart.</p>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">No changes from raw.</p>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">With (other lawyers)</p>
          {readOnly ? (
            <p className="text-xs text-foreground">
              {withSelectedIds.length === 0
                ? '—'
                : withSelectedIds
                    .map((id) => lawyersById.get(id)?.name ?? id)
                    .join(', ')}
            </p>
          ) : (
            <LawyerMultiSelect
              allLawyers={lawyers}
              selectedIds={withSelectedIds}
              onChange={setWith}
            />
          )}
        </div>
      </div>

      {/* Right: comments */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Comments</p>
        <CommentsThread
          revisionId={entry.revision?.id ?? null}
          comments={comments}
          onCommentAdded={onCommentAdded}
        />
      </div>
    </div>
  );
}

function RevisionEditor({
  initial, lawyers, matters, onSave, onCancel, busyLabel, saveLabel,
}: {
  initial: DTRSnapshot;
  lawyers: Lawyer[];
  matters: Matter[];
  onSave: (snap: DTRSnapshot) => Promise<void>;
  onCancel: () => void;
  busyLabel: string;
  saveLabel: string;
}) {
  const [snap, setSnap] = useState<DTRSnapshot>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Resolve current "with" lawyer ids: prefer stored ids, otherwise look up by name.
  const lawyersByName = useMemo(() => {
    const m = new Map<string, Lawyer>();
    for (const l of lawyers) m.set(l.name, l);
    return m;
  }, [lawyers]);
  const lawyersById = useMemo(() => {
    const m = new Map<string, Lawyer>();
    for (const l of lawyers) m.set(l.personId, l);
    return m;
  }, [lawyers]);

  const withSelectedIds = useMemo(() => {
    if ((snap.withIds ?? []).length > 0) return snap.withIds!;
    // Fall back to resolving names → ids when ids weren't stored on the raw row
    return (snap.withNames ?? [])
      .map((n) => lawyersByName.get(n)?.personId)
      .filter((x): x is string => !!x);
  }, [snap.withIds, snap.withNames, lawyersByName]);

  function setWithLawyers(ids: string[]) {
    const names = ids.map((id) => lawyersById.get(id)?.name).filter((n): n is string => !!n);
    setSnap((s) => ({ ...s, withIds: ids, withNames: names }));
  }

  return (
    <div className="space-y-3 bg-[var(--card-bg)] rounded-lg border border-[var(--border-color)] p-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date">
          <DatePickerInput value={snap.date} onChange={(v) => setSnap((s) => ({ ...s, date: v }))} placeholder="Select date" />
        </Field>
        <Field label="Lawyer">
          <PickerDropdown
            placeholder="Select lawyer"
            value={lawyersByName.get(snap.lawyerName)?.personId ?? null}
            displayValue={snap.lawyerName || ''}
            onSelect={(id) => {
              const l = lawyersById.get(id);
              setSnap((s) => ({ ...s, lawyerName: l?.name ?? '' }));
            }}
            onClear={() => setSnap((s) => ({ ...s, lawyerName: '' }))}
            options={lawyers.map((l) => ({ id: l.personId, label: l.name, sublabel: l.initials }))}
          />
        </Field>
        <Field label="Hours">
          <input type="number" min={0} value={snap.hours} onChange={(e) => setSnap((s) => ({ ...s, hours: parseInt(e.target.value) || 0 }))} className={inputCls} />
        </Field>
        <Field label="Minutes">
          <input type="number" min={0} max={59} value={snap.minutes} onChange={(e) => setSnap((s) => ({ ...s, minutes: parseInt(e.target.value) || 0 }))} className={inputCls} />
        </Field>
      </div>
      <Field label="Task">
        <PickerDropdown
          placeholder="Select task"
          value={snap.task || null}
          displayValue={snap.task}
          onSelect={(id) => setSnap((s) => ({ ...s, task: id }))}
          onClear={() => setSnap((s) => ({ ...s, task: '' }))}
          options={TASK_OPTIONS.map((t) => ({ id: t, label: t }))}
        />
      </Field>
      <Field label="Remarks">
        <textarea
          value={snap.remarks}
          onChange={(e) => setSnap((s) => ({ ...s, remarks: e.target.value }))}
          rows={2}
          className={inputCls}
        />
      </Field>
      <Field label="With">
        <LawyerMultiSelect
          allLawyers={lawyers}
          selectedIds={withSelectedIds}
          onChange={setWithLawyers}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Matter">
          <PickerDropdown
            placeholder={matters.length === 0 ? 'No matters for this client' : 'Select matter'}
            value={snap.matterId}
            displayValue={
              snap.matterId
                ? matters.find((m) => m.id === snap.matterId)?.name ?? snap.matterId
                : ''
            }
            onSelect={(id) => setSnap((s) => ({ ...s, matterId: id }))}
            onClear={() => setSnap((s) => ({ ...s, matterId: null }))}
            options={matters.map((m) => ({
              id: m.id,
              label: m.name,
              sublabel: m.code,
            }))}
          />
        </Field>
        <div className="flex items-end pb-1">
          <label className="inline-flex items-center gap-1.5 text-xs text-foreground">
            <input type="checkbox" checked={snap.nonBillable} onChange={(e) => setSnap((s) => ({ ...s, nonBillable: e.target.checked }))} />
            Non-billable
          </label>
        </div>
      </div>

      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--subtle-bg)] transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Cancel
        </button>
        <button
          onClick={async () => {
            setBusy(true);
            setErr('');
            try {
              await onSave(snap);
            } catch (e) {
              setErr(e instanceof Error ? e.message : 'Failed to save');
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-colors"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {busy ? busyLabel : saveLabel}
        </button>
      </div>
    </div>
  );
}

const inputCls =
  'w-full px-2 py-1.5 text-sm rounded-md bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400/20';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] mb-1">{label}</span>
      {children}
    </label>
  );
}

function CommentsThread({
  revisionId, comments, onCommentAdded,
}: {
  revisionId: number | null;
  comments: Comment[];
  onCommentAdded: () => void;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function post() {
    if (!revisionId || !body.trim()) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/finance/dtr-review/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revisionId, body: body.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to post comment');
      setBody('');
      onCommentAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to post');
    } finally {
      setBusy(false);
    }
  }

  if (!revisionId) {
    return (
      <p className="text-xs text-[var(--text-muted)]">
        Comments unlock after this entry is revised at least once.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {comments.length === 0 && <p className="text-xs text-[var(--text-muted)]">No comments yet.</p>}
        {comments.map((c) => (
          <div key={c.id} className={`text-xs p-2 rounded-md border ${c.resolved ? 'bg-[var(--subtle-bg)]/50 opacity-60 border-[var(--border-color)]' : 'bg-[var(--card-bg)] border-[var(--border-color)]'}`}>
            <p className="text-[10px] font-medium text-[var(--text-muted)] mb-0.5 capitalize">
              {c.authorRole.replace(/_/g, ' ')} · {new Date(c.createdAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </p>
            <p className="text-foreground whitespace-pre-wrap">{c.body}</p>
          </div>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Reply or note something for the partner…"
        className={inputCls}
      />
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
      <div className="flex justify-end">
        <button
          onClick={post}
          disabled={busy || !body.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--card-bg)] border border-[var(--border-color)] hover:bg-[var(--subtle-bg)] disabled:opacity-50 text-foreground transition-colors"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
          Post
        </button>
      </div>
    </div>
  );
}

// ── Searchable single-select dropdown (task, lawyer, matter) ──────

interface PickerOption {
  id: string;
  label: string;
  sublabel?: string;
}

function PickerDropdown({
  placeholder, value, displayValue, options, onSelect, onClear, autoOpen, onClose,
}: {
  placeholder: string;
  value: string | null;
  displayValue: string;
  options: PickerOption[];
  onSelect: (id: string) => void;
  onClear?: () => void;
  /** When true, the dropdown opens automatically on mount — used for cell-level inline editing. */
  autoOpen?: boolean;
  /** Fired when the dropdown is dismissed (outside click, Escape) without a selection. */
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(!!autoOpen);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(t) &&
        dropdownRef.current && !dropdownRef.current.contains(t)
      ) {
        setOpen(false);
        setSearch('');
        onClose?.();
      }
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setSearch('');
        onClose?.();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.sublabel?.toLowerCase().includes(q) ?? false),
    );
  }, [options, search]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-sm rounded-md border transition-colors ${
          open
            ? 'bg-[var(--background)] border-gold-400 ring-1 ring-gold-400/20'
            : 'bg-[var(--background)] border-[var(--border-color)] hover:border-[var(--text-muted)]'
        }`}
      >
        <span className={`truncate ${displayValue ? 'text-foreground' : 'text-[var(--text-muted)]'}`}>
          {displayValue || placeholder}
        </span>
        <span className="flex items-center gap-0.5 shrink-0">
          {value && onClear && (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); onClear(); setOpen(false); }}
              className="p-0.5 rounded text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)]"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[100] bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-[var(--shadow-elevated)] overflow-hidden"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          <div className="p-2 border-b border-[var(--border-color)]">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-[var(--subtle-bg)] rounded-md">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-[var(--text-muted)]"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-0.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm text-[var(--text-muted)] text-center">No matches.</p>
            ) : (
              filtered.map((opt) => {
                const isSelected = opt.id === value;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => { onSelect(opt.id); setOpen(false); setSearch(''); }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
                      isSelected ? 'bg-gold-500/10 text-gold-700 dark:text-gold-300' : 'text-foreground hover:bg-[var(--subtle-bg)]'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="truncate">{opt.label}</span>
                      {opt.sublabel && (
                        <span className={`ml-1.5 text-xs ${isSelected ? 'text-gold-500 dark:text-gold-400' : 'text-[var(--text-muted)]'}`}>
                          {opt.sublabel}
                        </span>
                      )}
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-gold-600 shrink-0 dark:text-gold-400" />}
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Lawyer multi-select with chips ────────────────────────────────

function LawyerMultiSelect({
  allLawyers, selectedIds, onChange,
}: {
  allLawyers: Lawyer[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const lawyersById = useMemo(() => {
    const m = new Map<string, Lawyer>();
    for (const l of allLawyers) m.set(l.personId, l);
    return m;
  }, [allLawyers]);

  const remaining = useMemo(() => {
    const set = new Set(selectedIds);
    return allLawyers.filter((l) => !set.has(l.personId));
  }, [allLawyers, selectedIds]);

  function add(id: string) {
    if (!selectedIds.includes(id)) onChange([...selectedIds, id]);
  }
  function remove(id: string) {
    onChange(selectedIds.filter((x) => x !== id));
  }

  return (
    <div className="space-y-2">
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map((id) => {
            const l = lawyersById.get(id);
            const label = l?.name ?? FORMER_MEMBER;
            const initials = l?.initials ?? '–';
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 pl-1.5 pr-1 py-0.5 text-xs font-medium bg-[var(--subtle-bg)] border border-[var(--border-color)] text-foreground rounded-full"
              >
                <span className="w-5 h-5 rounded-full bg-gold-500/15 text-gold-700 dark:text-gold-300 text-[10px] font-bold flex items-center justify-center shrink-0">
                  {initials}
                </span>
                <span className="truncate max-w-[120px]" title={label}>{label}</span>
                <button
                  type="button"
                  onClick={() => remove(id)}
                  className="p-0.5 rounded-full text-[var(--text-muted)] hover:text-red-500 hover:bg-red-500/10 dark:hover:text-red-400"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <PickerDropdown
        placeholder={remaining.length === 0 ? 'All lawyers added' : 'Add lawyer'}
        value={null}
        displayValue=""
        onSelect={(id) => add(id)}
        options={remaining.map((l) => ({ id: l.personId, label: l.name, sublabel: l.initials }))}
      />
    </div>
  );
}
