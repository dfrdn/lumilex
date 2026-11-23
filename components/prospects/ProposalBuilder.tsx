'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, Save, Download, RefreshCw, Trash2, ArrowUp, ArrowDown,
  AlertTriangle, Send, ListPlus, Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { failureMessage } from '@/lib/api-error';
import CellDropdown from '@/components/admin/CellDropdown';
import DatePickerInput from '@/components/DatePickerInput';
import type {
  EngagementProposalContent, EngagementProposalRow, ProposalBlock, ProposalSection, ProposalQuote,
  ProposalFirmContact, ProposalPayment,
} from '@/lib/engagement-proposal/types';
import type { QuoteIssue } from '@/lib/engagement-proposal/quote';
import type { LoadedScopeTemplate } from '@/lib/scope-library/types';
import { offeredFor } from '@/lib/scope-library/select';
import {
  insertScopeLines, presentSubheadings, scheduleSlugsFor, SCOPE_HEADING,
} from '@/lib/engagement-proposal/scope';
import ProposalDraftModal from './ProposalDraftModal';
import type { AcceptanceFeeOption } from '@/lib/engagement-proposal/catalogue';
import type { ProposalDraftPayload } from './ProposalDraftForm';
import {
  BLOCK_KINDS, Card, IconBtn, AddBtn, Picker, inputCls, labelCls,
  type RetainerTierOption,
} from './proposal-ui';

type ProposalWithIssues = EngagementProposalRow & { issues?: QuoteIssue[] };

/**
 * Pull a line out of the scope library into a section that already exists.
 *
 * The draft-time picker is unreachable once a proposal has been created, so
 * without this a partner revising a letter has to retype the firm's wording —
 * which is how the scope drifted in the first place.
 */
function InsertScopeLines({ templates, arrangement, section, onInsert }: {
  templates: LoadedScopeTemplate[];
  arrangement: ProposalQuote['arrangement'];
  section: ProposalSection;
  onInsert: (slugs: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const present = presentSubheadings(section);
  const options = offeredFor(templates, arrangement).map((t) => ({
    id: t.slug,
    label: t.name,
    sublabel: present.has(t.content.subheading.trim().toLowerCase())
      ? 'already in this section'
      : t.content.role === 'exclusions' ? 'carve-outs' : undefined,
  }));

  if (!options.length) return null;

  return (
    <>
      <button type="button" ref={ref} onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">
        <ListPlus className="w-3.5 h-3.5" /> Insert from scope library
      </button>
      {open && (
        <CellDropdown
          mode="multi"
          value={[]}
          options={options}
          onSelect={(ids) => { if (ids.length) onInsert(ids); setOpen(false); }}
          onClose={() => setOpen(false)}
          anchorRef={ref}
          placeholder="Search scope lines…"
        />
      )}
    </>
  );
}

// ── Block editor ────────────────────────────────────────────────────
function BlockEditor({ block, onChange }: { block: ProposalBlock; onChange: (next: ProposalBlock) => void }) {
  if (block.kind === 'subheading') {
    return <input className={inputCls} value={block.text} placeholder="Sub-heading"
      onChange={(e) => onChange({ ...block, text: e.target.value })} />;
  }
  if (block.kind === 'labelled') {
    return (
      <div className="space-y-1.5">
        <input className={inputCls} value={block.label} placeholder="Bold lead-in"
          onChange={(e) => onChange({ ...block, label: e.target.value })} />
        <textarea className={`${inputCls} leading-relaxed`} rows={3} value={block.text}
          onChange={(e) => onChange({ ...block, text: e.target.value })} />
      </div>
    );
  }
  if (block.kind === 'list') {
    return (
      <div className="space-y-1.5">
        <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <input type="checkbox" checked={block.ordered}
            onChange={(e) => onChange({ ...block, ordered: e.target.checked })} />
          Numbered
        </label>
        {block.items.map((item, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <textarea className={`${inputCls} leading-relaxed`} rows={2} value={item}
              onChange={(e) => onChange({ ...block, items: block.items.map((v, j) => (j === i ? e.target.value : v)) })} />
            <IconBtn title="Remove item" onClick={() => onChange({ ...block, items: block.items.filter((_, j) => j !== i) })}>
              <Trash2 className="w-3.5 h-3.5" />
            </IconBtn>
          </div>
        ))}
        <AddBtn label="Add item" onClick={() => onChange({ ...block, items: [...block.items, ''] })} />
      </div>
    );
  }
  if (block.kind === 'feeTable') {
    return (
      <div className="space-y-1.5">
        {block.rows.map((row, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <div className="grid grid-cols-3 gap-1.5 flex-1">
              <input className={inputCls} value={row.fee} placeholder="Fee"
                onChange={(e) => onChange({ ...block, rows: block.rows.map((r, j) => (j === i ? { ...r, fee: e.target.value } : r)) })} />
              <input className={inputCls} value={row.amount} placeholder="Amount"
                onChange={(e) => onChange({ ...block, rows: block.rows.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)) })} />
              <input className={inputCls} value={row.when} placeholder="When billed"
                onChange={(e) => onChange({ ...block, rows: block.rows.map((r, j) => (j === i ? { ...r, when: e.target.value } : r)) })} />
            </div>
            <IconBtn title="Remove row" onClick={() => onChange({ ...block, rows: block.rows.filter((_, j) => j !== i) })}>
              <Trash2 className="w-3.5 h-3.5" />
            </IconBtn>
          </div>
        ))}
        <AddBtn label="Add fee row" onClick={() => onChange({ ...block, rows: [...block.rows, { fee: '', amount: '', when: '' }] })} />
      </div>
    );
  }
  return (
    <textarea className={`${inputCls} leading-relaxed`} rows={4} value={block.text}
      placeholder="Paragraph — wrap text in **double asterisks** for bold"
      onChange={(e) => onChange({ ...block, text: e.target.value })} />
  );
}

/**
 * Which section takes library lines. Matched on the heading rather than the
 * index so a letter that opens with a background section still offers it, and
 * falling back to the first section keeps a renamed heading usable.
 */
function isScopeSection(section: ProposalSection, index: number): boolean {
  const heading = section.heading.trim().toLowerCase();
  return heading === SCOPE_HEADING.toLowerCase() || heading.includes('scope') || index === 0;
}

function emptyBlock(kind: string): ProposalBlock {
  switch (kind) {
    case 'subheading': return { kind: 'subheading', text: '' };
    case 'labelled': return { kind: 'labelled', label: '', text: '' };
    case 'list': return { kind: 'list', ordered: true, items: [''] };
    case 'feeTable': return { kind: 'feeTable', rows: [{ fee: '', amount: '', when: '' }] };
    default: return { kind: 'para', text: '' };
  }
}

// ── Builder ─────────────────────────────────────────────────────────
export default function ProposalBuilder({ proposalId }: { proposalId: string }) {
  const [loading, setLoading] = useState(true);
  const [proposal, setProposal] = useState<ProposalWithIssues | null>(null);
  const [content, setContent] = useState<EngagementProposalContent | null>(null);
  const [versions, setVersions] = useState<ProposalWithIssues[]>([]);
  const [schedules, setSchedules] = useState<{ slug: string; name: string }[]>([]);
  // The prefix this firm's typeface set can print, for the scope-line figures
  // filled in the browser. It arrives with the scope library in the same
  // catalogue, and the picker that needs it renders nothing until that lands.
  const [pesoSymbol, setPesoSymbol] = useState('');
  const [scopeTemplates, setScopeTemplates] = useState<LoadedScopeTemplate[]>([]);
  const [proposedServices, setProposedServices] = useState<string[]>([]);
  const [retainerTiers, setRetainerTiers] = useState<RetainerTierOption[]>([]);
  const [acceptanceFees, setAcceptanceFees] = useState<AcceptanceFeeOption[]>([]);
  // The firm profile's block, shown when a draft predates the editable band.
  const [firmContact, setFirmContact] = useState<ProposalFirmContact | null>(null);
  // The firm's invoice account, shown when a draft predates the payment section.
  const [payment, setPayment] = useState<ProposalPayment | null>(null);
  const [dirty, setDirty] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [redrafting, setRedrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const set = useCallback((mut: (draft: EngagementProposalContent) => void) => {
    setContent((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      mut(next);
      return next;
    });
    setDirty(true);
  }, []);

  useEffect(() => {
    fetch(`/api/proposals/${proposalId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Proposal not found'))))
      .then((j) => {
        setProposal(j.proposal);
        setContent(j.proposal.content);
        setVersions(j.versions ?? []);
        setSchedules(j.schedules ?? []);
        setPesoSymbol(j.pesoSymbol ?? '');
        setScopeTemplates(j.scopeTemplates ?? []);
        setProposedServices(j.proposedServices ?? []);
        setRetainerTiers(j.retainerTiers ?? []);
        setAcceptanceFees(j.acceptanceFees ?? []);
        setFirmContact(j.firmContact ?? null);
        setPayment(j.payment ?? null);
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [proposalId]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const draftVersion = async (payload: ProposalDraftPayload) => {
    setDrafting(true);
    try {
      const r = await fetch(`/api/proposals/${proposalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await failureMessage(r, 'Could not draft the proposal.'));
      const j = await r.json();
      toast.success(`Draft version ${j.proposal.version} ready — review every section before sending.`);
      // A new version is its own row; the editor follows it rather than holding
      // the superseded one open under a version number that no longer matches.
      window.location.href = `/dashboard/prospects/proposals/${j.proposal.id}`;
    } catch (e) {
      toast.error((e as Error).message);
      setDrafting(false);
    }
  };

  const save = async (status?: string) => {
    if (!content || !proposal) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/proposals/${proposalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, ...(status ? { status } : {}) }),
      });
      if (!r.ok) throw new Error(await failureMessage(r, 'Save failed.'));
      const j = await r.json();
      setProposal(j.proposal);
      setDirty(false);
      toast.success(status ? `Marked ${status}` : 'Proposal saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const renderPdf = async (opts: { letterOnly: boolean; download: boolean }) => {
    if (!content) return;
    const busy = opts.download ? setDownloading : setPreviewing;
    busy(true);
    try {
      const r = await fetch(`/api/proposals/${proposalId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Send the editor's current content so a preview reflects unsaved edits.
          content,
          letterOnly: opts.letterOnly,
          persist: opts.download && !dirty,
        }),
      });
      if (!r.ok) throw new Error(await failureMessage(r, 'Could not render the proposal.'));

      const missing: string[] = JSON.parse(r.headers.get('X-Missing-Schedules') || '[]');
      if (missing.length) {
        toast.warning(`These fee schedules no longer exist and were skipped: ${missing.join(', ')}`);
      }

      const blob = await r.blob();
      if (opts.download) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${content.client.name} Engagement Proposal with Annexes v${proposal?.version ?? 1}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const url = URL.createObjectURL(blob);
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = url;
        setPreviewUrl(url);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      busy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-5 h-5 text-[var(--text-muted)] animate-spin" />
      </div>
    );
  }

  if (!content || !proposal) {
    return (
      <p className="text-sm text-[var(--text-muted)] py-12 text-center">
        This proposal could not be loaded.
      </p>
    );
  }

  const errors = (proposal?.issues ?? []).filter((i) => i.severity === 'error');
  const warnings = (proposal?.issues ?? []).filter((i) => i.severity === 'warning');

  // What the cover band will print: the proposal's own block, or — for a draft
  // saved before the band was editable — the firm profile's, which the renderer
  // substitutes. Editing either writes the block onto this proposal.
  const cover: ProposalFirmContact =
    content.firmContact ?? firmContact ?? { addressLines: [], phone: '', email: '', website: '' };
  const setCover = (mut: (c: ProposalFirmContact) => void) =>
    set((d) => {
      d.firmContact = structuredClone(d.firmContact ?? cover);
      mut(d.firmContact);
    });

  // Same arrangement for the payment section: the proposal's own block, or the
  // firm's invoice account, which the renderer substitutes.
  const pay: ProposalPayment =
    content.payment ?? payment ?? { bankName: '', accountName: '', accountNo: '', tin: '', note: '' };
  const setPay = (mut: (p: ProposalPayment) => void) =>
    set((d) => {
      d.payment = structuredClone(d.payment ?? pay);
      mut(d.payment);
    });

  // ── Editing an existing version ──────────────────────────────────
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div className="space-y-4 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">
            Version {proposal?.version} · {content.client.name}
          </h1>
          {dirty && <span className="text-xs text-amber-600 dark:text-amber-500">• unsaved</span>}
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={() => save()} disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-navy-900 text-white hover:bg-navy-800 dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
            </button>
            <button type="button" onClick={() => save('sent')} disabled={saving || dirty}
              title={dirty ? 'Save your edits first' : 'Record that this version was sent to the client'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--border-color)] hover:bg-[var(--bg-hover)] disabled:opacity-50">
              <Send className="w-3.5 h-3.5" /> Mark sent
            </button>
            <button type="button" onClick={() => setRedrafting(true)}
              title="Draft a further version of this proposal — this one stays on the record"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--border-color)] hover:bg-[var(--subtle-bg)]">
              <Plus className="w-3.5 h-3.5" /> New version
            </button>
          </div>
        </div>

        {versions.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <span className="text-[var(--text-muted)]">Versions</span>
            {versions.map((v) => (
              <Link key={v.id} href={`/dashboard/prospects/proposals/${v.id}`}
                className={`px-2 py-0.5 rounded-md border ${
                  v.id === proposal.id
                    ? 'border-transparent bg-navy-900 text-white dark:bg-navy-600'
                    : 'border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--subtle-bg)]'
                }`}>
                v{v.version}
              </Link>
            ))}
          </div>
        )}

        <ProposalDraftModal
          open={redrafting}
          onClose={() => setRedrafting(false)}
          title={`New version of the proposal to ${content.client.name}`}
          scopeTemplates={scopeTemplates}
          retainerTiers={retainerTiers}
          acceptanceFees={acceptanceFees}
          proposedServices={proposedServices}
          submitLabel="Draft new version"
          busy={drafting}
          onDraft={draftVersion}
        />

        {(errors.length > 0 || warnings.length > 0) && (
          <div className={`rounded-xl border px-4 py-3 text-xs space-y-1.5 ${
            errors.length
              ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
              : 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
          }`}>
            <p className={`font-medium flex items-center gap-1.5 ${errors.length ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-400'}`}>
              <AlertTriangle className="w-3.5 h-3.5" /> Checked against the current fee schedule
            </p>
            {[...errors, ...warnings].map((issue, i) => (
              <p key={i} className={errors.includes(issue) ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-400'}>
                {issue.message}
              </p>
            ))}
            <p className="text-[10px] text-[var(--text-muted)]">
              Figures are not corrected automatically — a partner may have agreed an off-schedule rate deliberately.
            </p>
          </div>
        )}

        <Card title="Letterhead">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={labelCls}>Date</span>
              <DatePickerInput variant="token" value={content.date} onChange={(v) => set((d) => { d.date = v ?? d.date; })} />
            </div>
            <div>
              <span className={labelCls}>Salutation</span>
              <input className={inputCls} value={content.salutation}
                onChange={(e) => set((d) => { d.salutation = e.target.value; })} />
            </div>
          </div>
          <div>
            <span className={labelCls}>Addressee (entity or person)</span>
            <input className={inputCls} value={content.client.name}
              onChange={(e) => set((d) => { d.client.name = e.target.value; })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={labelCls}>Attention</span>
              <input className={inputCls} value={content.client.attnName}
                onChange={(e) => set((d) => { d.client.attnName = e.target.value; })} />
            </div>
            <div>
              <span className={labelCls}>Title</span>
              <input className={inputCls} value={content.client.attnTitle}
                onChange={(e) => set((d) => { d.client.attnTitle = e.target.value; })} />
            </div>
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <input type="checkbox" checked={content.client.isCorporate}
              onChange={(e) => set((d) => { d.client.isCorporate = e.target.checked; })} />
            Corporate client — signs the conforme through an entity block
          </label>
          <div>
            <span className={labelCls}>Subject</span>
            <textarea className={inputCls} rows={2} value={content.subject}
              onChange={(e) => set((d) => { d.subject = e.target.value; })} />
          </div>
        </Card>

        <Card title="Firm contact" subtitle="The address and contact lines printed in the gold band on the cover.">
          <div>
            <span className={labelCls}>Address</span>
            <div className="space-y-1.5">
              {cover.addressLines.map((line, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <input className={inputCls} value={line}
                    onChange={(e) => setCover((c) => { c.addressLines[i] = e.target.value; })} />
                  <IconBtn title="Remove line" onClick={() => setCover((c) => { c.addressLines.splice(i, 1); })}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </IconBtn>
                </div>
              ))}
              <AddBtn label="Add address line" onClick={() => setCover((c) => { c.addressLines.push(''); })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <span className={labelCls}>Landline</span>
              <input className={inputCls} value={cover.phone}
                onChange={(e) => setCover((c) => { c.phone = e.target.value; })} />
            </div>
            <div>
              <span className={labelCls}>Email</span>
              <input className={inputCls} value={cover.email}
                onChange={(e) => setCover((c) => { c.email = e.target.value; })} />
            </div>
            <div>
              <span className={labelCls}>Website</span>
              <input className={inputCls} value={cover.website}
                onChange={(e) => setCover((c) => { c.website = e.target.value; })} />
            </div>
          </div>
          {!content.firmContact && (
            <p className="text-[10px] text-[var(--text-muted)]">
              Currently taken from the firm profile. Editing any field pins these lines to this proposal.
            </p>
          )}
        </Card>

        <Card title="Opening">
          {content.intro.map((para, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <textarea className={`${inputCls} leading-relaxed`} rows={4} value={para}
                onChange={(e) => set((d) => { d.intro[i] = e.target.value; })} />
              <IconBtn title="Remove paragraph" onClick={() => set((d) => { d.intro.splice(i, 1); })}>
                <Trash2 className="w-3.5 h-3.5" />
              </IconBtn>
            </div>
          ))}
          <AddBtn label="Add paragraph" onClick={() => set((d) => { d.intro.push(''); })} />
        </Card>

        {content.sections.map((section, si) => (
          <Card
            key={si}
            title={`${si + 1} · ${section.heading || 'Untitled section'}`}
            actions={
              <div className="flex items-center gap-0.5">
                <IconBtn title="Move up" onClick={() => set((d) => {
                  if (si === 0) return;
                  [d.sections[si - 1], d.sections[si]] = [d.sections[si], d.sections[si - 1]];
                })}><ArrowUp className="w-3.5 h-3.5" /></IconBtn>
                <IconBtn title="Move down" onClick={() => set((d) => {
                  if (si >= d.sections.length - 1) return;
                  [d.sections[si + 1], d.sections[si]] = [d.sections[si], d.sections[si + 1]];
                })}><ArrowDown className="w-3.5 h-3.5" /></IconBtn>
                <IconBtn title="Remove section" onClick={() => set((d) => { d.sections.splice(si, 1); })}>
                  <Trash2 className="w-3.5 h-3.5" />
                </IconBtn>
              </div>
            }
          >
            <div>
              <span className={labelCls}>Heading</span>
              <input className={inputCls} value={section.heading}
                onChange={(e) => set((d) => { d.sections[si].heading = e.target.value; })} />
            </div>
            {section.blocks.map((block, bi) => (
              <div key={bi} className="rounded-lg border border-[var(--border-color)] p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    {BLOCK_KINDS.find((k) => k.id === block.kind)?.label ?? block.kind}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <IconBtn title="Move up" onClick={() => set((d) => {
                      if (bi === 0) return;
                      const blocks = d.sections[si].blocks;
                      [blocks[bi - 1], blocks[bi]] = [blocks[bi], blocks[bi - 1]];
                    })}><ArrowUp className="w-3.5 h-3.5" /></IconBtn>
                    <IconBtn title="Move down" onClick={() => set((d) => {
                      const blocks = d.sections[si].blocks;
                      if (bi >= blocks.length - 1) return;
                      [blocks[bi + 1], blocks[bi]] = [blocks[bi], blocks[bi + 1]];
                    })}><ArrowDown className="w-3.5 h-3.5" /></IconBtn>
                    <IconBtn title="Remove block" onClick={() => set((d) => { d.sections[si].blocks.splice(bi, 1); })}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </IconBtn>
                  </div>
                </div>
                <BlockEditor block={block} onChange={(next) => set((d) => { d.sections[si].blocks[bi] = next; })} />
              </div>
            ))}
            <div className="flex items-center gap-3 flex-wrap">
              {BLOCK_KINDS.map((k) => (
                <AddBtn key={k.id} label={k.label}
                  onClick={() => set((d) => { d.sections[si].blocks.push(emptyBlock(k.id)); })} />
              ))}
              {isScopeSection(section, si) && (
                <InsertScopeLines
                  templates={scopeTemplates}
                  arrangement={content.quote?.arrangement ?? 'retainer'}
                  section={section}
                  onInsert={(slugs) => {
                    set((d) => {
                      d.sections[si] = insertScopeLines(
                        d.sections[si], scopeTemplates, slugs, d.quote ?? null, pesoSymbol,
                      );
                      // An inserted offer brings the annex that prices it.
                      const annexes = new Set(d.annexes.feeScheduleSlugs);
                      for (const slug of scheduleSlugsFor(scopeTemplates, slugs)) {
                        if (schedules.some((s) => s.slug === slug)) annexes.add(slug);
                      }
                      d.annexes.feeScheduleSlugs = [...annexes];
                    });
                    toast.success(slugs.length === 1 ? 'Scope line inserted' : `${slugs.length} scope lines inserted`);
                  }}
                />
              )}
            </div>
          </Card>
        ))}

        <AddBtn label="Add section" onClick={() => set((d) => {
          const section: ProposalSection = { heading: '', blocks: [] };
          d.sections.push(section);
        })} />

        <Card title="Closing">
          {content.closing.map((para, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <textarea className={`${inputCls} leading-relaxed`} rows={3} value={para}
                onChange={(e) => set((d) => { d.closing[i] = e.target.value; })} />
              <IconBtn title="Remove paragraph" onClick={() => set((d) => { d.closing.splice(i, 1); })}>
                <Trash2 className="w-3.5 h-3.5" />
              </IconBtn>
            </div>
          ))}
          <AddBtn label="Add paragraph" onClick={() => set((d) => { d.closing.push(''); })} />
        </Card>

        <Card title="Payment details" subtitle="Printed as the letter's last numbered section, so the client knows where to pay.">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={labelCls}>Bank</span>
              <input className={inputCls} value={pay.bankName}
                onChange={(e) => setPay((c) => { c.bankName = e.target.value; })} />
            </div>
            <div>
              <span className={labelCls}>Account number</span>
              <input className={inputCls} value={pay.accountNo}
                onChange={(e) => setPay((c) => { c.accountNo = e.target.value; })} />
            </div>
          </div>
          <div>
            <span className={labelCls}>Account name</span>
            <input className={inputCls} value={pay.accountName}
              onChange={(e) => setPay((c) => { c.accountName = e.target.value; })} />
          </div>
          <div>
            <span className={labelCls}>TIN</span>
            <input className={inputCls} value={pay.tin}
              onChange={(e) => setPay((c) => { c.tin = e.target.value; })} />
          </div>
          <div>
            <span className={labelCls}>Note (optional)</span>
            <textarea className={inputCls} rows={2} value={pay.note}
              placeholder="Anything else the client should know about paying — e.g. where to send proof of payment."
              onChange={(e) => setPay((c) => { c.note = e.target.value; })} />
          </div>
          {!content.payment && (
            <p className="text-[10px] text-[var(--text-muted)]">
              Currently taken from the firm&rsquo;s invoice settings, so the proposal and the invoices
              that follow it name the same account. Editing any field pins these to this proposal.
            </p>
          )}
        </Card>

        <Card title="Signature">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={labelCls}>Signing partner</span>
              <input className={inputCls} value={content.signer.name}
                onChange={(e) => set((d) => { d.signer.name = e.target.value; })} />
            </div>
            <div>
              <span className={labelCls}>Position</span>
              <input className={inputCls} value={content.signer.position}
                onChange={(e) => set((d) => { d.signer.position = e.target.value; })} />
            </div>
          </div>
        </Card>

        <Card title="Annexes" subtitle="Rendered from the current fee schedules and firm profile each time the package is built.">
          {schedules.map((s) => (
            <label key={s.slug} className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={content.annexes.feeScheduleSlugs.includes(s.slug)}
                onChange={(e) => set((d) => {
                  d.annexes.feeScheduleSlugs = e.target.checked
                    ? [...d.annexes.feeScheduleSlugs, s.slug]
                    : d.annexes.feeScheduleSlugs.filter((x) => x !== s.slug);
                })}
              />
              {s.name}
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
            <input type="checkbox" checked={content.annexes.includeFirmProfile}
              onChange={(e) => set((d) => { d.annexes.includeFirmProfile = e.target.checked; })} />
            Firm Profile
          </label>
        </Card>
      </div>

      <div className="min-w-0">
        <div className="sticky top-4 space-y-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button type="button" onClick={() => renderPdf({ letterOnly: true, download: false })} disabled={previewing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--border-color)] hover:bg-[var(--bg-hover)] disabled:opacity-50">
              {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Preview letter
            </button>
            <button type="button" onClick={() => renderPdf({ letterOnly: false, download: false })} disabled={previewing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--border-color)] hover:bg-[var(--bg-hover)] disabled:opacity-50">
              Preview with annexes
            </button>
            <button type="button" onClick={() => renderPdf({ letterOnly: false, download: true })} disabled={downloading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--border-color)] hover:bg-[var(--bg-hover)] disabled:opacity-50">
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Download package
            </button>
          </div>
          <div className="h-[calc(100vh-10rem)] rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden">
            {previewUrl ? (
              <iframe src={previewUrl} title="Proposal preview" className="w-full h-full border-0" />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-[var(--text-muted)] text-center px-6">
                {previewing ? 'Rendering…' : 'Choose a preview above to see the proposal as the client will receive it.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
