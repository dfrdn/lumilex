'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  X, ChevronDown, Check, Clock, FileText, Users, Calendar,
  Briefcase, Scale, Building2, Search, Minus, Plus, CheckCircle2,
} from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';
import Avatar from './Avatar';
import type { MyDTREntry } from '@/lib/queries/my-dtr';

// ── Types ───────────────────────────────────────────────────────

export interface DTRPrefill {
  remarks: string;
  task: string;
  date: string;  // YYYY-MM-DD
  hours: number;
  minutes: number;
  withIds: string[];
  matterId: string | null;
  matterName: string;
  clientId?: string | null;
  clientName?: string;
}

interface PersonData {
  id: string;
  name: string;
  initials: string;
  avatarUrl?: string | null;
}

interface ClientOption {
  id: string;
  name: string;
}

interface MatterOption {
  id: string;
  name: string;
  code: string;
  clientId: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  prefill: DTRPrefill;
  /** Notion user ID to exclude from the lawyers dropdown (the current user) */
  excludeUserId?: string | null;
  /** Called with the created row so the parent can append it without a refresh */
  onSaved?: (created: MyDTREntry) => void;
}

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

  // Position the dropdown portal relative to the trigger button
  useEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      // Close when clicking anywhere that isn't the trigger button or the
      // dropdown portal — clicking the label, another field, empty modal
      // space, etc. all count as "outside".
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
        setSearch('');
      }
    }
    // Capture phase so a modal wrapper's `onMouseDown stopPropagation`
    // can't prevent the outside-click check from running.
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
          isOpen
            ? 'border-gold-400 ring-2 ring-gold-400/20 bg-white dark:bg-stone-900'
            : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 hover:bg-stone-50 dark:bg-stone-800 dark:border-stone-700 dark:hover:bg-stone-800 dark:hover:border-stone-600'
        }`}
      >
        <span className={`truncate ${value ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}`}>
          {displayValue || placeholder}
        </span>
        <div className="flex items-center gap-0.5 shrink-0">
          {value && onClear && (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); onClear(); setIsOpen(false); }}
              className="p-0.5 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 transition-colors dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-stone-400 transition-transform duration-150 dark:text-stone-500 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[100] bg-white border border-stone-200 rounded-lg shadow-lg shadow-stone-900/5 overflow-hidden animate-fade-down dark:bg-stone-900 dark:border-stone-700"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
        >
          <div className="p-2 border-b border-stone-100 dark:border-stone-800">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-stone-50 rounded-md dark:bg-stone-800">
              <Search className="w-3.5 h-3.5 text-stone-400 shrink-0 dark:text-stone-500" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type to search..."
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-stone-400 text-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
              />
            </div>
          </div>
          <div className="max-h-44 overflow-y-auto py-0.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-stone-400 text-center dark:text-stone-500">No results found</p>
            ) : (
              filtered.map((opt) => {
                const isSelected = opt.id === value;
                const sub = getOptionSublabel?.(opt);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => { onSelect(opt.id); setIsOpen(false); setSearch(''); }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors duration-75 cursor-pointer ${
                      isSelected
                        ? 'text-gold-700 bg-gold-50/80 dark:bg-gold-500/10 dark:text-gold-300'
                        : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className={`truncate ${isSelected ? 'font-medium' : ''}`}>
                        {getOptionLabel(opt)}
                      </span>
                      {sub && (
                        <span className={`text-xs ml-1.5 ${isSelected ? 'text-gold-500 dark:text-gold-400' : 'text-stone-400 dark:text-stone-500'}`}>
                          {sub}
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
    </div>
  );
}

// ── Duration Stepper ────────────────────────────────────────────

function DurationStepper({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const decrement = () => onChange(Math.max(min, value - step));
  const increment = () => onChange(max !== undefined ? Math.min(max, value + step) : value + step);

  return (
    <div>
      <label className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 block dark:text-stone-500">
        {label}
      </label>
      <div className="flex items-center h-[38px] border border-stone-200 rounded-lg bg-stone-50/80 overflow-hidden dark:bg-stone-800 dark:border-stone-700">
        <button
          type="button"
          onClick={decrement}
          disabled={value <= min}
          className="flex items-center justify-center w-9 h-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors duration-100 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"
        >
          <Minus className="w-3 h-3" />
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            let v = parseInt(e.target.value) || 0;
            v = Math.max(min, v);
            if (max !== undefined) v = Math.min(max, v);
            onChange(v);
          }}
          className="flex-1 w-0 text-center text-sm font-semibold text-stone-800 tabular-nums bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none dark:text-stone-100"
        />
        <button
          type="button"
          onClick={increment}
          disabled={max !== undefined && value >= max}
          className="flex items-center justify-center w-9 h-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors duration-100 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── Lawyer Multi-Select ─────────────────────────────────────────

function LawyerMultiSelect({
  withIds,
  allLawyers,
  avatarColors,
  onAdd,
  onRemove,
  getPersonDisplay,
}: {
  withIds: string[];
  allLawyers: PersonData[];
  avatarColors: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  getPersonDisplay: (id: string) => { name: string; initials: string; avatarUrl: string | null };
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Position the dropdown portal
  useEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, [isOpen]);

  // Close on outside click (capture phase so modal wrappers can't swallow it)
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      // Close when clicking anywhere that isn't the trigger button, a
      // selected chip (inside containerRef), or the dropdown portal.
      const insideButton = buttonRef.current?.contains(target) ?? false;
      const insideDropdown = dropdownRef.current?.contains(target) ?? false;
      if (!insideButton && !insideDropdown) {
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

  const available = useMemo(() => {
    const selectedSet = new Set(withIds);
    let opts = allLawyers.filter((l) => !selectedSet.has(l.id));
    if (search) {
      const q = search.toLowerCase();
      opts = opts.filter((l) => l.name.toLowerCase().includes(q) || l.initials.toLowerCase().includes(q));
    }
    return opts;
  }, [allLawyers, withIds, search]);

  return (
    <div ref={containerRef}>
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
        <Users className="w-3 h-3" />
        Lawyers
      </label>

      {/* Selected chips */}
      {withIds.length > 0 && (
        <div data-lawyers-chips className="flex flex-wrap gap-1.5 mb-2">
          {withIds.map((id, idx) => {
            const { name, initials, avatarUrl } = getPersonDisplay(id);
            const color = avatarColors[idx % avatarColors.length];
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 pl-1.5 pr-1 py-1 text-xs font-medium bg-stone-50 border border-stone-200/80 text-stone-700 rounded-full group hover:border-stone-300 transition-colors duration-100 dark:bg-stone-800 dark:border-stone-700/80 dark:text-stone-200 dark:hover:border-stone-600"
              >
                <Avatar avatarUrl={avatarUrl} initials={initials} name={name} size={20} fallbackClassName={color} />
                <span className="truncate max-w-[100px]" title={name}>
                  {name}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(id)}
                  className="p-0.5 rounded-full text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors duration-100 cursor-pointer dark:text-stone-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Add button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${
          isOpen
            ? 'border-gold-400 ring-2 ring-gold-400/20 bg-white dark:bg-stone-900'
            : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 hover:bg-stone-50 dark:bg-stone-800 dark:border-stone-700 dark:hover:bg-stone-800 dark:hover:border-stone-600'
        }`}
      >
        <span className="text-stone-400 dark:text-stone-500">Add lawyer...</span>
        <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform duration-150 dark:text-stone-500 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown portal */}
      {isOpen && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[100] bg-white border border-stone-200 rounded-lg shadow-lg shadow-stone-900/5 overflow-hidden animate-fade-down dark:bg-stone-900 dark:border-stone-700"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
        >
          <div className="p-2 border-b border-stone-100 dark:border-stone-800">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-stone-50 rounded-md dark:bg-stone-800">
              <Search className="w-3.5 h-3.5 text-stone-400 shrink-0 dark:text-stone-500" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search lawyers..."
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-stone-400 text-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
              />
            </div>
          </div>
          <div className="max-h-44 overflow-y-auto py-0.5">
            {available.length === 0 ? (
              <p className="px-3 py-4 text-sm text-stone-400 text-center dark:text-stone-500">
                {allLawyers.length === 0 ? 'Loading...' : 'No lawyers found'}
              </p>
            ) : (
              available.map((lawyer) => (
                <button
                  key={lawyer.id}
                  type="button"
                  onClick={() => { onAdd(lawyer.id); setSearch(''); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-stone-700 hover:bg-stone-50 transition-colors duration-75 cursor-pointer dark:text-stone-200 dark:hover:bg-stone-800"
                >
                  <Avatar avatarUrl={lawyer.avatarUrl} initials={lawyer.initials} name={lawyer.name} size={24} fallbackClassName="bg-gold-100 text-gold-700 dark:bg-gold-500/20 dark:text-gold-300" />
                  <span>{lawyer.name}</span>
                </button>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────

export default function AddDTRModal({ open, onClose, prefill, excludeUserId, onSaved }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Form state
  const [remarks, setRemarks] = useState(prefill.remarks);
  const [task, setTask] = useState(prefill.task);
  const [date, setDate] = useState(prefill.date);
  const [hours, setHours] = useState(prefill.hours);
  const [minutes, setMinutes] = useState(prefill.minutes);
  const [withIds, setWithIds] = useState<string[]>(prefill.withIds);
  const [people, setPeople] = useState<PersonData[]>([]);
  const [clientId, setClientId] = useState<string | null>(prefill.clientId ?? null);
  const [matterId, setMatterId] = useState<string | null>(prefill.matterId);

  // Dropdown data
  const [allClients, setAllClients] = useState<ClientOption[]>([]);
  const [allMatters, setAllMatters] = useState<MatterOption[]>([]);

  // UI state
  const [taskOpen, setTaskOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const taskRef = useRef<HTMLDivElement>(null);
  const taskButtonRef = useRef<HTMLButtonElement>(null);
  const taskDropdownRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Reset form when prefill changes
  useEffect(() => {
    if (open) {
      setRemarks(prefill.remarks);
      setTask(prefill.task);
      setDate(prefill.date);
      setHours(prefill.hours);
      setMinutes(prefill.minutes);
      setWithIds(prefill.withIds);
      setClientId(prefill.clientId ?? null);
      setMatterId(prefill.matterId);
      setSuccess(false);
      setError('');
      setErrors({});
    }
  }, [open, prefill]);

  // Fetch clients + matters when modal opens
  useEffect(() => {
    if (!open) return;
    fetch('/api/clients-matters')
      .then((res) => res.json())
      .then((data) => {
        setAllClients(data.clients ?? []);
        setAllMatters(data.matters ?? []);
      })
      .catch(() => {});
  }, [open]);

  // Auto-resolve clientId from matterId when dropdown data loads
  useEffect(() => {
    if (matterId && allMatters.length > 0 && !clientId) {
      const matter = allMatters.find((m) => m.id === matterId);
      if (matter?.clientId) setClientId(matter.clientId);
    }
  }, [matterId, allMatters, clientId]);

  // All team lawyers for the searchable add dropdown
  const [allLawyers, setAllLawyers] = useState<PersonData[]>([]);

  // Fetch all team lawyers when modal opens
  useEffect(() => {
    if (!open) return;
    fetch('/api/people?role=lawyers')
      .then((res) => res.json())
      .then((data: { people?: Array<{ person_id: string; name: string; initials: string; avatar_url?: string | null }> }) => {
        const lawyers = (data.people ?? [])
          .map((p) => ({
            id: p.person_id,
            name: p.name,
            initials: p.initials,
            avatarUrl: p.avatar_url ?? null,
          }))
          .filter((l: PersonData) => !excludeUserId || l.id !== excludeUserId);
        setAllLawyers(lawyers);
        // Resolve prefilled withIds from the fetched list
        if (prefill.withIds.length > 0) {
          const resolved = lawyers.filter((l: PersonData) => prefill.withIds.includes(l.id));
          // For any IDs not in team, keep placeholder
          const resolvedIds = new Set(resolved.map((r: PersonData) => r.id));
          const remaining = prefill.withIds
            .filter((id) => !resolvedIds.has(id))
            .map((id) => ({ id, name: id.slice(0, 8), initials: '??', avatarUrl: null }));
          setPeople([...resolved, ...remaining]);
        } else {
          setPeople([]);
        }
      })
      .catch(() => {
        setAllLawyers([]);
        setPeople([]);
      });
  }, [open, prefill.withIds, excludeUserId]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, submitting]);

  // Close task dropdown on outside click (capture phase).
  // Only the button and the dropdown panel are "inside"; clicking the
  // label or anywhere else in the modal closes it.
  useEffect(() => {
    if (!taskOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const insideButton = taskButtonRef.current?.contains(target) ?? false;
      const insideDropdown = taskDropdownRef.current?.contains(target) ?? false;
      if (!insideButton && !insideDropdown) {
        setTaskOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [taskOpen]);

  // Filter matters by selected client
  const filteredMatters = useMemo(() => {
    if (!clientId) return allMatters;
    return allMatters.filter((m) => m.clientId === clientId);
  }, [allMatters, clientId]);

  // Get display names
  const selectedClient = allClients.find((c) => c.id === clientId);
  const selectedMatter = allMatters.find((m) => m.id === matterId);
  const clientDisplay = selectedClient?.name ?? '';
  const matterDisplay = selectedMatter ? `${selectedMatter.name}${selectedMatter.code ? ` (${selectedMatter.code})` : ''}` : '';

  // When client changes, clear matter if it doesn't belong to the new client
  const handleClientSelect = useCallback((id: string) => {
    setClientId(id);
    if (matterId) {
      const matter = allMatters.find((m) => m.id === matterId);
      if (matter && matter.clientId !== id) {
        setMatterId(null);
      }
    }
  }, [matterId, allMatters]);

  const handleMatterSelect = useCallback((id: string) => {
    setMatterId(id);
    setErrors((p) => ({ ...p, matter: '' }));
    const matter = allMatters.find((m) => m.id === id);
    if (matter && matter.clientId) {
      setClientId(matter.clientId);
    }
  }, [allMatters]);

  const getClientLabel = useCallback((opt: { id: string }) => {
    const c = opt as ClientOption;
    return c.name;
  }, []);

  const getMatterLabel = useCallback((opt: { id: string }) => {
    const m = opt as MatterOption;
    return m.name;
  }, []);

  const getMatterSublabel = useCallback((opt: { id: string }) => {
    const m = opt as MatterOption;
    return m.code || '';
  }, []);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!remarks.trim()) e.remarks = 'Description is required';
    if (!task) e.task = 'Task type is required';
    if (!date) e.date = 'Date is required';
    if (hours === 0 && minutes === 0) e.duration = 'Total time must be at least 1 minute';
    if (!matterId) e.matter = 'Matter is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/dtr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          remarks,
          task,
          date,
          hours,
          minutes,
          withIds,
          matterId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create DTR');
      }

      setSuccess(true);
      toast.success(`Time logged — "${remarks.trim()}"`);
      setTimeout(() => {
        if (onSaved && data.entry) onSaved(data.entry);
        else onClose();
      }, 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || !mounted) return null;

  const getPersonDisplay = (id: string) => {
    const p = people.find((p) => p.id === id);
    return p ? { name: p.name, initials: p.initials, avatarUrl: p.avatarUrl ?? null } : { name: id.slice(0, 8), initials: '??', avatarUrl: null };
  };

  // Palette colors for person avatars
  const avatarColors = [
    'bg-gold-100 text-gold-700 dark:bg-gold-500/20 dark:text-gold-300',
    'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
    'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
    'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
    'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
    'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-overlay"
        onClick={submitting ? undefined : onClose}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative bg-white rounded-2xl shadow-2xl shadow-stone-900/10 w-full max-w-md animate-dialog ring-1 ring-stone-900/5 overflow-hidden dark:bg-stone-900"
      >
        {/* Header — warm gradient accent bar */}
        <div className="relative px-5 pt-5 pb-4">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-gold-400 via-gold-500 to-orange-400" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gold-50 to-gold-100 dark:from-gold-500/10 dark:to-gold-500/20 flex items-center justify-center ring-1 ring-gold-200/60 dark:ring-gold-500/20">
                <Clock className="w-4.5 h-4.5 text-gold-600 dark:text-gold-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-stone-900 leading-tight dark:text-stone-100">Log DTR Entry</h2>
                <p className="text-xs text-stone-400 mt-0.5 dark:text-stone-500">Record your time for this activity</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="p-1.5 -mr-1 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors duration-150 cursor-pointer disabled:opacity-50 dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Success state */}
        {success ? (
          <div className="px-6 py-14 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 ring-4 ring-emerald-100/60 dark:ring-emerald-500/20 flex items-center justify-center mx-auto mb-4 animate-scale-in dark:bg-emerald-500/10">
              <CheckCircle2 className="w-7 h-7 text-emerald-500 dark:text-emerald-400" />
            </div>
            <p className="text-lg font-semibold text-stone-900 dark:text-stone-100">Time Logged</p>
            <p className="text-sm text-stone-400 mt-1 dark:text-stone-500">Your DTR entry has been saved.</p>
          </div>
        ) : (
          <>
            {/* Form body */}
            <div className="px-5 pb-5 space-y-4 max-h-[62vh] overflow-y-auto">
              {/* ── Remarks ── */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
                  <FileText className="w-3 h-3" />
                  Remarks
                </label>
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => { setRemarks(e.target.value); if (errors.remarks) setErrors((p) => ({ ...p, remarks: '' })); }}
                  autoFocus
                  className={`w-full px-3 py-2 text-sm text-stone-800 bg-stone-50/80 border rounded-lg placeholder:text-stone-400 focus:outline-none focus:ring-2 transition-all duration-150 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500 ${
                    errors.remarks ? 'border-red-400 focus:ring-red-400/20' : 'border-stone-200 focus:ring-gold-400/20 focus:border-gold-400 dark:border-stone-700'
                  }`}
                  placeholder="What did you work on?"
                />
                {errors.remarks && <p className="text-xs text-red-500 mt-1 dark:text-red-400">{errors.remarks}</p>}
              </div>

              {/* ── Task + Date row ── */}
              <div className="grid grid-cols-2 gap-3">
                {/* Task */}
                <div ref={taskRef} className="relative">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
                    <Briefcase className="w-3 h-3" />
                    Task
                  </label>
                  <button
                    ref={taskButtonRef}
                    type="button"
                    onClick={() => setTaskOpen((o) => !o)}
                    className={`w-full flex items-center justify-between gap-1 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${
                      errors.task
                        ? 'border-red-400 ring-1 ring-red-400/20 bg-red-50/20 dark:bg-red-500/10'
                        : taskOpen
                          ? 'border-gold-400 ring-2 ring-gold-400/20 bg-white dark:bg-stone-900'
                          : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 dark:bg-stone-800 dark:border-stone-700 dark:hover:border-stone-600'
                    }`}
                  >
                    <span className={`truncate ${task ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}`}>
                      {task || 'Select'}
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform duration-150 dark:text-stone-500 ${taskOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {taskOpen && (
                    <div ref={taskDropdownRef} className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg shadow-stone-900/5 py-0.5 max-h-52 overflow-y-auto animate-fade-down dark:bg-stone-900 dark:border-stone-700">
                      {TASK_OPTIONS.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => { setTask(opt); setTaskOpen(false); setErrors((p) => ({ ...p, task: '' })); }}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors duration-75 cursor-pointer ${
                            task === opt
                              ? 'text-gold-700 bg-gold-50/80 font-medium dark:bg-gold-500/10 dark:text-gold-300'
                              : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'
                          }`}
                        >
                          {opt}
                          {task === opt && <Check className="w-3.5 h-3.5 text-gold-600 shrink-0 dark:text-gold-400" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Date */}
                <div>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
                    <Calendar className="w-3 h-3" />
                    Date
                  </label>
                  <DatePickerInput
                    value={date || null}
                    onChange={(v) => { setDate(v ?? ''); setErrors((p) => ({ ...p, date: '' })); }}
                    placeholder="Pick a date"
                    hasError={!!errors.date}
                  />
                  {errors.date && <p className="text-xs text-red-500 mt-1 dark:text-red-400">{errors.date}</p>}
                </div>
              </div>

              {errors.task && <p className="text-xs text-red-500 -mt-2 dark:text-red-400">{errors.task}</p>}

              {/* ── Duration row ── */}
              <div className="grid grid-cols-2 gap-3">
                <DurationStepper label="Hours" value={hours} onChange={(v) => { setHours(v); setErrors((p) => ({ ...p, duration: '' })); }} min={0} step={1} />
                <DurationStepper label="Minutes" value={minutes} onChange={(v) => { setMinutes(v); setErrors((p) => ({ ...p, duration: '' })); }} min={0} max={59} step={10} />
              </div>
              {errors.duration && <p className="text-xs text-red-500 -mt-2 dark:text-red-400">{errors.duration}</p>}

              {/* ── Divider ── */}
              <div className="border-t border-stone-100 dark:border-stone-800" />

              {/* ── Client ── */}
              <SearchableDropdown
                label="Client"
                icon={Building2}
                value={clientId}
                displayValue={clientDisplay}
                placeholder="Select client"
                options={allClients}
                onSelect={handleClientSelect}
                onClear={() => { setClientId(null); setMatterId(null); }}
                getOptionLabel={getClientLabel}
              />

              {/* ── Matter ── */}
              <div>
                <SearchableDropdown
                  label="Matter"
                  icon={Scale}
                  value={matterId}
                  displayValue={matterDisplay}
                  placeholder={clientId ? 'Select matter' : 'Select a client first'}
                  options={filteredMatters}
                  onSelect={handleMatterSelect}
                  onClear={() => setMatterId(null)}
                  getOptionLabel={getMatterLabel}
                  getOptionSublabel={getMatterSublabel}
                />
                {errors.matter && <p className="text-xs text-red-500 mt-1 dark:text-red-400">{errors.matter}</p>}
              </div>

              {/* ── Lawyers (multi-select with chips) ── */}
              <LawyerMultiSelect
                withIds={withIds}
                allLawyers={allLawyers}
                avatarColors={avatarColors}
                onAdd={(id) => {
                  if (!withIds.includes(id)) {
                    setWithIds((prev) => [...prev, id]);
                    const lawyer = allLawyers.find((l) => l.id === id);
                    if (lawyer) setPeople((prev) => [...prev, lawyer]);
                  }
                }}
                onRemove={(id) => {
                  setWithIds((prev) => prev.filter((p) => p !== id));
                }}
                getPersonDisplay={getPersonDisplay}
              />

              {/* Error message */}
              {error && (
                <div className="flex items-start gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200/60 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                  <X className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-stone-100 bg-stone-50/60 flex items-center justify-end gap-2.5 dark:bg-stone-800/40 dark:border-stone-800">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors duration-150 cursor-pointer disabled:opacity-50 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="px-5 py-2 text-sm font-semibold text-white bg-gold-600 hover:bg-gold-700 rounded-lg shadow-sm shadow-gold-600/20 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 disabled:opacity-40 disabled:shadow-none"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Saving...
                  </span>
                ) : (
                  'Log DTR'
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
