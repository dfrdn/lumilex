'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import CellDropdown, { type DropdownOption } from '@/components/admin/CellDropdown';
import DatePickerInput from '@/components/DatePickerInput';
import { BTN_OUTLINE, BTN_PRIMARY } from '@/components/ui/tone';
import type { CaseDetail } from '@/lib/queries/cases';
import { detectTrack, TRACK_LABEL, TRACKS, type Track } from '@/lib/cases/stages';
import { forumShort, RELATION_LABEL, type CourtLevel, type ForumType, type Proceeding, type Relation } from '@/lib/cases/view';

// ── Shell and fields ─────────────────────────────────────────────

export function Modal({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal aria-label={title}>
      <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-card shadow-2xl ring-1 ring-stone-900/5 dark:ring-white/10">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="font-serif text-lg text-stone-900 dark:text-stone-50">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-md text-stone-400 hover:text-stone-700 dark:hover:text-stone-200" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-2 space-y-3 overflow-y-auto">{children}</div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-stone-100 dark:border-white/[0.06]">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium text-stone-600 dark:text-stone-300 mb-1">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-[11px] text-stone-400 dark:text-stone-500">{hint}</span>}
    </label>
  );
}

const INPUT =
  'w-full px-3 py-2 text-sm rounded-lg border border-stone-200 dark:border-white/10 bg-white dark:bg-card text-stone-800 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-navy-200 dark:focus:ring-navy-500/30';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${INPUT} ${props.className ?? ''}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={`${INPUT} resize-y ${props.className ?? ''}`} />;
}

/** One choice from a list, in the app's own dropdown. */
export function Picker({ value, options, onChange, placeholder = 'Choose…', allowClear = false }: { value: string | null; options: DropdownOption[]; onChange: (v: string | null) => void; placeholder?: string; allowClear?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const label = options.find((o) => o.id === value)?.label;
  return (
    <>
      {/* The menu ignores clicks on the field that opened it, so the field toggles it. */}
      <button ref={ref} type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`${INPUT} flex items-center justify-between text-left`}>
        <span className={`truncate ${label ? '' : 'text-stone-400'}`}>{label ?? placeholder}</span>
        <ChevronDown className="w-4 h-4 text-stone-400 shrink-0" />
      </button>
      {open && (
        <CellDropdown
          mode="single"
          options={options}
          value={value}
          allowClear={allowClear}
          anchorRef={ref as React.RefObject<HTMLElement | null>}
          onSelect={(id) => {
            onChange(id);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Several from a list. */
export function MultiPicker({ value, options, onChange, placeholder = 'Choose…' }: { value: string[]; options: DropdownOption[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  // The menu is placed by an overlay that takes no clicks, so a click on the
  // field counts as outside it — which saves the ticks and closes it. That
  // same click mustn't open it again.
  const anchor = useRef<HTMLSpanElement>(null);
  const closing = useRef(false);
  const labels = options.filter((o) => value.includes(o.id)).map((o) => o.label);
  return (
    <span className="relative block">
      <button
        type="button"
        onMouseDown={() => {
          closing.current = open;
        }}
        onClick={() => {
          if (closing.current) closing.current = false;
          else setOpen(true);
        }}
        aria-expanded={open}
        className={`${INPUT} flex items-center justify-between text-left`}
      >
        <span className={`truncate ${labels.length ? '' : 'text-stone-400'}`}>{labels.length ? labels.join(', ') : placeholder}</span>
        <ChevronDown className="w-4 h-4 text-stone-400 shrink-0" />
      </button>
      <span ref={anchor} aria-hidden className="absolute inset-0 pointer-events-none" />
      {open && (
        <CellDropdown
          mode="multi"
          options={options}
          value={value}
          anchorRef={anchor as React.RefObject<HTMLElement | null>}
          onSelect={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

/** Send a change; on success hand back the case as it now stands. */
export async function sendCase(url: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body: unknown): Promise<CaseDetail | null> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast.error(json.error ?? 'That didn’t save.', { description: Array.isArray(json.details) ? json.details.join('; ') : undefined });
    return null;
  }
  return (json.case as CaseDetail) ?? null;
}

interface MatterOption {
  id: string;
  name: string;
  code: string;
  clientName: string;
}

/** Open matters for the pickers, plus any already on the case (closed ones included). */
export function useMatterOptions(open: boolean, current: { id: string; name: string; code: string; clientName: string }[] = []): DropdownOption[] {
  const [matters, setMatters] = useState<MatterOption[]>([]);
  useEffect(() => {
    if (!open || matters.length) return;
    fetch('/api/clients-matters')
      .then((r) => r.json())
      .then((j) =>
        setMatters(
          ((j.matters ?? []) as Record<string, string>[]).map((m) => ({
            id: m.notion_id ?? m.id,
            name: m.name,
            code: m.matter_code ?? m.code ?? '',
            clientName: m.client_name ?? m.clientName ?? '',
          })),
        ),
      )
      .catch(() => toast.error('Couldn’t load matters'));
  }, [open, matters.length]);
  return useMemo(() => {
    const seen = new Set<string>();
    return [...current, ...matters]
      .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
      .map((m) => ({ id: m.id, label: m.name, sublabel: [m.code, m.clientName].filter(Boolean).join(' · ') }));
  }, [matters, current]);
}

// ── New case ─────────────────────────────────────────────────────

const CLIENT_ROLE_OPTIONS: DropdownOption[] = [
  { id: 'complainant', label: 'Complainant' },
  { id: 'respondent', label: 'Respondent' },
  { id: 'plaintiff', label: 'Plaintiff' },
  { id: 'defendant', label: 'Defendant' },
  { id: 'petitioner', label: 'Petitioner' },
  { id: 'intervenor', label: 'Intervenor' },
  { id: 'other', label: 'Other' },
];

export function NewCaseModal({
  open,
  onClose,
  onCreated,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  /** Started from a matter: its name, what it's about, and the matter itself. */
  prefill?: { workingTitle: string; nature: string; matter: { id: string; name: string; code: string; clientName: string } };
}) {
  const [title, setTitle] = useState(prefill?.workingTitle ?? '');
  const [nature, setNature] = useState(prefill?.nature ?? '');
  const [role, setRole] = useState<string | null>(null);
  const [matterIds, setMatterIds] = useState<string[]>(prefill ? [prefill.matter.id] : []);
  const [saving, setSaving] = useState(false);
  const current = useMemo(() => (prefill ? [prefill.matter] : []), [prefill]);
  const matters = useMatterOptions(open, current);

  async function submit() {
    setSaving(true);
    const res = await fetch('/api/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workingTitle: title.trim(), nature: nature.trim() || null, clientRole: role, matterIds }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(json.error ?? 'Couldn’t open the case');
      return;
    }
    toast.success('Case opened — in evaluation');
    onCreated(json.id as string);
  }

  return (
    <Modal
      open={open}
      title="New case"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={`${BTN_OUTLINE} px-3 py-1.5`}>Cancel</button>
          <button type="button" disabled={!title.trim() || saving} onClick={submit} className={`${BTN_PRIMARY} px-3 py-1.5`}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Open case
          </button>
        </>
      }
    >
      <Field label="Working title" hint="What the firm calls it until a complaint is filed. It gives way to the caption once there is one.">
        <TextInput autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Northwind Power — Valdez" />
      </Field>
      <Field label="What it’s about">
        <TextInput value={nature} onChange={(e) => setNature(e.target.value)} placeholder="e.g. Estafa, Unlawful Detainer" />
      </Field>
      <Field label="The client is">
        <Picker value={role} options={CLIENT_ROLE_OPTIONS} onChange={setRole} allowClear placeholder="Not set" />
      </Field>
      <Field label="Matters handling it">
        <MultiPicker value={matterIds} options={matters} onChange={setMatterIds} placeholder="Choose matters…" />
      </Field>
    </Modal>
  );
}

// ── File a proceeding ────────────────────────────────────────────

const FORUM_OPTIONS: DropdownOption[] = [
  { id: 'court:rtc', label: 'RTC (incl. Family Court)' },
  { id: 'court:mtc', label: 'MTC / MeTC / MTCC / MCTC' },
  { id: 'court:ca', label: 'Court of Appeals' },
  { id: 'court:sc', label: 'Supreme Court' },
  { id: 'court:sandiganbayan', label: 'Sandiganbayan' },
  { id: 'court:cta', label: 'Court of Tax Appeals' },
  { id: 'prosecutor', label: 'Prosecutor (OCP / OPP)' },
  { id: 'doj', label: 'Department of Justice' },
  { id: 'ombudsman', label: 'Ombudsman' },
  { id: 'labor', label: 'NLRC / DOLE' },
  { id: 'law_enforcement', label: 'NBI / police' },
  { id: 'agency', label: 'Other agency (COA, COMELEC, BI, IBP…)' },
];

const RELATION_OPTIONS: DropdownOption[] = (['referral', 'review', 'information', 'appeal', 'rule_45', 'rule_65', 'other'] as Relation[]).map((r) => ({
  id: r,
  label: RELATION_LABEL[r],
}));

const TRACK_OPTIONS: DropdownOption[] = TRACKS.map((t) => ({ id: t, label: TRACK_LABEL[t] }));

function splitForum(id: string | null): { forumType: ForumType; courtLevel: CourtLevel | null } | null {
  if (!id) return null;
  const [t, l] = id.split(':');
  return { forumType: t as ForumType, courtLevel: (l as CourtLevel) ?? null };
}

/** The first filing, or one filed on a proceeding already in the tree (`parent` preset). */
export function FileProceedingModal({
  open,
  onClose,
  data,
  parentId: presetParent,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  data: CaseDetail;
  parentId: string | null;
  onSaved: (c: CaseDetail) => void;
}) {
  const first = data.proceedings.length === 0;
  const [parentId, setParentId] = useState<string | null>(presetParent);
  // Mounted fresh each time it opens, so its props are its starting point.
  const [relation, setRelation] = useState<Relation>(presetParent ? 'appeal' : 'original');
  const [forum, setForum] = useState<string | null>(null);
  const [office, setOffice] = useState('');
  const [docket, setDocket] = useState('');
  const [caption, setCaption] = useState(data.title);
  const [filedOn, setFiledOn] = useState<string | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [trackTouched, setTrackTouched] = useState(false);
  const [matterIds, setMatterIds] = useState<string[]>(data.matters.map((m) => m.id));
  const [saving, setSaving] = useState(false);
  const matters = useMatterOptions(open, data.matters);

  // Suggest the kind of proceeding from what's been entered, until a lawyer picks one.
  const f = splitForum(forum);
  const suggested = f
    ? detectTrack({ forumType: f.forumType, courtLevel: f.courtLevel, relation: parentId ? relation : 'original', docketNo: docket || null, caption, nature: data.nature })
    : null;
  const chosenTrack = trackTouched ? track : suggested;

  const parentOptions: DropdownOption[] = data.proceedings.map((p) => ({ id: p.id, label: p.office || forumShort(p), sublabel: p.docketNo ?? undefined }));

  async function submit() {
    if (!f || !chosenTrack) return;
    setSaving(true);
    const updated = await sendCase(`/api/cases/${data.id}/proceedings`, 'POST', {
      parentId,
      relation: parentId ? relation : 'original',
      forumType: f.forumType,
      courtLevel: f.courtLevel,
      office: office.trim(),
      docketNo: docket.trim() || null,
      caption: caption.trim(),
      track: chosenTrack,
      filedOn,
      matterIds,
    });
    setSaving(false);
    if (updated) {
      toast.success(first ? 'Filed — the case is active' : 'Proceeding added');
      onSaved(updated);
    }
  }

  return (
    <Modal
      open={open}
      title={first ? 'File the case' : 'File a proceeding'}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={`${BTN_OUTLINE} px-3 py-1.5`}>Cancel</button>
          <button type="button" disabled={!f || !chosenTrack || saving} onClick={submit} className={`${BTN_PRIMARY} px-3 py-1.5`}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} File
          </button>
        </>
      }
    >
      {!first && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Filed on">
            <Picker value={parentId} options={parentOptions} onChange={setParentId} allowClear placeholder="Nothing — a separate first filing" />
          </Field>
          {parentId && (
            <Field label="As">
              <Picker value={relation} options={RELATION_OPTIONS} onChange={(v) => v && setRelation(v as Relation)} />
            </Field>
          )}
        </div>
      )}
      <Field label="Forum">
        <Picker value={forum} options={FORUM_OPTIONS} onChange={setForum} />
      </Field>
      <Field label="Court or office and branch">
        <TextInput value={office} onChange={(e) => setOffice(e.target.value)} placeholder="e.g. RTC Branch 164, Pasig City" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Docket no.">
          <TextInput value={docket} onChange={(e) => setDocket(e.target.value)} placeholder="Once assigned" />
        </Field>
        <Field label="Filed">
          <DatePickerInput value={filedOn} onChange={setFiledOn} placeholder="Date filed" />
        </Field>
      </div>
      <Field label="Caption here" hint="In court a criminal case is captioned “People v. …” — the case takes the caption of the furthest forum.">
        <TextInput value={caption} onChange={(e) => setCaption(e.target.value)} />
      </Field>
      <Field label="Kind of proceeding" hint={trackTouched ? undefined : chosenTrack ? 'Suggested from the forum and docket — change it if it’s wrong.' : undefined}>
        <Picker
          value={chosenTrack}
          options={TRACK_OPTIONS}
          onChange={(v) => {
            setTrack(v as Track | null);
            setTrackTouched(true);
          }}
          placeholder="Pick the forum first"
        />
      </Field>
      <Field label="Handled by">
        <MultiPicker value={matterIds} options={matters} onChange={setMatterIds} placeholder="Choose matters…" />
      </Field>
    </Modal>
  );
}

// ── Record a decision ───────────────────────────────────────────

export function DecisionModal({ open, onClose, caseId, proceeding, onSaved }: { open: boolean; onClose: () => void; caseId: string; proceeding: Proceeding; onSaved: (c: CaseDetail) => void }) {
  const [resolution, setResolution] = useState('');
  const [resolvedOn, setResolvedOn] = useState<string | null>(null);
  const [receivedOn, setReceivedOn] = useState<string | null>(null);
  const [mrDueOn, setMrDueOn] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    const updated = await sendCase(`/api/cases/${caseId}/proceedings/${proceeding.id}`, 'PATCH', {
      decision: { resolution: resolution.trim() || null, resolvedOn, receivedOn, mrDueOn },
    });
    setSaving(false);
    if (updated) {
      toast.success('Decision recorded');
      onSaved(updated);
    }
  }

  return (
    <Modal
      open={open}
      title={`Decision · ${proceeding.office || forumShort(proceeding)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={`${BTN_OUTLINE} px-3 py-1.5`}>Cancel</button>
          <button type="button" disabled={saving} onClick={submit} className={`${BTN_PRIMARY} px-3 py-1.5`}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Record decision
          </button>
        </>
      }
    >
      <Field label="What was decided">
        <TextArea autoFocus value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="e.g. Probable cause found; Information to be filed for estafa" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dated">
          <DatePickerInput value={resolvedOn} onChange={setResolvedOn} />
        </Field>
        <Field label="Received">
          <DatePickerInput value={receivedOn} onChange={setReceivedOn} />
        </Field>
      </div>
      <Field label="MR due" hint="Optional. The period depends on the case — enter it to see it in Needs action.">
        <DatePickerInput value={mrDueOn} onChange={setMrDueOn} placeholder="Not tracked" />
      </Field>
    </Modal>
  );
}

// ── Close the case ───────────────────────────────────────────────

const OUTCOME_OPTIONS: DropdownOption[] = [
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
  { id: 'settled', label: 'Settled' },
  { id: 'dismissed', label: 'Dismissed' },
  { id: 'withdrawn', label: 'Withdrawn' },
  { id: 'not_pursued', label: 'Not pursued' },
  { id: 'other', label: 'Other' },
];

export function CloseCaseModal({ open, onClose, caseId, onSaved }: { open: boolean; onClose: () => void; caseId: string; onSaved: (c: CaseDetail) => void }) {
  const [outcome, setOutcome] = useState<string | null>(null);
  const [closedOn, setClosedOn] = useState<string | null>(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }));
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!outcome || !closedOn) return;
    setSaving(true);
    const updated = await sendCase(`/api/cases/${caseId}`, 'PATCH', { close: { outcome, closedOn } });
    setSaving(false);
    if (updated) {
      toast.success('Case closed');
      onSaved(updated);
    }
  }

  return (
    <Modal
      open={open}
      title="Close the case"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={`${BTN_OUTLINE} px-3 py-1.5`}>Cancel</button>
          <button type="button" disabled={!outcome || !closedOn || saving} onClick={submit} className={`${BTN_PRIMARY} px-3 py-1.5`}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Close case
          </button>
        </>
      }
    >
      <Field label="How it ended">
        <Picker value={outcome} options={OUTCOME_OPTIONS} onChange={setOutcome} />
      </Field>
      <Field label="Closed on">
        <DatePickerInput value={closedOn} onChange={setClosedOn} />
      </Field>
    </Modal>
  );
}

// ── Link a matter ────────────────────────────────────────────────

export function LinkMatterModal({ open, onClose, data, onSaved }: { open: boolean; onClose: () => void; data: CaseDetail; onSaved: (c: CaseDetail) => void }) {
  const [matterId, setMatterId] = useState<string | null>(null);
  const [proceedingIds, setProceedingIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const matters = useMatterOptions(open);
  const procOptions: DropdownOption[] = data.proceedings.map((p) => ({ id: p.id, label: p.office || forumShort(p), sublabel: p.docketNo ?? undefined }));

  async function submit() {
    if (!matterId) return;
    setSaving(true);
    const updated = await sendCase(`/api/cases/${data.id}/matters`, 'PUT', { matterId, proceedingIds });
    setSaving(false);
    if (updated) {
      toast.success('Matter linked');
      onSaved(updated);
    }
  }

  return (
    <Modal
      open={open}
      title="Link a matter"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={`${BTN_OUTLINE} px-3 py-1.5`}>Cancel</button>
          <button type="button" disabled={!matterId || saving} onClick={submit} className={`${BTN_PRIMARY} px-3 py-1.5`}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Link
          </button>
        </>
      }
    >
      <Field label="Matter">
        <Picker value={matterId} options={matters} onChange={setMatterId} />
      </Field>
      {procOptions.length > 0 && (
        <Field label="Handles" hint="None: it covers the evaluation.">
          <MultiPicker value={proceedingIds} options={procOptions} onChange={setProceedingIds} placeholder="Evaluation only" />
        </Field>
      )}
    </Modal>
  );
}
