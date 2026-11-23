'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X, ChevronDown, Check, Calendar, Users, Scale, Building2,
  Search, CheckCircle2, FileText, Loader2,
} from 'lucide-react';
import DatePickerInput from './DatePickerInput';
import Avatar from './Avatar';
import { useEnumValues } from '@/hooks/use-enum-options';
import { FORMER_MEMBER } from '@/lib/former-member';

// ── Types ───────────────────────────────────────────────────────

interface PersonData { id: string; name: string; initials: string; position: string; avatarUrl?: string | null; }
interface MatterOption { id: string; name: string; code: string; clientId: string; teamPersonIds: string[]; }
interface ClientOption { id: string; name: string; }

/** The company or mark the work is for: the client is fixed, and only its matters are offered. */
export interface DeliverableSubject {
  id: string;
  name: string;
  matters: { id: string; name: string; code: string }[];
  defaultMatterId: string | null;
}

export interface CreatedDeliverableEntry {
  id: string;
  name: string;
  status: string;
  type: string;
  due: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  defaultDrafterId?: string | null;
  subject?: DeliverableSubject;
  onCreated?: (d: CreatedDeliverableEntry) => void;
}

const PRIORITIES = ['High', 'Medium', 'Low'] as const;

// ── Seniority helpers (mirrors AddFilingModal) ────────────────

const SENIORITY_ORDER = [
  'Founding Partner', 'Managing Partner', 'Monitoring Partner', 'Partner', 'Of Counsel',
  'Senior Associate', 'Mid-level Associate', 'Junior Associate', 'Underbar Associate',
];

function getSeniorityRank(position: string): number {
  const idx = SENIORITY_ORDER.indexOf(position);
  return idx >= 0 ? idx : SENIORITY_ORDER.length;
}

const JUNIOR_POSITIONS = new Set(['Junior Associate', 'Underbar Associate']);

function deriveRoles(teamPersonIds: string[], allLawyers: PersonData[]) {
  const members = teamPersonIds
    .map((id) => allLawyers.find((l) => l.id === id))
    .filter((l): l is PersonData => !!l)
    .map((l) => ({ ...l, rank: getSeniorityRank(l.position) }))
    .sort((a, b) => a.rank - b.rank);

  // Drafters: junior associates in the matter
  const drafters = members
    .filter((m) => JUNIOR_POSITIONS.has(m.position))
    .map((m) => m.id);

  // Reviewers: everyone above junior associates, least senior first (final reviewer = most senior)
  const reviewerIds = members
    .filter((m) => !JUNIOR_POSITIONS.has(m.position))
    .reverse()
    .map((m) => m.id);

  return { drafters, reviewerIds };
}

// ── Searchable Dropdown ─────────────────────────────────────────

function SearchableDropdown({
  label, icon: Icon, value, displayValue, placeholder, options,
  onSelect, onClear, getOptionLabel, getOptionSublabel,
}: {
  label: string; icon: React.ComponentType<{ className?: string }>; value: string | null;
  displayValue: string; placeholder: string; options: { id: string }[];
  onSelect: (id: string) => void; onClear?: () => void;
  getOptionLabel: (opt: { id: string }) => string; getOptionSublabel?: (opt: { id: string }) => string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (isOpen && buttonRef.current) { const r = buttonRef.current.getBoundingClientRect(); setDropdownPos({ top: r.bottom + 4, left: r.left, width: r.width }); } }, [isOpen]);
  useEffect(() => { if (!isOpen) return; function h(e: MouseEvent) { const t = e.target as Node; if (!buttonRef.current?.contains(t) && !dropdownRef.current?.contains(t)) { setIsOpen(false); setSearch(''); } } document.addEventListener('mousedown', h, true); return () => document.removeEventListener('mousedown', h, true); }, [isOpen]);
  useEffect(() => { if (isOpen) requestAnimationFrame(() => inputRef.current?.focus()); }, [isOpen]);

  const filtered = useMemo(() => { if (!search) return options; const q = search.toLowerCase(); return options.filter((o) => getOptionLabel(o).toLowerCase().includes(q) || (getOptionSublabel?.(o)?.toLowerCase() ?? '').includes(q)); }, [options, search, getOptionLabel, getOptionSublabel]);

  return (
    <div>
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500"><Icon className="w-3 h-3" />{label}</label>
      <button ref={buttonRef} type="button" onClick={() => setIsOpen((o) => !o)} className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${isOpen ? 'border-gold-400 ring-2 ring-gold-400/20 bg-white dark:bg-stone-900' : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 hover:bg-stone-50 dark:bg-stone-800 dark:border-stone-700 dark:hover:bg-stone-800 dark:hover:border-stone-600'}`}>
        <span className={`truncate ${value ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}`}>{displayValue || placeholder}</span>
        <div className="flex items-center gap-0.5 shrink-0">
          {value && onClear && <span role="button" onClick={(e) => { e.stopPropagation(); onClear(); setIsOpen(false); }} className="p-0.5 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 transition-colors dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"><X className="w-3 h-3" /></span>}
          <ChevronDown className={`w-3.5 h-3.5 text-stone-400 transition-transform duration-150 dark:text-stone-500 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {isOpen && dropdownPos && createPortal(
        <div ref={dropdownRef} className="fixed z-[100] bg-white border border-stone-200 rounded-lg shadow-lg shadow-stone-900/5 overflow-hidden animate-fade-down dark:bg-stone-900 dark:border-stone-700" style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}>
          <div className="p-2 border-b border-stone-100 dark:border-stone-800"><div className="flex items-center gap-2 px-2.5 py-1.5 bg-stone-50 rounded-md dark:bg-stone-800"><Search className="w-3.5 h-3.5 text-stone-400 shrink-0 dark:text-stone-500" /><input ref={inputRef} type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type to search..." className="flex-1 text-sm bg-transparent outline-none placeholder:text-stone-400 text-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500" /></div></div>
          <div className="max-h-44 overflow-y-auto py-0.5">
            {filtered.length === 0 ? <p className="px-3 py-4 text-sm text-stone-400 text-center dark:text-stone-500">No results found</p> : filtered.map((opt) => { const sel = opt.id === value; const sub = getOptionSublabel?.(opt); return (
              <button key={opt.id} type="button" onClick={() => { onSelect(opt.id); setIsOpen(false); setSearch(''); }} className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors duration-75 cursor-pointer ${sel ? 'text-gold-700 bg-gold-50/80 dark:bg-gold-500/10 dark:text-gold-300' : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'}`}>
                <div className="min-w-0"><span className={`truncate ${sel ? 'font-medium' : ''}`}>{getOptionLabel(opt)}</span>{sub && <span className={`text-xs ml-1.5 ${sel ? 'text-gold-500 dark:text-gold-400' : 'text-stone-400 dark:text-stone-500'}`}>{sub}</span>}</div>
                {sel && <Check className="w-3.5 h-3.5 text-gold-600 shrink-0 dark:text-gold-400" />}
              </button>
            ); })}
          </div>
        </div>, document.body)}
    </div>
  );
}

// ── Lawyer Multi-Select ─────────────────────────────────────────

function LawyerMultiSelect({ label, selectedIds, allLawyers, onAdd, onRemove, maxCount }: {
  label: string; selectedIds: string[]; allLawyers: PersonData[]; onAdd: (id: string) => void; onRemove: (id: string) => void; maxCount?: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (isOpen && buttonRef.current) { const r = buttonRef.current.getBoundingClientRect(); setDropdownPos({ top: r.bottom + 4, left: r.left, width: r.width }); } }, [isOpen]);
  useEffect(() => { if (!isOpen) return; function h(e: MouseEvent) { const t = e.target as Node; if (!buttonRef.current?.contains(t) && !dropdownRef.current?.contains(t)) { setIsOpen(false); setSearch(''); } } document.addEventListener('mousedown', h, true); return () => document.removeEventListener('mousedown', h, true); }, [isOpen]);
  useEffect(() => { if (isOpen) requestAnimationFrame(() => inputRef.current?.focus()); }, [isOpen]);

  const available = useMemo(() => { const s = new Set(selectedIds); let o = allLawyers.filter((l) => !s.has(l.id)); if (search) { const q = search.toLowerCase(); o = o.filter((l) => l.name.toLowerCase().includes(q) || l.initials.toLowerCase().includes(q)); } return o; }, [allLawyers, selectedIds, search]);
  const avatarColors = ['bg-gold-100 text-gold-700 dark:bg-gold-500/20 dark:text-gold-300', 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300', 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300', 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300', 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300'];
  const getDisplay = (id: string) => { const l = allLawyers.find((l) => l.id === id); return l ? { name: l.name, initials: l.initials, avatarUrl: l.avatarUrl ?? null } : { name: id.slice(0, 8), initials: '??', avatarUrl: null }; };
  const atMax = maxCount !== undefined && selectedIds.length >= maxCount;

  return (
    <div ref={containerRef}>
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500"><Users className="w-3 h-3" /> {label}</label>
      {selectedIds.length > 0 && (
        <div data-chips className="flex flex-wrap gap-1.5 mb-2">
          {selectedIds.map((id, idx) => { const { name, initials, avatarUrl } = getDisplay(id); return (
            <span key={id} className="inline-flex items-center gap-1.5 pl-1.5 pr-1 py-1 text-xs font-medium bg-stone-50 border border-stone-200/80 text-stone-700 rounded-full dark:bg-stone-800 dark:border-stone-700/80 dark:text-stone-200">
              <Avatar avatarUrl={avatarUrl} initials={initials} name={name} size={20} fallbackClassName={avatarColors[idx % avatarColors.length]} />
              <span className="truncate max-w-[100px]" title={name}>{name}</span>
              <button type="button" onClick={() => onRemove(id)} className="p-0.5 rounded-full text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer dark:text-stone-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"><X className="w-3 h-3" /></button>
            </span>
          ); })}
        </div>
      )}
      {!atMax && (
        <button ref={buttonRef} type="button" onClick={() => setIsOpen((o) => !o)} className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${isOpen ? 'border-gold-400 ring-2 ring-gold-400/20 bg-white dark:bg-stone-900' : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 hover:bg-stone-50 dark:bg-stone-800 dark:border-stone-700 dark:hover:bg-stone-800 dark:hover:border-stone-600'}`}>
          <span className="text-stone-400 dark:text-stone-500">Add {label.toLowerCase().replace(/s$/, '')}...</span>
          <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform duration-150 dark:text-stone-500 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      )}
      {isOpen && dropdownPos && createPortal(
        <div ref={dropdownRef} className="fixed z-[100] bg-white border border-stone-200 rounded-lg shadow-lg shadow-stone-900/5 overflow-hidden animate-fade-down dark:bg-stone-900 dark:border-stone-700" style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}>
          <div className="p-2 border-b border-stone-100 dark:border-stone-800"><div className="flex items-center gap-2 px-2.5 py-1.5 bg-stone-50 rounded-md dark:bg-stone-800"><Search className="w-3.5 h-3.5 text-stone-400 shrink-0 dark:text-stone-500" /><input ref={inputRef} type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="flex-1 text-sm bg-transparent outline-none placeholder:text-stone-400 text-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500" /></div></div>
          <div className="max-h-44 overflow-y-auto py-0.5">
            {available.length === 0 ? (
              allLawyers.length === 0
                ? <p className="px-3 py-4 text-sm text-stone-400 inline-flex items-center justify-center gap-2 w-full dark:text-stone-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Loading…</span></p>
                : <p className="px-3 py-4 text-sm text-stone-400 text-center dark:text-stone-500">No lawyers found</p>
            ) : available.map((l) => (
              <button key={l.id} type="button" onClick={() => { onAdd(l.id); setSearch(''); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-stone-700 hover:bg-stone-50 transition-colors cursor-pointer dark:text-stone-200 dark:hover:bg-stone-800">
                <Avatar avatarUrl={l.avatarUrl} initials={l.initials} name={l.name} size={24} fallbackClassName="bg-gold-100 text-gold-700 dark:bg-gold-500/20 dark:text-gold-300" />
                <span>{l.name}</span>
              </button>
            ))}
          </div>
        </div>, document.body)}
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────

export default function AddDeliverableModal({ open, onClose, defaultDrafterId, subject, onCreated }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('Internal');
  const deliverableTypes = useEnumValues('deliverables', 'type');
  const [subtype, setSubtype] = useState<string>('');
  const deliverableSubtypes = useEnumValues('deliverables', 'subtype');
  const [priority, setPriority] = useState('');
  const [externalDueDate, setExternalDueDate] = useState('');
  const [drafterIds, setDrafterIds] = useState<string[]>([]);
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [reviewDates, setReviewDates] = useState<(string | null)[]>([]);
  const [matterId, setMatterId] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);

  const [allClients, setAllClients] = useState<ClientOption[]>([]);
  const [allMatters, setAllMatters] = useState<MatterOption[]>([]);
  const [allLawyers, setAllLawyers] = useState<PersonData[]>([]);

  const [typeOpen, setTypeOpen] = useState(false);
  const [subtypeOpen, setSubtypeOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const typeButtonRef = useRef<HTMLButtonElement>(null);
  const typeDropdownRef = useRef<HTMLDivElement>(null);
  const subtypeButtonRef = useRef<HTMLButtonElement>(null);
  const subtypeDropdownRef = useRef<HTMLDivElement>(null);
  const priorityButtonRef = useRef<HTMLButtonElement>(null);
  const priorityDropdownRef = useRef<HTMLDivElement>(null);

  // Reset form
  useEffect(() => {
    if (open) {
      setName('');
      setType('Internal');
      setSubtype('');
      setPriority('');
      setExternalDueDate('');
      setDrafterIds(defaultDrafterId ? [defaultDrafterId] : []);
      setReviewerIds([]);
      setReviewDates([]);
      setMatterId(subject?.defaultMatterId ?? subject?.matters[0]?.id ?? null);
      setClientId(null);
      setSuccess(false);
      setError('');
      setErrors({});
    }
    // Keyed on the subject's id: a parent re-rendering a new object mustn't wipe the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDrafterId, subject?.id]);

  // Fetch dropdown data
  useEffect(() => {
    if (!open) return;
    fetch('/api/clients-matters').then((r) => r.json()).then((d) => { setAllClients(d.clients ?? []); setAllMatters(d.matters ?? []); }).catch(() => {});
    fetch('/api/people?role=lawyers').then((r) => r.json()).then((d) => {
      setAllLawyers((d.people ?? []).map((p: { person_id: string; name: string; initials: string; position?: string; avatar_url?: string | null }) => ({
        id: p.person_id, name: p.name, initials: p.initials, position: p.position ?? '', avatarUrl: p.avatar_url ?? null,
      })));
    }).catch(() => {});
  }, [open]);

  useEffect(() => { if (!open) return; function h(e: KeyboardEvent) { if (e.key === 'Escape' && !submitting) onClose(); } window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [open, onClose, submitting]);
  useEffect(() => { if (!typeOpen) return; function h(e: MouseEvent) { const t = e.target as Node; if (!typeButtonRef.current?.contains(t) && !typeDropdownRef.current?.contains(t)) setTypeOpen(false); } document.addEventListener('mousedown', h, true); return () => document.removeEventListener('mousedown', h, true); }, [typeOpen]);
  useEffect(() => { if (!subtypeOpen) return; function h(e: MouseEvent) { const t = e.target as Node; if (!subtypeButtonRef.current?.contains(t) && !subtypeDropdownRef.current?.contains(t)) setSubtypeOpen(false); } document.addEventListener('mousedown', h, true); return () => document.removeEventListener('mousedown', h, true); }, [subtypeOpen]);
  useEffect(() => { if (!priorityOpen) return; function h(e: MouseEvent) { const t = e.target as Node; if (!priorityButtonRef.current?.contains(t) && !priorityDropdownRef.current?.contains(t)) setPriorityOpen(false); } document.addEventListener('mousedown', h, true); return () => document.removeEventListener('mousedown', h, true); }, [priorityOpen]);

  const subjectMatters = useMemo<MatterOption[] | null>(
    () => subject?.matters.map((m) => ({ ...m, clientId: '', teamPersonIds: allMatters.find((x) => x.id === m.id)?.teamPersonIds ?? [] })) ?? null,
    [subject, allMatters],
  );
  const filteredMatters = useMemo(
    () => subjectMatters ?? (clientId ? allMatters.filter((m) => m.clientId === clientId) : allMatters),
    [subjectMatters, allMatters, clientId],
  );
  const selectedMatter = (subjectMatters ?? allMatters).find((m) => m.id === matterId);
  const selectedClient = allClients.find((c) => c.id === clientId);

  const handleMatterSelect = useCallback((id: string) => {
    setMatterId(id);
    setErrors((p) => ({ ...p, matter: '' }));
    const matter = allMatters.find((m) => m.id === id);
    if (matter?.clientId) setClientId(matter.clientId);
    // Auto-derive roles from matter team
    if (matter?.teamPersonIds?.length && allLawyers.length > 0) {
      const roles = deriveRoles(matter.teamPersonIds, allLawyers);
      if (roles.drafters.length > 0) setDrafterIds(roles.drafters);
      if (roles.reviewerIds.length > 0) {
        setReviewerIds(roles.reviewerIds);
        setReviewDates(roles.reviewerIds.map(() => null));
      }
    }
  }, [allMatters, allLawyers]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Deliverable name is required';
    if (!type) e.type = 'Type is required';
    if (!matterId) e.matter = 'Matter is required';
    if (drafterIds.length === 0) e.drafter = 'At least one drafter is required';
    if (reviewerIds.length === 0) e.reviewer = 'At least one reviewer is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/deliverable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          matterId,
          type,
          subtype: subtype || null,
          priority: priority || null,
          externalDueDate: externalDueDate || null,
          drafterIds,
          reviewerIds,
          reviewDates,
          subjectId: subject?.id ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed');
      if (data.deliverable) {
        onCreated?.({ id: data.deliverable.notion_id, name: data.deliverable.name, status: data.deliverable.status, type, due: externalDueDate || null });
      }
      setSuccess(true);
      setTimeout(() => onClose(), 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-overlay" onClick={submitting ? undefined : onClose} />
      <div className="relative overflow-hidden bg-white rounded-2xl shadow-2xl shadow-stone-900/10 w-full max-w-md animate-dialog ring-1 ring-stone-900/5 dark:bg-stone-900">
        <div className="relative px-5 pt-5 pb-4">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-400 via-purple-500 to-violet-400" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-500/10 dark:to-purple-500/20 flex items-center justify-center ring-1 ring-purple-200/60 dark:ring-purple-500/20">
                <FileText className="w-4.5 h-4.5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-stone-900 leading-tight dark:text-stone-100">New Deliverable</h2>
                <p className="text-xs text-stone-400 mt-0.5 dark:text-stone-500">{subject ? `For ${subject.name}` : 'Create a new deliverable'}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} disabled={submitting} className="p-1.5 -mr-1 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors cursor-pointer disabled:opacity-50 dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"><X className="w-4.5 h-4.5" /></button>
          </div>
        </div>

        {success ? (
          <div className="px-6 py-14 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 ring-4 ring-emerald-100/60 dark:ring-emerald-500/20 flex items-center justify-center mx-auto mb-4 animate-scale-in dark:bg-emerald-500/10"><CheckCircle2 className="w-7 h-7 text-emerald-500 dark:text-emerald-400" /></div>
            <p className="text-lg font-semibold text-stone-900 dark:text-stone-100">Deliverable Created</p>
            <p className="text-sm text-stone-400 mt-1 dark:text-stone-500">Your new deliverable has been created.</p>
          </div>
        ) : (
          <>
            <div className="px-5 pb-5 space-y-4 max-h-[62vh] overflow-y-auto">
              {/* Name */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">Deliverable Name</label>
                <input type="text" value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((p) => ({ ...p, name: '' })); }} autoFocus placeholder="Enter deliverable name..." className={`w-full px-3 py-2 text-sm text-stone-800 bg-stone-50/80 border rounded-lg placeholder:text-stone-400 focus:outline-none focus:ring-2 transition-all duration-150 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500 ${errors.name ? 'border-red-400 focus:ring-red-400/20' : 'border-stone-200 focus:ring-purple-400/20 focus:border-purple-400 dark:border-stone-700'}`} />
                {errors.name && <p className="text-xs text-red-500 mt-1 dark:text-red-400">{errors.name}</p>}
              </div>

              {/* Type + Priority row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="relative">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">Type</label>
                  <button ref={typeButtonRef} type="button" onClick={() => setTypeOpen((o) => !o)} className={`w-full flex items-center justify-between gap-1 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${typeOpen ? 'border-purple-400 ring-2 ring-purple-400/20 bg-white dark:bg-stone-900' : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 dark:bg-stone-800 dark:border-stone-700 dark:hover:border-stone-600'}`}>
                    <span className="truncate text-stone-800 dark:text-stone-100">{type || 'Select'}</span>
                    <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform duration-150 dark:text-stone-500 ${typeOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {typeOpen && (
                    <div ref={typeDropdownRef} className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg py-0.5 max-h-52 overflow-y-auto animate-fade-down dark:bg-stone-900 dark:border-stone-700">
                      {deliverableTypes.map((opt) => (
                        <button key={opt} type="button" onClick={() => { setType(opt); setTypeOpen(false); }} className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors cursor-pointer ${type === opt ? 'text-purple-700 bg-purple-50/80 font-medium dark:text-purple-300' : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'}`}>
                          {opt}
                          {type === opt && <Check className="w-3.5 h-3.5 text-purple-600 shrink-0 dark:text-purple-400" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">Priority</label>
                  <button ref={priorityButtonRef} type="button" onClick={() => setPriorityOpen((o) => !o)} className={`w-full flex items-center justify-between gap-1 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${priorityOpen ? 'border-purple-400 ring-2 ring-purple-400/20 bg-white dark:bg-stone-900' : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 dark:bg-stone-800 dark:border-stone-700 dark:hover:border-stone-600'}`}>
                    <span className={`truncate ${priority ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}`}>{priority || 'Select'}</span>
                    <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform duration-150 dark:text-stone-500 ${priorityOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {priorityOpen && (
                    <div ref={priorityDropdownRef} className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg py-0.5 max-h-52 overflow-y-auto animate-fade-down dark:bg-stone-900 dark:border-stone-700">
                      {PRIORITIES.map((opt) => (
                        <button key={opt} type="button" onClick={() => { setPriority(opt); setPriorityOpen(false); }} className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors cursor-pointer ${priority === opt ? 'text-purple-700 bg-purple-50/80 font-medium dark:text-purple-300' : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'}`}>
                          {opt}
                          {priority === opt && <Check className="w-3.5 h-3.5 text-purple-600 shrink-0 dark:text-purple-400" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Subtype (pleading type) */}
              <div className="relative">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">Subtype</label>
                <button ref={subtypeButtonRef} type="button" onClick={() => setSubtypeOpen((o) => !o)} className={`w-full flex items-center justify-between gap-1 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${subtypeOpen ? 'border-purple-400 ring-2 ring-purple-400/20 bg-white dark:bg-stone-900' : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 dark:bg-stone-800 dark:border-stone-700 dark:hover:border-stone-600'}`}>
                  <span className={`truncate ${subtype ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}`}>{subtype || 'Select pleading type (optional)'}</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform duration-150 dark:text-stone-500 ${subtypeOpen ? 'rotate-180' : ''}`} />
                </button>
                {subtypeOpen && (
                  <div ref={subtypeDropdownRef} className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg py-0.5 max-h-52 overflow-y-auto animate-fade-down dark:bg-stone-900 dark:border-stone-700">
                    {subtype && (
                      <button type="button" onClick={() => { setSubtype(''); setSubtypeOpen(false); }} className="w-full px-3 py-2 text-sm text-left text-stone-400 hover:bg-stone-50 transition-colors cursor-pointer dark:text-stone-500 dark:hover:bg-stone-800">Clear</button>
                    )}
                    {deliverableSubtypes.map((opt) => (
                      <button key={opt} type="button" onClick={() => { setSubtype(opt); setSubtypeOpen(false); }} className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors cursor-pointer ${subtype === opt ? 'text-purple-700 bg-purple-50/80 font-medium dark:text-purple-300' : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'}`}>
                        {opt}
                        {subtype === opt && <Check className="w-3.5 h-3.5 text-purple-600 shrink-0 dark:text-purple-400" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Due Date */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500"><Calendar className="w-3 h-3" /> Deadline</label>
                <DatePickerInput value={externalDueDate || null} onChange={(v) => setExternalDueDate(v ?? '')} placeholder="Select due date" />
              </div>

              <div className="border-t border-stone-100 dark:border-stone-800" />

              {/* Client + Matter */}
              {!subject && <SearchableDropdown
                label="Client" icon={Building2} value={clientId} displayValue={selectedClient?.name ?? ''}
                placeholder="Select client" options={allClients}
                onSelect={(id) => { setClientId(id); if (matterId) { const m = allMatters.find((m) => m.id === matterId); if (m && m.clientId !== id) setMatterId(null); } }}
                onClear={() => { setClientId(null); setMatterId(null); }}
                getOptionLabel={(o) => (o as ClientOption).name}
              />}
              <div>
                <SearchableDropdown
                  label="Matter" icon={Scale} value={matterId} displayValue={selectedMatter ? `${selectedMatter.name}${selectedMatter.code ? ` (${selectedMatter.code})` : ''}` : ''}
                  placeholder={subject || clientId ? 'Select matter' : 'Select a client first'} options={filteredMatters}
                  onSelect={handleMatterSelect} onClear={() => setMatterId(null)}
                  getOptionLabel={(o) => (o as MatterOption).name}
                  getOptionSublabel={(o) => (o as MatterOption).code || ''}
                />
                {errors.matter && <p className="text-xs text-red-500 mt-1 dark:text-red-400">{errors.matter}</p>}
              </div>

              <div className="border-t border-stone-100 dark:border-stone-800" />

              {/* Drafters */}
              <LawyerMultiSelect
                label="Drafters"
                selectedIds={drafterIds}
                allLawyers={allLawyers}
                onAdd={(id) => { if (!drafterIds.includes(id)) { setDrafterIds((prev) => [...prev, id]); if (errors.drafter) setErrors((p) => ({ ...p, drafter: '' })); } }}
                onRemove={(id) => setDrafterIds((prev) => prev.filter((p) => p !== id))}
              />
              {errors.drafter && <p className="text-xs text-red-500 -mt-2 dark:text-red-400">{errors.drafter}</p>}

              {/* Reviewers (up to 5) */}
              <LawyerMultiSelect
                label="Reviewers"
                selectedIds={reviewerIds}
                allLawyers={allLawyers}
                maxCount={5}
                onAdd={(id) => {
                  if (!reviewerIds.includes(id) && reviewerIds.length < 5) {
                    setReviewerIds((prev) => [...prev, id]);
                    setReviewDates((prev) => [...prev, null]);
                    if (errors.reviewer) setErrors((p) => ({ ...p, reviewer: '' }));
                  }
                }}
                onRemove={(id) => {
                  const idx = reviewerIds.indexOf(id);
                  setReviewerIds((prev) => prev.filter((p) => p !== id));
                  setReviewDates((prev) => { const n = [...prev]; n.splice(idx, 1); return n; });
                }}
              />
              {errors.reviewer && <p className="text-xs text-red-500 -mt-2 dark:text-red-400">{errors.reviewer}</p>}

              {/* Per-reviewer dates */}
              {reviewerIds.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] text-stone-400 -mt-1 dark:text-stone-500">
                    {reviewerIds.length === 1
                      ? 'Single reviewer'
                      : `${reviewerIds.length} reviewers: ${reviewerIds.map((id, i) => {
                          const total = reviewerIds.length;
                          const label = total === 1 ? 'Reviewer' : i === 0 ? 'Initial' : i === total - 1 ? 'Final' : ['2nd', '3rd', '4th'][i - 1];
                          const nm = allLawyers.find((l) => l.id === id)?.initials ?? FORMER_MEMBER;
                          return `${label} (${nm})`;
                        }).join(' \u2192 ')}`}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {reviewerIds.map((rid, idx) => {
                      const total = reviewerIds.length;
                      const label = total === 1 ? 'Review Date' : idx === 0 ? 'Initial Review' : idx === total - 1 ? 'Final Review' : `${['2nd', '3rd', '4th'][idx - 1]} Review`;
                      const dateVal = reviewDates[idx] ?? '';
                      return (
                        <div key={rid}>
                          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
                            <Calendar className="w-3 h-3" /> {label}
                          </label>
                          <DatePickerInput
                            value={dateVal || null}
                            onChange={(v) => {
                              setReviewDates((prev) => {
                                const n = [...prev];
                                while (n.length < reviewerIds.length) n.push(null);
                                n[idx] = v ?? null;
                                return n;
                              });
                            }}
                            placeholder="Select date"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200/60 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                  <X className="w-4 h-4 text-red-400 shrink-0 mt-0.5" /><span>{error}</span>
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-stone-100 bg-stone-50/60 flex items-center justify-end gap-2.5 dark:bg-stone-800/40 dark:border-stone-800">
              <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 text-sm font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer disabled:opacity-50 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200">Cancel</button>
              <button type="button" onClick={handleSubmit} disabled={submitting} className="px-5 py-2 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-sm shadow-purple-600/20 transition-all cursor-pointer disabled:opacity-40 disabled:shadow-none">
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Creating...
                  </span>
                ) : 'Create Deliverable'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
