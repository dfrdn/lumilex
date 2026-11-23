'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Eye, History, Loader2, Pencil, RotateCcw } from 'lucide-react';
import LetterEditor, { PlaceholderButtons, type LetterEditorHandle } from '@/components/LetterEditor';
import { LetterPreview } from '@/components/letter-wording/LetterPreview';
import { RevisionList, type Revision } from '@/components/letter-wording/RevisionList';
import { BTN, CARD, LABEL, SAVE, modeButton, navItem } from '@/components/letter-wording/styles';
import CellDropdown from '@/components/admin/CellDropdown';
import { useBrand } from '@/components/BrandProvider';
import { formatDate } from '@/lib/format-date';
import { toManilaDay } from '@/lib/dates';
import { htmlToMarkup, markupToHtml } from '@/lib/letter-markup';
import type { LetterPlaceholder } from '@/lib/letter-placeholders';
import { REPORT_EVENTS, REPORT_EVENT_KEYS, buildClientReport, isReportEvent, reportSpec, type ReportEvent } from '@/lib/trademarks/client-report';
import { reportEmailHtml } from '@/lib/client-reports/letter';
import { wordingProblem } from '@/lib/trademarks/report-wording';
import { fieldsIn } from '@/lib/letter-wording';
import { sampleMarkFor } from '@/lib/trademarks/report-sample';
import { refNo } from '@/lib/trademark-deadlines';

interface Block {
  key: string;
  group: string;
  label: string;
  when: string;
  body: string;
  defaultBody: string;
  edited: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface Data {
  blocks: Block[];
  fields: LetterPlaceholder[];
  blockFields: LetterPlaceholder[];
  canEdit: boolean;
}

type Mode = 'letter' | 'email';

/** The report a shared paragraph is first previewed in — one that uses it. */
const SHARED_PREVIEW: Record<string, ReportEvent> = {
  'shared.closing': 'filing',
  'shared.dau3_reminder': 'filing',
  'shared.proof_of_use': 'filing',
  'shared.dau5_reminder': 'cor',
  'shared.dau5_pending': 'dau_3',
  'shared.renewal_reminder': 'dau_5',
  'shared.awaiting_registration': 'oa_response',
};

/** What a block is called in the list on the left. */
function navLabel(b: Block): string {
  if (b.key === 'oa_received.body_final') return 'Office Action report — final rejection';
  if (b.key.endsWith('_madrid')) return `${b.group} — Madrid designation`;
  return b.group === 'Shared' ? b.label : b.group;
}

/**
 * Trademarks → Report wording, laid out as the Billing Letter page: what can
 * be edited on the left, the editor and the report it makes side by side.
 * Every report is previewed on a made-up mark, never a client's.
 */
export default function ReportWordingEditor() {
  const [data, setData] = useState<Data | null>(null);
  const [mode, setMode] = useState<Mode>('letter');
  const [selected, setSelected] = useState('filing.body');

  const load = useCallback(async () => {
    const res = await fetch('/api/trademark/report-wording');
    if (res.ok) setData(await res.json());
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/trademark/report-wording')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (!cancelled && json) setData(json); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!data) {
    return (
      <div className={`${CARD} flex items-center gap-2 text-sm text-[var(--text-secondary)]`}>
        <Loader2 className="w-4 h-4 animate-spin" /> Loading the report wording…
      </div>
    );
  }

  const isMessage = (b: Block) => b.key.split('.')[1]?.startsWith('message') ?? false;
  const reports = data.blocks.filter((b) => b.group !== 'Shared' && (mode === 'email' ? isMessage(b) : !isMessage(b)));
  const shared = mode === 'letter' ? data.blocks.filter((b) => b.group === 'Shared') : [];
  const block = data.blocks.find((b) => b.key === selected) ?? reports[0];

  function switchMode(m: Mode) {
    setMode(m);
    setSelected(m === 'email' ? 'filing.message' : 'filing.body');
  }

  const item = (b: Block) => (
    <div key={b.key} className="flex">
      <button type="button" onClick={() => setSelected(b.key)} className={navItem(block.key === b.key)}>
        {navLabel(b)}
        {b.edited && <span className="ml-1.5 text-[10px] text-gold-700 dark:text-gold-400">edited</span>}
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-stone-200 dark:border-[rgba(255,255,255,0.1)] overflow-hidden text-sm">
          {([['letter', 'Letter'], ['email', 'Email']] as const).map(([m, l]) => (
            <button key={m} type="button" onClick={() => switchMode(m)} className={modeButton(mode === m)}>{l}</button>
          ))}
        </div>
        <p className="text-xs text-[var(--text-secondary)] max-w-xl sm:text-right">
          {mode === 'letter'
            ? 'The letter each report is, on the firm letterhead. Dates are fields the app works out from the mark, so an edit changes the words, never a deadline.'
            : 'The email each report is sent with from the firm\u2019s trademark mailbox, above the caption table. It can still be changed for one client when the report is sent.'}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav className={`${CARD} p-3 self-start space-y-4`} aria-label={mode === 'letter' ? 'Report letters' : 'Report emails'}>
          <div>
            <p className="px-2.5 mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Reports</p>
            {reports.map(item)}
          </div>
          {shared.length > 0 && (
            <div>
              <p className="px-2.5 mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Shared paragraphs</p>
              {shared.map(item)}
            </div>
          )}
        </nav>

        <BlockCard
          // Remounts whenever the stored wording changes (a save, a restore),
          // so the editor always starts from what is stored.
          key={`${block.key}:${block.updatedAt ?? 'default'}`}
          data={data}
          block={block}
          onSaved={load}
        />
      </div>
    </div>
  );
}

function BlockCard({ data, block, onSaved }: { data: Data; block: Block; onSaved: () => Promise<void> }) {
  const firmName = useBrand().fullName;
  const [html, setHtml] = useState(() => markupToHtml(block.body));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [allFields, setAllFields] = useState(false);
  const editor = useRef<LetterEditorHandle>(null);
  const editable = data.canEdit;

  const [report, part] = block.key.split('.');
  // A block's variants ("message_madrid", "body_final") belong with their kind.
  const message = part?.startsWith('message') ?? false;
  const [previewIn, setPreviewIn] = useState<ReportEvent>(isReportEvent(report) ? report : SHARED_PREVIEW[block.key] ?? 'filing');

  const body = htmlToMarkup(html);
  const dirty = body !== block.body;
  const problem = dirty ? wordingProblem(body) : null;
  const chips = useMemo(() => (message ? data.fields : [...data.fields, ...data.blockFields]), [message, data.fields, data.blockFields]);
  // The fields this wording uses come first; the rest wait behind "More fields".
  const used = new Set(fieldsIn(`${block.defaultBody}\n${body}`));
  const shownChips = allFields ? chips : chips.filter((c) => used.has(c.key));

  const sample = useMemo(() => {
    if (problem) return null;
    const saved = Object.fromEntries(data.blocks.map((b) => [b.key, b.body]));
    const t = sampleMarkFor(previewIn, { finalRejection: part === 'body_final', designation: part?.endsWith('_madrid') });
    const r = buildClientReport(t, previewIn, {
      today: '2026-10-19',
      signatory: { name: 'Juan dela Cruz', position: 'Associate' },
      letter: { attention: 'Ms. Maria Santos' },
      annexes: [reportSpec(t, previewIn).annexDocument],
      wording: { ...saved, [block.key]: body },
    });
    return { report: r, refNo: refNo(t) };
  }, [problem, data.blocks, previewIn, part, block.key, body]);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch('/api/trademark/report-wording', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: block.key, body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not save the wording');
      toast.success(`${navLabel(block)} saved`);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the wording');
    } finally {
      setBusy(false);
    }
  }

  async function restoreDefault() {
    setBusy(true);
    try {
      const res = await fetch(`/api/trademark/report-wording?key=${encodeURIComponent(block.key)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not put the default back');
      toast.success('Default wording back in place');
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not put the default back');
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory() {
    const res = await fetch(`/api/content-revisions?entityType=trademark_report_wording&entityId=${encodeURIComponent(block.key)}`);
    const json = await res.json().catch(() => ({}));
    setRevisions(json.revisions ?? []);
  }

  async function restoreRevision(rev: Revision) {
    setBusy(true);
    try {
      const res = await fetch('/api/content-revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType: 'trademark_report_wording', revisionId: rev.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not restore that version');
      toast.success('Earlier version restored');
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not restore that version');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{navLabel(block)}{block.group !== 'Shared' && <span className="font-normal text-[var(--text-secondary)]"> — {message ? 'email' : 'letter'}</span>}</h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {block.when.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => `“${chips.find((c) => c.key === k)?.label ?? k}”`)}.
            {block.edited && block.updatedAt
              ? <> Edited{block.updatedBy ? ` by ${block.updatedBy}` : ''} on {formatDate(toManilaDay(block.updatedAt))}.</>
              : <> The default wording.</>}
          </p>
        </div>
        <button type="button" onClick={() => setPreview((v) => !v)} className={`${BTN} xl:hidden`}>
          {preview ? <Pencil className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>

      <div className="mt-4 grid gap-5 xl:grid-cols-2">
        <div className={`space-y-4 min-w-0 ${preview ? 'hidden xl:block' : ''}`}>
          <div>
            <label htmlFor="report-wording" className={LABEL}>Wording</label>
            <LetterEditor
              ref={editor}
              id="report-wording"
              ariaLabel="Wording"
              variant="rich"
              formatting={message ? 'basic' : 'lists'}
              placeholders={chips}
              value={html}
              disabled={busy || !editable}
              onChange={setHtml}
            />
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
              Enter starts a new paragraph. Put [[ ]] around words that should drop out when a field inside them is blank.
              {!message && ' A block field — Proof of use, the DAU and renewal reminders, the goods & services list — goes in a paragraph of its own.'}
            </p>
          </div>
          {editable && (
            <div>
              <PlaceholderButtons label={allFields ? 'Fields' : 'Fields in this wording'} placeholders={shownChips} editor={editor} disabled={busy} />
              <button type="button" onClick={() => setAllFields((v) => !v)} className="mt-1.5 text-[11px] text-gold-700 dark:text-gold-400 hover:underline cursor-pointer">
                {allFields ? 'Show only the fields in this wording' : `More fields (${chips.length - shownChips.length})`}
              </button>
            </div>
          )}
          {problem && <p className="text-xs text-rose-600 dark:text-rose-400">{problem}</p>}
          {!editable && <p className="text-xs text-[var(--text-secondary)]">Lawyers, partners and admins can change the wording.</p>}
          {revisions && <RevisionList revisions={revisions} busy={busy} onRestore={editable ? (r) => void restoreRevision(r) : undefined} />}
        </div>

        <div className={`min-w-0 ${preview ? '' : 'hidden xl:block'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className={`${LABEL} mb-0`}>Preview: a made-up mark, as its client would get it</p>
            {block.group === 'Shared' && <PreviewInPicker value={previewIn} onChange={setPreviewIn} />}
          </div>
          {!sample ? (
            <p className="text-xs text-[var(--text-secondary)]">Fix the wording to see the preview.</p>
          ) : message ? (
            <EmailPreview
              subject={sample.report.subject}
              html={reportEmailHtml({ message: sample.report.message, caption: sample.report.caption, refNo: sample.refNo, senderName: 'Juan dela Cruz', firm: { name: firmName, addressLines: [] } })}
            />
          ) : (
            <LetterPreview paragraphs={sample.report.paragraphs} />
          )}
        </div>
      </div>

      {editable && (
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={() => void loadHistory()} disabled={busy} className={`${BTN} mr-auto`}>
            <History className="w-3.5 h-3.5" /> History
          </button>
          {block.edited && !dirty && (
            <button type="button" onClick={() => void restoreDefault()} disabled={busy} className={BTN}>
              <RotateCcw className="w-3.5 h-3.5" /> Use the default
            </button>
          )}
          {dirty && (
            <button type="button" disabled={busy} className={BTN} onClick={() => setHtml(markupToHtml(block.body))}>
              Discard changes
            </button>
          )}
          <button type="button" onClick={() => void save()} disabled={busy || !dirty || !!problem} className={SAVE}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Save
          </button>
        </div>
      )}
    </section>
  );
}

/** Which report a shared paragraph is previewed in. */
function PreviewInPicker({ value, onChange }: { value: ReportEvent; onChange: (e: ReportEvent) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)] hover:text-foreground cursor-pointer">
        In the {REPORT_EVENTS[value].label.toLowerCase()} <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <CellDropdown
          mode="single"
          value={value}
          options={REPORT_EVENT_KEYS.map((e) => ({ id: e, label: REPORT_EVENTS[e].label }))}
          minWidth={240}
          onSelect={(id) => {
            setOpen(false);
            if (id && isReportEvent(id)) onChange(id);
          }}
          onClose={() => setOpen(false)}
          anchorRef={ref}
        />
      )}
    </>
  );
}

/** The covering email as the client reads it. */
function EmailPreview({ subject, html }: { subject: string; html: string }) {
  const firmName = useBrand().fullName;
  return (
    <div className="rounded-lg border border-stone-200 dark:border-[rgba(255,255,255,0.1)] bg-white overflow-hidden">
      <div className="px-4 py-2 border-b border-stone-200 text-xs text-stone-600">
        <p><span className="text-stone-400">From</span> {firmName ? `${firmName}, trademark mailbox` : 'The firm\u2019s trademark mailbox'}</p>
        <p className="font-medium text-stone-800">{subject}</p>
      </div>
      <iframe title="Email preview" sandbox="" srcDoc={`<div style="font-family:Arial,sans-serif;font-size:13px;color:#1c1917;line-height:1.5">${html}</div>`} className="w-full h-[480px] bg-white" />
    </div>
  );
}
