'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Loader2, AlertCircle, CheckCircle2, Clock, XCircle, FileEdit, ChevronRight, Search, X, Send, FileText, Download, ArrowUpDown, AlertTriangle, ChevronDown, ShieldCheck, ShieldQuestion } from 'lucide-react';
import MonthSelect from '@/components/finance/MonthSelect';
import DTRReviewBundle from '@/components/finance/DTRReviewBundle';
import CellDropdown from '@/components/admin/CellDropdown';
import { manilaMonth } from '@/lib/dates';
import OffCycleRequests from '@/components/finance/OffCycleRequests';

interface ClientSummary {
  clientName: string;
  rawCount: number;
  revisedCount: number;
  reviewStatus: 'pending' | 'approved' | 'rejected' | null;
  /** Second signature: the relationship partner's sign-off, after MP approval. */
  clearanceStatus: 'cleared' | 'declined' | null;
  clearedAt: string | null;
  /** team.person_id of the partner who owns this client relationship. */
  relationshipPartnerId: string | null;
  relationshipPartnerName: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  totalLegalFees: number;
  /** Finance's manual "unlikely to pay" flag (clients.collection_risk). */
  collectionRisk: boolean;
  /** Unpaid balance on invoices past their due date. */
  overdueAmount: number;
  /** Running balance the client owes the firm (opening receivables + open invoices). */
  outstandingBalance: number;
  /** Its invoice for this month has gone out (sent, part-paid or paid), so
   *  "Generate cleared" leaves it alone. */
  billedThisMonth?: boolean;
}

type RiskLevel = 'flagged' | 'overdue' | 'outstanding' | 'clear';
type RiskFilter = 'all' | 'atrisk' | 'flagged' | 'overdue' | 'clear';
type SortBy = 'status' | 'risk' | 'receivable';
/** Partner-mode lens: whose queue am I looking at. */
type QueueFilter = 'all' | 'mine' | 'awaiting-approval' | 'cleared';
type BulkAction = 'submit' | 'approve' | 'clear' | null;

/**
 * Verb for the bulk button and its result banner. In partner mode a selection
 * can mix approvals and clearances, so fall back to a neutral label when it does.
 */
function bulkVerb(mode: 'finance' | 'partner', actions: Set<BulkAction>): { present: string; past: string } {
  if (mode === 'finance') return { present: 'Submit', past: 'Submitted' };
  if (actions.size === 1) {
    return actions.has('approve')
      ? { present: 'Approve', past: 'Approved' }
      : { present: 'Clear', past: 'Cleared' };
  }
  return { present: 'Sign off', past: 'Signed off' };
}

const QUEUE_FILTER_OPTIONS: { id: QueueFilter; label: string }[] = [
  { id: 'mine', label: 'Awaiting my clearance' },
  { id: 'all', label: 'All submitted bundles' },
  { id: 'awaiting-approval', label: 'Pending managing-partner approval' },
  { id: 'cleared', label: 'Cleared' },
];

/** Combined payment-risk level: manual flag first, then live overdue / balance signals. */
// Sub-peso threshold: amounts round to whole pesos in the UI, so anything under
// ₱1 (real residue or float noise from the running-balance sum) isn't a signal.
function riskLevelOf(c: ClientSummary): RiskLevel {
  if (c.collectionRisk) return 'flagged';
  if (c.overdueAmount >= 1) return 'overdue';
  if (c.outstandingBalance >= 1) return 'outstanding';
  return 'clear';
}

const RISK_FILTER_OPTIONS: { id: RiskFilter; label: string }[] = [
  { id: 'all', label: 'All clients' },
  { id: 'atrisk', label: 'At risk (flagged or overdue)' },
  { id: 'flagged', label: 'Flagged — unlikely to pay' },
  { id: 'overdue', label: 'Overdue balance' },
  { id: 'clear', label: 'No payment issues' },
];

const SORT_OPTIONS: { id: SortBy; label: string }[] = [
  { id: 'status', label: 'Review status' },
  { id: 'risk', label: 'Payment risk' },
  { id: 'receivable', label: 'Total receivable' },
];

function fmtPHP(amount: number): string {
  return `₱${amount.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
}

function currentMonthInPH(): string {
  return manilaMonth();
}

/**
 * A bundle's place in the two-signature chain: finance submits → managing
 * partner approves → relationship partner clears → invoice generates.
 */
function statusBadge(
  status: ClientSummary['reviewStatus'],
  clearance: ClientSummary['clearanceStatus'] = null,
) {
  if (status === 'approved')
    return clearance === 'cleared'
      ? { label: 'Cleared', icon: ShieldCheck, classes: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30' }
      : { label: 'Awaiting clearance', icon: ShieldQuestion, classes: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 ring-blue-500/30' };
  if (status === 'pending')
    return { label: 'Pending review', icon: Clock, classes: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30' };
  if (status === 'rejected')
    return clearance === 'declined'
      ? { label: 'Clearance declined', icon: XCircle, classes: 'bg-red-500/15 text-red-700 dark:text-red-300 ring-red-500/30' }
      : { label: 'Changes requested', icon: XCircle, classes: 'bg-red-500/15 text-red-700 dark:text-red-300 ring-red-500/30' };
  return { label: 'Not submitted', icon: FileEdit, classes: 'bg-[var(--subtle-bg)] text-[var(--text-muted)] ring-[var(--border-color)]' };
}

/** Chip describing a client's payment risk, or null when there's nothing to flag. */
function riskChip(c: ClientSummary): { label: string; classes: string } | null {
  const level = riskLevelOf(c);
  if (level === 'flagged')
    return { label: 'Unlikely to pay', classes: 'bg-red-500/15 text-red-700 dark:text-red-300 ring-red-500/30' };
  if (level === 'overdue')
    return { label: `Overdue ${fmtPHP(c.overdueAmount)}`, classes: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 ring-orange-500/30' };
  if (level === 'outstanding')
    return { label: `Owes ${fmtPHP(c.outstandingBalance)}`, classes: 'bg-amber-500/10 text-amber-700 dark:text-amber-300/90 ring-amber-500/20' };
  return null;
}

interface Props {
  currentUserId: string;
  /** 'finance' = inline edit + submit; 'partner' = read-only diff + approve/reject (managing partner only). */
  mode?: 'finance' | 'partner';
  /** Set when mode='partner'. Required for the approve/reject buttons to render. */
  isManagingPartner?: boolean;
}

export default function DTRReviewDashboard({ currentUserId, mode = 'finance', isManagingPartner = false }: Props) {
  const [month, setMonth] = useState<string>(() => currentMonthInPH());
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  // Payment-risk filter + sort ("unlikely to pay" lens).
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('status');
  const [riskOpen, setRiskOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const riskAnchor = useRef<HTMLDivElement>(null);
  const sortAnchor = useRef<HTMLDivElement>(null);
  // Partner mode opens on the viewer's own clearance queue — that's what a
  // relationship partner comes here for. The managing partner opens on the full
  // list instead: approving is their job, and approving a client they're also
  // the relationship partner for clears it in the same action, so their own
  // queue stays empty. Falls back to the full list when nothing is waiting.
  const [queueFilter, setQueueFilter] = useState<QueueFilter>(isManagingPartner ? 'all' : 'mine');
  const [queueOpen, setQueueOpen] = useState(false);
  const queueAnchor = useRef<HTMLDivElement>(null);
  // Whether the "empty queue → show all" fallback has already run for this month.
  const queueDefaultResolved = useRef(false);
  // Bulk selection (separate from `selected`, which drives the detail view).
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // `pastLabel`/`didClear` are captured when the run starts, not derived from
  // `checked` — runBulk empties the selection before this renders.
  const [bulkResult, setBulkResult] = useState<
    { ok: string[]; fail: { client: string; error: string }[]; pastLabel: string; didClear: boolean } | null
  >(null);
  // Month-level finance bulk actions (separate from the per-bundle checkbox set).
  const [monthAction, setMonthAction] = useState<'gen' | 'dl' | null>(null);
  const [monthActionNote, setMonthActionNote] = useState<string>('');

  const fetchClients = useCallback(async (m: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/finance/dtr-review/clients?month=${m}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load clients');
      setClients(data.clients ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelected(null);
    setChecked(new Set());
    setBulkResult(null);
    setQueueFilter(isManagingPartner ? 'all' : 'mine');
    queueDefaultResolved.current = false;
    fetchClients(month);
  }, [month, fetchClients, isManagingPartner]);

  // In partner mode, only show bundles that have been *formally submitted*
  // (status != null AND submittedAt != null). Override-only stub rows have
  // status='pending' with submittedAt=NULL — those don't belong in the
  // partner queue until finance actually submits them.
  const submittedClients = useMemo(
    () => (mode === 'partner' ? clients.filter((c) => c.reviewStatus !== null && !!c.submittedAt) : clients),
    [mode, clients],
  );
  /** Bundles this viewer personally has to clear. */
  const isMineToClear = useCallback(
    (c: ClientSummary) =>
      c.reviewStatus === 'approved' &&
      c.clearanceStatus !== 'cleared' &&
      c.relationshipPartnerId === currentUserId,
    [currentUserId],
  );
  const myQueueCount = useMemo(
    () => submittedClients.filter(isMineToClear).length,
    [submittedClients, isMineToClear],
  );

  // Nothing waiting on this partner when the month first loads → show everything
  // rather than an empty list. This runs ONCE per month: after that the filter is
  // the user's to set, so picking "Awaiting my clearance" while it's empty stays
  // picked, and clearing your last bundle doesn't yank the list out from under you.
  useEffect(() => {
    if (mode !== 'partner' || loading || queueDefaultResolved.current) return;
    queueDefaultResolved.current = true;
    if (queueFilter === 'mine' && myQueueCount === 0) setQueueFilter('all');
  }, [mode, loading, queueFilter, myQueueCount]);

  const visibleClients = useMemo(() => {
    if (mode !== 'partner' || queueFilter === 'all') return submittedClients;
    if (queueFilter === 'mine') return submittedClients.filter(isMineToClear);
    if (queueFilter === 'awaiting-approval') return submittedClients.filter((c) => c.reviewStatus === 'pending');
    return submittedClients.filter((c) => c.clearanceStatus === 'cleared');
  }, [mode, queueFilter, submittedClients, isMineToClear]);
  // Sort + filter. Default sort is by review status (pending → rejected →
  // approved → not-submitted); the "Payment risk" sort surfaces clients least
  // likely to pay first (flagged → overdue → owes → clear, then by amount).
  const sorted = useMemo(() => {
    const arr = [...visibleClients].sort((a, b) => {
      if (sortBy === 'receivable') {
        // Biggest owed first, but likely-to-pay clients ahead of at-risk ones
        // (flagged / overdue) so the largest *collectable* billings surface at
        // the top — then within each group, largest balance first.
        const atRisk = (c: ClientSummary) => {
          const level = riskLevelOf(c);
          return level === 'flagged' || level === 'overdue' ? 1 : 0;
        };
        const ar = atRisk(a);
        const br = atRisk(b);
        if (ar !== br) return ar - br;
        if (b.outstandingBalance !== a.outstandingBalance) return b.outstandingBalance - a.outstandingBalance;
        return a.clientName.localeCompare(b.clientName);
      }
      if (sortBy === 'risk') {
        const rank: Record<RiskLevel, number> = { flagged: 0, overdue: 1, outstanding: 2, clear: 3 };
        const ra = rank[riskLevelOf(a)];
        const rb = rank[riskLevelOf(b)];
        if (ra !== rb) return ra - rb;
        const amtA = a.overdueAmount || a.outstandingBalance;
        const amtB = b.overdueAmount || b.outstandingBalance;
        if (amtB !== amtA) return amtB - amtA;
        return a.clientName.localeCompare(b.clientName);
      }
      // Anything still waiting on a human first, finished bundles last.
      const chainRank = (c: ClientSummary) => {
        if (!c.reviewStatus) return 4;
        if (c.reviewStatus === 'pending') return 0;
        if (c.reviewStatus === 'rejected') return 1;
        return c.clearanceStatus === 'cleared' ? 3 : 2;
      };
      const aOrd = chainRank(a);
      const bOrd = chainRank(b);
      if (aOrd !== bOrd) return aOrd - bOrd;
      return a.clientName.localeCompare(b.clientName);
    });
    const matchesRisk = (c: ClientSummary) => {
      if (riskFilter === 'all') return true;
      const level = riskLevelOf(c);
      if (riskFilter === 'atrisk') return level === 'flagged' || level === 'overdue';
      return level === riskFilter;
    };
    const filtered = riskFilter === 'all' ? arr : arr.filter(matchesRisk);
    const q = search.trim().toLowerCase();
    return q ? filtered.filter((c) => c.clientName.toLowerCase().includes(q)) : filtered;
  }, [visibleClients, search, riskFilter, sortBy]);
  const atRiskCount = useMemo(
    () => visibleClients.filter((c) => {
      const level = riskLevelOf(c);
      return level === 'flagged' || level === 'overdue';
    }).length,
    [visibleClients],
  );
  const totalPotentialBillings = sorted.reduce((sum, c) => sum + (c.totalLegalFees || 0), 0);

  // ── Bulk submit (finance) / bulk approve (MP) / bulk clear (relationship partner) ──
  // In partner mode a row's bulk action depends on where it sits in the chain:
  // the MP approves what's pending, and the client's relationship partner clears
  // what's already approved. A partner who is both sees both on their own clients.
  const bulkActionFor = useCallback(
    (c: ClientSummary): 'submit' | 'approve' | 'clear' | null => {
      if (mode === 'finance') return c.reviewStatus !== 'approved' ? 'submit' : null;
      if (!c.submittedAt) return null;
      if (c.reviewStatus === 'pending') return isManagingPartner ? 'approve' : null;
      if (c.reviewStatus === 'approved' && c.clearanceStatus !== 'cleared') {
        return c.relationshipPartnerId === currentUserId ? 'clear' : null;
      }
      return null;
    },
    [mode, isManagingPartner, currentUserId],
  );
  const isEligible = useCallback((c: ClientSummary) => bulkActionFor(c) !== null, [bulkActionFor]);
  const canBulk = mode === 'finance' || mode === 'partner';
  const eligibleClients = useMemo(() => sorted.filter(isEligible), [sorted, isEligible]);
  const checkedCount = useMemo(
    () => eligibleClients.filter((c) => checked.has(c.clientName)).length,
    [eligibleClients, checked],
  );
  const allEligibleChecked = eligibleClients.length > 0 && checkedCount === eligibleClients.length;

  const toggleCheck = (name: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const toggleCheckAll = () =>
    setChecked(allEligibleChecked ? new Set() : new Set(eligibleClients.map((c) => c.clientName)));

  const runBulk = useCallback(async () => {
    const targets = eligibleClients.filter((c) => checked.has(c.clientName));
    if (targets.length === 0) return;
    // Resolve the verb now, from what's actually being run.
    const verb = bulkVerb(mode, new Set(targets.map(bulkActionFor)));
    setBulkBusy(true);
    setBulkResult(null);
    const ok: string[] = [];
    const fail: { client: string; error: string }[] = [];
    const queue = [...targets];
    // Bounded concurrency — clearances each kick off a background invoice
    // generation, so don't fan out unbounded.
    async function worker() {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const action = bulkActionFor(c);
        if (!action) continue;
        const [endpoint, payload] =
          action === 'submit'
            ? ['/api/finance/dtr-review/submit', { billingMonth: month, clientName: c.clientName }]
            : action === 'approve'
              ? ['/api/finance/dtr-review/decision', { billingMonth: month, clientName: c.clientName, decision: 'approve' }]
              : ['/api/finance/dtr-review/clearance', { billingMonth: month, clientName: c.clientName, decision: 'clear' }];
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
          ok.push(c.clientName);
        } catch (e) {
          fail.push({ client: c.clientName, error: e instanceof Error ? e.message : 'Failed' });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, () => worker()));
    setChecked(new Set());
    setBulkResult({ ok, fail, pastLabel: verb.past, didClear: verb.present === 'Clear' });
    setBulkBusy(false);
    fetchClients(month);
  }, [eligibleClients, checked, bulkActionFor, mode, month, fetchClients]);

  // Verb for the button itself, which only renders while a selection exists.
  const bulkLabel = useMemo(
    () => bulkVerb(mode, new Set(eligibleClients.filter((c) => checked.has(c.clientName)).map(bulkActionFor))).present,
    [mode, eligibleClients, checked, bulkActionFor],
  );

  // ── Month-level finance actions: generate all cleared bundles, and download
  // all generated invoice documents (letters + breakdown PDFs) for the month.
  // Only fully cleared bundles are generatable — approval alone isn't enough —
  // and never one whose invoice has gone out (the route skips those too).
  const clearedClients = useMemo(
    () => clients.filter((c) => c.reviewStatus === 'approved' && c.clearanceStatus === 'cleared' && !!c.submittedAt && !c.billedThisMonth),
    [clients],
  );

  const generateApproved = useCallback(async () => {
    if (clearedClients.length === 0) return;
    setMonthAction('gen');
    setMonthActionNote('');
    try {
      const res = await fetch('/api/finance/batch-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clients: clearedClients.map((c) => ({ clientName: c.clientName })), month }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      const gen = data.generated?.length ?? 0;
      const skip = data.skipped?.length ?? 0;
      const fail = data.failed?.length ?? 0;
      setMonthActionNote(`Generated ${gen}${skip ? `, skipped ${skip}` : ''}${fail ? `, failed ${fail}` : ''}.`);
      fetchClients(month);
    } catch (err) {
      setMonthActionNote(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setMonthAction(null);
    }
  }, [clearedClients, month, fetchClients]);

  const downloadInvoices = useCallback(async () => {
    setMonthAction('dl');
    setMonthActionNote('');
    try {
      const res = await fetch('/api/finance/invoices/bulk-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Download failed');
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
      const filename = match ? decodeURIComponent(match[1].replace(/"/g, '')) : `Invoices ${month}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setMonthActionNote(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setMonthAction(null);
    }
  }, [month]);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground font-serif mb-2">
        Billing Review
      </h1>
      <p className="text-sm text-[var(--text-secondary)] mb-6">
        {mode === 'partner'
          ? 'Preview each client’s upcoming invoice — DTRs, acceptance fees, retainer, actions, milestones, and expenses. The managing partner approves the bundle; the client’s relationship partner then clears it, which generates the draft invoice. When the same partner does both, approving clears it in one step.'
          : 'Curate each client’s bundle into the exact invoice that will be sent: edit DTRs, log actions and milestones, log expenses. Submit for managing-partner sign-off; once the relationship partner clears it, the invoice is generated automatically as a draft.'}
      </p>

      {mode === 'partner' && <OffCycleRequests mode="partner" />}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── Left: month + client picker ── */}
        <div className="lg:col-span-4 xl:col-span-3 space-y-4">
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-4 shadow-[var(--shadow-card)]">
            <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
              Billing month
            </label>
            <MonthSelect value={month} onChange={setMonth} />
          </div>

          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                {mode === 'partner' ? (queueFilter === 'mine' ? 'Yours to clear' : 'Submitted bundles') : 'Clients'}
              </h2>
              <span className="text-xs text-[var(--text-muted)]">{sorted.length}</span>
            </div>

            {/* Search */}
            <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--subtle-bg)]/50">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search clients..."
                  className="w-full pl-8 pr-7 py-1.5 text-xs rounded-md bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400/20 placeholder:text-[var(--text-muted)]"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--text-muted)] hover:text-foreground"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Queue lens (partner mode) — a relationship partner's own clearance
                list is the default landing view. */}
            {mode === 'partner' && (
              <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--subtle-bg)]/50">
                <div ref={queueAnchor} className="relative">
                  <button
                    type="button"
                    onClick={() => setQueueOpen((o) => !o)}
                    className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-xs transition-colors cursor-pointer ${
                      queueFilter === 'mine'
                        ? 'border-gold-400/50 bg-gold-500/10 text-gold-700 dark:text-gold-300'
                        : 'border-[var(--border-color)] bg-[var(--background)] text-[var(--text-secondary)] hover:border-gold-300 dark:hover:border-gold-500/40'
                    }`}
                  >
                    <ShieldQuestion className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate flex-1 text-left">
                      {QUEUE_FILTER_OPTIONS.find((o) => o.id === queueFilter)?.label ?? 'All submitted bundles'}
                    </span>
                    {queueFilter !== 'mine' && myQueueCount > 0 && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-gold-500/15 text-gold-700 dark:text-gold-300">
                        {myQueueCount}
                      </span>
                    )}
                    <ChevronDown className="w-3 h-3 shrink-0 text-[var(--text-muted)]" />
                  </button>
                  {queueOpen && (
                    <CellDropdown
                      mode="single"
                      options={QUEUE_FILTER_OPTIONS.map((o) => ({
                        id: o.id,
                        label: o.id === 'mine' ? `${o.label} (${myQueueCount})` : o.label,
                      }))}
                      value={queueFilter}
                      anchorRef={queueAnchor}
                      placeholder="Show…"
                      onSelect={(id) => setQueueFilter((id as QueueFilter) ?? 'all')}
                      onClose={() => setQueueOpen(false)}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Payment-risk filter + sort ("unlikely to pay" lens) */}
            <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--subtle-bg)]/50 flex items-center gap-2">
              <div ref={riskAnchor} className="relative flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => setRiskOpen((o) => !o)}
                  className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-xs transition-colors cursor-pointer ${
                    riskFilter === 'all'
                      ? 'border-[var(--border-color)] bg-[var(--background)] text-[var(--text-secondary)] hover:border-gold-300 dark:hover:border-gold-500/40'
                      : 'border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate flex-1 text-left">
                    {RISK_FILTER_OPTIONS.find((o) => o.id === riskFilter)?.label ?? 'All clients'}
                  </span>
                  {riskFilter === 'all' && atRiskCount > 0 && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/15 text-orange-700 dark:text-orange-300">
                      {atRiskCount}
                    </span>
                  )}
                  <ChevronDown className="w-3 h-3 shrink-0 text-[var(--text-muted)]" />
                </button>
                {riskOpen && (
                  <CellDropdown
                    mode="single"
                    options={RISK_FILTER_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
                    value={riskFilter}
                    anchorRef={riskAnchor}
                    placeholder="Filter by payment risk…"
                    onSelect={(id) => setRiskFilter((id as RiskFilter) ?? 'all')}
                    onClose={() => setRiskOpen(false)}
                  />
                )}
              </div>
              <div ref={sortAnchor} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setSortOpen((o) => !o)}
                  title={`Sort by ${SORT_OPTIONS.find((o) => o.id === sortBy)?.label.toLowerCase() ?? 'review status'}`}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-xs transition-colors cursor-pointer ${
                    sortBy !== 'status'
                      ? 'border-gold-400/50 bg-gold-500/10 text-gold-700 dark:text-gold-300'
                      : 'border-[var(--border-color)] bg-[var(--background)] text-[var(--text-secondary)] hover:border-gold-300 dark:hover:border-gold-500/40'
                  }`}
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{SORT_OPTIONS.find((o) => o.id === sortBy)?.label}</span>
                </button>
                {sortOpen && (
                  <CellDropdown
                    mode="single"
                    options={SORT_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
                    value={sortBy}
                    anchorRef={sortAnchor}
                    placeholder="Sort by…"
                    onSelect={(id) => setSortBy((id as SortBy) ?? 'status')}
                    onClose={() => setSortOpen(false)}
                  />
                )}
              </div>
            </div>

            {/* Bulk action bar — bulk submit (finance) / bulk approve (MP) */}
            {canBulk && eligibleClients.length > 0 && (
              <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--subtle-bg)]/30 flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allEligibleChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = checkedCount > 0 && !allEligibleChecked;
                    }}
                    onChange={toggleCheckAll}
                    className="w-4 h-4 rounded border-[var(--border-color)] accent-gold-500 cursor-pointer"
                  />
                  {checkedCount > 0 ? `${checkedCount} selected` : `Select all (${eligibleClients.length})`}
                </label>
                {checkedCount > 0 && (
                  <button
                    type="button"
                    onClick={runBulk}
                    disabled={bulkBusy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-colors"
                  >
                    {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : mode === 'finance' ? <Send className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    {bulkLabel} {checkedCount}
                  </button>
                )}
              </div>
            )}

            {/* Month-level finance bulk actions */}
            {mode === 'finance' && (
              <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--subtle-bg)]/30 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={generateApproved}
                  disabled={monthAction !== null || clearedClients.length === 0}
                  title={clearedClients.length === 0 ? 'No cleared bundles left to generate' : 'Generate drafts for cleared bundles whose invoice hasn’t been sent'}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border border-[var(--border-color)] text-foreground bg-[var(--background)] hover:bg-[var(--subtle-bg)] disabled:opacity-50 transition-colors"
                >
                  {monthAction === 'gen' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5 text-emerald-500" />}
                  Generate cleared{clearedClients.length > 0 ? ` (${clearedClients.length})` : ''}
                </button>
                <button
                  type="button"
                  onClick={downloadInvoices}
                  disabled={monthAction !== null}
                  title="Download all generated invoice documents (letters + breakdown PDFs) for this month"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border border-[var(--border-color)] text-foreground bg-[var(--background)] hover:bg-[var(--subtle-bg)] disabled:opacity-50 transition-colors"
                >
                  {monthAction === 'dl' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5 text-blue-500" />}
                  Download invoices
                </button>
                {monthActionNote && <span className="text-[11px] text-[var(--text-muted)]">{monthActionNote}</span>}
              </div>
            )}

            {bulkResult && (
              <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--subtle-bg)]/30 space-y-1 text-[11px]">
                {bulkResult.ok.length > 0 && (
                  <p className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    {bulkResult.pastLabel} {bulkResult.ok.length} bundle{bulkResult.ok.length === 1 ? '' : 's'}
                    {bulkResult.didClear ? ' — invoices generating' : ''}
                  </p>
                )}
                {bulkResult.fail.length > 0 && (
                  <p className="flex items-start gap-1.5 text-red-600 dark:text-red-400">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{bulkResult.fail.length} failed: {bulkResult.fail.map((f) => f.client).join(', ')}</span>
                  </p>
                )}
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 px-4 py-3 bg-red-50 dark:bg-red-500/10 border-b border-red-100 dark:border-red-500/20">
                <AlertCircle className="w-4 h-4 shrink-0" /> {error}
              </div>
            )}

            <div className="divide-y divide-[var(--border-color)] max-h-[60vh] overflow-y-auto">
              {loading ? (
                <div className="px-4 py-12 flex items-center justify-center text-sm text-[var(--text-muted)] gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                </div>
              ) : sorted.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                  {mode !== 'partner'
                    ? 'No DTR entries this month.'
                    : queueFilter === 'mine'
                      ? 'Nothing waiting on your clearance this month.'
                      : 'Nothing to review for this month.'}
                </div>
              ) : (
                sorted.map((c) => {
                  // Stub rows (override-only, not submitted) should display
                  // as "Not submitted" in the badge — the status field is
                  // 'pending' on disk but they haven't been sent for review.
                  const displayStatus = c.submittedAt ? c.reviewStatus : null;
                  const badge = statusBadge(displayStatus, c.clearanceStatus);
                  const Icon = badge.icon;
                  const awaitingMe =
                    mode === 'partner' &&
                    displayStatus === 'approved' &&
                    c.clearanceStatus !== 'cleared' &&
                    c.relationshipPartnerId === currentUserId;
                  const risk = riskChip(c);
                  const isActive = selected === c.clientName;
                  const eligible = canBulk && isEligible(c);
                  return (
                    <div
                      key={c.clientName}
                      className={`flex items-stretch transition-colors ${
                        isActive ? 'bg-[var(--subtle-bg)]' : 'hover:bg-[var(--subtle-bg)]'
                      }`}
                    >
                      {canBulk && (
                        <div className="flex items-center pl-3">
                          <input
                            type="checkbox"
                            checked={checked.has(c.clientName)}
                            disabled={!eligible}
                            onChange={() => toggleCheck(c.clientName)}
                            aria-label={`Select ${c.clientName}`}
                            className="w-4 h-4 rounded border-[var(--border-color)] accent-gold-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          />
                        </div>
                      )}
                      <button
                        onClick={() => setSelected(c.clientName)}
                        className="flex-1 min-w-0 text-left px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-foreground truncate">{c.clientName}</p>
                          <ChevronRight className={`w-4 h-4 shrink-0 mt-0.5 transition-colors ${isActive ? 'text-foreground' : 'text-[var(--text-muted)]'}`} />
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-md ring-1 ring-inset ${badge.classes}`}>
                            <Icon className="w-3 h-3" />
                            {badge.label}
                          </span>
                          {awaitingMe && (
                            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded-md ring-1 ring-inset bg-gold-500/15 text-gold-700 dark:text-gold-300 ring-gold-500/30">
                              Yours to clear
                            </span>
                          )}
                          <span className="text-[11px] text-[var(--text-muted)]">
                            {c.rawCount} raw{c.revisedCount > 0 ? ` · ${c.revisedCount} revised` : ''}
                          </span>
                          {risk && (
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-md ring-1 ring-inset ${risk.classes}`}>
                              <AlertTriangle className="w-3 h-3" />
                              {risk.label}
                            </span>
                          )}
                        </div>
                        {c.totalLegalFees > 0 && (
                          <p className="mt-1 text-[11px] font-medium text-foreground tabular-nums">
                            {fmtPHP(c.totalLegalFees)}
                          </p>
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {sorted.length > 0 && totalPotentialBillings > 0 && (
              <div className="px-4 py-3 border-t border-[var(--border-color)] bg-[var(--subtle-bg)] flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  {mode === 'partner' ? 'Total potential billings' : 'Total'}
                </span>
                <span className="text-sm font-semibold text-foreground tabular-nums">
                  {fmtPHP(totalPotentialBillings)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: bundle diff view ── */}
        <div className="lg:col-span-8 xl:col-span-9">
          {selected ? (
            <DTRReviewBundle
              key={`${month}|${selected}`}
              billingMonth={month}
              clientName={selected}
              currentUserId={currentUserId}
              mode={mode}
              isManagingPartner={isManagingPartner}
              onMutate={() => fetchClients(month)}
            />
          ) : (
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-12 text-center">
              <FileEdit className="w-10 h-10 mx-auto text-[var(--text-muted)] mb-3" />
              <p className="text-sm text-[var(--text-muted)]">Select a client on the left to review their DTR for this month.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
