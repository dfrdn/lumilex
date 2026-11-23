'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X, ChevronDown, Check, Calendar, Users, Scale, Building2,
  Search, CheckCircle2,
} from 'lucide-react';
import DatePickerInput from './DatePickerInput';
import Avatar from './Avatar';
import { useEnumValues } from '@/hooks/use-enum-options';

// ── Types ───────────────────────────────────────────────────────

export interface MeetingPrefill {
  name: string;
  matterId: string | null;
  matterName: string;
  type: string;
  date: string; // YYYY-MM-DDTHH:mm
  attendeeIds: string[];
}

interface PersonData {
  id: string;
  name: string;
  initials: string;
  avatarUrl?: string | null;
}

interface MatterOption {
  id: string;
  name: string;
  code: string;
  clientId: string;
  teamPersonIds: string[];
}

interface ClientOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  prefill: MeetingPrefill | null;
  /** Override the modal title (defaults to "New Meeting") */
  title?: string;
  /** Override the modal subtitle */
  subtitle?: string;
  /** Fires when the meeting is created successfully, before the auto-close
   *  timeout. The inbox uses this to keep the file-action claim instead of
   *  releasing it on close. */
  onSaved?: () => void;
}


// ── Searchable Dropdown (reused pattern from AddDTRModal) ─────

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
      // Close when clicking anywhere that isn't the trigger button or the
      // portal dropdown panel. Capture phase so a modal wrapper's
      // stopPropagation can't swallow the event.
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
          isOpen ? 'border-gold-400 ring-2 ring-gold-400/20 bg-white dark:bg-stone-900' : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 hover:bg-stone-50 dark:bg-stone-800 dark:border-stone-700 dark:hover:bg-stone-800 dark:hover:border-stone-600'
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
                <button key={opt.id} type="button" onClick={() => { onSelect(opt.id); setIsOpen(false); setSearch(''); }} className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors duration-75 cursor-pointer ${isSelected ? 'text-gold-700 bg-gold-50/80 dark:bg-gold-500/10 dark:text-gold-300' : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'}`}>
                  <div className="min-w-0">
                    <span className={`truncate ${isSelected ? 'font-medium' : ''}`}>{getOptionLabel(opt)}</span>
                    {sub && <span className={`text-xs ml-1.5 ${isSelected ? 'text-gold-500 dark:text-gold-400' : 'text-stone-400 dark:text-stone-500'}`}>{sub}</span>}
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-gold-600 shrink-0 dark:text-gold-400" />}
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
  selectedIds,
  allLawyers,
  onAdd,
  onRemove,
}: {
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
      // Close when clicking anywhere outside the trigger button, the
      // selected-chips area, or the portal dropdown.
      const insideButton = buttonRef.current?.contains(target) ?? false;
      const insideDropdown = dropdownRef.current?.contains(target) ?? false;
      if (!insideButton && !insideDropdown) {
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

  const avatarColors = ['bg-gold-100 text-gold-700 dark:bg-gold-500/20 dark:text-gold-300', 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300', 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300', 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300', 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300'];

  const getDisplay = (id: string) => {
    const l = allLawyers.find((l) => l.id === id);
    return l ? { name: l.name, initials: l.initials, avatarUrl: l.avatarUrl ?? null } : { name: id.slice(0, 8), initials: '??', avatarUrl: null };
  };

  return (
    <div ref={containerRef}>
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
        <Users className="w-3 h-3" /> Attendees
      </label>
      {selectedIds.length > 0 && (
        <div data-attendees-chips className="flex flex-wrap gap-1.5 mb-2">
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
      <button ref={buttonRef} type="button" onClick={() => setIsOpen((o) => !o)} className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${isOpen ? 'border-gold-400 ring-2 ring-gold-400/20 bg-white dark:bg-stone-900' : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 hover:bg-stone-50 dark:bg-stone-800 dark:border-stone-700 dark:hover:bg-stone-800 dark:hover:border-stone-600'}`}>
        <span className="text-stone-400 dark:text-stone-500">Add attendee...</span>
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
              <p className="px-3 py-4 text-sm text-stone-400 text-center dark:text-stone-500">{allLawyers.length === 0 ? 'Loading...' : 'No lawyers found'}</p>
            ) : available.map((l) => (
              <button key={l.id} type="button" onClick={() => { onAdd(l.id); setSearch(''); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-stone-700 hover:bg-stone-50 transition-colors cursor-pointer dark:text-stone-200 dark:hover:bg-stone-800">
                <Avatar avatarUrl={l.avatarUrl} initials={l.initials} name={l.name} size={24} fallbackClassName="bg-gold-100 text-gold-700 dark:bg-gold-500/20 dark:text-gold-300" />
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

export default function AddMeetingModal({ open, onClose, prefill, title, subtitle, onSaved }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState('Internal Discussion');
  const meetingTypes = useEnumValues('meetings', 'type');
  const [date, setDate] = useState('');
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [matterId, setMatterId] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);

  const [allClients, setAllClients] = useState<ClientOption[]>([]);
  const [allMatters, setAllMatters] = useState<MatterOption[]>([]);
  const [allLawyers, setAllLawyers] = useState<PersonData[]>([]);

  const [typeOpen, setTypeOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const typeRef = useRef<HTMLDivElement>(null);
  const typeButtonRef = useRef<HTMLButtonElement>(null);
  const typeDropdownRef = useRef<HTMLDivElement>(null);

  // Reset form when prefill changes
  useEffect(() => {
    if (open && prefill) {
      setName(prefill.name);
      setType(prefill.type);
      setDate(prefill.date);
      setAttendeeIds(prefill.attendeeIds);
      setMatterId(prefill.matterId);
      setSuccess(false);
      setError('');
      setErrors({});
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
        // Auto-resolve attendees from matter team
        if (prefill?.matterId) {
          const matter = (data.matters ?? []).find((m: MatterOption) => m.id === prefill.matterId);
          if (matter?.teamPersonIds?.length > 0 && prefill.attendeeIds.length === 0) {
            setAttendeeIds(matter.teamPersonIds);
          }
          if (matter?.clientId) setClientId(matter.clientId);
        }
      })
      .catch(() => {});
    fetch('/api/people?role=lawyers')
      .then((res) => res.json())
      .then((data) => {
        setAllLawyers((data.people ?? []).map((p: { person_id: string; name: string; initials: string; avatar_url?: string | null }) => ({
          id: p.person_id, name: p.name, initials: p.initials, avatarUrl: p.avatar_url ?? null,
        })));
      })
      .catch(() => {});
  }, [open, prefill]);

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

  const filteredMatters = useMemo(() => {
    if (!clientId) return allMatters;
    return allMatters.filter((m) => m.clientId === clientId);
  }, [allMatters, clientId]);

  const selectedMatter = allMatters.find((m) => m.id === matterId);
  const selectedClient = allClients.find((c) => c.id === clientId);

  const handleMatterSelect = useCallback((id: string) => {
    setMatterId(id);
    setErrors((p) => ({ ...p, matter: '' }));
    const matter = allMatters.find((m) => m.id === id);
    if (matter?.clientId) setClientId(matter.clientId);
    // Auto-fill attendees from matter team
    if (matter?.teamPersonIds?.length) setAttendeeIds(matter.teamPersonIds);
  }, [allMatters]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Meeting name is required';
    if (!type) e.type = 'Meeting type is required';
    if (!date) e.date = 'Date & time is required';
    if (!matterId) e.matter = 'Matter is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, matterId, type, date, attendeeIds }),
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Failed'); }
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
      <div className="relative overflow-hidden bg-white rounded-2xl shadow-2xl shadow-stone-900/10 w-full max-w-md animate-dialog ring-1 ring-stone-900/5 dark:bg-stone-900">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-4">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-400 via-blue-500 to-indigo-400" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-500/10 dark:to-blue-500/20 flex items-center justify-center ring-1 ring-blue-200/60 dark:ring-blue-500/20">
                <Calendar className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-stone-900 leading-tight dark:text-stone-100">{title ?? 'New Meeting'}</h2>
                <p className="text-xs text-stone-400 mt-0.5 dark:text-stone-500">{subtitle ?? 'Schedule a new meeting'}</p>
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
            <p className="text-lg font-semibold text-stone-900 dark:text-stone-100">Meeting Scheduled</p>
            <p className="text-sm text-stone-400 mt-1 dark:text-stone-500">The internal discussion has been created.</p>
          </div>
        ) : (
          <>
            <div className="px-5 pb-5 space-y-4 max-h-[62vh] overflow-y-auto">
              {/* Name */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">Meeting Name</label>
                <input type="text" value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((p) => ({ ...p, name: '' })); }} autoFocus placeholder="Enter meeting name..." className={`w-full px-3 py-2 text-sm text-stone-800 bg-stone-50/80 border rounded-lg placeholder:text-stone-400 focus:outline-none focus:ring-2 transition-all duration-150 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500 ${errors.name ? 'border-red-400 focus:ring-red-400/20' : 'border-stone-200 focus:ring-blue-400/20 focus:border-blue-400 dark:border-stone-700'}`} />
                {errors.name && <p className="text-xs text-red-500 mt-1 dark:text-red-400">{errors.name}</p>}
              </div>

              {/* Type + Date row */}
              <div className="grid grid-cols-2 gap-3">
                <div ref={typeRef} className="relative">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">Type</label>
                  <button ref={typeButtonRef} type="button" onClick={() => setTypeOpen((o) => !o)} className={`w-full flex items-center justify-between gap-1 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${typeOpen ? 'border-blue-400 ring-2 ring-blue-400/20 bg-white dark:bg-stone-900' : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 dark:bg-stone-800 dark:border-stone-700 dark:hover:border-stone-600'}`}>
                    <span className="truncate text-stone-800 dark:text-stone-100">{type || 'Select'}</span>
                    <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform duration-150 dark:text-stone-500 ${typeOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {typeOpen && (
                    <div ref={typeDropdownRef} className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg py-0.5 max-h-52 overflow-y-auto animate-fade-down dark:bg-stone-900 dark:border-stone-700">
                      {meetingTypes.map((opt) => (
                        <button key={opt} type="button" onClick={() => { setType(opt); setTypeOpen(false); }} className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors cursor-pointer ${type === opt ? 'text-blue-700 bg-blue-50/80 font-medium dark:bg-blue-500/10 dark:text-blue-300' : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'}`}>
                          {opt}
                          {type === opt && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0 dark:text-blue-400" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500"><Calendar className="w-3 h-3" /> Date & Time</label>
                  <DatePickerInput value={date || null} onChange={(v) => { setDate(v ?? ''); if (errors.date) setErrors((p) => ({ ...p, date: '' })); }} placeholder="Select date & time" showTime hasError={!!errors.date} />
                  {errors.date && <p className="text-xs text-red-500 mt-1 dark:text-red-400">{errors.date}</p>}
                </div>
              </div>

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
              <div>
                <SearchableDropdown
                  label="Matter" icon={Scale} value={matterId} displayValue={selectedMatter ? `${selectedMatter.name}${selectedMatter.code ? ` (${selectedMatter.code})` : ''}` : ''}
                  placeholder={clientId ? 'Select matter' : 'Select a client first'} options={filteredMatters}
                  onSelect={handleMatterSelect} onClear={() => setMatterId(null)}
                  getOptionLabel={(o) => (o as MatterOption).name}
                  getOptionSublabel={(o) => (o as MatterOption).code || ''}
                />
                {errors.matter && <p className="text-xs text-red-500 mt-1 dark:text-red-400">{errors.matter}</p>}
              </div>

              {/* Attendees */}
              <LawyerMultiSelect
                selectedIds={attendeeIds}
                allLawyers={allLawyers}
                onAdd={(id) => { if (!attendeeIds.includes(id)) setAttendeeIds((prev) => [...prev, id]); }}
                onRemove={(id) => setAttendeeIds((prev) => prev.filter((p) => p !== id))}
              />

              {error && (
                <div className="flex items-start gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200/60 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                  <X className="w-4 h-4 text-red-400 shrink-0 mt-0.5" /><span>{error}</span>
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-stone-100 bg-stone-50/60 flex items-center justify-end gap-2.5 dark:bg-stone-800/40 dark:border-stone-800">
              <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 text-sm font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer disabled:opacity-50 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200">Cancel</button>
              <button type="button" onClick={handleSubmit} disabled={submitting} className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm shadow-blue-600/20 transition-all cursor-pointer disabled:opacity-40 disabled:shadow-none">
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Creating...
                  </span>
                ) : 'Create Meeting'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
