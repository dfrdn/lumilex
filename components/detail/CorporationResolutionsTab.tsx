'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, FileText, Download, Eye, Link2, Pencil, ChevronDown } from 'lucide-react';
import { useFileViewer } from '@/hooks/use-file-viewer';
import { generatedDocName } from '@/lib/corporations/file-names';
import DatePickerInput from '@/components/DatePickerInput';
import CellDropdown, { type DropdownOption } from '@/components/admin/CellDropdown';
import ResolutionEditor from './ResolutionEditor';
import type {
  Corporation,
  Resolution,
  ResolutionTemplate,
  ResolutionKind,
  CorporationMeeting,
} from '@/types/corporations';

interface Props {
  corporation: Corporation;
  /** Board + Stockholders resolutions only; sec certs live in their own tab. */
  resolutions: Resolution[];
  /** Updates the parent-owned FULL resolutions array (both kinds). */
  onResolutionsChange: React.Dispatch<React.SetStateAction<Resolution[]>>;
  templates: ResolutionTemplate[];
  meetings: CorporationMeeting[];
}

const KINDS: ResolutionKind[] = ['Board Resolution', 'Stockholders Resolution'];

function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function insertByDate(prev: Resolution[], created: Resolution): Resolution[] {
  const i = prev.findIndex((r) => r.dateOfResolution <= created.dateOfResolution);
  return i === -1 ? [...prev, created] : [...prev.slice(0, i), created, ...prev.slice(i)];
}

function SelectField({
  value,
  options,
  onSelect,
  placeholder,
  disabled,
}: {
  value: string | null;
  options: DropdownOption[];
  onSelect: (id: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((o) => o.id === value) ?? null;
  return (
    <div>
      <button
        type="button"
        ref={anchorRef}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg bg-white dark:bg-card text-left outline-none disabled:bg-stone-50 dark:disabled:bg-white/5 disabled:text-stone-500 dark:disabled:text-stone-400"
      >
        <span className={`truncate ${selected ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}`}>
          {selected?.label ?? placeholder ?? '—'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500 shrink-0" />
      </button>
      {open && (
        <CellDropdown
          mode="single"
          value={value}
          options={options}
          onSelect={(id) => { onSelect(id); setOpen(false); }}
          onClose={() => setOpen(false)}
          anchorRef={anchorRef}
        />
      )}
    </div>
  );
}

export default function CorporationResolutionsTab({ corporation, resolutions, onResolutionsChange, templates, meetings }: Props) {
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileViewer = useFileViewer();
  const [editing, setEditing] = useState<Resolution | null>(null);
  const [formError, setFormError] = useState('');
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const previewResolution = (r: Resolution) => fileViewer.preview(generatedDocName(r), r.generatedFilePath);
  const downloadResolution = (r: Resolution) => fileViewer.download(generatedDocName(r), r.generatedFilePath);

  const [kind, setKind] = useState<ResolutionKind>('Board Resolution');
  const [templateId, setTemplateId] = useState<string | 'custom'>('');
  const [title, setTitle] = useState('');
  const [dateOfResolution, setDateOfResolution] = useState('');
  const [meetingId, setMeetingId] = useState<string | ''>('');
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [freeFormBody, setFreeFormBody] = useState('');

  const template = templates.find((t) => t.id === templateId);
  const eligibleTemplates = useMemo(
    () => templates.filter((t) => t.kind === kind),
    [templates, kind],
  );
  const linkedMeeting = useMemo(
    () => meetings.find((m) => m.id === meetingId) ?? null,
    [meetings, meetingId],
  );

  // When a meeting is linked, the resolution's date is the meeting's date —
  // a resolution adopted at a meeting can't be dated differently from the
  // meeting itself.
  useEffect(() => {
    if (linkedMeeting) setDateOfResolution(linkedMeeting.meetingDate);
  }, [linkedMeeting]);

  function reset() {
    setKind('Board Resolution');
    setTemplateId('');
    setTitle('');
    setDateOfResolution('');
    setMeetingId('');
    setVariables({});
    setFreeFormBody('');
    setFormError('');
  }

  async function create() {
    if (!title.trim() || !dateOfResolution) return;
    setBusy('create');
    setFormError('');
    const res = await fetch(`/api/corporation/${corporation.id}/resolutions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        title,
        dateOfResolution,
        templateId: templateId === 'custom' ? null : templateId || null,
        variables,
        freeFormBody: templateId === 'custom' ? freeFormBody : null,
        meetingId: meetingId || null,
        bundledResolutionIds: [],
      }),
    });
    const data = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) {
      setFormError(data?.error ?? 'Create failed');
      return;
    }
    setCreating(false);
    reset();
    if (data?.resolution) onResolutionsChange((prev) => insertByDate(prev, data.resolution));
  }

  async function generate(resId: string) {
    setBusy(`gen-${resId}`);
    setRowError(null);
    try {
      const res = await fetch(`/api/corporation/${corporation.id}/resolutions/${resId}/generate`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRowError({ id: resId, message: data?.error ?? 'Generate failed' });
        return;
      }
      if (data.docxPath && data.resolution) fileViewer.download(generatedDocName(data.resolution), data.docxPath);
      if (data.resolution) {
        onResolutionsChange((prev) => prev.map((r) => r.id === resId ? data.resolution : r));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Board and stockholders resolutions. Secretary's Certificates (which certify these resolutions) live in their own tab.
        </p>
        <button
          onClick={() => setCreating((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-navy-800 text-white hover:bg-navy-700"
        >
          <Plus className="w-3.5 h-3.5" /> New Resolution
        </button>
      </div>

      {creating && (
        <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-4">Create Resolution</h3>
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Kind</span>
                <SelectField
                  value={kind}
                  options={KINDS.map((k) => ({ id: k, label: k }))}
                  onSelect={(id) => {
                    if (!id) return;
                    setKind(id as ResolutionKind);
                    setTemplateId('');
                  }}
                />
              </div>
              <div>
                <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">
                  Date
                  {linkedMeeting && (
                    <span className="ml-1 text-[10px] text-stone-400 dark:text-stone-500 font-normal">(from linked meeting)</span>
                  )}
                </span>
                {linkedMeeting ? (
                  <div className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg bg-stone-50 dark:bg-white/5 text-stone-500 dark:text-stone-400">
                    {dateOfResolution ? fmtDate(dateOfResolution) : '—'}
                  </div>
                ) : (
                  <DatePickerInput
                    value={dateOfResolution || null}
                    onChange={(v) => setDateOfResolution(v ?? '')}
                  />
                )}
              </div>
              <div>
                <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Linked Meeting (optional)</span>
                <SelectField
                  value={meetingId || null}
                  options={meetings.map((m) => ({ id: m.id, label: `${fmtDate(m.meetingDate)} · ${m.meetingType}` }))}
                  onSelect={(id) => setMeetingId(id ?? '')}
                  placeholder="— None —"
                />
              </div>
            </div>

            {linkedMeeting && (
              <p className="text-[11px] text-stone-500 dark:text-stone-400 -mt-1">
                This resolution will appear in the {linkedMeeting.meetingType} on {fmtDate(linkedMeeting.meetingDate)} and be listed in its minutes.
              </p>
            )}

            <label className="block">
              <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Title</span>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Authorizing BPI Bank Account"
                className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none" />
            </label>

            <div>
              <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Template</span>
              <SelectField
                value={templateId || null}
                options={[
                  ...eligibleTemplates.map((t) => ({ id: t.id, label: `${t.category} · ${t.name}` })),
                  { id: 'custom', label: 'Custom (free-form body)' },
                ]}
                onSelect={(id) => { setTemplateId(id ?? ''); setVariables({}); }}
                placeholder="— Pick a template —"
              />
            </div>

            {template && (
              <div className="space-y-3 pt-2">
                <p className="text-xs text-stone-500 dark:text-stone-400">{template.description}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {template.variableSchema.map((v) => (
                    <div key={v.key}>
                      <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">
                        {v.label}{v.required && <span className="text-rose-500 ml-0.5">*</span>}
                      </span>
                      {v.type === 'textarea' ? (
                        <textarea rows={2}
                          value={variables[v.key] ?? ''}
                          onChange={(e) => setVariables((vs) => ({ ...vs, [v.key]: e.target.value }))}
                          className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none" />
                      ) : v.type === 'select' ? (
                        <SelectField
                          value={variables[v.key] || null}
                          options={(v.options ?? []).map((o) => ({ id: o, label: o }))}
                          onSelect={(id) => setVariables((vs) => ({ ...vs, [v.key]: id ?? '' }))}
                          placeholder="—"
                        />
                      ) : v.type === 'date' ? (
                        <DatePickerInput
                          value={variables[v.key] || null}
                          onChange={(val) => setVariables((vs) => ({ ...vs, [v.key]: val ?? '' }))}
                        />
                      ) : (
                        <input type={v.type === 'number' ? 'number' : 'text'}
                          value={variables[v.key] ?? ''}
                          onChange={(e) => setVariables((vs) => ({ ...vs, [v.key]: e.target.value }))}
                          className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {templateId === 'custom' && (
              <label className="block">
                <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Resolution body</span>
                <textarea
                  rows={8}
                  value={freeFormBody}
                  onChange={(e) => setFreeFormBody(e.target.value)}
                  placeholder="RESOLVED, that …"
                  className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none font-serif"
                />
              </label>
            )}

            {formError && (
              <div className="px-3 py-2 text-xs rounded bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300">{formError}</div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => { setCreating(false); reset(); }} className="px-3 py-1.5 text-xs text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/5 rounded">Cancel</button>
              <button
                onClick={create}
                disabled={busy === 'create' || !title.trim() || !dateOfResolution}
                className="px-3 py-1.5 text-xs font-medium rounded bg-navy-800 text-white hover:bg-navy-700 disabled:opacity-50"
              >
                {busy === 'create' ? 'Saving…' : 'Save Resolution'}
              </button>
            </div>
          </div>
        </section>
      )}

      {resolutions.length === 0 ? (
        <div className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-8 text-center text-sm text-stone-500 dark:text-stone-400">
          No resolutions yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {resolutions.map((r) => {
            const meeting = meetings.find((m) => m.id === r.meetingId);
            return (
              <li key={r.id} className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => setEditing(r)}
                      className="text-sm font-semibold text-stone-800 dark:text-stone-100 hover:text-navy-700 dark:hover:text-navy-300 hover:underline text-left truncate"
                      title="View and edit"
                    >
                      {r.title}
                    </button>
                    <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span>{r.kind}</span>
                      <span>·</span>
                      <span>{fmtDate(r.dateOfResolution)}</span>
                      <span>·</span>
                      <span className={`px-1.5 py-0.5 rounded ${r.status === 'Signed' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : r.status === 'For Signing' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-stone-100 dark:bg-white/10 text-stone-600 dark:text-stone-300'}`}>
                        {r.status}
                      </span>
                      {meeting && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-navy-50 dark:bg-navy-500/10 text-navy-700 dark:text-navy-300">
                          <Link2 className="w-3 h-3" />
                          {meeting.meetingType} · {fmtDate(meeting.meetingDate)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditing(r)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-stone-300 dark:border-white/15 rounded hover:bg-stone-50 dark:hover:bg-white/5"
                      title="View and edit body"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                    {r.generatedFilePath && (
                      <>
                        <button
                          onClick={() => previewResolution(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-stone-300 dark:border-white/15 rounded hover:bg-stone-50 dark:hover:bg-white/5"
                          title="Preview in-app"
                        >
                          <Eye className="w-3.5 h-3.5" /> Preview
                        </button>
                        <button
                          onClick={() => downloadResolution(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-stone-300 dark:border-white/15 rounded hover:bg-stone-50 dark:hover:bg-white/5"
                          title="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => generate(r.id)}
                      disabled={busy === `gen-${r.id}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-stone-300 dark:border-white/15 rounded hover:bg-stone-50 dark:hover:bg-white/5 disabled:opacity-50"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      {r.generatedFilePath ? 'Regenerate' : 'Generate'}
                    </button>
                  </div>
                </div>
                {rowError?.id === r.id && (
                  <div className="mt-2 px-3 py-2 text-xs rounded bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300">
                    {rowError.message}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {fileViewer.viewer}

      {editing && (
        <ResolutionEditor
          corporationId={corporation.id}
          resolution={editing}
          templates={templates}
          meetings={meetings}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            if (saved) onResolutionsChange((prev) => prev.map((r) => r.id === saved.id ? saved : r));
          }}
        />
      )}
    </div>
  );
}
