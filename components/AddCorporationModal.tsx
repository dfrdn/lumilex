'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X, Building2, ChevronDown, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import DatePickerInput from '@/components/DatePickerInput';
import CellDropdown from '@/components/admin/CellDropdown';
import { parseAmount } from '@/lib/parse-amount';
import { confirmAction } from '@/components/ui/confirm';
import { FIRM_FILINGS, type FirmFiling } from '@/lib/corporations/obligations';

interface ClientOption {
  id: string;
  name: string;
}

interface MatterOption {
  id: string;
  name: string;
  code: string;
  clientId: string;
  type: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

type EngagingMode = 'new' | 'existing';
type LifecycleMode = 'incorporating' | 'already_incorporated';
type CompanyType = 'Stock' | 'Non-Stock' | 'OPC' | 'Partnership';

const COMPANY_TYPE_OPTIONS: { id: CompanyType; label: string }[] = [
  { id: 'Stock', label: 'Stock' },
  { id: 'Non-Stock', label: 'Non-Stock' },
  { id: 'OPC', label: 'One-Person Corporation (OPC)' },
  { id: 'Partnership', label: 'Partnership' },
];

export default function AddCorporationModal({ open, onClose }: Props) {
  const router = useRouter();

  const [lifecycle, setLifecycle] = useState<LifecycleMode>('incorporating');
  const [mode, setMode] = useState<EngagingMode>('new');
  const [workingName, setWorkingName] = useState('');
  const [engagingClientId, setEngagingClientId] = useState<string | null>(null);

  const [handlesIncorporation, setHandlesIncorporation] = useState(true);
  const [handlesPostIncorporation, setHandlesPostIncorporation] = useState(false);
  const [handlesHousekeeping, setHandlesHousekeeping] = useState(false);
  const [isUnderRetainer, setIsUnderRetainer] = useState(false);
  const [firmFiles, setFirmFiles] = useState<FirmFiling[]>([]);
  const [retainerMatterId, setRetainerMatterId] = useState<string | null>(null);

  // Existing-corp fields
  const [companyType, setCompanyType] = useState<CompanyType | ''>('');
  const [secRegistrationNo, setSecRegistrationNo] = useState('');
  const [secRegistrationDate, setSecRegistrationDate] = useState('');
  const [authorizedCapitalStock, setAuthorizedCapitalStock] = useState('');
  const [parValue, setParValue] = useState('');
  const [principalOfficeAddress, setPrincipalOfficeAddress] = useState('');

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [matters, setMatters] = useState<MatterOption[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [clientOpen, setClientOpen] = useState(false);
  const [retainerOpen, setRetainerOpen] = useState(false);
  const [companyTypeOpen, setCompanyTypeOpen] = useState(false);
  const companyTypeRef = useRef<HTMLButtonElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLifecycle('incorporating');
    setMode('new');
    setWorkingName('');
    setEngagingClientId(null);
    setHandlesIncorporation(true);
    setHandlesPostIncorporation(false);
    setHandlesHousekeeping(false);
    setFirmFiles([]);
    setIsUnderRetainer(false);
    setRetainerMatterId(null);
    setCompanyType('');
    setSecRegistrationNo('');
    setSecRegistrationDate('');
    setAuthorizedCapitalStock('');
    setParValue('');
    setPrincipalOfficeAddress('');
    setClientSearch('');
    setCompanyTypeOpen(false);
    setError('');
    setSuccess(false);

    fetch('/api/clients-matters')
      .then((r) => r.json())
      .then((d) => {
        setClients(d.clients ?? []);
        setMatters(d.matters ?? []);
      })
      .catch(() => {});
  }, [open]);

  const dirty =
    lifecycle !== 'incorporating' ||
    mode !== 'new' ||
    workingName.trim() !== '' ||
    engagingClientId !== null ||
    !handlesIncorporation ||
    handlesPostIncorporation ||
    handlesHousekeeping ||
    isUnderRetainer ||
    companyType !== '' ||
    secRegistrationNo.trim() !== '' ||
    secRegistrationDate !== '' ||
    authorizedCapitalStock.trim() !== '' ||
    parValue.trim() !== '' ||
    principalOfficeAddress.trim() !== '';

  const asking = useRef(false);
  async function requestClose() {
    if (submitting || asking.current) return;
    if (!success && dirty) {
      asking.current = true;
      const discard = await confirmAction({ title: 'Discard this corporation?', message: 'What you’ve entered so far is lost.', confirmLabel: 'Discard', danger: true });
      asking.current = false;
      if (!discard) return;
    }
    onClose();
  }
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    if (!open) return;
    function h(e: KeyboardEvent) { if (e.key === 'Escape') requestCloseRef.current(); }
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients.slice(0, 50);
    return clients.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 50);
  }, [clients, clientSearch]);

  const selectedClient = clients.find((c) => c.id === engagingClientId);

  // Whoever will own the corporation's matters: the engaging client when one is
  // named, otherwise the client the working name resolves to — the server
  // reuses an existing client of that name rather than minting a second one.
  // Reading retainers off the engaging client alone left a self-engaging
  // corporation unable to pick one at all, so it could be marked "under
  // retainer" with no matter to point at. The engaging client only counts in
  // 'existing' mode, because that is the only mode that submits it.
  const retainerClientId = useMemo(() => {
    if (mode === 'existing') return engagingClientId;
    const target = workingName.trim().toLowerCase();
    if (!target) return null;
    return clients.find((c) => c.name.trim().toLowerCase() === target)?.id ?? null;
  }, [mode, engagingClientId, workingName, clients]);

  const retainerMattersForClient = useMemo(() => {
    if (!retainerClientId) return [];
    return matters.filter((m) => m.clientId === retainerClientId && /retainer/i.test(m.type));
  }, [matters, retainerClientId]);

  const selectedRetainer = matters.find((m) => m.id === retainerMatterId);

  // Changing the client out from under a chosen retainer would submit a matter
  // that belongs to someone else.
  useEffect(() => {
    if (retainerMatterId && !retainerMattersForClient.some((m) => m.id === retainerMatterId)) {
      setRetainerMatterId(null);
    }
  }, [retainerMatterId, retainerMattersForClient]);

  const isExisting = lifecycle === 'already_incorporated';
  // For existing corps, the "incorporation" scope toggle is meaningless; we
  // pin it to false regardless of UI state to keep server logic clean.
  const effectiveHandlesIncorporation = isExisting ? false : handlesIncorporation;

  async function submit() {
    setError('');
    if (!workingName.trim()) {
      setError(isExisting ? 'Corporate name is required' : 'Working name is required');
      return;
    }
    if (mode === 'existing' && !engagingClientId) {
      setError('Pick the engaging client');
      return;
    }
    if (isUnderRetainer && !retainerMatterId) {
      setError('Pick the retainer matter this corporation falls under');
      return;
    }
    if (isExisting) {
      if (!handlesPostIncorporation && !handlesHousekeeping && !isUnderRetainer) {
        setError('Pick at least one scope: post-incorporation, housekeeping, or under retainer');
        return;
      }
    }
    const acs = parseAmount(authorizedCapitalStock);
    if (isExisting && authorizedCapitalStock.trim() && acs === null) {
      setError('Authorized Capital Stock must be a number, e.g. 1,000,000');
      return;
    }
    const pv = parseAmount(parValue);
    if (isExisting && parValue.trim() && pv === null) {
      setError('Par Value must be a number, e.g. 1.00');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/corporation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workingName: workingName.trim(),
          engagingClientId: mode === 'existing' ? engagingClientId : null,
          handlesIncorporation: effectiveHandlesIncorporation,
          handlesPostIncorporation,
          handlesHousekeeping,
          firmFiles,
          isUnderRetainer,
          retainerMatterId: isUnderRetainer ? retainerMatterId : null,
          alreadyIncorporated: isExisting,
          approvedName: isExisting ? workingName.trim() : null,
          companyType: isExisting ? (companyType || null) : null,
          secRegistrationNo: isExisting ? (secRegistrationNo.trim() || null) : null,
          secRegistrationDate: isExisting ? (secRegistrationDate || null) : null,
          authorizedCapitalStock: isExisting ? acs : null,
          parValue: isExisting ? pv : null,
          principalOfficeAddress: isExisting ? (principalOfficeAddress.trim() || null) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to create corporation');
        setSubmitting(false);
        return;
      }
      // No new client row was created — this corporation attached to one that
      // already answered to this name. Say so, otherwise the user is left
      // wondering why the client list didn't grow.
      const linked = data.linkedExistingClient as { name: string; clientCode: number | null } | null;
      if (linked) {
        toast.info(
          `Linked to existing client ${linked.name}${linked.clientCode ? ` (${linked.clientCode})` : ''}`,
        );
      }
      setSuccess(true);
      setTimeout(() => {
        router.push(`/dashboard/corporations/${data.corporation.id}`);
      }, 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
      setSubmitting(false);
    }
  }

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto" onClick={requestClose}>
      <div className="bg-white dark:bg-card rounded-xl shadow-2xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-stone-200 dark:border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-stone-700 dark:text-stone-200" />
            <h2 className="text-base font-semibold text-stone-800 dark:text-stone-100">New Corporation</h2>
          </div>
          <button onClick={requestClose} className="p-1 rounded hover:bg-stone-100 dark:hover:bg-white/10">
            <X className="w-4 h-4 text-stone-500 dark:text-stone-400" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Section: lifecycle */}
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-2">What stage is this corporation in?</label>
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  className="mt-0.5"
                  checked={lifecycle === 'incorporating'}
                  onChange={() => setLifecycle('incorporating')}
                  disabled={submitting}
                />
                <span className="text-sm text-stone-700 dark:text-stone-200">
                  New corporation — we'll file with SEC.
                  <span className="block text-xs text-stone-500 dark:text-stone-400">Starts at Pre-Incorporation. Opens the Intake / eSPARC flow.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  className="mt-0.5"
                  checked={lifecycle === 'already_incorporated'}
                  onChange={() => {
                    setLifecycle('already_incorporated');
                    setHandlesIncorporation(false);
                    setHandlesPostIncorporation(true);
                  }}
                  disabled={submitting}
                />
                <span className="text-sm text-stone-700 dark:text-stone-200">
                  Already incorporated — engage for post-incorporation or housekeeping only.
                  <span className="block text-xs text-stone-500 dark:text-stone-400">Skips the SEC filing flow. Starts at Registered.</span>
                </span>
              </label>
            </div>
          </div>

          {/* Section: engaging client */}
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-2">Who's engaging us?</label>
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  className="mt-0.5"
                  checked={mode === 'new'}
                  onChange={() => setMode('new')}
                  disabled={submitting}
                />
                <span className="text-sm text-stone-700 dark:text-stone-200">
                  This is a new client (the corporation itself).
                  <span className="block text-xs text-stone-500 dark:text-stone-400">A placeholder client is created now and renamed when SEC approves.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  className="mt-0.5"
                  checked={mode === 'existing'}
                  onChange={() => setMode('existing')}
                  disabled={submitting}
                />
                <span className="text-sm text-stone-700 dark:text-stone-200">
                  An existing client is creating this corporation.
                  <span className="block text-xs text-stone-500 dark:text-stone-400">No new client is created — matters and billing stay under that client.</span>
                </span>
              </label>
            </div>

            {mode === 'existing' && (
              <div className="mt-3 relative">
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg bg-white dark:bg-card hover:border-stone-400"
                  onClick={() => setClientOpen((o) => !o)}
                  disabled={submitting}
                >
                  <span className={selectedClient ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}>
                    {selectedClient?.name ?? 'Select engaging client…'}
                  </span>
                  <ChevronDown className="w-4 h-4 text-stone-400 dark:text-stone-500" />
                </button>
                {clientOpen && (
                  <div className="absolute z-10 mt-1 w-full bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    <input
                      autoFocus
                      type="text"
                      className="w-full px-3 py-2 text-sm border-b border-stone-200 dark:border-white/10 outline-none"
                      placeholder="Search clients…"
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                    />
                    {filteredClients.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-stone-50 dark:hover:bg-white/5"
                        onClick={() => {
                          setEngagingClientId(c.id);
                          setClientOpen(false);
                        }}
                      >
                        {c.name}
                      </button>
                    ))}
                    {filteredClients.length === 0 && (
                      <div className="px-3 py-2 text-xs text-stone-400 dark:text-stone-500">No matches</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Working name / Corporate name */}
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">
              {isExisting ? 'Corporate name (as registered)' : 'Working name'}
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none focus:border-navy-600"
              value={workingName}
              onChange={(e) => setWorkingName(e.target.value)}
              placeholder={isExisting ? 'Acme Industries, Inc.' : 'Acme Industries, Inc.'}
              disabled={submitting}
            />
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              {isExisting
                ? 'Exact registered corporate name as on the SEC Certificate of Registration.'
                : 'First proposed name. Updated when SEC approves.'}
            </p>
          </div>

          {/* Existing-corp registration details */}
          {isExisting && (
            <div className="border-t border-stone-200 dark:border-white/10 pt-5 space-y-4">
              <div className="text-xs font-semibold text-stone-700 dark:text-stone-200">Registration details</div>

              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Company type</label>
                <button
                  type="button"
                  ref={companyTypeRef}
                  onClick={() => setCompanyTypeOpen((o) => !o)}
                  disabled={submitting}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg bg-white dark:bg-card text-left outline-none focus:border-navy-600 hover:border-stone-400 disabled:bg-stone-50 dark:disabled:bg-white/5 disabled:text-stone-500 dark:disabled:text-stone-400"
                >
                  <span className={companyType ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}>
                    {COMPANY_TYPE_OPTIONS.find((o) => o.id === companyType)?.label ?? '— Select —'}
                  </span>
                  <ChevronDown className="w-4 h-4 text-stone-400 dark:text-stone-500 shrink-0" />
                </button>
                {companyTypeOpen && (
                  <CellDropdown
                    mode="single"
                    value={companyType || null}
                    options={COMPANY_TYPE_OPTIONS}
                    onSelect={(id) => {
                      setCompanyType((id as CompanyType | null) ?? '');
                      setCompanyTypeOpen(false);
                    }}
                    onClose={() => setCompanyTypeOpen(false)}
                    anchorRef={companyTypeRef}
                  />
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">SEC Registration No.</label>
                  <input
                    type="text"
                    value={secRegistrationNo}
                    onChange={(e) => setSecRegistrationNo(e.target.value)}
                    disabled={submitting}
                    placeholder="e.g. CS202412345"
                    className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none focus:border-navy-600 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">SEC Reg. Date</label>
                  <DatePickerInput
                    value={secRegistrationDate || null}
                    onChange={(v) => setSecRegistrationDate(v ?? '')}
                    className={submitting ? 'pointer-events-none opacity-60' : undefined}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Authorized Capital Stock (PHP)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={authorizedCapitalStock}
                    onChange={(e) => setAuthorizedCapitalStock(e.target.value)}
                    disabled={submitting}
                    placeholder="1,000,000"
                    className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none focus:border-navy-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Par Value (PHP)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={parValue}
                    onChange={(e) => setParValue(e.target.value)}
                    disabled={submitting}
                    placeholder="1.00"
                    className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none focus:border-navy-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Principal Office Address</label>
                <textarea
                  rows={2}
                  value={principalOfficeAddress}
                  onChange={(e) => setPrincipalOfficeAddress(e.target.value)}
                  disabled={submitting}
                  className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none focus:border-navy-600"
                />
              </div>

              <p className="text-xs text-stone-500 dark:text-stone-400">
                Stockholders, directors, and officers can be added from the corporation's People tab after creation.
              </p>
            </div>
          )}

          {/* Scope toggles */}
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-2">Engagement scope</label>
            <div className="space-y-2">
              {!isExisting && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={handlesIncorporation}
                    onChange={(e) => setHandlesIncorporation(e.target.checked)}
                    disabled={submitting}
                  />
                  <span className="text-sm text-stone-700 dark:text-stone-200">Incorporation (SEC eSPARC)</span>
                </label>
              )}
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={handlesPostIncorporation}
                  onChange={(e) => setHandlesPostIncorporation(e.target.checked)}
                  disabled={submitting}
                />
                <span className="text-sm text-stone-700 dark:text-stone-200">Post-Incorporation (BIR, business permit, SSS, PhilHealth, Pag-IBIG)</span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={handlesHousekeeping}
                  onChange={(e) => setHandlesHousekeeping(e.target.checked)}
                  disabled={submitting}
                />
                <span className="text-sm text-stone-700 dark:text-stone-200">Corporate Housekeeping (resolutions, meetings)</span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={isUnderRetainer}
                  onChange={(e) => setIsUnderRetainer(e.target.checked)}
                  disabled={submitting}
                />
                <span className="text-sm text-stone-700 dark:text-stone-200">
                  Under general retainer
                  <span className="block text-xs text-stone-500 dark:text-stone-400">The retainer matter carries the post-incorporation and housekeeping work — no separate matters are opened.</span>
                </span>
              </label>
            </div>
            {isUnderRetainer && (
              <div className="mt-3 relative">
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Retainer matter</label>
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg bg-white dark:bg-card hover:border-stone-400"
                  onClick={() => setRetainerOpen((o) => !o)}
                  disabled={submitting || !retainerClientId}
                >
                  <span className={selectedRetainer ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}>
                    {selectedRetainer?.name ?? (retainerClientId ? 'Select retainer matter…' : 'No client resolved yet')}
                  </span>
                  <ChevronDown className="w-4 h-4 text-stone-400 dark:text-stone-500" />
                </button>
                {retainerOpen && retainerClientId && (
                  <div className="absolute z-10 mt-1 w-full bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {retainerMattersForClient.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-stone-400 dark:text-stone-500">No retainer matters for this client</div>
                    ) : (
                      retainerMattersForClient.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-stone-50 dark:hover:bg-white/5"
                          onClick={() => {
                            setRetainerMatterId(m.id);
                            setRetainerOpen(false);
                          }}
                        >
                          {m.name}
                          {m.code ? <span className="ml-2 text-xs font-mono text-stone-400 dark:text-stone-500">{m.code}</span> : null}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Filings we handle</label>
            <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
              Each one ticked is tracked and raised every year. Leave the AFS and ITR off when the company&apos;s auditor or accountant files them.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {FIRM_FILINGS.map((f) => (
                <label key={f.key} className="inline-flex items-center gap-1.5 text-sm text-stone-700 dark:text-stone-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={firmFiles.includes(f.key)}
                    onChange={(e) => setFirmFiles((prev) => (e.target.checked ? [...prev, f.key] : prev.filter((k) => k !== f.key)))}
                    disabled={submitting}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </div>

          {error && <div className="px-3 py-2 text-xs rounded bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300">{error}</div>}
          {success && (
            <div className="px-3 py-2 text-xs rounded bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              Created — taking you to the corporation…
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-stone-200 dark:border-white/10 flex justify-end gap-2">
          <button
            type="button"
            onClick={requestClose}
            className="px-3 py-1.5 text-xs font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-white/10 rounded-lg"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || success}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-navy-800 text-white hover:bg-navy-700 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create Corporation'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
