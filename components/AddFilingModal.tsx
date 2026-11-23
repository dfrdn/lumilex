'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X, ChevronDown, ChevronLeft, ChevronRight, Check, Calendar, Users, Scale, Building2,
  Search, CheckCircle2, Gavel, Link2,
} from 'lucide-react';
import Avatar from './Avatar';
import { FORMER_MEMBER } from '@/lib/former-member';

// ── Types ───────────────────────────────────────────────────────

export interface FilingPrefill {
  name: string;
  matterId: string | null;
  matterName: string;
  fileName: string;
  dateReceived: string | null; // YYYY-MM-DD
}

interface PersonData {
  id: string;
  name: string;
  initials: string;
  position: string;
  avatarUrl?: string | null;
}

// ── Seniority helpers (mirrors lib/queries/team-roles.ts) ────

const SENIORITY_ORDER = [
  'Founding Partner', 'Managing Partner', 'Monitoring Partner', 'Partner', 'Of Counsel',
  'Senior Associate', 'Mid-level Associate', 'Junior Associate', 'Underbar Associate',
];
const PARTNER_POSITIONS = new Set(SENIORITY_ORDER.slice(0, 5));

function getSeniorityRank(position: string): number {
  const idx = SENIORITY_ORDER.indexOf(position);
  return idx >= 0 ? idx : SENIORITY_ORDER.length;
}

function deriveRoles(teamPersonIds: string[], allLawyers: PersonData[]) {
  const members = teamPersonIds
    .map((id) => allLawyers.find((l) => l.id === id))
    .filter((l): l is PersonData => !!l)
    .map((l) => ({ ...l, rank: getSeniorityRank(l.position) }))
    .sort((a, b) => a.rank - b.rank);

  const associates = members.filter((m) => !PARTNER_POSITIONS.has(m.position));

  // Drafters: junior associates (lowest seniority)
  let drafters: string[] = [];
  if (associates.length > 0) {
    const lowestRank = Math.max(...associates.map((a) => a.rank));
    drafters = associates.filter((a) => a.rank === lowestRank).map((a) => a.id);
  }

  // Build reviewer chain: initial (most senior associate) → final (most senior partner)
  const reviewers: string[] = [];
  if (associates.length > 1) reviewers.push(associates[0].id); // initial reviewer
  const seniorPartner = members.find((m) => PARTNER_POSITIONS.has(m.position));
  if (seniorPartner) reviewers.push(seniorPartner.id); // final reviewer

  return { drafters, reviewerIds: reviewers };
}

interface MatterOption {
  id: string;
  name: string;
  code: string;
  clientId: string;
  teamPersonIds: string[];
  type: string;
}

interface CourtRuleSet {
  id: string;
  name: string;
  triggerEventLabel: string;
  deadlines: { id: string; label: string; daysFromTrigger: number; calendarType: string; isReglementary: boolean }[];
}

interface ClientOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  prefill: FilingPrefill | null;
  /** Fires when the deliverable is created successfully, before the auto-close
   *  timeout. The inbox uses this to keep the file-action claim instead of
   *  releasing it on close. */
  onSaved?: () => void;
}

const DELIVERABLE_TYPES = ['Internal', 'External', 'For Client'] as const;

// ── Date helpers ────────────────────────────────────────────────

function skipWeekend(d: Date): Date {
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() + 2);
  if (day === 0) d.setDate(d.getDate() + 1);
  return d;
}

function addDays(base: string, days: number): string {
  const d = new Date(base + 'T00:00:00');
  d.setDate(d.getDate() + days);
  skipWeekend(d);
  return d.toLocaleDateString('en-CA');
}

function formatShort(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
  });
}

type DateOption = { label: string; value: string; key: string };

function getDeadlineOptions(dateReceived: string | null): DateOption[] {
  if (!dateReceived) {
    const today = new Date().toLocaleDateString('en-CA');
    return [{ label: 'Today', value: today, key: 'today' }];
  }
  const receipt = addDays(dateReceived, 0);
  return [
    { label: `From receipt (${formatShort(receipt)})`, value: receipt, key: 'receipt' },
    { label: `5 days (${formatShort(addDays(dateReceived, 5))})`, value: addDays(dateReceived, 5), key: '5' },
    { label: `10 days (${formatShort(addDays(dateReceived, 10))})`, value: addDays(dateReceived, 10), key: '10' },
    { label: `15 days (${formatShort(addDays(dateReceived, 15))})`, value: addDays(dateReceived, 15), key: '15' },
    { label: `30 days (${formatShort(addDays(dateReceived, 30))})`, value: addDays(dateReceived, 30), key: '30' },
    { label: 'Custom', value: '', key: 'custom' },
  ];
}

// ── Searchable Dropdown ─────────────────────────────────────────

function SearchableDropdown({
  label,
  icon: Icon,
  value,
  displayValue,
  placeholder,
  options,
  onSelect,
  onClear,
  getOptionLabel,
  getOptionSublabel,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string | null;
  displayValue: string;
  placeholder: string;
  options: { id: string }[];
  onSelect: (id: string) => void;
  onClear?: () => void;
  getOptionLabel: (opt: { id: string }) => string;
  getOptionSublabel?: (opt: { id: string }) => string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter((o) => {
      const label = getOptionLabel(o).toLowerCase();
      const sub = getOptionSublabel?.(o)?.toLowerCase() ?? '';
      return label.includes(q) || sub.includes(q);
    });
  }, [options, search, getOptionLabel, getOptionSublabel]);

  return (
    <div ref={ref} className="relative">
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
        <Icon className="w-3 h-3" />
        {label}
      </label>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${
          isOpen ? 'border-purple-400 ring-2 ring-purple-400/20 bg-white dark:bg-stone-900' : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 hover:bg-stone-50 dark:bg-stone-800 dark:border-stone-700 dark:hover:bg-stone-800 dark:hover:border-stone-600'
        }`}
      >
        <span className={`truncate ${value ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}`}>{displayValue || placeholder}</span>
        <div className="flex items-center gap-0.5 shrink-0">
          {value && onClear && (
            <span role="button" onClick={(e) => { e.stopPropagation(); onClear(); setIsOpen(false); }} className="p-0.5 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 transition-colors dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-300">
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-stone-400 transition-transform duration-150 dark:text-stone-500 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {isOpen && dropdownPos && createPortal(
        <div ref={dropdownRef} className="fixed z-[100] bg-white border border-stone-200 rounded-lg shadow-lg shadow-stone-900/5 overflow-hidden animate-fade-down dark:bg-stone-900 dark:border-stone-700" style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}>
          <div className="p-2 border-b border-stone-100 dark:border-stone-800">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-stone-50 rounded-md dark:bg-stone-800">
              <Search className="w-3.5 h-3.5 text-stone-400 shrink-0 dark:text-stone-500" />
              <input ref={inputRef} type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type to search..." className="flex-1 text-sm bg-transparent outline-none placeholder:text-stone-400 text-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500" />
            </div>
          </div>
          <div className="max-h-44 overflow-y-auto py-0.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-stone-400 text-center dark:text-stone-500">No results found</p>
            ) : filtered.map((opt) => {
              const isSelected = opt.id === value;
              const sub = getOptionSublabel?.(opt);
              return (
                <button key={opt.id} type="button" onClick={() => { onSelect(opt.id); setIsOpen(false); setSearch(''); }} className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors duration-75 cursor-pointer ${isSelected ? 'text-purple-700 bg-purple-50/80 dark:bg-purple-500/10 dark:text-purple-300' : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'}`}>
                  <div className="min-w-0">
                    <span className={`truncate ${isSelected ? 'font-medium' : ''}`}>{getOptionLabel(opt)}</span>
                    {sub && <span className={`text-xs ml-1.5 ${isSelected ? 'text-purple-500' : 'text-stone-400 dark:text-stone-500'}`}>{sub}</span>}
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-purple-600 shrink-0 dark:text-purple-400" />}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── Lawyer Multi-Select ─────────────────────────────────────────

function LawyerMultiSelect({
  label,
  selectedIds,
  allLawyers,
  onAdd,
  onRemove,
}: {
  label: string;
  selectedIds: string[];
  allLawyers: PersonData[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const chipsArea = containerRef.current?.querySelector('[data-multiselect-chips]');
      const insideButton = buttonRef.current?.contains(target) ?? false;
      const insideChips = chipsArea?.contains(target) ?? false;
      const insideDropdown = dropdownRef.current?.contains(target) ?? false;
      if (!insideButton && !insideChips && !insideDropdown) {
        setIsOpen(false); setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [isOpen]);

  useEffect(() => { if (isOpen) requestAnimationFrame(() => inputRef.current?.focus()); }, [isOpen]);

  const available = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    let opts = allLawyers.filter((l) => !selectedSet.has(l.id));
    if (search) {
      const q = search.toLowerCase();
      opts = opts.filter((l) => l.name.toLowerCase().includes(q) || l.initials.toLowerCase().includes(q));
    }
    return opts;
  }, [allLawyers, selectedIds, search]);

  const avatarColors = ['bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300', 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300', 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300', 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300', 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300'];

  const getDisplay = (id: string) => {
    const l = allLawyers.find((l) => l.id === id);
    return l ? { name: l.name, initials: l.initials, avatarUrl: l.avatarUrl ?? null } : { name: id.slice(0, 8), initials: '??', avatarUrl: null };
  };

  return (
    <div ref={containerRef}>
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
        <Users className="w-3 h-3" /> {label}
      </label>
      {selectedIds.length > 0 && (
        <div data-multiselect-chips className="flex flex-wrap gap-1.5 mb-2">
          {selectedIds.map((id, idx) => {
            const { name, initials, avatarUrl } = getDisplay(id);
            return (
              <span key={id} className="inline-flex items-center gap-1.5 pl-1.5 pr-1 py-1 text-xs font-medium bg-stone-50 border border-stone-200/80 text-stone-700 rounded-full dark:bg-stone-800 dark:border-stone-700/80 dark:text-stone-200">
                <Avatar avatarUrl={avatarUrl} initials={initials} name={name} size={20} fallbackClassName={avatarColors[idx % avatarColors.length]} />
                <span className="truncate max-w-[100px]" title={name}>{name}</span>
                <button type="button" onClick={() => onRemove(id)} className="p-0.5 rounded-full text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer dark:text-stone-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"><X className="w-3 h-3" /></button>
              </span>
            );
          })}
        </div>
      )}
      <button ref={buttonRef} type="button" onClick={() => setIsOpen((o) => !o)} className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${isOpen ? 'border-purple-400 ring-2 ring-purple-400/20 bg-white dark:bg-stone-900' : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 hover:bg-stone-50 dark:bg-stone-800 dark:border-stone-700 dark:hover:bg-stone-800 dark:hover:border-stone-600'}`}>
        <span className="text-stone-400 dark:text-stone-500">Add {label.toLowerCase()}...</span>
        <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform duration-150 dark:text-stone-500 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && dropdownPos && createPortal(
        <div ref={dropdownRef} className="fixed z-[100] bg-white border border-stone-200 rounded-lg shadow-lg shadow-stone-900/5 overflow-hidden animate-fade-down dark:bg-stone-900 dark:border-stone-700" style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}>
          <div className="p-2 border-b border-stone-100 dark:border-stone-800">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-stone-50 rounded-md dark:bg-stone-800">
              <Search className="w-3.5 h-3.5 text-stone-400 shrink-0 dark:text-stone-500" />
              <input ref={inputRef} type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="flex-1 text-sm bg-transparent outline-none placeholder:text-stone-400 text-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500" />
            </div>
          </div>
          <div className="max-h-44 overflow-y-auto py-0.5">
            {available.length === 0 ? (
              <p className="px-3 py-4 text-sm text-stone-400 text-center dark:text-stone-500">{allLawyers.length === 0 ? 'Loading...' : 'No results'}</p>
            ) : available.map((l) => (
              <button key={l.id} type="button" onClick={() => { onAdd(l.id); setSearch(''); setIsOpen(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-stone-700 hover:bg-stone-50 transition-colors cursor-pointer dark:text-stone-200 dark:hover:bg-stone-800">
                <Avatar avatarUrl={l.avatarUrl} initials={l.initials} name={l.name} size={24} fallbackClassName="bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300" />
                <span>{l.name}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────

export default function AddFilingModal({ open, onClose, prefill, onSaved }: Props) {
  const [name, setName] = useState('');
  const [deliverableType, setDeliverableType] = useState<string>('External');
  const [typeOpen, setTypeOpen] = useState(false);

  // Deadline (filing date with smart options)
  const [selectedDateKey, setSelectedDateKey] = useState('15');
  const [customDate, setCustomDate] = useState('');
  const [dateDropOpen, setDateDropOpen] = useState(false);

  // People
  const [drafterIds, setDrafterIds] = useState<string[]>([]);
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [reviewDates, setReviewDates] = useState<(string | null)[]>([]);

  // Matter
  const [matterId, setMatterId] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);

  // Reference data
  const [allClients, setAllClients] = useState<ClientOption[]>([]);
  const [allMatters, setAllMatters] = useState<MatterOption[]>([]);
  const [allLawyers, setAllLawyers] = useState<PersonData[]>([]);

  const [openDatePicker, setOpenDatePicker] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  // Court rule integration
  const [courtRules, setCourtRules] = useState<CourtRuleSet[]>([]);
  const [selectedRuleSetId, setSelectedRuleSetId] = useState<string | null>(null);
  const [ruleDropOpen, setRuleDropOpen] = useState(false);
  const [chainCreated, setChainCreated] = useState(false);

  const typeRef = useRef<HTMLDivElement>(null);
  const typeButtonRef = useRef<HTMLButtonElement>(null);
  const typeDropdownRef = useRef<HTMLDivElement>(null);
  const ruleDropRef = useRef<HTMLDivElement>(null);
  const ruleDropButtonRef = useRef<HTMLButtonElement>(null);
  const ruleDropdownRef = useRef<HTMLDivElement>(null);

  const dateOptions = useMemo(
    () => getDeadlineOptions(prefill?.dateReceived ?? null),
    [prefill?.dateReceived],
  );
  const selectedOption = dateOptions.find((o) => o.key === selectedDateKey);
  const deadline = selectedDateKey === 'custom' ? customDate : (selectedOption?.value ?? '');

  // Reset on open
  useEffect(() => {
    if (open && prefill) {
      setName(prefill.name);
      setDeliverableType('External');
      setSelectedDateKey('15');
      setCustomDate('');
      setDrafterIds([]);
      setReviewerIds([]);
      setReviewDates([]);
      setMatterId(prefill.matterId);
      setClientId(null);
      setSuccess(false);
      setError('');
      setSelectedRuleSetId(null);
      setChainCreated(false);
    }
  }, [open, prefill]);

  // Fetch dropdown data
  useEffect(() => {
    if (!open) return;
    fetch('/api/clients-matters')
      .then((res) => res.json())
      .then((data) => {
        setAllClients(data.clients ?? []);
        setAllMatters(data.matters ?? []);
        if (prefill?.matterId) {
          const matter = (data.matters ?? []).find((m: MatterOption) => m.id === prefill.matterId);
          if (matter?.clientId) setClientId(matter.clientId);
        }
      })
      .catch(() => {});
    fetch('/api/people?role=lawyers')
      .then((res) => res.json())
      .then((data) => {
        setAllLawyers((data.people ?? []).map((p: { person_id: string; name: string; initials: string; position: string; avatar_url?: string | null }) => ({
          id: p.person_id, name: p.name, initials: p.initials, position: p.position ?? '', avatarUrl: p.avatar_url ?? null,
        })));
      })
      .catch(() => {});
  }, [open, prefill]);

  // Auto-populate roles when prefilled matter + data are both loaded
  useEffect(() => {
    if (!open || !prefill?.matterId || allLawyers.length === 0 || allMatters.length === 0) return;
    if (drafterIds.length > 0 || reviewerIds.length > 0) return; // already populated
    const matter = allMatters.find((m) => m.id === prefill.matterId);
    if (matter?.teamPersonIds) {
      const roles = deriveRoles(matter.teamPersonIds, allLawyers);
      setDrafterIds(roles.drafters);
      setReviewerIds(roles.reviewerIds);
    }
  }, [open, prefill, allLawyers, allMatters, drafterIds.length, reviewerIds.length]);

  // Fetch court rules when selected matter has a supported type
  const selectedMatterType = allMatters.find((m) => m.id === matterId)?.type ?? '';
  const hasCourRuleSupport = ['Litigation', 'Labor', 'Tax'].some((t) =>
    selectedMatterType.toLowerCase().includes(t.toLowerCase()),
  );

  useEffect(() => {
    if (!hasCourRuleSupport || !selectedMatterType) {
      setCourtRules([]);
      setSelectedRuleSetId(null);
      return;
    }
    fetch(`/api/court-rules?matterType=${encodeURIComponent(selectedMatterType)}`)
      .then((r) => r.json())
      .then((d) => setCourtRules(d.data ?? []))
      .catch(() => setCourtRules([]));
  }, [hasCourRuleSupport, selectedMatterType]);

  // When a court rule is selected, auto-fill deadline from the first deadline in the chain
  const selectedRule = courtRules.find((r) => r.id === selectedRuleSetId);
  const ruleFirstDeadline = useMemo(() => {
    if (!selectedRule || !prefill?.dateReceived) return null;
    const first = selectedRule.deadlines[0];
    if (!first) return null;
    const computed = addDays(prefill.dateReceived, first.daysFromTrigger);
    return { date: computed, label: first.label, days: first.daysFromTrigger, calendarType: first.calendarType, isReglementary: first.isReglementary };
  }, [selectedRule, prefill?.dateReceived]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape' && !submitting) onClose(); }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, submitting]);

  useEffect(() => {
    if (!typeOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const insideButton = typeButtonRef.current?.contains(target) ?? false;
      const insideDropdown = typeDropdownRef.current?.contains(target) ?? false;
      if (!insideButton && !insideDropdown) setTypeOpen(false);
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [typeOpen]);

  useEffect(() => {
    if (!ruleDropOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const insideButton = ruleDropButtonRef.current?.contains(target) ?? false;
      const insideDropdown = ruleDropdownRef.current?.contains(target) ?? false;
      if (!insideButton && !insideDropdown) setRuleDropOpen(false);
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [ruleDropOpen]);

  const filteredMatters = useMemo(() => {
    if (!clientId) return allMatters;
    return allMatters.filter((m) => m.clientId === clientId);
  }, [allMatters, clientId]);

  const selectedMatter = allMatters.find((m) => m.id === matterId);
  const selectedClient = allClients.find((c) => c.id === clientId);

  const handleMatterSelect = useCallback((id: string) => {
    setMatterId(id);
    setSelectedRuleSetId(null);
    const matter = allMatters.find((m) => m.id === id);
    if (matter?.clientId) setClientId(matter.clientId);

    // Auto-populate roles from matter team
    if (matter?.teamPersonIds && allLawyers.length > 0) {
      const roles = deriveRoles(matter.teamPersonIds, allLawyers);
      setDrafterIds(roles.drafters);
      setReviewerIds(roles.reviewerIds);
    }
  }, [allMatters, allLawyers]);

  // Use rule-derived deadline when a court rule is selected
  const effectiveDeadline = ruleFirstDeadline ? ruleFirstDeadline.date : deadline;

  const handleSubmit = async () => {
    if (!effectiveDeadline || !matterId) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/filing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          matterId,
          deadline: effectiveDeadline,
          type: deliverableType,
          drafterIds,
          reviewerIds,
          reviewDates,
        }),
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Failed'); }
      const filingResult = await res.json();

      // If a court rule was selected, create the deadline chain
      if (selectedRuleSetId && filingResult.deliverableId && prefill?.dateReceived) {
        try {
          const chainRes = await fetch('/api/deadlines', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              matterId,
              ruleSetId: selectedRuleSetId,
              triggerDate: prefill.dateReceived,
              existingFirstEntityId: filingResult.deliverableId,
            }),
          });
          if (chainRes.ok) setChainCreated(true);
        } catch {
          // Chain creation is best-effort — filing was already created
        }
      }

      setSuccess(true);
      onSaved?.();
      setTimeout(() => onClose(), 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || !prefill) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-overlay" onClick={submitting ? undefined : onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl shadow-stone-900/10 w-full max-w-md animate-dialog ring-1 ring-stone-900/5 dark:bg-stone-900">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-4">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-400 via-purple-500 to-indigo-400" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-500/10 dark:to-purple-500/20 flex items-center justify-center ring-1 ring-purple-200/60 dark:ring-purple-500/20">
                <Scale className="w-4.5 h-4.5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-stone-900 leading-tight dark:text-stone-100">Create Deliverable</h2>
                <p className="text-xs text-stone-400 mt-0.5 dark:text-stone-500">Schedule a deliverable with deadline</p>
              </div>
            </div>
            <button type="button" onClick={onClose} disabled={submitting} className="p-1.5 -mr-1 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors cursor-pointer disabled:opacity-50 dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-300">
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {success ? (
          <div className="px-6 py-14 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 ring-4 ring-emerald-100/60 dark:ring-emerald-500/20 flex items-center justify-center mx-auto mb-4 animate-scale-in dark:bg-emerald-500/10">
              <CheckCircle2 className="w-7 h-7 text-emerald-500 dark:text-emerald-400" />
            </div>
            <p className="text-lg font-semibold text-stone-900 dark:text-stone-100">Deliverable Created</p>
            <p className="text-sm text-stone-400 mt-1 dark:text-stone-500">
              {chainCreated
                ? 'The deliverable and deadline chain have been created.'
                : 'The deliverable has been created and assigned.'}
            </p>
          </div>
        ) : (
          <>
            <div className={`px-5 pb-5 space-y-4 max-h-[62vh] ${openDatePicker ? 'overflow-y-visible' : 'overflow-y-auto'}`}>
              {/* Name */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus className="w-full px-3 py-2 text-sm text-stone-800 bg-stone-50/80 border border-stone-200 rounded-lg placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-purple-400/20 focus:border-purple-400 transition-all duration-150 dark:bg-stone-800 dark:border-stone-700 dark:text-stone-100 dark:placeholder:text-stone-500" />
              </div>

              {/* Type + Deadline row */}
              <div className="grid grid-cols-2 gap-3">
                <div ref={typeRef} className="relative">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">Type</label>
                  <button ref={typeButtonRef} type="button" onClick={() => setTypeOpen((o) => !o)} className={`w-full flex items-center justify-between gap-1 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${typeOpen ? 'border-purple-400 ring-2 ring-purple-400/20 bg-white dark:bg-stone-900' : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 dark:bg-stone-800 dark:border-stone-700 dark:hover:border-stone-600'}`}>
                    <span className="truncate text-stone-800 dark:text-stone-100">{deliverableType || 'Select'}</span>
                    <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform duration-150 dark:text-stone-500 ${typeOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {typeOpen && (
                    <div ref={typeDropdownRef} className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg py-0.5 max-h-52 overflow-y-auto animate-fade-down dark:bg-stone-900 dark:border-stone-700">
                      {DELIVERABLE_TYPES.map((opt) => (
                        <button key={opt} type="button" onClick={() => { setDeliverableType(opt); setTypeOpen(false); }} className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors cursor-pointer ${deliverableType === opt ? 'text-purple-700 bg-purple-50/80 font-medium dark:text-purple-300' : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'}`}>
                          {opt}
                          {deliverableType === opt && <Check className="w-3.5 h-3.5 text-purple-600 shrink-0 dark:text-purple-400" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Deadline dropdown */}
                <div className="relative">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
                    <Calendar className="w-3 h-3" /> Deadline
                  </label>
                  <button
                    type="button"
                    onClick={() => setDateDropOpen((o) => !o)}
                    className={`w-full flex items-center justify-between gap-1 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${
                      dateDropOpen ? 'border-purple-400 ring-2 ring-purple-400/20 bg-white dark:bg-stone-900' : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 dark:bg-stone-800 dark:border-stone-700 dark:hover:border-stone-600'
                    }`}
                  >
                    <span className="text-stone-800 truncate dark:text-stone-100">
                      {selectedDateKey === 'custom'
                        ? (customDate ? `${formatShort(customDate)}` : 'Select...')
                        : selectedOption?.label ?? 'Select'}
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform duration-150 dark:text-stone-500 ${dateDropOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {dateDropOpen && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg py-0.5 max-h-52 overflow-y-auto animate-fade-down dark:bg-stone-900 dark:border-stone-700">
                      {dateOptions.map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => { setSelectedDateKey(opt.key); setDateDropOpen(false); }}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors cursor-pointer ${
                            selectedDateKey === opt.key ? 'text-purple-700 bg-purple-50/80 font-medium dark:bg-purple-500/10 dark:text-purple-300' : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'
                          }`}
                        >
                          {opt.label}
                          {selectedDateKey === opt.key && <Check className="w-3.5 h-3.5 text-purple-600 shrink-0 dark:text-purple-400" />}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedDateKey === 'custom' && (
                    <div className="mt-2">
                      <InlineDatePicker
                        value={customDate || null}
                        display={customDate ? new Date(customDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null}
                        isOpen={openDatePicker === 'custom-deadline'}
                        onToggle={() => setOpenDatePicker(openDatePicker === 'custom-deadline' ? null : 'custom-deadline')}
                        onSelect={(d) => { setCustomDate(d ?? ''); setOpenDatePicker(null); }}
                        onClose={() => setOpenDatePicker(null)}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Court Rule (optional — only for supported matter types) */}
              {hasCourRuleSupport && courtRules.length > 0 && (
                <div ref={ruleDropRef} className="relative">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
                    <Gavel className="w-3 h-3" /> Court Rule <span className="font-normal normal-case tracking-normal">(optional)</span>
                  </label>
                  <button
                    ref={ruleDropButtonRef}
                    type="button"
                    onClick={() => setRuleDropOpen((o) => !o)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${
                      ruleDropOpen ? 'border-purple-400 ring-2 ring-purple-400/20 bg-white dark:bg-stone-900' : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 dark:bg-stone-800 dark:border-stone-700 dark:hover:border-stone-600'
                    }`}
                  >
                    <span className={`truncate ${selectedRule ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}`}>
                      {selectedRule ? selectedRule.name : 'Link to court rule...'}
                    </span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {selectedRule && (
                        <span role="button" onClick={(e) => { e.stopPropagation(); setSelectedRuleSetId(null); setRuleDropOpen(false); }} className="p-0.5 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 transition-colors dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-300">
                          <X className="w-3 h-3" />
                        </span>
                      )}
                      <ChevronDown className={`w-3.5 h-3.5 text-stone-400 transition-transform duration-150 dark:text-stone-500 ${ruleDropOpen ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                  {ruleDropOpen && (
                    <div ref={ruleDropdownRef} className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg py-0.5 max-h-52 overflow-y-auto animate-fade-down dark:bg-stone-900 dark:border-stone-700">
                      {courtRules.map((rs) => (
                        <button
                          key={rs.id}
                          type="button"
                          onClick={() => { setSelectedRuleSetId(rs.id); setRuleDropOpen(false); }}
                          className={`w-full text-left px-3 py-2.5 transition-colors cursor-pointer ${
                            selectedRuleSetId === rs.id ? 'text-purple-700 bg-purple-50/80 dark:bg-purple-500/10 dark:text-purple-300' : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="min-w-0">
                              <span className={`text-sm ${selectedRuleSetId === rs.id ? 'font-medium' : ''}`}>{rs.name}</span>
                              <p className="text-[10px] text-stone-400 mt-0.5 truncate dark:text-stone-500">{rs.triggerEventLabel}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[10px] text-stone-400 dark:text-stone-500">{rs.deadlines.length} items</span>
                              {selectedRuleSetId === rs.id && <Check className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Rule info banner */}
                  {selectedRule && ruleFirstDeadline && (
                    <div className="mt-2 px-3 py-2.5 rounded-lg bg-purple-50/80 border border-purple-200/60 text-xs dark:bg-purple-500/10 dark:border-purple-500/20">
                      <div className="flex items-center gap-1.5 text-purple-700 font-medium dark:text-purple-300">
                        <Link2 className="w-3 h-3" />
                        Deadline auto-set to {formatShort(ruleFirstDeadline.date)} ({ruleFirstDeadline.days} {ruleFirstDeadline.calendarType} days)
                      </div>
                      {selectedRule.deadlines.length > 1 && (
                        <p className="text-purple-600/70 mt-1 dark:text-purple-300/70">
                          +{selectedRule.deadlines.length - 1} chain item{selectedRule.deadlines.length > 2 ? 's' : ''} will be auto-created on submit
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="border-t border-stone-100 dark:border-stone-800" />

              {/* Client */}
              <SearchableDropdown
                label="Client" icon={Building2} value={clientId} displayValue={selectedClient?.name ?? ''}
                placeholder="Select client" options={allClients}
                onSelect={(id) => { setClientId(id); if (matterId) { const m = allMatters.find((m) => m.id === matterId); if (m && m.clientId !== id) setMatterId(null); } }}
                onClear={() => { setClientId(null); setMatterId(null); }}
                getOptionLabel={(o) => (o as ClientOption).name}
              />

              {/* Matter */}
              <SearchableDropdown
                label="Matter" icon={Scale} value={matterId} displayValue={selectedMatter ? `${selectedMatter.name}${selectedMatter.code ? ` (${selectedMatter.code})` : ''}` : ''}
                placeholder={clientId ? 'Select matter' : 'Select a client first'} options={filteredMatters}
                onSelect={handleMatterSelect} onClear={() => setMatterId(null)}
                getOptionLabel={(o) => (o as MatterOption).name}
                getOptionSublabel={(o) => (o as MatterOption).code || ''}
              />

              <div className="border-t border-stone-100 dark:border-stone-800" />

              {/* Drafters */}
              <LawyerMultiSelect
                label="Drafters"
                selectedIds={drafterIds}
                allLawyers={allLawyers}
                onAdd={(id) => { if (!drafterIds.includes(id)) setDrafterIds((prev) => [...prev, id]); }}
                onRemove={(id) => setDrafterIds((prev) => prev.filter((p) => p !== id))}
              />

              {/* Reviewers (1-5, ordered: first=initial, last=final) */}
              <LawyerMultiSelect
                label="Reviewers"
                selectedIds={reviewerIds}
                allLawyers={allLawyers}
                onAdd={(id) => { if (!reviewerIds.includes(id) && reviewerIds.length < 5) setReviewerIds((prev) => [...prev, id]); }}
                onRemove={(id) => setReviewerIds((prev) => prev.filter((p) => p !== id))}
              />
              {/* Per-reviewer dates with order labels */}
              {reviewerIds.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] text-stone-400 -mt-1 dark:text-stone-500">
                    {reviewerIds.length === 1
                      ? 'Single reviewer'
                      : `${reviewerIds.length} reviewers: ${reviewerIds.map((id, i) => {
                          const total = reviewerIds.length;
                          const label = total === 1 ? 'Reviewer' : i === 0 ? 'Initial' : i === total - 1 ? 'Final' : ['2nd', '3rd', '4th'][i - 1];
                          const name = allLawyers.find((l) => l.id === id)?.initials ?? FORMER_MEMBER;
                          return `${label} (${name})`;
                        }).join(' \u2192 ')}`}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {reviewerIds.map((rid, idx) => {
                      const total = reviewerIds.length;
                      const label = total === 1 ? 'Review Date' : idx === 0 ? 'Initial Review' : idx === total - 1 ? 'Final Review' : `${['2nd', '3rd', '4th'][idx - 1]} Review`;
                      const pickerKey = `review-date-${idx}`;
                      const dateVal = reviewDates[idx] ?? null;
                      return (
                        <div key={rid}>
                          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
                            <Calendar className="w-3 h-3" /> {label}
                          </label>
                          <InlineDatePicker
                            value={dateVal}
                            display={dateVal ? new Date(dateVal + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null}
                            isOpen={openDatePicker === pickerKey}
                            onToggle={() => setOpenDatePicker(openDatePicker === pickerKey ? null : pickerKey)}
                            onSelect={(d) => {
                              setReviewDates((prev) => {
                                const newDates = [...prev];
                                while (newDates.length < reviewerIds.length) newDates.push(null);
                                newDates[idx] = d ?? null;
                                return newDates;
                              });
                              setOpenDatePicker(null);
                            }}
                            onClose={() => setOpenDatePicker(null)}
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
              <button type="button" onClick={handleSubmit} disabled={submitting || !name || !effectiveDeadline} className="px-5 py-2 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-sm shadow-purple-600/20 transition-all cursor-pointer disabled:opacity-40 disabled:shadow-none">
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

// ── Inline date picker for use inside the modal ──────────────────

const DATE_DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DATE_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface InlineDatePickerProps {
  value: string | null;
  display: string | null;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (date: string | null) => void;
  onClose: () => void;
}

function InlineDatePicker({ value, display, isOpen, onToggle, onSelect, onClose }: InlineDatePickerProps) {
  const parsed = value ? (() => { const d = new Date(value + 'T00:00:00'); return isNaN(d.getTime()) ? null : d; })() : null;
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? today.getMonth());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Re-sync the calendar view to the currently selected date each time
      // the popover opens. setState-in-effect is intentional here — the
      // view must reflect the latest `parsed` value at open-time, not the
      // value at last close. A key-based remount would also work but would
      // reset scroll state inside the popover.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewYear(parsed?.getFullYear() ?? today.getFullYear());
      setViewMonth(parsed?.getMonth() ?? today.getMonth());
    }
  }, [isOpen, parsed, today]);

  useEffect(() => {
    if (!isOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen, onClose]);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();

  const cells: { date: Date; isCurrentMonth: boolean }[] = [];
  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({ date: new Date(viewYear, viewMonth - 1, prevMonthDays - i), isCurrentMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(viewYear, viewMonth, d), isCurrentMonth: true });
  }
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    cells.push({ date: new Date(viewYear, viewMonth + 1, d), isCurrentMonth: false });
  }

  const rows: typeof cells[] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  if (rows.length === 6 && rows[5].every((c) => !c.isCurrentMonth)) rows.pop();

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={onToggle}
        className={`flex items-center justify-between w-full bg-stone-50/80 border rounded-lg px-3 py-2 text-sm transition-all duration-150 cursor-pointer dark:bg-stone-800 ${
          isOpen ? 'border-purple-400 ring-2 ring-purple-400/20' : 'border-stone-200 hover:border-stone-300 dark:border-stone-700 dark:hover:border-stone-600'
        }`}
      >
        <span className={display ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}>
          {display ?? 'Select date'}
        </span>
        <Calendar className="w-4 h-4 text-stone-400 dark:text-stone-500" />
      </button>

      {isOpen && (
        <div
          className="absolute z-20 top-full mt-1 left-0 bg-white border border-stone-200 rounded-xl overflow-hidden dark:bg-stone-900 dark:border-stone-700"
          style={{ width: 280, boxShadow: '0 8px 30px -4px rgba(0,0,0,0.12), 0 4px 10px -4px rgba(0,0,0,0.06)' }}
        >
          <div className="flex items-center justify-between px-3 pt-3 pb-2">
            <button type="button" onClick={prevMonth} className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-200">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); }} className="text-sm font-semibold text-stone-800 hover:text-purple-600 transition-colors cursor-pointer dark:text-stone-100">
              {DATE_MONTHS[viewMonth]} {viewYear}
            </button>
            <button type="button" onClick={nextMonth} className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-200">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 px-2">
            {DATE_DAYS.map((d) => (
              <div key={d} className="text-center text-[10px] font-semibold uppercase tracking-wider text-stone-400 py-1 dark:text-stone-500">{d}</div>
            ))}
          </div>

          <div className="px-2 pb-2">
            {rows.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7">
                {week.map((cell, ci) => {
                  const isToday = isSameDay(cell.date, today);
                  const isSelected = parsed && isSameDay(cell.date, parsed);
                  return (
                    <button
                      key={ci}
                      type="button"
                      onClick={() => onSelect(toDateStr(cell.date))}
                      className={`
                        relative w-full aspect-square flex items-center justify-center text-sm rounded-lg transition-all duration-100 cursor-pointer
                        ${!cell.isCurrentMonth ? 'text-stone-300 dark:text-stone-600' : 'text-stone-700 dark:text-stone-200'}
                        ${isSelected ? 'bg-purple-500 text-white font-semibold shadow-sm' : isToday ? 'font-semibold ring-1 ring-purple-400/50' : 'hover:bg-stone-100 dark:hover:bg-stone-700'}
                      `}
                    >
                      {cell.date.getDate()}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="border-t border-stone-100 px-3 py-2 flex items-center justify-between dark:border-stone-800">
            <button type="button" onClick={() => onSelect(toDateStr(today))} className="text-xs font-medium text-purple-600 hover:text-purple-700 cursor-pointer px-2 py-0.5 rounded hover:bg-purple-50 transition-colors dark:text-purple-400 dark:hover:text-purple-300 dark:hover:bg-purple-500/10">
              Today
            </button>
            {parsed && (
              <button type="button" onClick={() => onSelect(null)} className="text-xs font-medium text-stone-400 hover:text-red-500 cursor-pointer px-2 py-0.5 rounded hover:bg-red-50 transition-colors flex items-center gap-1 dark:text-stone-500 dark:hover:bg-red-500/10 dark:hover:text-red-400">
                <X className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
