'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Upload, Loader2, Plus, Trash2 } from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';
import ClientBillingProfileModal from '@/components/finance/ClientBillingProfileModal';

interface BillingConfig {
  id: number;
  billing_type: string;
  acceptance_fee: number | null;
  acceptance_fee_paid: boolean;
  monthly_retainer: number | null;
  retainer_hours_cap: number | null;
  hourly_rate_override: number | null;
  fixed_fee_amount: number | null;
  success_fee_percent: number | null;
  success_fee_amount: number | null;
  engagement_date: string | null;
  engagement_file_path: string | null;
  engagement_file_name: string | null;
  billing_settings: Record<string, unknown>;
  notes: string;
}

interface ActionDef {
  id?: number;
  name: string;
  rate: string;
  cap: string;
  unit_label: string;
}

interface MilestoneDef {
  id?: number;
  name: string;
  description: string;
  fee: string;
  target_date: string | null;
  reached_at: string | null;
  invoiced: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  matterId: string;
  existing: BillingConfig | null;
  onSaved: () => void;
}

const BILLING_TYPES = [
  { value: 'litigation', label: 'Litigation', desc: 'Acceptance + hourly + success fee' },
  { value: 'retainer', label: 'Retainer', desc: 'Monthly + hourly excess' },
  { value: 'fixed_retainer', label: 'Fixed Retainer', desc: 'Flat monthly, no excess' },
  { value: 'fixed_fee', label: 'Fixed Fee', desc: 'Flat fee for engagement' },
  { value: 'acceptance_per_action', label: 'Per Action', desc: 'Acceptance + per-action fees' },
  { value: 'acceptance_per_milestone', label: 'Per Milestone', desc: 'Acceptance + per-milestone fees' },
] as const;

export default function BillingConfigModal({ open, onClose, matterId, existing, onSaved }: Props) {
  const [billingType, setBillingType] = useState(existing?.billing_type ?? 'litigation');
  const [acceptanceFee, setAcceptanceFee] = useState(existing?.acceptance_fee?.toString() ?? '');
  const [acceptanceFeePaid, setAcceptanceFeePaid] = useState(existing?.acceptance_fee_paid ?? false);
  const [monthlyRetainer, setMonthlyRetainer] = useState(existing?.monthly_retainer?.toString() ?? '');
  const [retainerHoursCap, setRetainerHoursCap] = useState(existing?.retainer_hours_cap?.toString() ?? '');
  const [hourlyRateOverride, setHourlyRateOverride] = useState(existing?.hourly_rate_override?.toString() ?? '');
  const [fixedFeeAmount, setFixedFeeAmount] = useState(existing?.fixed_fee_amount?.toString() ?? '');
  const [successFeePercent, setSuccessFeePercent] = useState(existing?.success_fee_percent?.toString() ?? '');
  const [successFeeAmount, setSuccessFeeAmount] = useState(existing?.success_fee_amount?.toString() ?? '');
  const [engagementDate, setEngagementDate] = useState(existing?.engagement_date ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');

  // Dynamic lists for per-action / per-milestone variants
  const [actions, setActions] = useState<ActionDef[]>([]);
  const [milestones, setMilestones] = useState<MilestoneDef[]>([]);

  // Billing settings (persisted per matter)
  const settings = (existing?.billing_settings ?? {}) as Record<string, string>;
  const [bankName, setBankName] = useState(settings.bankName ?? '');
  const [bankAccountNo, setBankAccountNo] = useState(settings.bankAccountNo ?? '');
  const [bankAccountName, setBankAccountName] = useState(settings.bankAccountName ?? '');
  const [settleFromDeposit, setSettleFromDeposit] = useState(settings.settleFromDeposit !== 'false');
  // The matter's client, whose billing profile holds the letter and recipient.
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  // Discount on hourly rates and total (percent values; 0 = disabled).
  const [hourlyDiscountPercent, setHourlyDiscountPercent] = useState(settings.hourlyDiscountPercent ?? '');
  const [totalDiscountPercent, setTotalDiscountPercent] = useState(settings.totalDiscountPercent ?? '');

  const [saving, setSaving] = useState(false);
  const [uploadingEngagement, setUploadingEngagement] = useState(false);
  const [engagementFileName, setEngagementFileName] = useState(existing?.engagement_file_name ?? '');
  const [engagementFilePath, setEngagementFilePath] = useState(existing?.engagement_file_path ?? '');
  const [engagementError, setEngagementError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadActionsAndMilestones = useCallback(async () => {
    if (!matterId) return;
    try {
      const [aRes, mRes] = await Promise.all([
        fetch(`/api/finance/matter-billing/actions?matterId=${encodeURIComponent(matterId)}`),
        fetch(`/api/finance/matter-billing/milestones?matterId=${encodeURIComponent(matterId)}`),
      ]);
      if (aRes.ok) {
        const { actions: rows } = await aRes.json();
        setActions(
          (rows ?? []).map((r: { id: number; name: string; rate: number; cap: number | null; unit_label: string }) => ({
            id: r.id,
            name: r.name,
            rate: r.rate?.toString() ?? '',
            cap: r.cap?.toString() ?? '',
            unit_label: r.unit_label ?? '',
          })),
        );
      }
      if (mRes.ok) {
        const { milestones: rows } = await mRes.json();
        setMilestones(
          (rows ?? []).map((r: { id: number; name: string; description: string; fee: number; target_date: string | null; reached_at: string | null; invoiced: boolean }) => ({
            id: r.id,
            name: r.name,
            description: r.description ?? '',
            fee: r.fee?.toString() ?? '',
            target_date: r.target_date,
            reached_at: r.reached_at,
            invoiced: r.invoiced,
          })),
        );
      }
    } catch { /* ignore */ }
  }, [matterId]);

  // Reset form when existing changes
  useEffect(() => {
    if (!open) return;
    setBillingType(existing?.billing_type ?? 'litigation');
    setAcceptanceFee(existing?.acceptance_fee?.toString() ?? '');
    setAcceptanceFeePaid(existing?.acceptance_fee_paid ?? false);
    setMonthlyRetainer(existing?.monthly_retainer?.toString() ?? '');
    setRetainerHoursCap(existing?.retainer_hours_cap?.toString() ?? '');
    setHourlyRateOverride(existing?.hourly_rate_override?.toString() ?? '');
    setFixedFeeAmount(existing?.fixed_fee_amount?.toString() ?? '');
    setSuccessFeePercent(existing?.success_fee_percent?.toString() ?? '');
    setSuccessFeeAmount(existing?.success_fee_amount?.toString() ?? '');
    setEngagementDate(existing?.engagement_date ?? '');
    setNotes(existing?.notes ?? '');
    setEngagementFileName(existing?.engagement_file_name ?? '');
    setEngagementFilePath(existing?.engagement_file_path ?? '');
    const s = (existing?.billing_settings ?? {}) as Record<string, string>;
    setBankName(s.bankName ?? '');
    setBankAccountNo(s.bankAccountNo ?? '');
    setBankAccountName(s.bankAccountName ?? '');
    setSettleFromDeposit(s.settleFromDeposit !== 'false');
    setHourlyDiscountPercent(s.hourlyDiscountPercent ?? '');
    setTotalDiscountPercent(s.totalDiscountPercent ?? '');
    loadActionsAndMilestones();
    // The matter's client, for its billing profile.
    (async () => {
      try {
        const res = await fetch(`/api/finance/matter-billing/defaults?matterId=${encodeURIComponent(matterId)}`);
        if (res.ok) {
          const json = await res.json();
          setClient(json.clientId ? { id: json.clientId, name: json.clientName ?? '' } : null);
        }
      } catch { /* ignore */ }
    })();
  }, [open, existing, loadActionsAndMilestones, matterId]);

  const handleUploadEngagement = async (file: File) => {
    setUploadingEngagement(true);
    setEngagementError(null);
    try {
      // Phase 1: get signed upload URL
      const urlRes = await fetch('/api/finance/matter-billing/engagement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matterId,
          fileName: file.name,
          fileType: file.type,
        }),
      });
      if (!urlRes.ok) {
        const errData = await urlRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to prepare upload');
      }
      const { storagePath, signedUrl, contentType } = (await urlRes.json()) as {
        storagePath: string;
        signedUrl: string;
        contentType: string;
      };

      // Phase 2: PUT the file directly to Supabase Storage
      const putRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || contentType || 'application/pdf' },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`Upload failed (${putRes.status})`);
      }

      // Phase 3: confirm — persist the storage path on the billing config
      const confirmRes = await fetch('/api/finance/matter-billing/engagement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: true,
          matterId,
          storagePath,
          fileName: file.name,
        }),
      });
      if (!confirmRes.ok) {
        const errData = await confirmRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to save engagement');
      }
      const json = await confirmRes.json();
      setEngagementFileName(json.fileName);
      setEngagementFilePath(json.path ?? storagePath);
    } catch (err) {
      setEngagementError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingEngagement(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/finance/matter-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matterId,
          billingType,
          acceptanceFee: acceptanceFee ? parseFloat(acceptanceFee) : null,
          acceptanceFeePaid,
          monthlyRetainer: monthlyRetainer ? parseFloat(monthlyRetainer) : null,
          retainerHoursCap: retainerHoursCap ? parseInt(retainerHoursCap) : null,
          hourlyRateOverride: hourlyRateOverride ? parseFloat(hourlyRateOverride) : null,
          fixedFeeAmount: fixedFeeAmount ? parseFloat(fixedFeeAmount) : null,
          successFeePercent: successFeePercent ? parseFloat(successFeePercent) : null,
          successFeeAmount: successFeeAmount ? parseFloat(successFeeAmount) : null,
          engagementDate: engagementDate || null,
          engagementFilePath: engagementFilePath || null,
          engagementFileName: engagementFileName || null,
          notes,
          // The save replaces billing_settings, so keys this form doesn't
          // manage (the engagement's currency) are carried over; the letter
          // keys that moved to the client's billing profile are dropped.
          billingSettings: {
            ...withoutKeys(existing?.billing_settings ?? {}, MOVED_TO_CLIENT_PROFILE),
            bankName, bankAccountNo, bankAccountName,
            settleFromDeposit: settleFromDeposit ? 'true' : 'false',
            hourlyDiscountPercent, totalDiscountPercent,
          },
        }),
      });
      if (!res.ok) {
        setSaving(false);
        return;
      }

      // Sync per-type sub-tables
      if (billingType === 'acceptance_per_action') {
        await fetch('/api/finance/matter-billing/actions', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            matterId,
            actions: actions
              .filter((a) => a.name.trim() && a.rate)
              .map((a, i) => ({
                id: a.id,
                name: a.name.trim(),
                rate: parseFloat(a.rate),
                cap: a.cap ? parseInt(a.cap) : null,
                unit_label: a.unit_label.trim(),
                order_index: i,
              })),
          }),
        });
      }
      if (billingType === 'acceptance_per_milestone') {
        await fetch('/api/finance/matter-billing/milestones', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            matterId,
            milestones: milestones
              .filter((m) => m.name.trim() && m.fee)
              .map((m, i) => ({
                id: m.id,
                name: m.name.trim(),
                description: m.description.trim(),
                fee: parseFloat(m.fee),
                target_date: m.target_date,
                order_index: i,
              })),
          }),
        });
      }

      onSaved();
      onClose();
    } catch { /* ignore */ }
    setSaving(false);
  };

  if (!open) return null;

  const usesAcceptance =
    billingType === 'litigation' ||
    billingType === 'acceptance_per_action' ||
    billingType === 'acceptance_per_milestone';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] sticky top-0 bg-[var(--card-bg)] z-10">
          <h2 className="text-sm font-semibold text-foreground">Billing Configuration</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-subtle cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Billing Type */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Billing Type</label>
            <div className="grid grid-cols-2 gap-2">
              {BILLING_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setBillingType(t.value)}
                  className={`px-3 py-2 text-xs font-medium rounded-lg border transition-all cursor-pointer text-left ${
                    billingType === t.value
                      ? 'bg-gold-50 text-gold-700 border-gold-300 ring-1 ring-gold-200 dark:ring-gold-500/20 dark:bg-gold-500/15 dark:text-gold-400 dark:border-gold-500/40'
                      : 'bg-subtle text-[var(--text-secondary)] border-[var(--border-color)] hover:border-gold-200 dark:hover:border-gold-500/25'
                  }`}
                >
                  <div>{t.label}</div>
                  <div className="text-[9px] mt-0.5 opacity-70">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Acceptance fee (shared by litigation / per-action / per-milestone) */}
          {usesAcceptance && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Acceptance Fee" value={acceptanceFee} onChange={setAcceptanceFee} type="number" placeholder="0.00" />
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={acceptanceFeePaid} onChange={(e) => setAcceptanceFeePaid(e.target.checked)} className="rounded" />
                  <span className="text-[var(--text-secondary)]">Paid</span>
                </label>
              </div>
            </div>
          )}

          {/* Type-specific fields */}
          {billingType === 'litigation' && (
            <div className="space-y-3">
              <Field label="Hourly Rate Override" value={hourlyRateOverride} onChange={setHourlyRateOverride} type="number" placeholder="Use position rates" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Success Fee %" value={successFeePercent} onChange={setSuccessFeePercent} type="number" placeholder="e.g. 10" />
                <Field label="or Fixed Amount" value={successFeeAmount} onChange={setSuccessFeeAmount} type="number" placeholder="0.00" />
              </div>
            </div>
          )}

          {billingType === 'retainer' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Monthly Retainer" value={monthlyRetainer} onChange={setMonthlyRetainer} type="number" placeholder="0.00" />
                <Field label="Hours Cap" value={retainerHoursCap} onChange={setRetainerHoursCap} type="number" placeholder="e.g. 10" />
              </div>
              <Field label="Excess Hourly Rate" value={hourlyRateOverride} onChange={setHourlyRateOverride} type="number" placeholder="Use position rates" />
            </div>
          )}

          {billingType === 'fixed_retainer' && (
            <div className="space-y-1">
              <Field label="Monthly Retainer" value={monthlyRetainer} onChange={setMonthlyRetainer} type="number" placeholder="0.00" />
              <p className="text-[10px] text-[var(--text-muted)]">Flat monthly fee — hours rendered are tracked for transparency but not billed.</p>
            </div>
          )}

          {billingType === 'fixed_fee' && (
            <Field label="Fixed Fee Amount" value={fixedFeeAmount} onChange={setFixedFeeAmount} type="number" placeholder="0.00" />
          )}

          {billingType === 'acceptance_per_action' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Actions</label>
                <button
                  type="button"
                  onClick={() =>
                    setActions((a) => [...a, { name: '', rate: '', cap: '', unit_label: '' }])
                  }
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-subtle hover:bg-gold-50 border border-[var(--border-color)] text-[var(--text-secondary)] cursor-pointer dark:hover:bg-gold-500/10"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
              {actions.length === 0 && (
                <p className="text-[11px] text-[var(--text-muted)] italic">No actions yet. Add one to start billing per occurrence.</p>
              )}
              {actions.map((a, idx) => (
                <div key={idx} className="grid grid-cols-[1.4fr_0.9fr_0.7fr_0.7fr_auto] gap-2 items-center">
                  <input
                    value={a.name}
                    onChange={(e) => setActions((arr) => arr.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                    placeholder="Court Appearance"
                    className="px-2 py-1 text-xs rounded-md bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
                  />
                  <input
                    type="number"
                    value={a.rate}
                    onChange={(e) => setActions((arr) => arr.map((x, i) => i === idx ? { ...x, rate: e.target.value } : x))}
                    placeholder="Rate"
                    className="px-2 py-1 text-xs rounded-md bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
                  />
                  <input
                    type="number"
                    value={a.cap}
                    onChange={(e) => setActions((arr) => arr.map((x, i) => i === idx ? { ...x, cap: e.target.value } : x))}
                    placeholder="Cap"
                    className="px-2 py-1 text-xs rounded-md bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
                  />
                  <input
                    value={a.unit_label}
                    onChange={(e) => setActions((arr) => arr.map((x, i) => i === idx ? { ...x, unit_label: e.target.value } : x))}
                    placeholder="unit"
                    className="px-2 py-1 text-xs rounded-md bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
                  />
                  <button
                    type="button"
                    onClick={() => setActions((arr) => arr.filter((_, i) => i !== idx))}
                    className="p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500 cursor-pointer"
                    aria-label="Remove action"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <p className="text-[10px] text-[var(--text-muted)]">Cap is per billing month. Leave blank for no cap.</p>
            </div>
          )}

          {billingType === 'acceptance_per_milestone' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Milestones</label>
                <button
                  type="button"
                  onClick={() =>
                    setMilestones((m) => [...m, { name: '', description: '', fee: '', target_date: null, reached_at: null, invoiced: false }])
                  }
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-subtle hover:bg-gold-50 border border-[var(--border-color)] text-[var(--text-secondary)] cursor-pointer dark:hover:bg-gold-500/10"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
              {milestones.length === 0 && (
                <p className="text-[11px] text-[var(--text-muted)] italic">No milestones yet. Add one to track billable events.</p>
              )}
              {milestones.map((m, idx) => (
                <div key={idx} className="space-y-1 p-2 rounded-md border border-[var(--border-color)] bg-subtle/40">
                  <div className="grid grid-cols-[1.4fr_0.7fr_auto] gap-2 items-center">
                    <input
                      value={m.name}
                      onChange={(e) => setMilestones((arr) => arr.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                      placeholder="Filing of Complaint"
                      className="px-2 py-1 text-xs rounded-md bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
                    />
                    <input
                      type="number"
                      value={m.fee}
                      onChange={(e) => setMilestones((arr) => arr.map((x, i) => i === idx ? { ...x, fee: e.target.value } : x))}
                      placeholder="Fee"
                      className="px-2 py-1 text-xs rounded-md bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
                    />
                    <button
                      type="button"
                      onClick={() => setMilestones((arr) => arr.filter((_, i) => i !== idx))}
                      className="p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500 cursor-pointer"
                      aria-label="Remove milestone"
                      disabled={m.invoiced}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input
                    value={m.description}
                    onChange={(e) => setMilestones((arr) => arr.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))}
                    placeholder="Description (optional)"
                    className="w-full px-2 py-1 text-xs rounded-md bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Target</span>
                    <DatePickerInput
                      variant="cell"
                      value={m.target_date}
                      onChange={(v) => setMilestones((arr) => arr.map((x, i) => i === idx ? { ...x, target_date: v } : x))}
                      placeholder="Optional"
                    />
                    {m.reached_at && (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 ml-auto">
                        {m.invoiced ? 'Reached & invoiced' : 'Reached'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-[var(--text-muted)]">Mark milestones as reached from the matter detail page to trigger billing.</p>
            </div>
          )}

          {/* Engagement */}
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Engagement Date</label>
              <DatePickerInput
                variant="compact"
                value={engagementDate || null}
                onChange={(v) => setEngagementDate(v ?? '')}
                placeholder="Pick a date"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Engagement Agreement</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingEngagement}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-subtle text-[var(--text-secondary)] hover:bg-gold-50 border border-[var(--border-color)] transition-colors cursor-pointer dark:hover:bg-gold-500/10"
                >
                  {uploadingEngagement ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  Upload PDF
                </button>
                {engagementFileName && (
                  <span className="text-xs text-[var(--text-muted)] truncate">{engagementFileName}</span>
                )}
                {engagementError && (
                  <span className="text-xs text-red-600 dark:text-red-400 truncate" title={engagementError}>
                    {engagementError}
                  </span>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadEngagement(f);
                  }}
                />
              </div>
            </div>
          </div>

          {/* Billing Settings (for invoice generation) */}
          <div className="border-t border-[var(--border-color)] pt-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Invoice Settings</h3>
            <div className="space-y-3">
              {/* Letter and recipient live on the client, not the matter. */}
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--subtle-bg)]/40 px-3 py-2.5 flex items-center justify-between gap-3">
                <div className="text-xs">
                  <p className="font-medium text-foreground">Letter and recipient</p>
                  <p className="text-[var(--text-muted)]">
                    Addressee, emails, VAT, the letter&apos;s paragraphs and the early-payment discount are set once for {client?.name || 'the client'}, across all its matters.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setProfileOpen(true)}
                  disabled={!client}
                  className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-gold-50 dark:hover:bg-gold-500/10 disabled:opacity-50 cursor-pointer"
                >
                  Edit client billing profile
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Bank" value={bankName} onChange={setBankName} placeholder="Bank name" />
                <Field label="Account No." value={bankAccountNo} onChange={setBankAccountNo} placeholder="Account number" />
                <Field label="Account Name" value={bankAccountName} onChange={setBankAccountName} placeholder="Registered account name" />
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={settleFromDeposit} onChange={(e) => setSettleFromDeposit(e.target.checked)} className="rounded" />
                <span className="text-[var(--text-secondary)]">Settle bills from advance deposit (letter and breakdown show the deduction; the deposit is drawn down automatically when the invoice is sent)</span>
              </label>

              {/* Discount on this matter's fees */}
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Hourly Discount (%)"
                  value={hourlyDiscountPercent}
                  onChange={setHourlyDiscountPercent}
                  type="number"
                  placeholder="0"
                />
                <Field
                  label="Total Discount (%)"
                  value={totalDiscountPercent}
                  onChange={setTotalDiscountPercent}
                  type="number"
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40 resize-none"
              placeholder="Internal notes..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--border-color)] sticky bottom-0 bg-[var(--card-bg)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-subtle text-[var(--text-secondary)] hover:bg-stone-100 dark:hover:bg-stone-800 border border-[var(--border-color)] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-gold-500 text-white hover:bg-gold-600 disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      {profileOpen && client && (
        <ClientBillingProfileModal clientId={client.id} onClose={() => setProfileOpen(false)} />
      )}
    </div>
  );
}

/** Letter and recipient settings that now live on the client's billing profile. */
const MOVED_TO_CLIENT_PROFILE = [
  'clientAddress', 'attnName', 'attnTitle', 'throughName', 'salutation', 'signerName', 'includeVAT', 'includeLessenFeesNote',
  'clientEmail', 'ccEmails', 'letterAddressee', 'letterInitialStatement', 'letterDeferredAcceptanceFee',
  'letterPaymentArrangement', 'earlyPaymentDiscountPercent', 'earlyPaymentDays', 'billingLetterSubcategory',
];

function withoutKeys(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
}

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
      />
    </div>
  );
}
