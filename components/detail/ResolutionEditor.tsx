'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronDown } from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';
import CellDropdown, { type DropdownOption } from '@/components/admin/CellDropdown';
import type {
  CorporationMeeting,
  Resolution,
  ResolutionStatus,
  ResolutionTemplate,
} from '@/types/corporations';

interface Props {
  corporationId: string;
  resolution: Resolution;
  templates: ResolutionTemplate[];
  meetings: CorporationMeeting[];
  onClose: () => void;
  onSaved: (saved: Resolution | null) => void;
}

const STATUSES: ResolutionStatus[] = ['Draft', 'For Signing', 'Signed'];

/**
 * Pure-string handlebars-light substitution. Mirrors
 * lib/docx/resolution-generator.ts so the preview matches the generated doc.
 */
function renderInner(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
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

export default function ResolutionEditor({
  corporationId,
  resolution,
  templates,
  meetings,
  onClose,
  onSaved,
}: Props) {
  const [title, setTitle] = useState(resolution.title);
  const [dateOfResolution, setDateOfResolution] = useState(resolution.dateOfResolution);
  const [meetingId, setMeetingId] = useState(resolution.meetingId ?? '');
  const [templateId, setTemplateId] = useState<string | 'custom'>(
    resolution.templateId ?? (resolution.freeFormBody !== null ? 'custom' : ''),
  );
  const [variables, setVariables] = useState<Record<string, string>>(resolution.variables ?? {});
  const [freeFormBody, setFreeFormBody] = useState(resolution.freeFormBody ?? '');
  const [status, setStatus] = useState<ResolutionStatus>(resolution.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isSecCert = resolution.kind === 'Secretarys Certificate';
  const eligibleTemplates = useMemo(
    () => templates.filter((t) => t.kind === resolution.kind),
    [templates, resolution.kind],
  );
  const template = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );
  const linkedMeeting = useMemo(
    () => meetings.find((m) => m.id === meetingId) ?? null,
    [meetings, meetingId],
  );

  // Date follows the linked meeting — a resolution adopted at a meeting can't
  // be dated differently from the meeting itself.
  useEffect(() => {
    if (linkedMeeting) setDateOfResolution(linkedMeeting.meetingDate);
  }, [linkedMeeting]);

  const renderedBody = useMemo(() => {
    if (templateId === 'custom' || !template) return freeFormBody;
    return renderInner(template.bodyTemplate, variables);
  }, [template, templateId, variables, freeFormBody]);

  async function save() {
    setError('');
    if (!title.trim()) { setError('Title is required'); return; }
    if (!dateOfResolution) { setError('Date is required'); return; }
    setBusy(true);
    const payload: Record<string, unknown> = {
      title,
      dateOfResolution,
      meetingId: meetingId || null,
      status,
    };
    if (templateId === 'custom') {
      payload.templateId = null;
      payload.variables = {};
      payload.freeFormBody = freeFormBody;
    } else if (templateId) {
      payload.templateId = templateId;
      payload.variables = variables;
      payload.freeFormBody = null;
    } else {
      payload.templateId = null;
      payload.variables = {};
      payload.freeFormBody = null;
    }
    const res = await fetch(`/api/corporation/${corporationId}/resolutions/${resolution.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? 'Save failed'); return; }
    onSaved(data.resolution ?? null);
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch justify-end" onClick={() => !busy && onClose()}>
      <div className="bg-white dark:bg-card w-full max-w-2xl h-full overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-card border-b border-stone-200 dark:border-white/10 px-5 py-3 flex items-center justify-between z-10">
          <div>
            <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Edit Resolution</h2>
            <p className="text-[11px] text-stone-500 dark:text-stone-400">{resolution.kind}</p>
          </div>
          <button onClick={() => !busy && onClose()} className="p-1 rounded hover:bg-stone-100 dark:hover:bg-white/10">
            <X className="w-4 h-4 text-stone-500 dark:text-stone-400" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <label className="block">
            <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
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
              <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Status</span>
              <SelectField
                value={status}
                options={STATUSES.map((s) => ({ id: s, label: s }))}
                onSelect={(id) => { if (id) setStatus(id as ResolutionStatus); }}
              />
            </div>
          </div>

          {!isSecCert && (
            <div>
              <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Linked Meeting</span>
              <SelectField
                value={meetingId || null}
                options={meetings.map((m) => ({ id: m.id, label: `${fmtDate(m.meetingDate)} · ${m.meetingType}` }))}
                onSelect={(id) => setMeetingId(id ?? '')}
                placeholder="— None —"
              />
            </div>
          )}

          {!isSecCert && (
            <div>
              <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Template</span>
              <SelectField
                value={templateId || null}
                options={[
                  ...eligibleTemplates.map((t) => ({ id: t.id, label: `${t.category} · ${t.name}` })),
                  { id: 'custom', label: 'Custom (free-form body)' },
                ]}
                onSelect={(id) => {
                  setTemplateId(id ?? '');
                  if (id !== 'custom' && id !== null) setVariables({});
                }}
                placeholder="— None —"
              />
            </div>
          )}

          {!isSecCert && template && (
            <div className="space-y-2">
              <p className="text-[11px] text-stone-500 dark:text-stone-400">{template.description}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {template.variableSchema.map((v) => (
                  <div key={v.key}>
                    <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">
                      {v.label}{v.required && <span className="text-rose-500 ml-0.5">*</span>}
                    </span>
                    {v.type === 'textarea' ? (
                      <textarea
                        rows={2}
                        value={variables[v.key] ?? ''}
                        onChange={(e) => setVariables((vs) => ({ ...vs, [v.key]: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none"
                      />
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
                      <input
                        type={v.type === 'number' ? 'number' : 'text'}
                        value={variables[v.key] ?? ''}
                        onChange={(e) => setVariables((vs) => ({ ...vs, [v.key]: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isSecCert && templateId === 'custom' && (
            <label className="block">
              <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Resolution body</span>
              <textarea
                rows={10}
                value={freeFormBody}
                onChange={(e) => setFreeFormBody(e.target.value)}
                placeholder="RESOLVED, that …"
                className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none font-serif"
              />
            </label>
          )}

          {!isSecCert && (
            <div className="space-y-1">
              <span className="block text-xs font-medium text-stone-600 dark:text-stone-300">Body preview</span>
              <div className="px-3 py-3 text-sm font-serif border border-stone-200 dark:border-white/10 bg-stone-50 dark:bg-white/5 rounded-lg whitespace-pre-wrap min-h-[3rem]">
                {renderedBody || <span className="text-stone-400 dark:text-stone-500 italic font-sans">No body — pick a template or switch to custom.</span>}
              </div>
            </div>
          )}

          {isSecCert && (
            <div className="px-3 py-2 text-xs rounded bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300">
              Secretary's Certificates aren't edited here — their content comes from the resolutions they certify. Manage bundled resolutions from the Sec Certs tab.
            </div>
          )}

          {resolution.generatedFilePath && (
            <p className="text-[11px] text-stone-500 dark:text-stone-400">
              A DOCX has already been generated for this resolution. After saving edits, regenerate it from the list view to refresh the file.
            </p>
          )}

          {error && <div className="px-3 py-2 text-xs rounded bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300">{error}</div>}
        </div>

        <div className="sticky bottom-0 bg-white dark:bg-card border-t border-stone-200 dark:border-white/10 px-5 py-3 flex justify-end gap-2">
          <button onClick={() => !busy && onClose()} className="px-3 py-1.5 text-xs text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/5 rounded">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy || !title.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded bg-navy-800 text-white hover:bg-navy-700 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
