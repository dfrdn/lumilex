'use client';

import { useState, useEffect, useCallback } from 'react';
import { Clock, AlertTriangle, Shield, Edit3, Check, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { confirmAction } from '@/components/ui/confirm';

interface SOLRecord {
  id: number;
  matter_id: string;
  period_id: string;
  cause_of_action: string;
  legal_basis: string;
  accrual_date: string;
  expiry_date: string;
  tolling_days: number;
  tolling_notes: string;
  status: 'active' | 'tolled' | 'expired' | 'filed';
}

interface Props {
  matterId: string;
  canEdit: boolean;
  onSetup?: () => void;
}

function daysRemaining(targetDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDate + 'T00:00:00');
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(d: string): string {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

export default function SOLBanner({ matterId, canEdit, onSetup }: Props) {
  const [sol, setSOL] = useState<SOLRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [tollingDays, setTollingDays] = useState(0);
  const [tollingNotes, setTollingNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchSOL = useCallback(async () => {
    const res = await fetch(`/api/sol?matterId=${matterId}`);
    if (res.ok) {
      const { data } = await res.json();
      setSOL(data);
      if (data) {
        setTollingDays(data.tolling_days);
        setTollingNotes(data.tolling_notes);
      }
    }
    setLoading(false);
  }, [matterId]);

  useEffect(() => { fetchSOL(); }, [fetchSOL]);

  const handleSaveTolling = async () => {
    if (!sol) return;
    setSaving(true);
    const res = await fetch('/api/sol', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sol.id, tollingDays, tollingNotes }),
    });
    if (res.ok) {
      await fetchSOL();
      setEditing(false);
    }
    setSaving(false);
  };

  const handleStatusChange = async (status: string) => {
    if (!sol) return;
    setSaving(true);
    const res = await fetch('/api/sol', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sol.id, status }),
    });
    if (res.ok) await fetchSOL();
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!sol || !(await confirmAction({ title: 'Remove this prescriptive period record?', confirmLabel: 'Remove', danger: true }))) return;
    const res = await fetch('/api/sol', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sol.id }),
    });
    if (res.ok) {
      setSOL(null);
    }
  };

  if (loading) return null;

  if (!sol) {
    if (!canEdit) return null;
    return (
      <div className="mb-6 animate-fade-up">
        <button
          onClick={onSetup}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-[var(--text-secondary)] bg-[var(--card-bg)] rounded-xl border border-dashed border-[var(--border-color)] hover:border-navy-300 dark:hover:border-navy-600 hover:text-navy-600 dark:hover:text-navy-400 transition-all duration-150"
        >
          <Clock className="w-4 h-4" />
          Set Prescriptive Period (Statute of Limitations)
        </button>
      </div>
    );
  }

  const days = daysRemaining(sol.expiry_date);
  const isExpired = days < 0 || sol.status === 'expired';
  const isCritical = !isExpired && days <= 30;
  const isWarning = !isExpired && !isCritical && days <= 90;
  const isFiled = sol.status === 'filed';
  const isTolled = sol.status === 'tolled';

  const bgClass = isFiled
    ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/5 dark:border-emerald-500/20'
    : isTolled
    ? 'bg-blue-50 border-blue-200 dark:bg-blue-500/5 dark:border-blue-500/20'
    : isExpired
    ? 'bg-red-50 border-red-300 dark:bg-red-500/10 dark:border-red-500/30'
    : isCritical
    ? 'bg-red-50 border-red-200 dark:bg-red-500/5 dark:border-red-500/20'
    : isWarning
    ? 'bg-amber-50 border-amber-200 dark:bg-amber-500/5 dark:border-amber-500/20'
    : 'bg-emerald-50/50 border-emerald-200/50 dark:bg-emerald-500/5 dark:border-emerald-500/10';

  const iconClass = isFiled
    ? 'text-emerald-600 dark:text-emerald-400'
    : isTolled
    ? 'text-blue-600 dark:text-blue-400'
    : isExpired || isCritical
    ? 'text-red-600 dark:text-red-400'
    : isWarning
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-emerald-600 dark:text-emerald-400';

  const countdownClass = isExpired
    ? 'text-red-700 dark:text-red-400 font-bold'
    : isCritical
    ? 'text-red-600 dark:text-red-400 font-semibold'
    : isWarning
    ? 'text-amber-600 dark:text-amber-400 font-semibold'
    : 'text-emerald-700 dark:text-emerald-400 font-semibold';

  return (
    <div className={`mb-6 rounded-xl border px-5 py-4 animate-fade-up ${bgClass} ${isExpired && !isFiled ? 'animate-pulse' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {isExpired && !isFiled ? (
            <AlertTriangle className={`w-5 h-5 ${iconClass}`} />
          ) : (
            <Shield className={`w-5 h-5 ${iconClass}`} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Prescriptive Period
            </h3>
            {isFiled && (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
                Filed
              </span>
            )}
            {isTolled && (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
                Tolled
              </span>
            )}
          </div>

          <p className="text-xs text-[var(--text-secondary)] mb-2">
            {sol.cause_of_action} &middot; {sol.legal_basis}
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-[var(--text-muted)]">
              Accrual: <span className="text-[var(--text-secondary)] font-medium">{formatDate(sol.accrual_date)}</span>
            </span>
            <span className="text-[var(--text-muted)]">
              Expiry: <span className="text-[var(--text-secondary)] font-medium">{formatDate(sol.expiry_date)}</span>
            </span>
            {!isFiled && (
              <span className={`text-sm tabular-nums ${countdownClass}`}>
                {isExpired ? `Expired ${Math.abs(days)} days ago` : `${days} days remaining`}
              </span>
            )}
            {sol.tolling_days > 0 && (
              <span className="text-[var(--text-muted)]">
                Tolling: <span className="text-[var(--text-secondary)] font-medium">{sol.tolling_days} days</span>
              </span>
            )}
          </div>

          {/* Tolling edit form */}
          {editing && (
            <div className="mt-3 p-3 rounded-lg bg-white/60 dark:bg-black/20 border border-[var(--border-color)]">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1">
                    Tolling Days
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={tollingDays}
                    onChange={(e) => setTollingDays(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1">
                    Tolling Notes
                  </label>
                  <input
                    type="text"
                    value={tollingNotes}
                    onChange={(e) => setTollingNotes(e.target.value)}
                    placeholder="e.g. Demand letter sent"
                    className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)]"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={handleSaveTolling}
                  disabled={saving}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-navy-600 hover:bg-navy-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Check className="w-3 h-3" />
                  Save
                </button>
                <button
                  onClick={() => { setEditing(false); setTollingDays(sol.tolling_days); setTollingNotes(sol.tolling_notes); }}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <X className="w-3 h-3" />
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        {canEdit && !editing && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setEditing(true)}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              title="Edit tolling"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
            {!isFiled && sol.status !== 'filed' && (
              <button
                onClick={() => handleStatusChange('filed')}
                disabled={saving}
                className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/10 transition-colors"
              >
                Mark Filed
              </button>
            )}
            <button
              onClick={handleDelete}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
              title="Remove SOL"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
