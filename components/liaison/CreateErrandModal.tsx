'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Send, Loader2, Bike, ChevronDown, Check, Search,
  Building2, Scale, FileText, MapPin, Calendar, AlertTriangle,
} from 'lucide-react';
import type { LiaisonTask } from '@/lib/queries/liaison';
import DatePickerInput from '@/components/DatePickerInput';

interface ZoneOption { id: number; name: string; round_trip_rate: number }
interface LiaisonOption { person_id: string; name: string; role: string }
interface ClientOption { id: string; name: string }
interface MatterOption { id: string; name: string; code: string; clientId: string }
interface DeliverableOption { id: string; name: string; type?: string; status?: string }

interface Props {
  open: boolean;
  onClose: () => void;
  liaisonOfficers: LiaisonOption[];
  editing?: LiaisonTask | null;
  onSaved?: (task: LiaisonTask, isEdit: boolean) => void;
}

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
] as const;

// ── Searchable dropdown (inline; same pattern as AddTaskModal) ────────────
function SearchableDropdown<T extends { id: string }>({
  label, icon: Icon, value, displayValue, placeholder, options, disabled,
  onSelect, onClear, getOptionLabel, getOptionSublabel, hasError,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string | null;
  displayValue: string;
  placeholder: string;
  options: T[];
  disabled?: boolean;
  onSelect: (id: string) => void;
  onClear?: () => void;
  getOptionLabel: (opt: T) => string;
  getOptionSublabel?: (opt: T) => string;
  hasError?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function h(e: MouseEvent) {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !dropRef.current?.contains(t)) {
        setIsOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', h, true);
    return () => document.removeEventListener('mousedown', h, true);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) =>
        getOptionLabel(o).toLowerCase().includes(q) ||
        (getOptionSublabel?.(o)?.toLowerCase() ?? '').includes(q),
    );
  }, [options, search, getOptionLabel, getOptionSublabel]);

  return (
    <div>
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
        <Icon className="w-3 h-3" />
        {label}
      </label>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${
          disabled
            ? 'border-stone-200 bg-stone-50 text-stone-400 cursor-not-allowed dark:bg-stone-800/40 dark:border-stone-800 dark:text-stone-600'
            : isOpen
              ? 'border-gold-400 ring-2 ring-gold-400/20 bg-white dark:bg-stone-900'
              : hasError
                ? 'border-red-400 ring-1 ring-red-400/20 bg-white dark:bg-stone-900'
                : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 dark:bg-stone-800 dark:border-stone-700 dark:hover:border-stone-600'
        }`}
      >
        <span className={`truncate ${value ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}`}>
          {displayValue || placeholder}
        </span>
        <div className="flex items-center gap-0.5 shrink-0">
          {value && onClear && !disabled && (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); onClear(); setIsOpen(false); }}
              className="p-0.5 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:bg-stone-700"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-stone-400 transition-transform duration-150 dark:text-stone-500 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {isOpen && pos && createPortal(
        <div
          ref={dropRef}
          className="fixed z-[100] bg-white border border-stone-200 rounded-lg shadow-lg overflow-hidden animate-fade-down dark:bg-stone-900 dark:border-stone-700"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
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
                const sel = opt.id === value;
                const sub = getOptionSublabel?.(opt);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => { onSelect(opt.id); setIsOpen(false); setSearch(''); }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors cursor-pointer ${
                      sel
                        ? 'text-gold-700 bg-gold-50/80 dark:bg-gold-500/10 dark:text-gold-300'
                        : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className={`truncate ${sel ? 'font-medium' : ''}`}>{getOptionLabel(opt)}</span>
                      {sub && (
                        <span className={`text-xs ml-1.5 ${sel ? 'text-gold-500 dark:text-gold-400' : 'text-stone-400 dark:text-stone-500'}`}>
                          {sub}
                        </span>
                      )}
                    </div>
                    {sel && <Check className="w-3.5 h-3.5 text-gold-600 shrink-0 dark:text-gold-400" />}
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

// ── Main modal ────────────────────────────────────────────────────────────
export default function CreateErrandModal({ open, onClose, liaisonOfficers, editing, onSaved }: Props) {
  const isEdit = !!editing;

  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [assignedTo, setAssignedTo] = useState<string>('');
  const [zoneId, setZoneId] = useState<number | null>(null);
  const [scheduledFor, setScheduledFor] = useState<string>('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [matterId, setMatterId] = useState<string | null>(null);
  const [deliverableId, setDeliverableId] = useState<string | null>(null);
  const [billAtInternal, setBillAtInternal] = useState(false);

  const [zones, setZones] = useState<ZoneOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [matters, setMatters] = useState<MatterOption[]>([]);
  const [deliverables, setDeliverables] = useState<DeliverableOption[]>([]);
  const [loadingDeliverables, setLoadingDeliverables] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [priorityOpen, setPriorityOpen] = useState(false);

  // Reset / hydrate form on open
  useEffect(() => {
    if (!open) return;

    if (editing) {
      setTitle(editing.title);
      setPurpose(editing.purpose);
      setDescription(editing.description);
      setPriority(editing.priority);
      setAssignedTo(editing.assigned_to);
      setZoneId(editing.zone_id);
      setScheduledFor(editing.scheduled_for ?? '');
      setClientId(editing.client_id ?? null);
      setMatterId(editing.matter_id ?? null);
      setDeliverableId(editing.deliverable_id ?? null);
      setBillAtInternal(!!editing.bill_at_internal);
    } else {
      setTitle('');
      setPurpose('');
      setDescription('');
      setPriority('normal');
      setAssignedTo(liaisonOfficers.find((o) => o.role === 'liaison_officer')?.person_id ?? '');
      setZoneId(null);
      setScheduledFor('');
      setClientId(null);
      setMatterId(null);
      setDeliverableId(null);
      setBillAtInternal(false);
    }
    setError('');
    setErrors({});

    fetch('/api/transportation-zones')
      .then((r) => r.json())
      .then((d) => setZones(d.zones ?? []))
      .catch(() => {});
    fetch('/api/clients-matters')
      .then((r) => r.json())
      .then((d) => {
        setClients(d.clients ?? []);
        setMatters(d.matters ?? []);
      })
      .catch(() => {});
  }, [open, editing, liaisonOfficers]);

  // Load deliverables when matter changes
  useEffect(() => {
    if (!matterId) {
      setDeliverables([]);
      return;
    }
    setLoadingDeliverables(true);
    fetch(`/api/deliverables-by-matter?matterId=${encodeURIComponent(matterId)}`)
      .then((r) => r.json())
      .then((d) => setDeliverables(d.deliverables ?? []))
      .catch(() => setDeliverables([]))
      .finally(() => setLoadingDeliverables(false));
  }, [matterId]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose, submitting]);

  const filteredMatters = useMemo(
    () => (clientId ? matters.filter((m) => m.clientId === clientId) : matters),
    [matters, clientId],
  );
  const selectedClient = clients.find((c) => c.id === clientId);
  const selectedMatter = matters.find((m) => m.id === matterId);
  const selectedDeliverable = deliverables.find((d) => d.id === deliverableId);

  const handleMatterSelect = useCallback((id: string) => {
    setMatterId(id);
    setDeliverableId(null); // changing matter resets deliverable
    const m = matters.find((mm) => mm.id === id);
    if (m?.clientId) setClientId(m.clientId);
  }, [matters]);

  function validate() {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = 'Title is required';
    if (!assignedTo) e.assignedTo = 'Pick a liaison officer';
    if (!clientId) e.clientId = 'Client is required';
    if (!matterId) e.matterId = 'Matter is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSubmitting(true);
    setError('');
    try {
      const url = isEdit ? `/api/liaison-tasks/${editing!.id}` : '/api/liaison-tasks';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          purpose: purpose.trim(),
          description: description.trim(),
          priority,
          assigned_to: assignedTo,
          zone_id: zoneId,
          scheduled_for: scheduledFor || null,
          client_id: clientId,
          matter_id: matterId,
          deliverable_id: deliverableId || null,
          bill_at_internal: billAtInternal,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      if (data.task && onSaved) onSaved(data.task, isEdit);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-overlay" onClick={submitting ? undefined : onClose} />
      <div className="relative overflow-hidden bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-dialog ring-1 ring-stone-900/5 dark:bg-stone-900">
        <div className="relative px-5 pt-5 pb-4">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-fuchsia-400 via-fuchsia-500 to-pink-400" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-50 to-fuchsia-100 flex items-center justify-center ring-1 ring-fuchsia-200/60 dark:from-fuchsia-900/30 dark:to-fuchsia-800/20 dark:ring-fuchsia-700/30">
                <Bike className="w-4.5 h-4.5 text-fuchsia-600 dark:text-fuchsia-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-stone-900 leading-tight dark:text-stone-100">
                  {isEdit ? 'Edit Errand' : 'Assign New Errand'}
                </h2>
                <p className="text-xs text-stone-400 mt-0.5 dark:text-stone-500">
                  {isEdit ? 'Update the errand details' : 'Chief assigns errands to liaison officers'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="p-1.5 -mr-1 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors cursor-pointer disabled:opacity-50 dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        <div className="px-5 pb-5 space-y-4 max-h-[65vh] overflow-y-auto">
          <div>
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
              Title
            </label>
            <input
              autoFocus
              value={title}
              onChange={(e) => { setTitle(e.target.value); if (errors.title) setErrors((p) => ({ ...p, title: '' })); }}
              placeholder="e.g. File Position Paper at MTC Quezon City"
              className={`w-full px-3 py-2 text-sm rounded-lg bg-stone-50/80 border placeholder:text-stone-400 focus:outline-none focus:ring-2 transition-all dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500 ${
                errors.title
                  ? 'border-red-400 focus:ring-red-400/20'
                  : 'border-stone-200 focus:ring-fuchsia-400/20 focus:border-fuchsia-400 dark:border-stone-700'
              }`}
            />
            {errors.title && <p className="text-xs text-red-500 mt-1 dark:text-red-400">{errors.title}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <SearchableDropdown
              label="Assign to"
              icon={Bike}
              value={assignedTo || null}
              displayValue={
                liaisonOfficers.find((o) => o.person_id === assignedTo)
                  ? `${liaisonOfficers.find((o) => o.person_id === assignedTo)!.name}${
                      liaisonOfficers.find((o) => o.person_id === assignedTo)!.role === 'chief_liaison_officer'
                        ? ' (Chief)'
                        : ''
                    }`
                  : ''
              }
              placeholder="Select liaison"
              options={liaisonOfficers.map((o) => ({ id: o.person_id, name: o.name, role: o.role }))}
              onSelect={(id) => { setAssignedTo(id); if (errors.assignedTo) setErrors((p) => ({ ...p, assignedTo: '' })); }}
              getOptionLabel={(o) => o.name}
              getOptionSublabel={(o) => (o.role === 'chief_liaison_officer' ? 'Chief' : '')}
              hasError={!!errors.assignedTo}
            />
            <div className="relative">
              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
                <AlertTriangle className="w-3 h-3" /> Priority
              </label>
              <button
                type="button"
                onClick={() => setPriorityOpen((o) => !o)}
                onBlur={() => setTimeout(() => setPriorityOpen(false), 150)}
                className={`w-full flex items-center justify-between gap-1 px-3 py-2 text-sm rounded-lg transition-all cursor-pointer border ${
                  priorityOpen
                    ? 'border-fuchsia-400 ring-2 ring-fuchsia-400/20 bg-white dark:bg-stone-900'
                    : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 dark:bg-stone-800 dark:border-stone-700 dark:hover:border-stone-600'
                }`}
              >
                <span className="capitalize text-stone-800 dark:text-stone-100">{priority}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-stone-400 transition-transform duration-150 dark:text-stone-500 ${priorityOpen ? 'rotate-180' : ''}`} />
              </button>
              {priorityOpen && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg py-0.5 animate-fade-down dark:bg-stone-900 dark:border-stone-700">
                  {PRIORITIES.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onMouseDown={() => { setPriority(opt.value); setPriorityOpen(false); }}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors cursor-pointer ${
                        priority === opt.value
                          ? 'text-fuchsia-700 bg-fuchsia-50/80 font-medium dark:bg-fuchsia-500/10 dark:text-fuchsia-300'
                          : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'
                      }`}
                    >
                      {opt.label}
                      {priority === opt.value && <Check className="w-3.5 h-3.5 text-fuchsia-600 dark:text-fuchsia-400" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <SearchableDropdown
            label="Destination"
            icon={MapPin}
            value={zoneId != null ? String(zoneId) : null}
            displayValue={
              zoneId != null
                ? (() => {
                    const z = zones.find((zz) => zz.id === zoneId);
                    return z ? `${z.name} · ₱${Number(z.round_trip_rate).toLocaleString('en-PH')}` : '';
                  })()
                : ''
            }
            placeholder="Select destination (zone)"
            options={zones.map((z) => ({ id: String(z.id), name: z.name, rate: z.round_trip_rate }))}
            onSelect={(id) => setZoneId(Number(id))}
            onClear={() => setZoneId(null)}
            getOptionLabel={(o) => o.name}
            getOptionSublabel={(o) => `₱${Number(o.rate).toLocaleString('en-PH')}`}
          />

          <label className="flex items-start gap-2 text-xs text-stone-600 dark:text-stone-300 cursor-pointer">
            <input
              type="checkbox"
              checked={billAtInternal}
              onChange={(e) => setBillAtInternal(e.target.checked)}
              className="mt-0.5 accent-fuchsia-600"
            />
            <span>Bill client at internal rate (no markup) — charge the actual cost without the firm markup.</span>
          </label>

          <div>
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
              <Calendar className="w-3 h-3" /> Scheduled For
            </label>
            <DatePickerInput
              value={scheduledFor || null}
              onChange={(v) => setScheduledFor(v ?? '')}
              placeholder="Select date"
            />
            <p className="text-[11px] text-stone-400 dark:text-stone-500 mt-1">
              The deadline (if any) is inherited from the linked deliverable below.
            </p>
          </div>

          <div className="border-t border-stone-100 dark:border-stone-800" />

          <SearchableDropdown
            label="Client"
            icon={Building2}
            value={clientId}
            displayValue={selectedClient?.name ?? ''}
            placeholder="Select client"
            options={clients}
            onSelect={(id) => {
              setClientId(id);
              if (errors.clientId) setErrors((p) => ({ ...p, clientId: '' }));
              // If existing matter no longer belongs to selected client, clear it
              if (matterId) {
                const m = matters.find((mm) => mm.id === matterId);
                if (m && m.clientId !== id) { setMatterId(null); setDeliverableId(null); }
              }
            }}
            onClear={() => { setClientId(null); setMatterId(null); setDeliverableId(null); }}
            getOptionLabel={(o) => o.name}
            hasError={!!errors.clientId}
          />
          {errors.clientId && <p className="text-xs text-red-500 -mt-2 dark:text-red-400">{errors.clientId}</p>}

          <SearchableDropdown
            label="Matter"
            icon={Scale}
            value={matterId}
            displayValue={
              selectedMatter
                ? `${selectedMatter.name}${selectedMatter.code ? ` (${selectedMatter.code})` : ''}`
                : ''
            }
            placeholder={clientId ? 'Select matter' : 'Select a client first'}
            options={filteredMatters}
            disabled={!clientId}
            onSelect={(id) => { handleMatterSelect(id); if (errors.matterId) setErrors((p) => ({ ...p, matterId: '' })); }}
            onClear={() => { setMatterId(null); setDeliverableId(null); }}
            getOptionLabel={(o) => o.name}
            getOptionSublabel={(o) => o.code || ''}
            hasError={!!errors.matterId}
          />
          {errors.matterId && <p className="text-xs text-red-500 -mt-2 dark:text-red-400">{errors.matterId}</p>}

          <SearchableDropdown
            label={`Related Deliverable (optional)${loadingDeliverables ? ' · loading…' : ''}`}
            icon={FileText}
            value={deliverableId}
            displayValue={selectedDeliverable?.name ?? ''}
            placeholder={
              !matterId
                ? 'Select a matter first'
                : deliverables.length === 0 && !loadingDeliverables
                  ? 'No deliverables on this matter'
                  : 'Pick a deliverable'
            }
            options={deliverables}
            disabled={!matterId || (deliverables.length === 0 && !loadingDeliverables)}
            onSelect={(id) => setDeliverableId(id)}
            onClear={() => setDeliverableId(null)}
            getOptionLabel={(o) => o.name}
            getOptionSublabel={(o) => o.status || o.type || ''}
          />

          <div>
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
              Purpose
            </label>
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="e.g. Submit pleadings before 4pm cutoff"
              className="w-full px-3 py-2 text-sm rounded-lg bg-stone-50/80 border border-stone-200 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20 focus:border-fuchsia-400 transition-all dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500 dark:border-stone-700"
            />
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
              Additional Notes
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-stone-50/80 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20 focus:border-fuchsia-400 transition-all resize-none dark:bg-stone-800 dark:text-stone-100 dark:border-stone-700"
            />
          </div>

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t border-stone-100 dark:border-stone-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 rounded-lg text-sm text-stone-600 hover:bg-stone-100 cursor-pointer dark:text-stone-300 dark:hover:bg-stone-800/50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-fuchsia-600 text-white hover:bg-fuchsia-700 disabled:opacity-60 cursor-pointer"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {isEdit ? 'Save Changes' : 'Assign Errand'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
