'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, UserPlus, ChevronDown } from 'lucide-react';
import ConflictCheckResults from '@/components/conflicts/ConflictCheckResults';
import CellDropdown from '@/components/admin/CellDropdown';
import type { ConflictCheckResponse } from '@/types/conflicts';

interface Person {
  person_id: string;
  name: string;
  initials: string;
  position?: string;
  avatar_url?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const SOURCE_OPTIONS = [
  { value: 'referral', label: 'Referral' },
  { value: 'website', label: 'Website' },
  { value: 'walk-in', label: 'Walk-in' },
  { value: 'event', label: 'Event' },
  { value: 'other', label: 'Other' },
];

export default function NewProspectModal({ open, onClose, onSuccess }: Props) {
  const [name, setName] = useState('');
  const [fullCompanyName, setFullCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [tin, setTin] = useState('');
  const [pointPersons, setPointPersons] = useState('');
  const [source, setSource] = useState('referral');
  const [referralSource, setReferralSource] = useState('');
  const [assignedPartnerId, setAssignedPartnerId] = useState('');

  const [partners, setPartners] = useState<Person[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [sourceOpen, setSourceOpen] = useState(false);
  const [partnerOpen, setPartnerOpen] = useState(false);
  const sourceRef = useRef<HTMLButtonElement>(null);
  const partnerRef = useRef<HTMLButtonElement>(null);

  // Conflict check
  const [conflictResult, setConflictResult] = useState<ConflictCheckResponse | null>(null);
  const [conflictChecking, setConflictChecking] = useState(false);
  const [conflictAcknowledged, setConflictAcknowledged] = useState(false);

  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (open) {
      setName(''); setFullCompanyName(''); setEmail(''); setPhone('');
      setTin(''); setPointPersons(''); setSource('referral'); setReferralSource('');
      setAssignedPartnerId(''); setError('');
      setConflictResult(null); setConflictChecking(false); setConflictAcknowledged(false);
      setSourceOpen(false); setPartnerOpen(false);

      // A prospect is assigned to a partner, not to any lawyer — new business
      // sits with the partner who owns the client relationship.
      fetch('/api/people?role=partners').then((r) => r.json()).then((d) => {
        if (mounted.current) setPartners(d.people ?? d ?? []);
      }).catch(() => {});
    }
  }, [open]);

  const runConflictCheck = async (): Promise<boolean> => {
    const names = [name.trim()];
    if (fullCompanyName.trim()) names.push(fullCompanyName.trim());
    if (names[0].length === 0) return true;

    setConflictChecking(true);
    try {
      const res = await fetch('/api/conflicts/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names, tin: tin.trim() || undefined }),
      });
      if (res.ok) {
        const result: ConflictCheckResponse = await res.json();
        setConflictResult(result);
        if (result.conflicts.length > 0) return false;
      }
      return true;
    } catch {
      return true;
    } finally {
      setConflictChecking(false);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;

    // Run conflict check first
    if (!conflictAcknowledged && !conflictResult) {
      const clean = await runConflictCheck();
      if (!clean) return;
    }

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/intakes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          fullCompanyName: fullCompanyName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          tin: tin.trim(),
          pointPersons: pointPersons.trim(),
          source,
          referralSource: referralSource.trim(),
          assignedLawyerId: assignedPartnerId || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // A 400 carries per-field detail; the bare `error` is just
        // "Validation failed", which doesn't say which field to fix.
        const detail = Array.isArray(data.details) ? data.details.join('; ') : '';
        throw new Error(detail || data.error || 'Failed to create prospect');
      }

      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[var(--card-bg)] rounded-2xl shadow-2xl border border-[var(--border-color)] w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <UserPlus className="w-5 h-5 text-gold-500 dark:text-gold-400" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">New Prospect</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--subtle-bg)] text-[var(--text-muted)] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <div className="p-5 space-y-4">
          {/* Client info */}
          <div>
            <h3 className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Client Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-[11px] font-medium text-[var(--text-muted)] block mb-1">Client Name *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500/30" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[11px] font-medium text-[var(--text-muted)] block mb-1">Full Company Name</label>
                <input value={fullCompanyName} onChange={(e) => setFullCompanyName(e.target.value)} placeholder="Full legal name" className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500/30" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-[var(--text-muted)] block mb-1">Email</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="email@example.com" className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500/30" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-[var(--text-muted)] block mb-1">Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+63" className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500/30" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-[var(--text-muted)] block mb-1">TIN</label>
                <input value={tin} onChange={(e) => setTin(e.target.value)} placeholder="Tax ID number" className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500/30" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-[var(--text-muted)] block mb-1">Point Persons</label>
                <input value={pointPersons} onChange={(e) => setPointPersons(e.target.value)} placeholder="Contact persons" className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500/30" />
              </div>
            </div>
          </div>

          {/* Intake info */}
          <div>
            <h3 className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Intake Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-[var(--text-muted)] block mb-1">Source</label>
                <button
                  type="button"
                  ref={sourceRef}
                  onClick={() => setSourceOpen((o) => !o)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] text-left focus:outline-none focus:ring-2 focus:ring-navy-500/30"
                >
                  <span>{SOURCE_OPTIONS.find((o) => o.value === source)?.label ?? source}</span>
                  <ChevronDown className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                </button>
                {sourceOpen && (
                  <CellDropdown
                    mode="single"
                    value={source}
                    options={SOURCE_OPTIONS.map((o) => ({ id: o.value, label: o.label }))}
                    onSelect={(id) => { if (id) setSource(id); setSourceOpen(false); }}
                    onClose={() => setSourceOpen(false)}
                    anchorRef={sourceRef}
                  />
                )}
              </div>
              <div>
                <label className="text-[11px] font-medium text-[var(--text-muted)] block mb-1">Referral Source</label>
                <input value={referralSource} onChange={(e) => setReferralSource(e.target.value)} placeholder="Who referred?" className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500/30" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[11px] font-medium text-[var(--text-muted)] block mb-1">Assigned Partner</label>
                <button
                  type="button"
                  ref={partnerRef}
                  onClick={() => setPartnerOpen((o) => !o)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-left focus:outline-none focus:ring-2 focus:ring-navy-500/30"
                >
                  <span className={assignedPartnerId ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>
                    {partners.find((p) => p.person_id === assignedPartnerId)?.name ?? 'Not assigned'}
                  </span>
                  <ChevronDown className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                </button>
                {partnerOpen && (
                  <CellDropdown
                    mode="single"
                    value={assignedPartnerId || null}
                    options={partners.map((p) => ({
                      id: p.person_id,
                      label: p.name,
                      sublabel: p.position || '',
                      initials: p.initials,
                      avatarUrl: p.avatar_url ?? null,
                    }))}
                    onSelect={(id) => { setAssignedPartnerId(id ?? ''); setPartnerOpen(false); }}
                    onClose={() => setPartnerOpen(false)}
                    anchorRef={partnerRef}
                    placeholder="Search partners…"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Conflict check results */}
          {(conflictChecking || conflictResult) && (
            <div>
              <h3 className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Conflict Check</h3>
              <ConflictCheckResults result={conflictResult} loading={conflictChecking} />
              {conflictResult && conflictResult.conflicts.length > 0 && !conflictAcknowledged && (
                <div className="flex items-center justify-end gap-2 mt-3">
                  <button onClick={() => { setConflictResult(null); }} className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--subtle-bg)] rounded-lg transition-colors">
                    Go Back
                  </button>
                  <button onClick={() => { setConflictAcknowledged(true); handleSubmit(); }} className="px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 dark:hover:bg-amber-500/30 dark:text-amber-300 dark:bg-amber-500/20 rounded-lg transition-colors">
                    Proceed Anyway
                  </button>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[var(--border-color)] flex items-center justify-end gap-2.5">
          <button onClick={onClose} disabled={submitting} className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--subtle-bg)] rounded-lg transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || submitting || conflictChecking || (conflictResult !== null && conflictResult.conflicts.length > 0 && !conflictAcknowledged)}
            className="px-5 py-2.5 text-sm font-medium text-white bg-gold-500 hover:bg-gold-600 rounded-xl shadow-sm transition-all disabled:opacity-40"
          >
            {submitting ? 'Creating...' : conflictChecking ? 'Checking conflicts...' : 'Create Prospect'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
