'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, AlertCircle, CheckCircle2, Mail, FileEdit, Paperclip, AlertTriangle } from 'lucide-react';
import type { DashboardDeadline, DeadlineKind } from '@/lib/trademark-deadlines';
import { AUTO_FILLED_KEYS } from '@/lib/trademark-report-context';
import { useBrand } from '@/components/BrandProvider';
import { signOff } from '@/lib/firm/outbound-identity';

interface Props {
  open: boolean;
  onClose: () => void;
  deadlines: DashboardDeadline[]; // all from a single client
  /** The deadlines are on record as reported — emailed to `to`, or marked with no email. */
  onReported?: (report: { sentAt: string; recipientEmail: string }) => void;
}

interface Recipient { address: string }

interface PlaceholderDef {
  key: string;
  label?: string;
  type?: string;
  required?: boolean;
}

interface TemplateOption {
  id: number;
  name: string;
  description: string | null;
  deadlineKind: DeadlineKind | null;
  placeholders: PlaceholderDef[];
  hasFile: boolean;
}

const KIND_LABELS: Record<DeadlineKind, string> = {
  '1st Publication Fee': 'Notice of Allowance — 1st publication fee',
  'Issuance Fee':  'Notice of Issuance — payment',
  'OA Response':   'Office Action — response',
  'Revival':       'Revival of the abandoned application',
  '3-DAU':         '3rd-Year Declaration of Actual Use',
  '5-DAU':         '5th-Year Declaration of Actual Use',
  'Renewal':       '10-Year Renewal',
  'Renewal DAU':   'Declaration of Actual Use following renewal',
  'Renewal 5-DAU': 'Declaration of Actual Use — 5th year of renewal',
  'Local Filing':  'Filing in the designated country',
  'IR Renewal':    'Renewal of the international registration',
};

function deadlineKey(d: DashboardDeadline): string {
  return `${d.trademark.id}|${d.kind}|${d.due}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildDefaultSubject(clientName: string, deadlines: DashboardDeadline[]): string {
  if (deadlines.length === 1) {
    const d = deadlines[0];
    return `Trademark deadline reminder: ${d.kind} on ${d.trademark.mark} — due ${d.due}`;
  }
  return `Trademark deadlines update — ${clientName}`;
}

function buildDefaultBody(clientName: string, deadlines: DashboardDeadline[], firmName: string): string {
  const rows = deadlines
    .map((d) => {
      const classes = d.trademark.classes.join(', ') || '—';
      return `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600;">${escapeHtml(d.trademark.mark)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:monospace;">${escapeHtml(classes)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(KIND_LABELS[d.kind])}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600;">${escapeHtml(d.due)}</td>
        </tr>
      `;
    })
    .join('');

  return `
<div style="font-family: 'Adobe Garamond Pro', Garamond, 'Times New Roman', serif; font-size: 14px; color: #333;">
  <p>Dear ${escapeHtml(clientName)},</p>
  <p>This is a courtesy reminder of upcoming deadlines on the following trademark${deadlines.length === 1 ? '' : 's'}. Please find the relevant report${deadlines.length === 1 ? '' : 's'} attached.</p>
  <table style="border-collapse:collapse;border:1px solid #ddd;font-size:13px;margin:12px 0;">
    <thead>
      <tr style="background:#f8f8f8;">
        <th style="padding:6px 10px;border-bottom:1px solid #ddd;text-align:left;">Mark</th>
        <th style="padding:6px 10px;border-bottom:1px solid #ddd;text-align:left;">Class/es</th>
        <th style="padding:6px 10px;border-bottom:1px solid #ddd;text-align:left;">Deadline</th>
        <th style="padding:6px 10px;border-bottom:1px solid #ddd;text-align:left;">Due Date</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p>Kindly coordinate with us at your earliest convenience so we can act on these deadlines.</p>
  <br/>
  ${signOff(firmName, 'Intellectual Property Department')}
</div>
  `.trim();
}

export default function SendTrademarkReportModal({ open, onClose, deadlines, onReported }: Props) {
  const { fullName: firmName } = useBrand();
  const clientName = deadlines[0]?.trademark.clientName ?? '';
  const defaultRecipient = deadlines[0]?.trademark.contactEmail ?? '';

  const [to, setTo] = useState<string>('');
  const [cc, setCc] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [bodyHtml, setBodyHtml] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showSource, setShowSource] = useState(false);

  // Templates fetched from /api/trademark/templates
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [templateOverrides, setTemplateOverrides] = useState<Record<string, number>>({});
  const [placeholderOverrides, setPlaceholderOverrides] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    if (!open) return;
    setTo(defaultRecipient);
    setCc('');
    setSubject(buildDefaultSubject(clientName, deadlines));
    setBodyHtml(buildDefaultBody(clientName, deadlines, firmName));
    setSuccess(false);
    setError('');
    setWarnings([]);
    setShowSource(false);
    setTemplateOverrides({});
    setPlaceholderOverrides({});
    setTemplatesLoaded(false);

    fetch('/api/trademark/templates')
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates ?? []))
      .catch(() => setTemplates([]))
      .finally(() => setTemplatesLoaded(true));
  }, [open, clientName, defaultRecipient, deadlines]);

  useEffect(() => {
    if (!open) return;
    function h(e: KeyboardEvent) { if (e.key === 'Escape' && !submitting) onClose(); }
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose, submitting]);

  const parsedTo = useMemo<Recipient[]>(
    () => to.split(/[,;]/).map((s) => s.trim()).filter(Boolean).map((address) => ({ address })),
    [to],
  );
  const parsedCc = useMemo<Recipient[]>(
    () => cc.split(/[,;]/).map((s) => s.trim()).filter(Boolean).map((address) => ({ address })),
    [cc],
  );

  // Group templates by deadline kind for the per-row dropdown.
  const templatesByKind = useMemo(() => {
    const m = new Map<DeadlineKind, TemplateOption[]>();
    for (const t of templates) {
      if (!t.deadlineKind) continue;
      const list = m.get(t.deadlineKind) ?? [];
      list.push(t);
      m.set(t.deadlineKind, list);
    }
    return m;
  }, [templates]);

  // Resolve which template applies to each deadline (override or default-by-kind).
  const resolved = useMemo(() => {
    return deadlines.map((d) => {
      const overrideId = templateOverrides[deadlineKey(d)];
      const override = overrideId ? templates.find((t) => t.id === overrideId) ?? null : null;
      const fallback = templatesByKind.get(d.kind)?.[0] ?? null;
      const template = override ?? fallback;
      const missingPlaceholders = template
        ? (template.placeholders ?? [])
            .filter((p) => !!p.key && !AUTO_FILLED_KEYS.has(p.key))
        : [];
      return { deadline: d, template, missingPlaceholders };
    });
  }, [deadlines, templates, templatesByKind, templateOverrides]);

  if (!open) return null;

  function setPlaceholder(d: DashboardDeadline, key: string, value: string) {
    const k = deadlineKey(d);
    setPlaceholderOverrides((prev) => ({
      ...prev,
      [k]: { ...(prev[k] ?? {}), [key]: value },
    }));
  }

  async function send(mode: 'send' | 'mark') {
    setError('');
    setWarnings([]);
    if (mode === 'send' && parsedTo.length === 0) {
      setError('At least one recipient is required.');
      return;
    }
    setSubmitting(true);
    try {
      const endpoint =
        mode === 'send' ? '/api/trademark/send-report' : '/api/trademark/mark-reported';
      const body =
        mode === 'send'
          ? {
              deadlines: deadlines.map((d) => ({
                trademarkId: d.trademark.id, kind: d.kind, due: d.due,
              })),
              to: parsedTo,
              cc: parsedCc,
              subject,
              bodyHtml,
              templateOverrides,
              placeholderOverrides,
            }
          : {
              deadlines: deadlines.map((d) => ({
                trademarkId: d.trademark.id, kind: d.kind, due: d.due,
              })),
            };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        setWarnings(data.warnings);
      }
      setSuccess(true);
      onReported?.({ sentAt: new Date().toISOString(), recipientEmail: mode === 'send' ? parsedTo.map((r) => r.address).join(', ') : '' });
      setTimeout(() => { onClose(); }, 1100);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  }

  const hasMissingTemplate = resolved.some((r) => !r.template);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={submitting ? undefined : onClose} />
      <div className="relative overflow-hidden bg-white dark:bg-card rounded-2xl shadow-2xl shadow-stone-900/10 w-full max-w-2xl ring-1 ring-stone-900/5 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-4 shrink-0">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-400 via-blue-500 to-indigo-400" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-500/10 dark:to-blue-500/20 flex items-center justify-center ring-1 ring-blue-200/60 dark:ring-blue-500/20">
                <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100 leading-tight">
                  Client report — {clientName || '(unknown client)'}
                </h2>
                <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
                  {deadlines.length} deadline{deadlines.length === 1 ? '' : 's'} across {new Set(deadlines.map((d) => d.trademark.id)).size} mark{new Set(deadlines.map((d) => d.trademark.id)).size === 1 ? '' : 's'}
                </p>
              </div>
            </div>
            <button type="button" onClick={onClose} disabled={submitting} className="p-1.5 -mr-1 rounded-lg text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-white/10 cursor-pointer disabled:opacity-50">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {success ? (
          <div className="px-6 py-14 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-500/10 ring-4 ring-emerald-100/60 dark:ring-emerald-500/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-stone-800 dark:text-stone-100">Done.</p>
            {warnings.length > 0 && (
              <div className="mt-4 mx-auto max-w-md text-left text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2">
                {warnings.map((w, i) => (
                  <p key={i} className="leading-snug">{w}</p>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Form */}
            <div className="flex-1 overflow-y-auto px-5 pb-2 space-y-3">
              {/* Per-deadline attachments / templates */}
              <section className="rounded-lg border border-stone-200 dark:border-white/10 bg-stone-50/60 dark:bg-white/5 p-3 space-y-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider">
                  <Paperclip className="w-3 h-3" />
                  Attachments (one DOCX per deadline)
                </div>
                {resolved.map(({ deadline: d, template, missingPlaceholders }) => {
                  const k = deadlineKey(d);
                  const options = templatesByKind.get(d.kind) ?? [];
                  return (
                    <div key={k} className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-md p-2.5 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-stone-800 dark:text-stone-100 truncate">
                            {d.trademark.mark} <span className="text-stone-400 dark:text-stone-500">·</span> <span className="text-stone-600 dark:text-stone-300">{d.kind}</span> <span className="text-stone-400 dark:text-stone-500">·</span>{' '}
                            <span className={d.urgency === 'overdue' ? 'text-rose-700 dark:text-rose-300' : 'text-stone-700 dark:text-stone-200'}>{d.due}</span>
                          </p>
                        </div>
                        {templatesLoaded && options.length > 1 && (
                          <select
                            value={templateOverrides[k] ?? template?.id ?? ''}
                            onChange={(e) => setTemplateOverrides((prev) => ({ ...prev, [k]: Number(e.target.value) }))}
                            className="text-[11px] bg-stone-50 dark:bg-white/5 border border-stone-200 dark:border-white/10 rounded px-1.5 py-0.5 cursor-pointer"
                          >
                            {options.map((opt) => (
                              <option key={opt.id} value={opt.id}>{opt.name}</option>
                            ))}
                          </select>
                        )}
                      </div>

                      {!templatesLoaded ? (
                        <p className="text-[11px] text-stone-400 dark:text-stone-500">Loading templates…</p>
                      ) : !template ? (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          No template configured for {d.kind}. Email will send without an attachment for this deadline.
                        </p>
                      ) : (
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          {template.name}
                        </p>
                      )}

                      {missingPlaceholders.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1.5 border-t border-stone-100 dark:border-white/10">
                          {missingPlaceholders.map((p) => (
                            <label key={p.key} className="block">
                              <span className="text-[10px] text-stone-500 dark:text-stone-400 block">
                                {p.label || p.key}
                                {p.required && <span className="text-rose-600 dark:text-rose-400">*</span>}
                              </span>
                              <input
                                type={p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text'}
                                value={placeholderOverrides[k]?.[p.key] ?? ''}
                                onChange={(e) => setPlaceholder(d, p.key, e.target.value)}
                                className="w-full px-2 py-1 text-[11px] border border-stone-200 dark:border-white/10 rounded focus:outline-none focus:border-blue-400"
                              />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {hasMissingTemplate && (
                  <p className="text-[11px] text-stone-500 dark:text-stone-400 pt-1">
                    Manage templates at{' '}
                    <a href="/admin/templates" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
                      /admin/templates
                    </a>{' '}
                    (subcategory <code>trademark_report</code>).
                  </p>
                )}
              </section>

              <div className="grid grid-cols-1 gap-3">
                <Field label="To">
                  <input
                    type="text"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="client@example.com"
                    className="w-full px-3 py-1.5 text-sm border border-stone-200 dark:border-white/10 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"
                  />
                </Field>
                <Field label="CC (comma-separated)">
                  <input
                    type="text"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="optional"
                    className="w-full px-3 py-1.5 text-sm border border-stone-200 dark:border-white/10 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"
                  />
                </Field>
                <Field label="Subject">
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-stone-200 dark:border-white/10 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"
                  />
                </Field>
                <Field label={
                  <span className="flex items-center justify-between w-full">
                    <span>Body</span>
                    <button
                      type="button"
                      onClick={() => setShowSource((v) => !v)}
                      className="inline-flex items-center gap-1 text-[11px] font-normal text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100 cursor-pointer"
                    >
                      <FileEdit className="w-3 h-3" />
                      {showSource ? 'Show preview' : 'Edit HTML'}
                    </button>
                  </span>
                }>
                  {showSource ? (
                    <textarea
                      value={bodyHtml}
                      onChange={(e) => setBodyHtml(e.target.value)}
                      rows={10}
                      className="w-full px-3 py-2 text-xs font-mono bg-stone-50/60 dark:bg-white/5 border border-stone-200 dark:border-white/10 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"
                    />
                  ) : (
                    <div
                      className="border border-stone-200 dark:border-white/10 rounded-lg p-3 bg-white dark:bg-card max-h-56 overflow-y-auto prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: bodyHtml }}
                    />
                  )}
                </Field>
              </div>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-xs text-red-700 dark:text-red-300">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span className="flex-1">{error}</span>
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="px-5 py-3 border-t border-stone-100 dark:border-white/10 flex items-center gap-2 justify-end shrink-0">
              <button
                type="button"
                onClick={() => send('mark')}
                disabled={submitting}
                className="text-xs font-medium px-3 py-1.5 rounded-lg text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-white/10 cursor-pointer disabled:opacity-50"
                title="Record that you've contacted the client outside the system — no email is sent"
              >
                Mark reported (no email)
              </button>
              <button
                type="button"
                onClick={() => send('send')}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer disabled:opacity-60"
              >
                <Send className="w-3.5 h-3.5" />
                {submitting ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider mb-1 block">{label}</label>
      {children}
    </div>
  );
}
