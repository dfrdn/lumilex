'use client';

import { createPortal } from 'react-dom';
import { useState, useEffect, useCallback } from 'react';
import {
  TrendingDown, ChevronDown, ChevronRight, Loader2,
  DollarSign, Clock, AlertTriangle, AlertCircle, XCircle,
  Mail, Send, CheckCircle, X, Pencil, Wallet, Plus, ArrowDownRight, Search, Trash2, Banknote, Percent,
} from 'lucide-react';
import RecordPaymentModal from './RecordPaymentModal';
import InvoiceCreditModal from './InvoiceCreditModal';
import ClientBalanceModal from './ClientBalanceModal';
import DepositModal from './DepositModal';
import ApplyDepositModal from './ApplyDepositModal';
import RecordOnAccountModal from './RecordOnAccountModal';
import PartnerCcToggle, { type PartnerCcState } from './PartnerCcToggle';
import EmailTemplateEditor, {
  FOLLOWUP_TEMPLATES,
  type EmailTemplate, type TemplateVars,
} from './EmailTemplateEditor';
import { useBrand } from '@/components/BrandProvider';
import { useEmailTemplates } from '@/hooks/useEmailTemplates';
import { runningBalance, carriedForward as computeCarriedForward, type BalanceInvoice } from '@/lib/finance/client-balance';
import { buildClientStatement } from '@/lib/finance/client-statement';
import { formatManilaDate } from '@/lib/finance/format';

interface AgingInvoice {
  id: number;
  invoice_number: string;
  client_name: string;
  matter_name: string | null;
  billing_month: string;
  total_amount: number;
  total_expenses: number;
  paid_amount: number;
  totalDue: number;
  balance: number;
  daysOutstanding: number;
  bucket: string;
  sent_date: string | null;
  due_date: string | null;
  created_at: string;
}

interface Payment {
  id: number;
  invoice_id: number;
  amount: number;
  payment_date: string;
  payment_method: string;
  reference_number: string;
  notes: string;
  recorded_by: string;
}

interface ClientBalance {
  receivables: number | null;
  receivables_note: string | null;
  receivables_as_of: string | null;
  receivables_updated_at: string | null;
  receivables_updated_by: string | null;
}

interface DepositLedgerEntry {
  id: number;
  type: 'deposit' | 'application' | 'refund' | 'adjustment' | string;
  amount: number;
  transaction_date: string;
  payment_method: string;
  reference_number: string;
  notes: string;
  invoice_id: number | null;
  recorded_by: string;
}

interface Props {
  role?: string;
  /** The firm's own billing mailbox, resolved server-side. Blank omits the note. */
  financeAddress: string;
}

function fmt(n: number) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function stmtDate(d: string) {
  return d ? formatManilaDate(d) : '—';
}

const BUCKET_CONFIG = [
  { key: 'current', label: 'Current', icon: DollarSign, color: 'emerald' },
  { key: '1-30', label: '1-30 Days', icon: Clock, color: 'blue' },
  { key: '31-60', label: '31-60 Days', icon: AlertTriangle, color: 'amber' },
  { key: '61-90', label: '61-90 Days', icon: AlertCircle, color: 'orange' },
  { key: '90+', label: '90+ Days', icon: XCircle, color: 'red' },
] as const;

const COLOR_MAP: Record<string, { bg: string; text: string; ring: string; icon: string; border: string }> = {
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', ring: 'ring-emerald-200/60 dark:ring-emerald-500/20', icon: 'text-emerald-500 dark:text-emerald-400', border: 'border-emerald-200/60 dark:border-emerald-500/30' },
  blue: { bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400', ring: 'ring-blue-200/60 dark:ring-blue-500/20', icon: 'text-blue-500', border: 'border-blue-200/60 dark:border-blue-500/30' },
  amber: { bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', ring: 'ring-amber-200/60 dark:ring-amber-500/20', icon: 'text-amber-500', border: 'border-amber-200/60 dark:border-amber-500/30' },
  orange: { bg: 'bg-orange-50 dark:bg-orange-500/10', text: 'text-orange-700 dark:text-orange-400', ring: 'ring-orange-200/60 dark:ring-orange-500/20', icon: 'text-orange-500', border: 'border-orange-200/60 dark:border-orange-500/30' },
  red: { bg: 'bg-red-50 dark:bg-red-500/10', text: 'text-red-700 dark:text-red-400', ring: 'ring-red-200/60 dark:ring-red-500/20', icon: 'text-red-500 dark:text-red-400', border: 'border-red-200/60 dark:border-red-500/30' },
};

export default function ReceivablesAging({ role, financeAddress }: Props) {
  const { fullName: firmName } = useBrand();
  const canEditBalance = role === 'finance' || role === 'super_user';
  const { defaultTemplate: getDefaultTemplate, presetsForCategory } = useEmailTemplates();
  const [invoices, setInvoices] = useState<AgingInvoice[]>([]);
  const [byClient, setByClient] = useState<Record<string, AgingInvoice[]>>({});
  const [buckets, setBuckets] = useState<Record<string, number>>({});
  const [paymentsByInvoice, setPaymentsByInvoice] = useState<Record<number, Payment[]>>({});
  const [balancesByClient, setBalancesByClient] = useState<Record<string, ClientBalance>>({});
  const [balanceClient, setBalanceClient] = useState<{ name: string; computed: number } | null>(null);
  const [depositBalancesByClient, setDepositBalancesByClient] = useState<Record<string, number>>({});
  const [depositLedgerByClient, setDepositLedgerByClient] = useState<Record<string, DepositLedgerEntry[]>>({});
  const [depositLedgerNetByClient, setDepositLedgerNetByClient] = useState<Record<string, number>>({});
  const [clientSearch, setClientSearch] = useState('');
  const [balanceOnly, setBalanceOnly] = useState(false);
  const [collectionRiskByClient, setCollectionRiskByClient] = useState<Record<string, boolean>>({});
  const [riskFilter, setRiskFilter] = useState<'all' | 'exclude' | 'only'>('all');
  const [activeClientNames, setActiveClientNames] = useState<string[]>([]);
  const [clientStatus, setClientStatus] = useState<Record<string, 'Active' | 'Inactive'>>({});
  const [depositModal, setDepositModal] = useState<{ clientName: string | null; balance: number; editEntry?: DepositLedgerEntry | null } | null>(null);
  const [confirmDeleteDeposit, setConfirmDeleteDeposit] = useState<number | null>(null);
  const [confirmUndoPayment, setConfirmUndoPayment] = useState<number | null>(null);
  const [applyDepositClient, setApplyDepositClient] = useState<string | null>(null);
  const [onAccountClient, setOnAccountClient] = useState<{ name: string; balance: number } | null>(null);
  const [expandedDeposits, setExpandedDeposits] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<{ Active: boolean; Inactive: boolean }>({ Active: true, Inactive: false });
  const [paymentInvoice, setPaymentInvoice] = useState<AgingInvoice | null>(null);
  const [creditInvoice, setCreditInvoice] = useState<AgingInvoice | null>(null);
  const [followUpSent, setFollowUpSent] = useState<Set<number>>(new Set());
  const [followUpError, setFollowUpError] = useState('');
  // Bulk follow-up
  const [selectedInvoices, setSelectedInvoices] = useState<Set<number>>(new Set());
  const [bulkTemplate, setBulkTemplate] = useState<'reminder' | 'overdue' | 'final'>('reminder');
  const [sendingBulk, setSendingBulk] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ sent: number; failed: string[]; warnings?: string[] } | null>(null);
  // Follow-up modal
  const [followUpModal, setFollowUpModal] = useState<{
    invoiceIds: number[];
    templateKey: 'reminder' | 'overdue' | 'final';
  } | null>(null);
  const [followUpTemplate, setFollowUpTemplate] = useState<EmailTemplate>(FOLLOWUP_TEMPLATES.reminder);
  const [followUpCc, setFollowUpCc] = useState<PartnerCcState>({
    ccRelationshipPartner: false,
    ccManagingPartner: false,
  });

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/finance/receivables');
      const json = await res.json();
      setInvoices(json.invoices ?? []);
      setByClient(json.byClient ?? {});
      setBuckets(json.buckets ?? {});
      setPaymentsByInvoice(json.paymentsByInvoice ?? {});
      setBalancesByClient(json.balancesByClient ?? {});
      setDepositBalancesByClient(json.depositBalancesByClient ?? {});
      setDepositLedgerByClient(json.depositLedgerByClient ?? {});
      setDepositLedgerNetByClient(json.depositLedgerNetByClient ?? {});
      setActiveClientNames(json.activeClientNames ?? []);
      setClientStatus(json.clientStatus ?? {});
      setCollectionRiskByClient(json.collectionRiskByClient ?? {});
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const deleteDeposit = useCallback(async (id: number) => {
    setConfirmDeleteDeposit(null);
    const res = await fetch(`/api/finance/clients/deposits?id=${id}`, { method: 'DELETE' });
    if (res.ok) await fetchData();
  }, [fetchData]);

  // On-account payments are reversed as a whole receipt (the opening 'payment'
  // row plus any invoice allocations sharing its OA- reference).
  const deleteOnAccount = useCallback(async (ref: string) => {
    setConfirmDeleteDeposit(null);
    const res = await fetch(`/api/finance/clients/payments?ref=${encodeURIComponent(ref)}`, { method: 'DELETE' });
    if (res.ok) await fetchData();
  }, [fetchData]);

  // Undo a single invoice payment. Routes by nature: a whole on-account receipt
  // (OA- ref) reverses via the payments endpoint; a post-send credit via the
  // invoices reverse_credit action; a direct payment or a deposit application via
  // the payments endpoint (which also reverses the paired deposit-ledger row).
  const undoPayment = useCallback(async (p: Payment, invoiceId: number) => {
    setConfirmUndoPayment(null);
    let res: Response;
    if (typeof p.reference_number === 'string' && p.reference_number.startsWith('OA-')) {
      res = await fetch(`/api/finance/clients/payments?ref=${encodeURIComponent(p.reference_number)}`, { method: 'DELETE' });
    } else if (p.payment_method === 'credit') {
      res = await fetch('/api/finance/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reverse_credit', invoiceId, creditId: p.id }),
      });
    } else {
      res = await fetch(`/api/finance/invoices/payments?id=${p.id}`, { method: 'DELETE' });
    }
    if (res.ok) await fetchData();
  }, [fetchData]);


  const toggleCollectionRisk = useCallback(async (client: string, next: boolean) => {
    setCollectionRiskByClient((prev) => ({ ...prev, [client]: next }));
    const res = await fetch('/api/finance/clients/collection-risk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientName: client, collectionRisk: next }),
    });
    // Refetch so the collectible/doubtful totals and aging reflect the change.
    if (res.ok) await fetchData();
    else setCollectionRiskByClient((prev) => ({ ...prev, [client]: !next }));
  }, [fetchData]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleClient = (client: string) => {
    setExpandedClients((prev) => {
      const next = new Set(prev);
      if (next.has(client)) next.delete(client);
      else next.add(client);
      return next;
    });
  };

  function getAutoTemplate(days: number): 'reminder' | 'overdue' | 'final' {
    if (days > 60) return 'final';
    if (days > 30) return 'overdue';
    return 'reminder';
  }

  function openFollowUpModal(invoiceIds: number[], templateKey: 'reminder' | 'overdue' | 'final') {
    setFollowUpTemplate(getDefaultTemplate(templateKey));
    setFollowUpCc({ ccRelationshipPartner: false, ccManagingPartner: false });
    setFollowUpModal({ invoiceIds, templateKey });
  }

  // Build sample vars for template preview
  function buildSampleVars(invIds: number[]): TemplateVars {
    const inv = invoices.find((i) => invIds.includes(i.id));
    if (!inv) return { firmName };
    const [year, mon] = inv.billing_month.split('-');
    const monthDisplay = new Date(parseInt(year), parseInt(mon) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return {
      clientName: inv.client_name,
      month: monthDisplay,
      amount: fmt(inv.balance),
      invoiceNumber: inv.invoice_number,
      dueDate: inv.due_date ?? '',
      daysOverdue: String(inv.daysOutstanding),
      firmName,
    };
  }

  async function sendFollowUpFromModal() {
    if (!followUpModal) return;
    setSendingBulk(true);
    setBulkResult(null);
    setFollowUpError('');
    try {
      const res = await fetch('/api/finance/send-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceIds: followUpModal.invoiceIds,
          template: followUpModal.templateKey,
          customSubject: followUpTemplate.subject,
          customBody: followUpTemplate.body,
          ...followUpCc,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send');
      setBulkResult({ sent: data.sent, failed: data.failed ?? [], warnings: data.warnings ?? [] });
      setFollowUpSent((prev) => new Set([...prev, ...followUpModal.invoiceIds]));
      setSelectedInvoices(new Set());
      setFollowUpModal(null);
    } catch (err) {
      setFollowUpError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSendingBulk(false);
    }
  }

  function toggleInvoiceSelect(id: number) {
    setSelectedInvoices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  const clientNames = new Set<string>([
    ...Object.keys(byClient),
    ...Object.keys(balancesByClient),
    ...Object.keys(depositBalancesByClient),
    // Include every surfaced client (Active + Inactive, plus any with a
    // tracked balance) so finance sees the full roster grouped by status,
    // even when a client has no open invoices or deposits.
    ...Object.keys(clientStatus),
    ...activeClientNames,
  ]);
  const allClientRows = Array.from(clientNames)
    .map((client) => {
      const invs = byClient[client] ?? [];
      const computedBalance = invs.reduce((s, i) => s + i.balance, 0);
      const balance = balancesByClient[client] ?? null;
      const overrideBalance = balance?.receivables ?? null;
      // Running balance = opening figure + invoices that carry forward on top of
      // it (mirrors the invoice letter's "previous balance + current = total
      // due"). Shared with invoice generation via lib/finance/client-balance so
      // the A/R page and the "Previous Balance" on the letter can't diverge.
      const balanceInputs = {
        receivables: overrideBalance,
        receivablesAsOf: balance?.receivables_as_of ?? null,
        invoices: invs.map((i): BalanceInvoice => ({
          billingMonth: i.billing_month ?? '',
          balance: i.balance,
          sentDate: i.sent_date,
          createdDate: i.created_at?.split('T')[0] ?? null,
        })),
      };
      const carriedForward = computeCarriedForward(balanceInputs);
      // Amount due: + = client owes. Deposits no longer pull this negative —
      // deposit on hand is its own bucket (clients.deposit_balance).
      const displayBalance = runningBalance(balanceInputs);
      const depositAmount = depositBalancesByClient[client] ?? 0;
      const hasDeposit = depositAmount > 0.005;
      const hasActivity = invs.length > 0 || overrideBalance !== null || hasDeposit || Math.abs(displayBalance) > 0.01;
      // Any surfaced client without an explicit Active flag (incl. a
      // balance-carrying Prospective, or an unmatched invoice name) sits in
      // the Inactive bucket.
      const status: 'Active' | 'Inactive' = clientStatus[client] === 'Active' ? 'Active' : 'Inactive';
      const collectionRisk = collectionRiskByClient[client] ?? false;
      return {
        client,
        status,
        invoices: invs,
        computedBalance,
        overrideBalance,
        carriedForward,
        displayBalance,
        balanceMeta: balance,
        hasDeposit,
        depositAmount,
        hasActivity,
        collectionRisk,
      };
    });
  // Within a status group: clients with money activity first (largest balance
  // owed at top), then idle clients alphabetically.
  const sortGroup = (rows: typeof allClientRows) =>
    [...rows].sort((a, b) => {
      if (a.hasActivity !== b.hasActivity) return a.hasActivity ? -1 : 1;
      if (a.hasActivity) return b.displayBalance - a.displayBalance;
      return a.client.localeCompare(b.client);
    });
  const activeRows = sortGroup(allClientRows.filter((r) => r.status === 'Active'));
  const inactiveRows = sortGroup(allClientRows.filter((r) => r.status === 'Inactive'));

  // Search + filter for the client breakdown.
  const clientQuery = clientSearch.trim().toLowerCase();
  const filterActive = !!clientQuery || balanceOnly || riskFilter !== 'all';
  const applyClientFilter = (rows: typeof allClientRows) =>
    rows.filter((r) =>
      (!clientQuery || r.client.toLowerCase().includes(clientQuery)) &&
      (!balanceOnly || Math.abs(r.displayBalance) > 0.01 || r.depositAmount > 0.01) &&
      (riskFilter === 'all' || (riskFilter === 'only' ? r.collectionRisk : !r.collectionRisk)),
    );
  const activeRowsShown = applyClientFilter(activeRows);
  const inactiveRowsShown = applyClientFilter(inactiveRows);
  // Summary cards reflect the CURRENTLY VISIBLE clients (after search / balance /
  // risk filters), so the totals + aging adjust as you filter. Doubtful
  // ("unlikely to pay") balances stay split out into their own card.
  const visibleRows = [...activeRowsShown, ...inactiveRowsShown].filter((r) => r.hasActivity);
  const collectibleRows = visibleRows.filter((r) => !r.collectionRisk);
  const totalClientBalance = collectibleRows.reduce(
    (s, r) => s + Math.max(0, r.displayBalance), 0,
  );
  const owingClientCount = collectibleRows.filter((r) => r.displayBalance > 0).length;
  const doubtfulRows = visibleRows.filter((r) => r.collectionRisk && r.displayBalance > 0.01);
  const doubtfulTotal = doubtfulRows.reduce((s, r) => s + r.displayBalance, 0);
  const doubtfulClientCount = doubtfulRows.length;
  const totalDepositBalance = visibleRows.reduce(
    (s, r) => s + r.depositAmount, 0,
  );
  const depositClientCount = visibleRows.filter((r) => r.hasDeposit).length;
  // Aging buckets over the visible collectible clients' invoices, so the
  // breakdown foots to the (filtered) collectible total.
  const collectibleClientNames = new Set(collectibleRows.map((r) => r.client));
  const visibleBuckets: Record<string, { amount: number; count: number }> = {
    current: { amount: 0, count: 0 }, '1-30': { amount: 0, count: 0 },
    '31-60': { amount: 0, count: 0 }, '61-90': { amount: 0, count: 0 }, '90+': { amount: 0, count: 0 },
  };
  for (const inv of invoices) {
    if (!collectibleClientNames.has(inv.client_name)) continue;
    const b = visibleBuckets[inv.bucket];
    if (b) { b.amount += inv.balance; b.count += 1; }
  }

  function fmtUpdatedAt(iso: string | null | undefined): string {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-PH', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila',
    });
  }

  const renderClientRow = (row: (typeof allClientRows)[number]) => {
    const { client, invoices: clientInvs, computedBalance, overrideBalance, carriedForward, displayBalance, balanceMeta, hasDeposit, depositAmount, collectionRisk } = row;
    const expanded = expandedClients.has(client);
    const hasOverride = overrideBalance !== null;
    const drift = hasOverride && Math.abs(overrideBalance - computedBalance) > 0.01;
    const ledger = depositLedgerByClient[client] ?? [];
    const ledgerExpanded = expandedDeposits.has(client);
    // Built only for the expanded row — no point assembling a statement for every
    // collapsed client on each render.
    const statement = expanded
      ? buildClientStatement({
          currentBalance: displayBalance,
          receivables: overrideBalance,
          receivablesAsOf: balanceMeta?.receivables_as_of ?? null,
          invoices: clientInvs.map((i) => ({
            invoiceNumber: i.invoice_number,
            billingMonth: i.billing_month,
            balance: i.balance,
            sentDate: i.sent_date,
            createdDate: i.created_at?.split('T')[0] ?? null,
          })),
          deposits: ledger.map((e) => ({ type: e.type, amount: e.amount, date: e.transaction_date, notes: e.notes })),
        })
      : null;
    return (
      <div key={client}>
        <div className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] transition-colors">
          <button
            type="button"
            onClick={() => toggleClient(client)}
            className="flex items-center gap-3 flex-1 cursor-pointer text-left"
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
            ) : (
              <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
            )}
            <div>
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                {client}
                {hasDeposit && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                    <Wallet className="w-2.5 h-2.5" />
                    Deposit
                  </span>
                )}
                {collectionRisk && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                    <AlertTriangle className="w-2.5 h-2.5" />
                    Unlikely to pay
                  </span>
                )}
              </p>
              <p className="text-[10px] text-[var(--text-muted)]">
                {clientInvs.length} invoice{clientInvs.length !== 1 ? 's' : ''}
                {hasOverride && balanceMeta?.receivables_as_of && (
                  <span className="ml-2">· as of {balanceMeta.receivables_as_of}</span>
                )}
                {hasOverride && balanceMeta?.receivables_updated_at && (
                  <span className="ml-2" title={balanceMeta.receivables_note ?? ''}>
                    · set by {balanceMeta.receivables_updated_by ?? 'finance'} on {fmtUpdatedAt(balanceMeta.receivables_updated_at)}
                  </span>
                )}
              </p>
            </div>
          </button>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <span
                className="text-sm font-semibold tabular-nums text-foreground"
                title="Amount due from client"
              >
                {fmt(displayBalance)}
              </span>
              {carriedForward !== 0 && overrideBalance !== null && (
                <p className="text-[10px] text-[var(--text-muted)] tabular-nums">
                  {fmt(overrideBalance)} opening + {fmt(carriedForward)} since
                </p>
              )}
              {carriedForward === 0 && drift && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 tabular-nums">
                  computed: {fmt(computedBalance)}
                </p>
              )}
              {hasDeposit && (
                <p
                  className="text-[10px] font-medium text-indigo-500 dark:text-indigo-400 tabular-nums"
                  title="Advance deposit on hand (held in trust, not yet applied)"
                >
                  {fmt(depositAmount)} on hand
                </p>
              )}
            </div>
            {canEditBalance && displayBalance > 0.01 && (
              <button
                type="button"
                onClick={() => setOnAccountClient({ name: client, balance: displayBalance })}
                title="Record a payment toward the running balance"
                className="p-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20 cursor-pointer"
              >
                <Banknote className="w-3 h-3" />
              </button>
            )}
            {canEditBalance && hasDeposit && clientInvs.length > 0 && (
              <button
                type="button"
                onClick={() => setApplyDepositClient(client)}
                title="Apply deposit to an open invoice"
                className="p-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20 cursor-pointer"
              >
                <ArrowDownRight className="w-3 h-3" />
              </button>
            )}
            {canEditBalance && (
              <button
                type="button"
                onClick={() => setDepositModal({ clientName: client, balance: depositAmount })}
                title="Record an advance deposit, refund, or adjustment"
                className="p-1.5 rounded-lg border border-indigo-200/60 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20 cursor-pointer"
              >
                <Wallet className="w-3 h-3" />
              </button>
            )}
            {canEditBalance && (
              <button
                type="button"
                onClick={() => toggleCollectionRisk(client, !collectionRisk)}
                title={collectionRisk ? 'Unflag — client is likely to pay' : 'Flag as unlikely to pay (excludes from collectible total)'}
                className={`p-1.5 rounded-lg border cursor-pointer transition-colors ${
                  collectionRisk
                    ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20'
                    : 'border-[var(--border-color)] text-[var(--text-muted)] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-subtle'
                }`}
              >
                <AlertTriangle className="w-3 h-3" />
              </button>
            )}
            {canEditBalance && (
              <button
                type="button"
                onClick={() => setBalanceClient({ name: client, computed: computedBalance })}
                title={hasOverride ? 'Edit running balance' : 'Set running balance override'}
                className={`p-1.5 rounded-lg border cursor-pointer transition-colors ${
                  hasOverride
                    ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20'
                    : 'border-[var(--border-color)] text-[var(--text-muted)] hover:text-foreground hover:bg-subtle'
                }`}
              >
                <Pencil className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {expanded && (
          <div className="bg-subtle/50 border-t border-[var(--border-color)]">
            {statement && statement.lines.length > 0 && (
              <div className="px-5 py-3 border-b border-[var(--border-color)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Statement</span>
                  <div className="flex items-center gap-3">
                    <a
                      href={`/finance/clients/${encodeURIComponent(client)}/ledger`}
                      className="text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Full ledger ↗
                    </a>
                    <a
                      href={`/finance/clients/${encodeURIComponent(client)}/statement`}
                      className="text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Open statement ↗
                    </a>
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--border-color)] overflow-hidden bg-[var(--card-bg)]">
                  <div className="grid grid-cols-[88px_1fr_120px_120px] gap-2 px-3 py-1.5 bg-subtle text-[9px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    <span>Date</span>
                    <span>Description</span>
                    <span className="text-right">Charge / (Credit)</span>
                    <span className="text-right">Balance</span>
                  </div>
                  {statement.lines.map((line) => (
                    <div key={line.key} className="grid grid-cols-[88px_1fr_120px_120px] gap-2 px-3 py-1.5 text-[11px] border-t border-[var(--border-color)]/60 items-center">
                      <span className="text-[var(--text-muted)] font-mono text-[10px]">{stmtDate(line.date)}</span>
                      <span className="text-[var(--text-secondary)] truncate" title={line.label}>{line.label}</span>
                      <span className={`text-right tabular-nums ${line.credit > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'}`}>
                        {line.charge > 0 ? fmt(line.charge) : line.credit > 0 ? `(${fmt(line.credit)})` : '—'}
                      </span>
                      <span className="text-right tabular-nums font-medium text-foreground">{fmt(line.runningBalance)}</span>
                    </div>
                  ))}
                  <div className="grid grid-cols-[88px_1fr_120px_120px] gap-2 px-3 py-1.5 text-[11px] border-t border-[var(--border-color)] bg-subtle font-semibold">
                    <span></span>
                    <span className="text-[var(--text-secondary)]">Current balance</span>
                    <span></span>
                    <span className="text-right tabular-nums">{fmt(statement.currentBalance)}</span>
                  </div>
                </div>
              </div>
            )}
            {clientInvs.length === 0 && (
              <div className="px-5 py-3 text-[11px] text-[var(--text-muted)]">
                No open invoices for this client.
              </div>
            )}
            {clientInvs.length > 0 && (
            <>
            {/* Table Header */}
            <div className="grid grid-cols-[24px_1fr_90px_90px_90px_60px_160px] gap-2 px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              <span></span>
              <span>Invoice</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Paid</span>
              <span className="text-right">Balance</span>
              <span className="text-right">Days</span>
              <span className="text-right">Actions</span>
            </div>
            {clientInvs.sort((a, b) => b.daysOutstanding - a.daysOutstanding).map((inv) => (
              <div key={inv.id}>
                <div className="grid grid-cols-[24px_1fr_90px_90px_90px_60px_160px] gap-2 px-5 py-2.5 items-center hover:bg-gold-50/30 dark:hover:bg-[rgba(201,168,76,0.04)] transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedInvoices.has(inv.id)}
                    onChange={() => toggleInvoiceSelect(inv.id)}
                    className="rounded border-[var(--border-color)] w-3.5 h-3.5"
                  />
                  <div>
                    <p className="text-xs font-medium text-foreground">{inv.invoice_number}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      {inv.matter_name ?? inv.billing_month}
                    </p>
                  </div>
                  <span className="text-xs text-right tabular-nums text-[var(--text-secondary)]">{fmt(inv.totalDue)}</span>
                  <span className="text-xs text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                    {Number(inv.paid_amount) > 0 ? fmt(Number(inv.paid_amount)) : '—'}
                  </span>
                  <span className="text-xs text-right font-semibold tabular-nums text-foreground">{fmt(inv.balance)}</span>
                  <span className={`text-xs text-right font-mono tabular-nums ${
                    inv.daysOutstanding > 90 ? 'text-red-500 dark:text-red-400' :
                    inv.daysOutstanding > 60 ? 'text-orange-500' :
                    inv.daysOutstanding > 30 ? 'text-amber-500' :
                    'text-[var(--text-muted)]'
                  }`}>
                    {inv.daysOutstanding}d
                  </span>
                  <div className="flex items-center justify-end gap-1.5">
                    {followUpSent.has(inv.id) ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckCircle className="w-2.5 h-2.5" /> Sent
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openFollowUpModal([inv.id], getAutoTemplate(inv.daysOutstanding))}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200/60 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/30 dark:hover:bg-blue-500/20 cursor-pointer transition-colors"
                      >
                        <Mail className="w-2.5 h-2.5" />
                        Remind
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPaymentInvoice(inv)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30 dark:hover:bg-emerald-500/20 cursor-pointer transition-colors"
                    >
                      <DollarSign className="w-2.5 h-2.5" />
                      Record
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreditInvoice(inv)}
                      title="Record a post-send discount / credit"
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-gold-50 text-gold-700 hover:bg-gold-100 border border-gold-200/60 dark:bg-gold-500/10 dark:text-gold-400 dark:border-gold-500/30 dark:hover:bg-gold-500/20 cursor-pointer transition-colors"
                    >
                      <Percent className="w-2.5 h-2.5" />
                      Credit
                    </button>
                  </div>
                </div>

                {/* Payment History */}
                {paymentsByInvoice[inv.id]?.length > 0 && (
                  <div className="px-5 pb-2">
                    <div className="ml-4 pl-3 border-l-2 border-emerald-200 dark:border-emerald-500/30">
                      {paymentsByInvoice[inv.id].map((p) => {
                        const isCredit = p.payment_method === 'credit';
                        return (
                        <div key={p.id} className="flex items-center gap-3 py-1 text-[10px]">
                          <span className={`font-medium tabular-nums ${isCredit ? 'text-gold-600 dark:text-gold-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{fmt(Number(p.amount))}</span>
                          <span className="text-[var(--text-muted)] font-mono">
                            {new Date(p.payment_date + 'T00:00:00Z').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })}
                          </span>
                          <span className="text-[var(--text-muted)]">{isCredit ? 'credit/discount' : p.payment_method === 'deposit' ? 'from deposit' : p.payment_method}</span>
                          {!isCredit && p.reference_number && !/^(APP|OA)-/.test(p.reference_number) && (
                            <span className="text-[var(--text-muted)] font-mono">#{p.reference_number}</span>
                          )}
                          {isCredit && p.notes && (
                            <span className="text-[var(--text-muted)] truncate">— {p.notes}</span>
                          )}
                          {canEditBalance && (
                            <span className="flex items-center gap-1 ml-auto shrink-0">
                              {confirmUndoPayment === p.id ? (
                                <button
                                  type="button"
                                  onClick={() => undoPayment(p, inv.id)}
                                  className="text-[9px] font-semibold text-red-600 dark:text-red-400 px-1 cursor-pointer"
                                >
                                  Undo?
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmUndoPayment(p.id)}
                                  title={p.reference_number?.startsWith('OA-') ? 'Reverse this on-account receipt' : 'Undo this payment'}
                                  className="p-0.5 rounded text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </span>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
            </>
            )}

            {/* Deposit ledger */}
            {(hasDeposit || ledger.length > 0) && (
              <div className="border-t border-[var(--border-color)] bg-indigo-50/30 dark:bg-indigo-500/5">
                <button
                  type="button"
                  onClick={() => setExpandedDeposits((prev) => {
                    const next = new Set(prev);
                    if (next.has(client)) next.delete(client); else next.add(client);
                    return next;
                  })}
                  className="w-full flex items-center justify-between px-5 py-2 text-left cursor-pointer hover:bg-indigo-50/60 dark:hover:bg-indigo-500/10 transition-colors"
                >
                  <span className="flex items-center gap-2 text-[11px] font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">
                    {ledgerExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <Wallet className="w-3 h-3" />
                    Deposit ledger
                    <span className="text-[10px] text-[var(--text-muted)] normal-case">
                      ({ledger.length} entr{ledger.length === 1 ? 'y' : 'ies'})
                    </span>
                  </span>
                  <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-400 tabular-nums">
                    On hand {fmt(depositAmount)}
                  </span>
                </button>
                {ledgerExpanded && (
                  <div className="px-5 pb-3">
                    {ledger.length === 0 ? (
                      <p className="text-[11px] text-[var(--text-muted)] italic py-1">No deposit transactions recorded yet.</p>
                    ) : (
                      <div className="ml-4 pl-3 border-l-2 border-indigo-200 dark:border-indigo-500/30">
                        {ledger.map((entry) => {
                          const sign = entry.amount >= 0 ? '+' : '-';
                          const color = entry.amount >= 0
                            ? 'text-indigo-700 dark:text-indigo-400'
                            : 'text-amber-700 dark:text-amber-400';
                          const typeLabel = entry.type === 'deposit'
                            ? 'Deposit'
                            : entry.type === 'application'
                              ? 'Applied'
                              : entry.type === 'refund'
                                ? 'Refund'
                                : entry.type === 'payment'
                                  ? 'Payment'
                                  : 'Adjustment';
                          return (
                            <div key={entry.id} className="flex items-center gap-3 py-1 text-[10px]">
                              <span className={`font-semibold tabular-nums w-20 ${color}`}>
                                {sign}{fmt(Math.abs(entry.amount))}
                              </span>
                              <span className="text-[var(--text-muted)] font-mono w-20">
                                {new Date(entry.transaction_date + 'T00:00:00Z').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider ${
                                entry.amount >= 0
                                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                              }`}>
                                {typeLabel}
                              </span>
                              {entry.payment_method && (
                                <span className="text-[var(--text-muted)]">{entry.payment_method}</span>
                              )}
                              {entry.reference_number && (
                                <span className="text-[var(--text-muted)] font-mono">#{entry.reference_number}</span>
                              )}
                              {entry.notes && (
                                <span className="text-[var(--text-muted)] truncate flex-1" title={entry.notes}>{entry.notes}</span>
                              )}
                              {canEditBalance && entry.type !== 'application' && (
                                <span className="flex items-center gap-1 ml-auto shrink-0">
                                  {entry.type !== 'payment' && (
                                    <button
                                      type="button"
                                      onClick={() => { setConfirmDeleteDeposit(null); setDepositModal({ clientName: client, balance: depositAmount, editEntry: entry }); }}
                                      title="Edit entry"
                                      className="p-0.5 rounded text-[var(--text-muted)] hover:text-foreground cursor-pointer"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                  )}
                                  {confirmDeleteDeposit === entry.id ? (
                                    <button
                                      type="button"
                                      onClick={() => entry.type === 'payment' ? deleteOnAccount(entry.reference_number) : deleteDeposit(entry.id)}
                                      className="text-[9px] font-semibold text-red-600 dark:text-red-400 px-1 cursor-pointer"
                                    >
                                      {entry.type === 'payment' ? 'Reverse?' : 'Delete?'}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteDeposit(entry.id)}
                                      title={entry.type === 'payment' ? 'Reverse this on-account payment' : 'Delete entry'}
                                      className="p-0.5 rounded text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderGroup = (
    label: string,
    rows: typeof allClientRows,
    groupKey: 'Active' | 'Inactive',
    forceOpen = false,
  ) => {
    const open = forceOpen || openGroups[groupKey];
    const owing = rows.filter((r) => r.displayBalance > 0).length;
    return (
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
        <button
          type="button"
          onClick={() => setOpenGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }))}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)] hover:bg-[var(--subtle-bg)] transition-colors cursor-pointer"
          aria-expanded={open}
        >
          <div className="flex items-center gap-2">
            {open ? (
              <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
            ) : (
              <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
            )}
            <h2 className="text-sm font-semibold text-foreground">{label}</h2>
            <span className="text-xs text-[var(--text-muted)]">({rows.length})</span>
          </div>
          <span className="text-[11px] text-[var(--text-muted)]">
            {owing > 0 ? `${owing} with a balance` : 'No outstanding balances'}
          </span>
        </button>
        {open && (
          rows.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-[var(--text-muted)]">
              No {label.toLowerCase()}
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-color)]">
              {rows.map(renderClientRow)}
            </div>
          )
        )}
      </div>
    );
  };

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
            <TrendingDown className="w-5 h-5 text-red-500 dark:text-red-400" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-foreground">Accounts Receivable</h1>
            <p className="text-sm text-[var(--text-muted)]">Outstanding invoices and client deposits</p>
          </div>
          {canEditBalance && (
            <button
              type="button"
              onClick={() => setDepositModal({ clientName: null, balance: 0 })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-500 text-white hover:bg-indigo-600 cursor-pointer"
              title="Record an advance deposit from a client"
            >
              <Plus className="w-3.5 h-3.5" />
              Record Deposit
            </button>
          )}
        </div>

        {/* Aging Buckets. Literal column classes (Tailwind can't see interpolated ones). */}
        <div className={`grid grid-cols-2 sm:grid-cols-3 ${
          ({ 6: 'lg:grid-cols-6', 7: 'lg:grid-cols-7', 8: 'lg:grid-cols-8' } as Record<number, string>)[
            6 + (totalDepositBalance > 0 ? 1 : 0) + (doubtfulTotal > 0 ? 1 : 0)
          ]
        } gap-3`}>
          {/* Total */}
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">{doubtfulTotal > 0 ? 'Collectible' : 'Total Outstanding'}</p>
            <p className="text-lg font-bold text-foreground tabular-nums">{fmt(totalClientBalance)}</p>
            <p className="text-[10px] text-[var(--text-muted)]">{owingClientCount} client{owingClientCount !== 1 ? 's' : ''}</p>
          </div>
          {doubtfulTotal > 0 && (
            <div className="rounded-xl border border-rose-200/60 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 shadow-[var(--shadow-card)] p-4 ring-1 ring-inset ring-rose-200/60 dark:ring-rose-500/20">
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-400">Doubtful</p>
              </div>
              <p className="text-lg font-bold tabular-nums text-rose-700 dark:text-rose-400">{fmt(doubtfulTotal)}</p>
              <p className="text-[10px] text-rose-700/70 dark:text-rose-400/70">
                {doubtfulClientCount} unlikely to pay
              </p>
            </div>
          )}
          {totalDepositBalance > 0 && (
            <div className="rounded-xl border border-indigo-200/60 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 shadow-[var(--shadow-card)] p-4 ring-1 ring-inset ring-indigo-200/60 dark:ring-indigo-500/20">
              <div className="flex items-center gap-1.5 mb-1">
                <Wallet className="w-3.5 h-3.5 text-indigo-500" />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-400">Deposits on Hand</p>
              </div>
              <p className="text-lg font-bold tabular-nums text-indigo-700 dark:text-indigo-400">{fmt(totalDepositBalance)}</p>
              <p className="text-[10px] text-indigo-700/70 dark:text-indigo-400/70">
                {depositClientCount} client{depositClientCount !== 1 ? 's' : ''}
              </p>
            </div>
          )}
          {BUCKET_CONFIG.map((b) => {
            const c = COLOR_MAP[b.color];
            const amount = visibleBuckets[b.key]?.amount ?? 0;
            const count = visibleBuckets[b.key]?.count ?? 0;
            return (
              <div key={b.key} className={`rounded-xl border ${c.border} shadow-[var(--shadow-card)] p-4 ${c.bg} ring-1 ring-inset ${c.ring}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <b.icon className={`w-3.5 h-3.5 ${c.icon}`} />
                  <p className={`text-[10px] font-semibold uppercase tracking-wider ${c.text}`}>{b.label}</p>
                </div>
                <p className={`text-lg font-bold tabular-nums ${c.text}`}>{fmt(amount)}</p>
                <p className={`text-[10px] ${c.text} opacity-70`}>{count} invoice{count !== 1 ? 's' : ''}</p>
              </div>
            );
          })}
        </div>

        {/* Bulk Follow-Up Bar */}
        {selectedInvoices.size > 0 && (
          <div className="bg-[var(--card-bg)] rounded-xl border border-blue-200 dark:border-blue-500/30 shadow-[var(--shadow-card)] p-4 flex items-center gap-4 flex-wrap">
            <span className="text-sm font-medium text-foreground">
              {selectedInvoices.size} invoice{selectedInvoices.size !== 1 ? 's' : ''} selected
            </span>
            <select
              value={bulkTemplate}
              onChange={(e) => setBulkTemplate(e.target.value as 'reminder' | 'overdue' | 'final')}
              className="px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:border-gold-400"
            >
              <option value="reminder">Gentle Reminder</option>
              <option value="overdue">Overdue Notice</option>
              <option value="final">Final Notice</option>
            </select>
            <button
              onClick={() => openFollowUpModal([...selectedInvoices], bulkTemplate)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-all"
            >
              <Send className="w-3.5 h-3.5" />
              Compose Follow-Up
            </button>
            <button
              onClick={() => setSelectedInvoices(new Set())}
              className="text-xs text-[var(--text-muted)] hover:text-foreground transition-colors"
            >
              Clear
            </button>
          </div>
        )}

        {/* Bulk result feedback */}
        {bulkResult && (
          <div className={`rounded-xl border p-3 text-sm ${bulkResult.sent > 0 ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400'}`}>
            {bulkResult.sent > 0 && <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4" /> {bulkResult.sent} follow-up{bulkResult.sent !== 1 ? 's' : ''} sent</span>}
            {bulkResult.failed.length > 0 && <span>{bulkResult.failed.join(', ')}</span>}
          </div>
        )}

        {bulkResult && (bulkResult.warnings?.length ?? 0) > 0 && (
          <div className="rounded-xl border bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 p-3 text-sm text-amber-700 dark:text-amber-400">
            {bulkResult.warnings!.map((w, i) => (
              <p key={i} className="flex items-start gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {w}
              </p>
            ))}
          </div>
        )}

        {followUpError && (
          <div className="rounded-xl border bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 p-3 text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {followUpError}
          </div>
        )}

        {/* Client Breakdown — grouped by client status */}
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-3 shadow-[var(--shadow-card)] flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <input
              type="text"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              placeholder="Search clients…"
              className="w-full pl-9 pr-8 py-2 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400/20 placeholder:text-[var(--text-muted)]"
            />
            {clientSearch && (
              <button type="button" onClick={() => setClientSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--text-muted)] hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer select-none shrink-0">
            <input type="checkbox" checked={balanceOnly} onChange={(e) => setBalanceOnly(e.target.checked)} className="w-4 h-4 rounded border-[var(--border-color)] accent-gold-500" />
            With a balance only
          </label>
          <div className="flex items-center rounded-lg border border-[var(--border-color)] overflow-hidden shrink-0 text-[11px]" title="Filter by collection risk">
            {([['all', 'All'], ['exclude', 'Hide unlikely'], ['only', 'Only unlikely']] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setRiskFilter(key)}
                className={`px-2.5 py-1.5 font-medium cursor-pointer transition-colors ${
                  riskFilter === key
                    ? 'bg-rose-500 text-white'
                    : 'text-[var(--text-secondary)] hover:bg-subtle'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {filterActive && (
            <span className="text-[11px] text-[var(--text-muted)] shrink-0 tabular-nums">
              {activeRowsShown.length + inactiveRowsShown.length} match{activeRowsShown.length + inactiveRowsShown.length === 1 ? '' : 'es'}
            </span>
          )}
        </div>
        {renderGroup('Active clients', activeRowsShown, 'Active', filterActive)}
        {renderGroup('Inactive clients', inactiveRowsShown, 'Inactive', filterActive)}
      </div>

      <RecordPaymentModal
        open={!!paymentInvoice}
        onClose={() => setPaymentInvoice(null)}
        invoice={paymentInvoice}
        onRecorded={fetchData}
        depositBalance={paymentInvoice ? depositBalancesByClient[paymentInvoice.client_name] ?? 0 : 0}
      />

      <InvoiceCreditModal
        open={!!creditInvoice}
        onClose={() => setCreditInvoice(null)}
        invoice={creditInvoice}
        credits={creditInvoice ? (paymentsByInvoice[creditInvoice.id] ?? []).filter((p) => p.payment_method === 'credit') : []}
        onSaved={fetchData}
      />

      <ClientBalanceModal
        open={!!balanceClient}
        onClose={() => setBalanceClient(null)}
        clientName={balanceClient?.name ?? null}
        computedBalance={balanceClient?.computed ?? 0}
        currentBalance={balanceClient ? balancesByClient[balanceClient.name]?.receivables ?? null : null}
        currentNote={balanceClient ? balancesByClient[balanceClient.name]?.receivables_note ?? null : null}
        currentAsOf={balanceClient ? balancesByClient[balanceClient.name]?.receivables_as_of ?? null : null}
        onSaved={fetchData}
      />

      <DepositModal
        open={!!depositModal}
        onClose={() => setDepositModal(null)}
        clientName={depositModal?.clientName ?? null}
        clients={Array.from(new Set([
          ...activeClientNames,
          ...Object.keys(byClient),
          ...Object.keys(balancesByClient),
          ...Object.keys(depositBalancesByClient),
        ])).sort()}
        currentBalance={depositModal?.balance ?? 0}
        editEntry={depositModal?.editEntry ?? null}
        onSaved={fetchData}
      />

      <RecordOnAccountModal
        open={!!onAccountClient}
        onClose={() => setOnAccountClient(null)}
        clientName={onAccountClient?.name ?? null}
        currentBalance={onAccountClient?.balance ?? 0}
        onRecorded={fetchData}
      />

      <ApplyDepositModal
        open={!!applyDepositClient}
        onClose={() => setApplyDepositClient(null)}
        clientName={applyDepositClient}
        depositBalance={applyDepositClient ? depositBalancesByClient[applyDepositClient] ?? 0 : 0}
        invoices={applyDepositClient
          ? (byClient[applyDepositClient] ?? []).map((i) => ({
              id: i.id,
              invoice_number: i.invoice_number,
              billing_month: i.billing_month,
              totalDue: i.totalDue,
              balance: i.balance,
            }))
          : []}
        onApplied={fetchData}
      />

      {/* Follow-Up Email Modal */}
      {followUpModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm" onClick={() => setFollowUpModal(null)} />
          <div className="relative bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Send Follow-Up</h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {followUpModal.invoiceIds.length} invoice{followUpModal.invoiceIds.length !== 1 ? 's' : ''}{financeAddress ? ` — sent from ${financeAddress}` : ''}
                </p>
              </div>
              <button onClick={() => setFollowUpModal(null)} className="p-1.5 rounded-lg hover:bg-[var(--subtle-bg)] text-[var(--text-muted)] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {/* Recipient summary */}
              <div className="mb-4 p-3 rounded-xl bg-[var(--subtle-bg)] border border-[var(--border-color)]">
                <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Recipients ({followUpModal.invoiceIds.length})</p>
                <div className="flex flex-wrap gap-1.5">
                  {followUpModal.invoiceIds.map((id) => {
                    const inv = invoices.find((i) => i.id === id);
                    if (!inv) return null;
                    return (
                      <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-secondary)]">
                        {inv.client_name}
                        <span className="text-[var(--text-muted)]">{inv.invoice_number}</span>
                        <span className={`font-mono ${inv.daysOutstanding > 60 ? 'text-red-500 dark:text-red-400' : inv.daysOutstanding > 30 ? 'text-amber-500' : 'text-blue-500'}`}>
                          {inv.daysOutstanding}d
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Template preset selector */}
              <div className="mb-3 flex items-center gap-2">
                <span className="text-xs font-medium text-[var(--text-muted)]">Tone:</span>
                {(['reminder', 'overdue', 'final'] as const).map((key) => (
                  <button
                    key={key}
                    onClick={() => {
                      setFollowUpTemplate(getDefaultTemplate(key));
                      setFollowUpModal({ ...followUpModal, templateKey: key });
                    }}
                    className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
                      followUpModal.templateKey === key
                        ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/30'
                        : 'bg-[var(--background)] text-[var(--text-muted)] border-[var(--border-color)] hover:text-foreground'
                    }`}
                  >
                    {key === 'reminder' ? 'Gentle Reminder' : key === 'overdue' ? 'Overdue Notice' : 'Final Notice'}
                  </button>
                ))}
              </div>

              <PartnerCcToggle
                invoiceIds={followUpModal.invoiceIds}
                value={followUpCc}
                onChange={setFollowUpCc}
              />

              <EmailTemplateEditor
            financeAddress={financeAddress}
                template={followUpTemplate}
                onChange={setFollowUpTemplate}
                sampleVars={buildSampleVars(followUpModal.invoiceIds)}
                presets={presetsForCategory(followUpModal.templateKey)}
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-color)]">
              <button
                onClick={() => setFollowUpModal(null)}
                className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={sendFollowUpFromModal}
                disabled={sendingBulk}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {sendingBulk ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Send {followUpModal.invoiceIds.length} Follow-Up{followUpModal.invoiceIds.length !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
