'use client';

import { useMemo, useRef, useState } from 'react';
import { Plus, FileText, Download, Eye, Stamp, ChevronDown } from 'lucide-react';
import { useFileViewer } from '@/hooks/use-file-viewer';
import { generatedDocName } from '@/lib/corporations/file-names';
import DatePickerInput from '@/components/DatePickerInput';
import CellDropdown, { type DropdownOption } from '@/components/admin/CellDropdown';
import type {
  Corporation,
  Resolution,
  ResolutionTemplate,
  CorporationMeeting,
} from '@/types/corporations';

interface Props {
  corporation: Corporation;
  /** Existing Secretary's Certificates for this corporation. */
  secCerts: Resolution[];
  /** Updates the parent-owned FULL resolutions array (both kinds). */
  onResolutionsChange: React.Dispatch<React.SetStateAction<Resolution[]>>;
  /** Board + Stockholders resolutions available to bundle / certify. */
  bundleableResolutions: Resolution[];
  templates: ResolutionTemplate[];
  meetings: CorporationMeeting[];
}

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

export default function CorporationSecCertsTab({
  corporation,
  secCerts,
  onResolutionsChange,
  bundleableResolutions,
  templates,
  meetings,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileViewer = useFileViewer();
  const [formError, setFormError] = useState('');
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const [title, setTitle] = useState('');
  const [certDate, setCertDate] = useState('');
  const [templateId, setTemplateId] = useState<string>('');
  const [bundledResolutionIds, setBundledResolutionIds] = useState<string[]>([]);

  const secCertTemplates = useMemo(
    () => templates.filter((t) => t.kind === 'Secretarys Certificate'),
    [templates],
  );

  function reset() {
    setTitle('');
    setCertDate('');
    setTemplateId('');
    setBundledResolutionIds([]);
    setFormError('');
  }

  function toggleBundle(id: string) {
    setBundledResolutionIds((xs) => xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]);
  }
  function moveBundle(id: string, dir: -1 | 1) {
    setBundledResolutionIds((xs) => {
      const i = xs.indexOf(id);
      if (i < 0) return xs;
      const j = i + dir;
      if (j < 0 || j >= xs.length) return xs;
      const next = [...xs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  const previewCert = (r: Resolution) => fileViewer.preview(generatedDocName(r), r.generatedFilePath);
  const downloadCert = (r: Resolution) => fileViewer.download(generatedDocName(r), r.generatedFilePath);

  async function create() {
    if (!title.trim() || !certDate || bundledResolutionIds.length === 0) return;
    setBusy('create');
    setFormError('');
    const res = await fetch(`/api/corporation/${corporation.id}/resolutions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'Secretarys Certificate',
        title,
        dateOfResolution: certDate,
        templateId: templateId || null,
        variables: {},
        freeFormBody: null,
        meetingId: null,
        bundledResolutionIds,
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

  async function generate(certId: string) {
    setBusy(`gen-${certId}`);
    setRowError(null);
    try {
      const res = await fetch(`/api/corporation/${corporation.id}/resolutions/${certId}/generate`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRowError({ id: certId, message: data?.error ?? 'Generate failed' });
        return;
      }
      if (data.docxPath && data.resolution) fileViewer.download(generatedDocName(data.resolution), data.docxPath);
      if (data.resolution) {
        onResolutionsChange((prev) => prev.map((r) => r.id === certId ? data.resolution : r));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-stone-500 dark:text-stone-400">
          A Secretary's Certificate is the Corporate Secretary's attestation that a resolution was duly adopted. Pick the resolutions to certify below.
        </p>
        <button
          onClick={() => setCreating((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-navy-800 text-white hover:bg-navy-700"
        >
          <Plus className="w-3.5 h-3.5" /> New Secretary's Certificate
        </button>
      </div>

      {creating && (
        <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-4">Create Secretary's Certificate</h3>
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Title</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Secretary's Certificate — BPI Bank Account"
                  className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none"
                />
              </label>
              <div>
                <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Date of Certification</span>
                <DatePickerInput
                  value={certDate || null}
                  onChange={(v) => setCertDate(v ?? '')}
                />
              </div>
            </div>

            {secCertTemplates.length > 0 && (
              <div>
                <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">
                  Certificate Format <span className="text-stone-400 dark:text-stone-500 font-normal">(optional)</span>
                </span>
                <SelectField
                  value={templateId || null}
                  options={secCertTemplates.map((t) => ({ id: t.id, label: `${t.category} · ${t.name}` }))}
                  onSelect={(id) => setTemplateId(id ?? '')}
                  placeholder="— Default certificate format —"
                />
              </div>
            )}

            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <span className="block text-xs font-medium text-stone-600 dark:text-stone-300">
                  Resolutions to certify
                </span>
                <span className="text-[10px] text-stone-400 dark:text-stone-500">{bundledResolutionIds.length} selected</span>
              </div>
              <p className="text-[11px] text-stone-500 dark:text-stone-400">
                Each selected resolution will be quoted in the certificate with its own preamble (meeting type and date, if linked).
              </p>
              {bundleableResolutions.length === 0 ? (
                <div className="px-3 py-4 text-xs text-stone-400 dark:text-stone-500 border border-dashed border-stone-200 dark:border-white/10 rounded text-center">
                  No board or stockholders resolutions to certify yet. Create one from the Resolutions tab first.
                </div>
              ) : (
                <ul className="border border-stone-200 dark:border-white/10 rounded divide-y divide-stone-100 dark:divide-white/10 max-h-72 overflow-y-auto">
                  {bundleableResolutions.map((r) => {
                    const selected = bundledResolutionIds.includes(r.id);
                    const order = selected ? bundledResolutionIds.indexOf(r.id) + 1 : null;
                    const linkedMeeting = meetings.find((m) => m.id === r.meetingId);
                    return (
                      <li key={r.id} className="flex items-start gap-2 px-3 py-2 text-xs">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleBundle(r.id)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-stone-800 dark:text-stone-100 truncate">{r.title}</div>
                          <div className="text-[10px] text-stone-500 dark:text-stone-400">
                            {r.kind} · {fmtDate(r.dateOfResolution)}
                            {linkedMeeting && <> · {linkedMeeting.meetingType} on {fmtDate(linkedMeeting.meetingDate)}</>}
                          </div>
                        </div>
                        {selected && (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-full px-1.5 py-0.5">
                              #{order}
                            </span>
                            <button
                              type="button"
                              onClick={() => moveBundle(r.id, -1)}
                              className="text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-200 px-1"
                              title="Move up"
                            >↑</button>
                            <button
                              type="button"
                              onClick={() => moveBundle(r.id, 1)}
                              className="text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-200 px-1"
                              title="Move down"
                            >↓</button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {formError && (
              <div className="px-3 py-2 text-xs rounded bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300">{formError}</div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setCreating(false); reset(); }}
                className="px-3 py-1.5 text-xs text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/5 rounded"
              >
                Cancel
              </button>
              <button
                onClick={create}
                disabled={busy === 'create' || !title.trim() || !certDate || bundledResolutionIds.length === 0}
                className="px-3 py-1.5 text-xs font-medium rounded bg-navy-800 text-white hover:bg-navy-700 disabled:opacity-50"
              >
                {busy === 'create' ? 'Saving…' : 'Save Certificate'}
              </button>
            </div>
          </div>
        </section>
      )}

      {secCerts.length === 0 ? (
        <div className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-8 text-center text-sm text-stone-500 dark:text-stone-400">
          No Secretary's Certificates yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {secCerts.map((c) => {
            const certifiedTitles = c.bundledResolutionIds
              .map((bid) => bundleableResolutions.find((r) => r.id === bid)?.title)
              .filter((t): t is string => !!t);
            return (
              <li key={c.id} className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-stone-800 dark:text-stone-100 truncate flex items-center gap-1.5">
                      <Stamp className="w-3.5 h-3.5 text-navy-700 dark:text-navy-300 shrink-0" />
                      {c.title}
                    </div>
                    <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5 flex flex-wrap items-center gap-x-2">
                      <span>Dated {fmtDate(c.dateOfResolution)}</span>
                      <span>·</span>
                      <span className={`px-1.5 py-0.5 rounded ${c.status === 'Signed' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : c.status === 'For Signing' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-stone-100 dark:bg-white/10 text-stone-600 dark:text-stone-300'}`}>
                        {c.status}
                      </span>
                    </div>
                    {certifiedTitles.length > 0 && (
                      <div className="text-xs text-stone-600 dark:text-stone-300 mt-2">
                        <span className="text-stone-400 dark:text-stone-500">Certifies: </span>
                        {certifiedTitles.join('; ')}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {c.generatedFilePath && (
                      <>
                        <button
                          onClick={() => previewCert(c)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-stone-300 dark:border-white/15 rounded hover:bg-stone-50 dark:hover:bg-white/5"
                          title="Preview in-app"
                        >
                          <Eye className="w-3.5 h-3.5" /> Preview
                        </button>
                        <button
                          onClick={() => downloadCert(c)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-stone-300 dark:border-white/15 rounded hover:bg-stone-50 dark:hover:bg-white/5"
                          title="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => generate(c.id)}
                      disabled={busy === `gen-${c.id}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-stone-300 dark:border-white/15 rounded hover:bg-stone-50 dark:hover:bg-white/5 disabled:opacity-50"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      {c.generatedFilePath ? 'Regenerate' : 'Generate'}
                    </button>
                  </div>
                </div>
                {rowError?.id === c.id && (
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
    </div>
  );
}
