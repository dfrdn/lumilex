'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Stamp, Check, ChevronDown, CheckCircle2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import DatePickerInput from '@/components/DatePickerInput';
import {
  DESIGNATION_STAGES, DESIGNATION_STAGE_LABELS, START_STAGES, START_STAGE_LABELS,
  type DesignationStage, type DesignationStartInput, type StartStage, type TrademarkStart,
} from '@/lib/trademarks/create';
import { PUBLICATION_FEE_UPFRONT_FROM, dau3Deadline } from '@/lib/trademark-deadlines';
import { addYears, manilaToday } from '@/lib/dates';

interface MatterOption {
  id: string;
  name: string;
  code: string;
  clientId: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const TRADEMARK_TYPES = ['Wordmark', 'Combined', 'Device'] as const;

// Nice classification 1–45 (PH IPO uses the standard Nice classes).
const ALL_CLASSES = Array.from({ length: 45 }, (_, i) => i + 1);

const LABEL = 'flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1.5';
const INPUT = 'w-full px-3 py-2 text-sm text-stone-800 dark:text-stone-100 bg-stone-50/80 dark:bg-white/5 border border-stone-200 dark:border-white/10 rounded-lg placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-blue-400/20 focus:border-blue-400';
const FILED_STAGES = START_STAGES.filter((s) => s !== 'new' && s !== 'for_filing');

export default function AddTrademarkModal({ open, onClose }: Props) {
  const router = useRouter();

  const [mark, setMark] = useState('');
  const [type, setType] = useState<string>('');
  const [classes, setClasses] = useState<number[]>([]);
  const [matterId, setMatterId] = useState<string | null>(null);
  const [owner, setOwner] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  /**
   * Not yet filed; already filed — a mark taken over from other counsel or
   * picked up mid-prosecution; or a designation of the Philippines in an
   * international registration (Madrid Protocol).
   */
  const [origin, setOrigin] = useState<'new' | 'filed' | 'madrid'>('new');
  const filed = origin === 'filed';
  const madrid = origin === 'madrid';
  const [start, setStart] = useState<TrademarkStart>({ stage: 'new' });
  const [designation, setDesignation] = useState<DesignationStartInput>({ stage: 'examination' });

  const [allMatters, setAllMatters] = useState<MatterOption[]>([]);
  const [matterSearch, setMatterSearch] = useState('');
  const [matterOpen, setMatterOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [classesOpen, setClassesOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setMark('');
    setType('');
    setClasses([]);
    setMatterId(null);
    setOwner('');
    setContactEmail('');
    setOrigin('new');
    setStart({ stage: 'new' });
    setDesignation({ stage: 'examination' });
    setMatterSearch('');
    setSuccess(false);
    setError('');
    setErrors({});

    fetch('/api/clients-matters')
      .then((r) => r.json())
      .then((d) => setAllMatters(d.matters ?? []))
      .catch(() => {});
  }, [open]);

  const filteredMatters = useMemo(() => {
    const q = matterSearch.trim().toLowerCase();
    if (!q) return allMatters.slice(0, 50);
    return allMatters.filter((m) =>
      m.name.toLowerCase().includes(q) || (m.code ?? '').toLowerCase().includes(q),
    ).slice(0, 50);
  }, [allMatters, matterSearch]);

  const selectedMatter = allMatters.find((m) => m.id === matterId);

  function validate() {
    const e: Record<string, string> = {};
    if (!mark.trim()) e.mark = 'Mark is required';
    if (!matterId) e.matter = 'Matter is required';
    if (filed) {
      if (!start.filingDate) e.filingDate = 'Filing date is required';
      if (start.stage === 'office_action' && !start.oaMailingDate) e.oaMailingDate = 'Date on the Office Action is required';
      if (start.stage === 'allowed' && !start.noiDate) e.noiDate = 'Date of the Notice of Allowance is required';
      if (start.stage === 'published' && !start.publishedDate) e.publishedDate = 'Publication date is required';
      if (start.stage === 'registered' && !start.regDate) e.regDate = 'Registration date is required';
    }
    if (madrid) {
      if (!designation.irDate) e.irDate = 'International registration date is required';
      if (designation.stage === 'refusal') {
        if (!designation.refusalMailingDate) e.refusalMailingDate = 'Date on the refusal is required';
        if (!designation.refusalRespondBy) e.refusalRespondBy = 'The response date on the notice is required';
      }
      if (designation.stage === 'published' && !designation.publishedDate) e.publishedDate = 'Publication date is required';
      if (designation.stage === 'registered' && !designation.grantDate) e.grantDate = 'Date of the grant is required';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/trademark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mark: mark.trim(),
          type: type || null,
          classes,
          matterId,
          owner: owner.trim() || null,
          contactEmail: contactEmail.trim() || null,
          country: 'PH',
          ...(madrid
            ? { origin: 'madrid_in', designation }
            : { start: filed ? start : { stage: start.stage === 'for_filing' ? 'for_filing' : 'new' } }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setSuccess(true);
      const newId: string | undefined = data.trademark?.id;
      setTimeout(() => {
        onClose();
        if (newId) router.push(`/dashboard/trademarks/${newId}`);
      }, 900);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  const set = (patch: Partial<TrademarkStart>) => {
    setStart((p) => ({ ...p, ...patch }));
    setErrors((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !(k in patch))));
  };
  const at = START_STAGES.indexOf(start.stage);
  const from = (st: StartStage) => at >= START_STAGES.indexOf(st);
  const owesPublicationFee = !!start.filingDate && start.filingDate < PUBLICATION_FEE_UPFRONT_FROM;
  // The 3rd-year DAU is asked for only once it could have been filed: its deadline is near or past.
  const dau3 = dau3Deadline(start.filingDate ?? null);
  const askDau3 = !!dau3 && start.filingDate! <= addYears(manilaToday(), -2);
  const setD = (patch: Partial<DesignationStartInput>) => {
    setDesignation((p) => ({ ...p, ...patch }));
    setErrors((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !(k in patch))));
  };
  const dAt = DESIGNATION_STAGES.indexOf(designation.stage);
  const dFrom = (st: DesignationStage) => dAt >= DESIGNATION_STAGES.indexOf(st);
  const designatedOn = designation.designationDate ?? designation.irDate;
  const askDesignationDau3 = !!designatedOn && designatedOn <= addYears(manilaToday(), -2);
  const dField = (key: keyof DesignationStartInput, label: string, hint?: string) => (
    <div>
      <label className={LABEL}>{label}</label>
      <DatePickerInput
        value={(designation[key] as string | undefined) ?? null}
        onChange={(v) => setD({ [key]: v ?? undefined })}
        hasError={!!errors[key]}
      />
      {errors[key] ? <p className="text-xs text-red-500 mt-1">{errors[key]}</p> : hint && <p className="text-[11px] text-stone-400 dark:text-stone-500 mt-1">{hint}</p>}
    </div>
  );
  const dateField = (key: keyof TrademarkStart, label: string, hint?: string) => (
    <div>
      <label className={LABEL}>{label}</label>
      <DatePickerInput
        value={(start[key] as string | undefined) ?? null}
        onChange={(v) => set({ [key]: v ?? undefined })}
        hasError={!!errors[key]}
      />
      {errors[key] ? <p className="text-xs text-red-500 mt-1">{errors[key]}</p> : hint && <p className="text-[11px] text-stone-400 dark:text-stone-500 mt-1">{hint}</p>}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!submitting}
      title="New Trademark"
      description="Start tracking a mark — new, already before IPOPHL, or designated under the Madrid Protocol"
      icon={<Stamp className="w-4 h-4" />}
      footer={success ? undefined : (
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>{submitting ? 'Creating…' : 'Create Trademark'}</Button>
        </>
      )}
    >
        {success ? (
          <div className="px-6 py-14 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-500/10 ring-4 ring-emerald-100/60 dark:ring-emerald-500/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7 text-emerald-500" />
            </div>
            <p className="text-lg font-semibold text-stone-900 dark:text-stone-100">Trademark Created</p>
            <p className="text-sm text-stone-400 dark:text-stone-500 mt-1">Opening detail page…</p>
          </div>
        ) : (
            <div className="space-y-4">
              {/* Mark */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1.5">Mark</label>
                <input
                  autoFocus
                  type="text"
                  value={mark}
                  onChange={(e) => { setMark(e.target.value); if (errors.mark) setErrors((p) => ({ ...p, mark: '' })); }}
                  placeholder="Enter mark..."
                  className={`w-full px-3 py-2 text-sm text-stone-800 dark:text-stone-100 bg-stone-50/80 dark:bg-white/5 border rounded-lg placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 ${errors.mark ? 'border-red-400 focus:ring-red-400/20' : 'border-stone-200 dark:border-white/10 focus:ring-blue-400/20 focus:border-blue-400'}`}
                />
                {errors.mark && <p className="text-xs text-red-500 mt-1">{errors.mark}</p>}
              </div>

              {/* Type */}
              <div className="relative">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1.5">Type</label>
                <button
                  type="button"
                  onClick={() => setTypeOpen((o) => !o)}
                  className={`w-full flex items-center justify-between gap-1 px-3 py-2 text-sm rounded-lg cursor-pointer border ${typeOpen ? 'border-blue-400 ring-2 ring-blue-400/20 bg-white dark:bg-card' : 'border-stone-200 dark:border-white/10 bg-stone-50/80 dark:bg-white/5 hover:border-stone-300 dark:hover:border-white/15'}`}
                >
                  <span className={`truncate ${type ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}`}>{type || 'Select type'}</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-stone-400 dark:text-stone-500 shrink-0 ${typeOpen ? 'rotate-180' : ''}`} />
                </button>
                {typeOpen && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-lg shadow-lg py-0.5">
                    {TRADEMARK_TYPES.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => { setType(opt); setTypeOpen(false); }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left cursor-pointer ${type === opt ? 'text-blue-700 dark:text-blue-300 bg-blue-50/80 dark:bg-blue-500/10 font-medium' : 'text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-white/5'}`}
                      >
                        {opt}
                        {type === opt && <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Classes */}
              <div className="relative">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1.5">Class/es</label>
                <button
                  type="button"
                  onClick={() => setClassesOpen((o) => !o)}
                  className={`w-full flex items-center justify-between gap-1 px-3 py-2 text-sm rounded-lg cursor-pointer border ${classesOpen ? 'border-blue-400 ring-2 ring-blue-400/20 bg-white dark:bg-card' : 'border-stone-200 dark:border-white/10 bg-stone-50/80 dark:bg-white/5 hover:border-stone-300 dark:hover:border-white/15'}`}
                >
                  <span className={`truncate ${classes.length > 0 ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}`}>
                    {classes.length > 0 ? classes.join(', ') : 'Select classes (1–45)'}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-stone-400 dark:text-stone-500 shrink-0 ${classesOpen ? 'rotate-180' : ''}`} />
                </button>
                {classesOpen && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-lg shadow-lg py-2 px-2 max-h-60 overflow-y-auto">
                    <div className="grid grid-cols-9 gap-1">
                      {ALL_CLASSES.map((c) => {
                        const sel = classes.includes(c);
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setClasses((prev) => sel ? prev.filter((x) => x !== c) : [...prev, c].sort((a, b) => a - b))}
                            className={`px-1 py-1 text-[11px] font-mono rounded cursor-pointer transition-colors ${sel ? 'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-500/30' : 'bg-stone-50 dark:bg-white/5 text-stone-600 dark:text-stone-300 border border-stone-200 dark:border-white/10 hover:bg-stone-100 dark:hover:bg-white/10'}`}
                          >
                            {c}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Matter */}
              <div className="relative">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1.5">Matter</label>
                <button
                  type="button"
                  onClick={() => setMatterOpen((o) => !o)}
                  className={`w-full flex items-center justify-between gap-1 px-3 py-2 text-sm rounded-lg cursor-pointer border ${errors.matter ? 'border-red-400' : matterOpen ? 'border-blue-400 ring-2 ring-blue-400/20 bg-white dark:bg-card' : 'border-stone-200 dark:border-white/10 bg-stone-50/80 dark:bg-white/5 hover:border-stone-300 dark:hover:border-white/15'}`}
                >
                  <span className={`truncate ${selectedMatter ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}`}>
                    {selectedMatter ? `${selectedMatter.name} (${selectedMatter.code})` : 'Select matter'}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-stone-400 dark:text-stone-500 shrink-0 ${matterOpen ? 'rotate-180' : ''}`} />
                </button>
                {matterOpen && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-lg shadow-lg overflow-hidden">
                    <input
                      type="text"
                      value={matterSearch}
                      onChange={(e) => setMatterSearch(e.target.value)}
                      placeholder="Search matters..."
                      className="w-full px-3 py-2 text-sm border-b border-stone-100 dark:border-white/10 focus:outline-none"
                    />
                    <div className="max-h-52 overflow-y-auto py-0.5">
                      {filteredMatters.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-stone-400 dark:text-stone-500 text-center">No results</p>
                      ) : (
                        filteredMatters.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => { setMatterId(m.id); setMatterOpen(false); setErrors((p) => ({ ...p, matter: '' })); }}
                            className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer ${matterId === m.id ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 font-medium' : 'text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-white/5'}`}
                          >
                            <span>{m.name}</span>
                            {m.code && <span className="ml-1.5 font-mono text-stone-400 dark:text-stone-500">({m.code})</span>}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
                {errors.matter && <p className="text-xs text-red-500 mt-1">{errors.matter}</p>}
              </div>

              {/* Owner + Contact email */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1.5">Owner</label>
                  <input
                    type="text"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    placeholder="Owner name"
                    className="w-full px-3 py-2 text-sm text-stone-800 dark:text-stone-100 bg-stone-50/80 dark:bg-white/5 border border-stone-200 dark:border-white/10 rounded-lg placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-blue-400/20 focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1.5">Contact Email</label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="contact@example.com"
                    className="w-full px-3 py-2 text-sm text-stone-800 dark:text-stone-100 bg-stone-50/80 dark:bg-white/5 border border-stone-200 dark:border-white/10 rounded-lg placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-blue-400/20 focus:border-blue-400"
                  />
                </div>
              </div>


              {/* Where the mark is now */}
              <div>
                <label className={LABEL}>Where is it now?</label>
                <div className="inline-flex rounded-lg border border-stone-200 dark:border-white/10 overflow-hidden text-xs">
                  {([['new', 'Not yet filed'], ['filed', 'Already filed with IPOPHL'], ['madrid', 'Madrid designation']] as const).map(([v, l]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        setOrigin(v);
                        setStart({ stage: v === 'filed' ? 'examination' : 'new' });
                        setDesignation({ stage: 'examination' });
                        setErrors({});
                      }}
                      className={`px-3 py-1.5 cursor-pointer ${origin === v ? 'bg-blue-600 text-white' : 'text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/5'}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                {madrid ? (
                  <>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {DESIGNATION_STAGES.map((st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setD({ stage: st })}
                          className={`px-2.5 py-1 text-xs rounded-full border cursor-pointer ${designation.stage === st ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 font-medium' : 'border-stone-200 dark:border-white/10 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/5'}`}
                        >
                          {DESIGNATION_STAGE_LABELS[st]}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-stone-400 dark:text-stone-500 mt-1.5">
                      A foreign owner’s international registration that designates the Philippines, with the firm as local counsel before IPOPHL.
                    </p>
                  </>
                ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(filed ? FILED_STAGES : (['new', 'for_filing'] as StartStage[])).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => set({ stage: st })}
                      className={`px-2.5 py-1 text-xs rounded-full border cursor-pointer ${start.stage === st ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 font-medium' : 'border-stone-200 dark:border-white/10 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/5'}`}
                    >
                      {START_STAGE_LABELS[st]}
                    </button>
                  ))}
                </div>
                )}
                {filed && (
                  <p className="text-[11px] text-stone-400 dark:text-stone-500 mt-1.5">
                    Give the dates of the steps already taken — the deadlines count from them. Anything later is recorded on the mark’s page as usual.
                  </p>
                )}
              </div>

              {madrid && (
                <div className="space-y-3 rounded-xl border border-stone-200 dark:border-white/10 p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={LABEL}>International Registration No.</label>
                      <input type="text" value={designation.irNo ?? ''} onChange={(e) => setD({ irNo: e.target.value })} placeholder="1234567" className={INPUT} />
                    </div>
                    {dField('irDate', 'International registration date')}
                  </div>
                  {dField('designationDate', 'Philippines designated later on', 'Only if the Philippines was added after the international registration. The 3rd-year DAU counts from this date.')}
                  {designation.stage === 'refusal' && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        {dField('refusalMailingDate', 'Date on the refusal')}
                        {dField('refusalReceivedDate', 'Received on')}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {dField('refusalRespondBy', 'Respond by', 'As stated on the notice.')}
                        <div>
                          <label className={LABEL}>What it is</label>
                          <div className="inline-flex rounded-lg border border-stone-200 dark:border-white/10 overflow-hidden text-xs">
                            {([['provisional_refusal', 'Provisional'], ['final_rejection', 'Final']] as const).map(([k, l]) => (
                              <button
                                key={k}
                                type="button"
                                onClick={() => setD({ refusalKind: k })}
                                className={`px-2.5 py-1.5 cursor-pointer ${(designation.refusalKind ?? 'provisional_refusal') === k ? 'bg-stone-800 text-white dark:bg-white/15' : 'text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/5'}`}
                              >
                                {l}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                  {dFrom('published') && (
                    <div className="grid grid-cols-2 gap-3">
                      {dField('publishedDate', 'Published on', designation.stage === 'published' ? undefined : 'If known')}
                      {designation.stage === 'registered' && dField('grantDate', 'Protection granted on', 'The date on IPOPHL’s statement of grant.')}
                    </div>
                  )}
                  {askDesignationDau3 && dField('dau3FilingDate', '3rd-year DAU filed on', 'Leave blank if it hasn’t been filed.')}
                </div>
              )}

              {filed && (
                <div className="space-y-3 rounded-xl border border-stone-200 dark:border-white/10 p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={LABEL}>{start.stage === 'registered' ? 'Registration No.' : 'Application No.'}</label>
                      <input type="text" value={start.applicationNo ?? ''} onChange={(e) => set({ applicationNo: e.target.value })} placeholder="4-2025-500001" className={INPUT} />
                    </div>
                    {dateField('filingDate', 'Filing date')}
                  </div>
                  {start.stage === 'office_action' && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        {dateField('oaMailingDate', 'Date on the Office Action', 'Its response period counts from this date.')}
                        {dateField('oaReceivedDate', 'Received on')}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={LABEL}>What it is</label>
                          <div className="inline-flex rounded-lg border border-stone-200 dark:border-white/10 overflow-hidden text-xs">
                            {([['office_action', 'Office Action'], ['final_rejection', 'Final rejection']] as const).map(([k, l]) => (
                              <button
                                key={k}
                                type="button"
                                onClick={() => set({ oaKind: k })}
                                className={`px-2.5 py-1.5 cursor-pointer ${(start.oaKind ?? 'office_action') === k ? 'bg-stone-800 text-white dark:bg-white/15' : 'text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/5'}`}
                              >
                                {l}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className={LABEL}>Title</label>
                          <input type="text" value={start.oaTitle ?? ''} onChange={(e) => set({ oaTitle: e.target.value })} placeholder="Registrability Report" className={INPUT} />
                        </div>
                      </div>
                    </>
                  )}
                  {from('allowed') && (
                    <div className="grid grid-cols-2 gap-3">
                      {dateField('noiDate', 'Notice of Allowance', start.stage === 'allowed' ? undefined : 'If known')}
                      {owesPublicationFee && dateField('noiPaymentDate', '1st publication fee paid', 'Filed before 14 Feb 2023, so the fee was due on allowance.')}
                    </div>
                  )}
                  {from('published') && (
                    <div className="grid grid-cols-2 gap-3">
                      {dateField('publishedDate', 'Published on', start.stage === 'published' ? undefined : 'If known')}
                      {start.stage === 'registered' && dateField('regDate', 'Registration date', 'As printed on the certificate.')}
                    </div>
                  )}
                  {askDau3 && dateField('dau3FilingDate', '3rd-year DAU filed on', 'Leave blank if it hasn’t been filed.')}
                </div>
              )}

              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            </div>
        )}
    </Modal>
  );
}
