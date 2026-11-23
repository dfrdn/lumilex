'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Eye, History, Loader2, Lock, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import LetterEditor, { PlaceholderButtons, type LetterEditorHandle } from '@/components/LetterEditor';
import BillingEmailFrame from '@/components/finance/BillingEmailFrame';
import { formatDate } from '@/lib/format-date';
import { toManilaDay } from '@/lib/dates';
import { billingLetterParagraphs, letterFacts, letterFields, systemTexts, type BillingLetterParams } from '@/lib/billing/letter-content';
import { letterWording, unknownFields } from '@/lib/billing/letter-blocks';
import { renderBillingEmail, type BillingEmailInvoice } from '@/lib/billing/email-blocks';
import { htmlToMarkup, markupToHtml } from '@/lib/letter-markup';
import { SYSTEM_PARAGRAPHS, describeRule, type BillingParagraph, type DocumentKind, type FactKey, type RuleTerm } from '@/lib/billing/paragraphs';
import type { LetterPlaceholder } from '@/lib/letter-placeholders';
import type { EmailBrand } from '@/lib/email-chrome';
import { LetterPreview } from '@/components/letter-wording/LetterPreview';
import { RevisionList, type Revision } from '@/components/letter-wording/RevisionList';
import { BTN, CARD, INPUT, LABEL, SAVE, modeButton, navItem } from '@/components/letter-wording/styles';


type Stamped = { updatedAt: string | null; updatedBy: string | null };
type Paragraph = BillingParagraph & Stamped;
interface Line extends Stamped { document: DocumentKind; key: string; label: string; when: string; body: string; defaultBody: string }

interface TemplateData {
  lines: Line[];
  paragraphs: Record<DocumentKind, Paragraph[]>;
  facts: { key: FactKey; label: string }[];
  choices: { key: string; label: string }[];
  placeholders: LetterPlaceholder[];
  canEdit: boolean;
  signer: { name: string; position: string; atty: boolean };
  /** The firm's name and mark, for the email preview's frame. Set by the page, not the API. */
  brand: EmailBrand;
}

type Selection = { kind: 'paragraph'; key: string } | { kind: 'line'; key: string } | { kind: 'new' };

/** A new paragraph ticked per client on its own; the server names the choice by the new key. */
const OWN_CHOICE = '__own';
const SAMPLE_CLIENT = 'Acme Holdings Corporation';

const plainText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// ── The sample invoice the preview writes ──────────────────────────────

interface Sample {
  vat: boolean;
  expenses: boolean;
  balance: 'owed' | 'credit' | 'none';
  overCap: boolean;
  lessenFees: boolean;
  initialStatement: boolean;
  moneyOnHand: boolean;
  bankDetails: boolean;
  discount: boolean;
}

const BASE_SAMPLE: Sample = {
  vat: true, expenses: true, balance: 'none', overCap: false, lessenFees: false, initialStatement: false,
  moneyOnHand: false, bankDetails: true, discount: true,
};

/** The sample set up so that a paragraph with this rule shows. */
function sampleFor(rule: RuleTerm[], system: BillingParagraph['system']): Sample {
  const s = { ...BASE_SAMPLE };
  if (system === 'deposit') s.moneyOnHand = true;
  for (const t of rule) {
    switch (t.fact) {
      case 'previousBalance': if (t.is) s.balance = 'owed'; else if (s.balance === 'owed') s.balance = 'none'; break;
      case 'advanceCredit': if (t.is) s.balance = 'credit'; else if (s.balance === 'credit') s.balance = 'none'; break;
      case 'payable': if (t.is) s.moneyOnHand = false; break;
      default: s[t.fact] = t.is;
    }
  }
  return s;
}

function sampleParams(o: Sample, signer: TemplateData['signer'], chosen: string[], firmName: string): BillingLetterParams {
  const fees = 42_000;
  const expenses = o.expenses ? 2_500 : 0;
  const total = Math.round((fees + expenses) * (o.vat ? 1.12 : 1) * 100) / 100;
  const prev = o.balance === 'owed' ? 36_500 : o.balance === 'credit' ? -10_000 : 0;
  const withBalance = prev ? Math.round((total + prev) * 100) / 100 : undefined;
  return {
    firmName,
    date: '17 October 2026',
    invoiceNumber: 'INV-2026-09-001',
    addressee: 'company',
    clientName: SAMPLE_CLIENT,
    clientAddress: '12/F Tower One, Ayala Avenue\nMakati City',
    attnName: 'Ms. Jane Doe',
    attnTitle: 'Chief Financial Officer',
    billingPeriod: 'September 2026',
    engagementDate: '2025-08-14',
    retainerCap: o.overCap ? 20_000 : undefined,
    retainerHoursCap: o.overCap ? 10 : undefined,
    actualHoursAmount: o.overCap ? 58_000 : undefined,
    includeLessenFeesNote: o.lessenFees,
    totalAmount: total,
    totalExpenses: expenses,
    previousBalance: prev || undefined,
    previousBalanceLabel: o.balance === 'owed' ? 'outstanding balance for periods through 31 August 2026' : o.balance === 'credit' ? 'advance deposit on file as of 30 September 2026' : undefined,
    totalWithBalance: withBalance,
    depositOnHand: o.moneyOnHand ? 200_000 : undefined,
    includeVAT: o.vat,
    bankName: 'Sample Bank',
    bankAccountNo: o.bankDetails ? '000123456789' : '',
    bankAccountName: firmName || 'The firm',
    dueDate: '24 October 2026',
    signerName: signer.name || 'Juan dela Cruz',
    signerPosition: signer.position || 'Managing Partner',
    signerAtty: signer.atty,
    initialStatement: o.initialStatement,
    optionalParagraphs: chosen,
    earlyPayment: o.discount ? { percent: 5, amount: Math.round(fees * 0.05 * (o.vat ? 1.12 : 1) * 100) / 100, deadline: '2026-10-22' } : null,
  };
}

// ── The previews ───────────────────────────────────────────────────────

/**
 * The letter or the email as the sample client would get it, with the edit in
 * progress laid in. Every client choice is ticked, so each paragraph can show.
 */
function DocumentPreview({ data, document, sample, paragraphs, lines }: {
  data: TemplateData;
  document: DocumentKind;
  sample: Sample;
  paragraphs: BillingParagraph[];
  lines: Line[];
}) {
  const chosen = [...new Set([...data.choices.map((c) => c.key), ...paragraphs.map((p) => p.choice).filter((c): c is string => !!c)])];
  const params = sampleParams(sample, data.signer, chosen, data.brand.firmName);
  const letterLines = lines.filter((l) => l.document === 'letter').map((l) => ({ key: l.key, kind: 'standard', body: l.body }));
  if (document === 'letter') {
    return <LetterPreview paragraphs={billingLetterParagraphs({ ...params, wording: letterWording(letterLines, paragraphs) })} />;
  }
  // The email reads what the letter froze at generation; the preview freezes it the same way.
  const wording = letterWording(letterLines, data.paragraphs.letter);
  const invoice: BillingEmailInvoice = {
    invoice_number: params.invoiceNumber!,
    client_name: SAMPLE_CLIENT,
    billing_month: '2026-09',
    total_amount: 42_000,
    total_expenses: params.totalExpenses ?? 0,
    billing_settings: { optionalParagraphs: chosen },
  };
  const email = renderBillingEmail(invoice, {
    paragraphs,
    subject: lines.find((l) => l.key === 'email_subject')?.body,
    brand: data.brand,
    basis: { fields: letterFields(params, wording), facts: letterFacts(params), system: systemTexts(params) },
  });
  return <BillingEmailFrame html={email.html} subject={email.subject} />;
}

const SAMPLE_TOGGLES: [Exclude<keyof Sample, 'balance'>, string][] = [
  ['vat', 'VAT'], ['expenses', 'Expenses'], ['overCap', 'Over the cap'], ['lessenFees', 'Lessen fees'],
  ['initialStatement', 'Initial statement'], ['moneyOnHand', 'Advance deposit'],
  ['discount', 'Discount'], ['bankDetails', 'Bank details'],
];

function SampleControls({ sample, onChange }: { sample: Sample; onChange: (s: Sample) => void }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]">
      {SAMPLE_TOGGLES.map(([k, l]) => (
        <label key={k} className="inline-flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={sample[k]} onChange={(e) => onChange({ ...sample, [k]: e.target.checked })} className="rounded" />
          {l}
        </label>
      ))}
      <span className="inline-flex rounded border border-stone-200 dark:border-[rgba(255,255,255,0.1)] overflow-hidden">
        {(['owed', 'credit', 'none'] as const).map((b) => (
          <button key={b} type="button" onClick={() => onChange({ ...sample, balance: b })}
            className={`px-1.5 py-0.5 cursor-pointer ${sample.balance === b ? 'bg-stone-100 dark:bg-white/10 text-foreground' : ''}`}>
            {b === 'owed' ? 'Balance owed' : b === 'credit' ? 'Credit' : 'No balance'}
          </button>
        ))}
      </span>
    </div>
  );
}

// ── The page ───────────────────────────────────────────────────────────

export default function BillingLetterEditor({ emailBrand }: { emailBrand: EmailBrand }) {
  const [data, setData] = useState<TemplateData | null>(null);
  const [mode, setMode] = useState<DocumentKind>('letter');
  const [selected, setSelected] = useState<Selection>({ kind: 'paragraph', key: 'bill' });

  const load = useCallback(async () => {
    const res = await fetch('/api/finance/letter-template');
    if (res.ok) setData({ ...(await res.json()), brand: emailBrand });
  }, [emailBrand]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/finance/letter-template')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (!cancelled && json) setData({ ...json, brand: emailBrand }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [emailBrand]);

  if (!data) {
    return (
      <div className={`${CARD} flex items-center gap-2 text-sm text-[var(--text-secondary)]`}>
        <Loader2 className="w-4 h-4 animate-spin" /> Loading the billing letter…
      </div>
    );
  }

  const paragraphs = data.paragraphs[mode];
  const lines = data.lines.filter((l) => l.document === mode);
  const choiceLabel = (key: string | null) => (key ? data.choices.find((c) => c.key === key)?.label : undefined);

  function switchMode(m: DocumentKind) {
    setMode(m);
    const first = data!.paragraphs[m].find((p) => !p.system && p.key !== 'greeting');
    setSelected(first ? { kind: 'paragraph', key: first.key } : { kind: 'new' });
  }

  async function move(key: string, by: -1 | 1) {
    const keys = paragraphs.map((p) => p.key);
    const i = keys.indexOf(key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    const byKey = new Map(paragraphs.map((p) => [p.key, p]));
    setData((d) => d && { ...d, paragraphs: { ...d.paragraphs, [mode]: keys.map((k) => byKey.get(k)!) } });
    const res = await fetch('/api/finance/letter-template/paragraphs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: mode, keys }),
    });
    if (!res.ok) {
      toast.error('Could not save the new order');
      await load();
    }
  }

  async function setSignature(change: { atty?: boolean }, message: string) {
    const before = data!.signer;
    setData((d) => (d ? { ...d, signer: { ...d.signer, ...change } } : d));
    const res = await fetch('/api/finance/letter-template', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signerAtty: change.atty }),
    });
    if (!res.ok) {
      setData((d) => (d ? { ...d, signer: before } : d));
      toast.error('Could not save the signature setting');
      return;
    }
    toast.success(message);
  }

  const paragraph = selected.kind === 'paragraph' ? paragraphs.find((p) => p.key === selected.key) ?? null : null;
  const line = selected.kind === 'line' ? lines.find((l) => l.key === selected.key) ?? null : null;
  // Remounts the card whenever the stored wording changes (a save, a restore),
  // so the editor always starts from what is stored.
  const cardKey = paragraph
    ? `${mode}:p:${paragraph.key}:${paragraph.updatedAt ?? 'seed'}`
    : line ? `${mode}:l:${line.key}:${line.updatedAt ?? 'default'}` : `${mode}:new`;
  // A new paragraph goes in before the closing lines.
  const tail = new Set(['closing', 'signoff']);
  const insertAfter = paragraphs.filter((p) => !tail.has(p.key)).at(-1)?.key;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-stone-200 dark:border-[rgba(255,255,255,0.1)] overflow-hidden text-sm">
          {([['letter', 'Letter'], ['email', 'Email']] as const).map(([m, l]) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={modeButton(mode === m)}
            >
              {l}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--text-secondary)] max-w-xl sm:text-right">
          {mode === 'letter'
            ? 'The letter every invoice goes out with, on the firm letterhead. Each paragraph shows when its conditions hold for the invoice.'
            : "The email every invoice is sent with, in the firm's branded frame, with the letter and its breakdown attached. Each paragraph shows when its conditions hold."}
        </p>
      </div>

      {mode === 'letter' && (
        <section className={`${CARD} flex flex-wrap items-center justify-between gap-3`}>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Signature</h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Every billing letter is signed by the Managing Partner{data.signer.name ? <>, now {data.signer.name}</> : null}. The name under the signature reads{' '}
              <span className="font-medium text-foreground">{data.signer.atty ? 'Atty. ' : ''}{data.signer.name || 'the Managing Partner'}</span>.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={`inline-flex items-center gap-2 text-sm ${data.canEdit ? 'cursor-pointer' : 'opacity-60'}`}>
              <input type="checkbox" checked={data.signer.atty} disabled={!data.canEdit} className="rounded"
                onChange={(e) => void setSignature({ atty: e.target.checked }, e.target.checked ? 'Letters now write "Atty." before the signatory' : 'Letters no longer write "Atty." before the signatory')} />
              Write &quot;Atty.&quot; before the name
            </label>
          </div>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav className={`${CARD} p-3 self-start space-y-4`} aria-label={mode === 'letter' ? 'Letter paragraphs' : 'Email paragraphs'}>
          <div>
            <p className="px-2.5 mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Paragraphs, in order</p>
            {paragraphs.map((p, i) => {
              const active = selected.kind === 'paragraph' && selected.key === p.key;
              return (
                <div key={p.key} className="flex items-center gap-0.5">
                  <button type="button" onClick={() => setSelected({ kind: 'paragraph', key: p.key })} className={navItem(active)} title={describeRule(p, choiceLabel(p.choice))}>
                    <span className="flex items-center gap-1.5 min-w-0">
                      {p.system && <Lock className="w-3 h-3 shrink-0 text-[var(--text-muted)]" aria-label="Worded by the app" />}
                      <span className="truncate">{p.label}</span>
                    </span>
                  </button>
                  {active && data.canEdit && (
                    <span className="flex shrink-0">
                      <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => void move(p.key, -1)}
                        className="p-1 rounded hover:bg-stone-100 dark:hover:bg-white/10 disabled:opacity-30 cursor-pointer">
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" aria-label="Move down" disabled={i === paragraphs.length - 1} onClick={() => void move(p.key, 1)}
                        className="p-1 rounded hover:bg-stone-100 dark:hover:bg-white/10 disabled:opacity-30 cursor-pointer">
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
            {data.canEdit && (
              <button type="button" onClick={() => setSelected({ kind: 'new' })} className={`${navItem(selected.kind === 'new')} w-full mt-1 inline-flex items-center gap-1.5`}>
                <Plus className="w-3.5 h-3.5" /> Add paragraph
              </button>
            )}
          </div>
          <div>
            <p className="px-2.5 mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Fixed lines</p>
            {lines.map((l) => (
              <div key={l.key} className="flex">
                <button type="button" onClick={() => setSelected({ kind: 'line', key: l.key })} className={navItem(selected.kind === 'line' && selected.key === l.key)}>
                  {l.label}
                  {l.updatedAt && <span className="ml-1.5 text-[10px] text-gold-700 dark:text-gold-400">edited</span>}
                </button>
              </div>
            ))}
          </div>
        </nav>

        {line ? (
          <LineCard key={cardKey} data={data} document={mode} line={line} onSaved={load} />
        ) : (
          <ParagraphCard
            key={cardKey}
            data={data}
            document={mode}
            paragraph={paragraph}
            after={insertAfter}
            onSaved={async (key) => {
              await load();
              if (key) setSelected({ kind: 'paragraph', key });
            }}
            onDeleted={async () => {
              const next = paragraphs.find((p) => !p.system && p.key !== paragraph?.key);
              await load();
              setSelected(next ? { kind: 'paragraph', key: next.key } : { kind: 'new' });
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── One paragraph ──────────────────────────────────────────────────────

function ParagraphCard({ data, document, paragraph, after, onSaved, onDeleted }: {
  data: TemplateData;
  document: DocumentKind;
  /** null for a new paragraph. */
  paragraph: Paragraph | null;
  /** Where a new paragraph goes: right after this one. */
  after?: string;
  onSaved: (key?: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const isNew = !paragraph;
  const system = paragraph?.system ?? null;
  // Letter paragraphs are stored as the letter markup; email paragraphs as HTML.
  const toHtml = (body: string) => (document === 'letter' ? markupToHtml(body) : body);
  const fromHtml = (html: string) => (document === 'letter' ? htmlToMarkup(html) : html);

  const [label, setLabel] = useState(paragraph?.label ?? '');
  const [html, setHtml] = useState(() => toHtml(paragraph?.body ?? ''));
  const [rule, setRule] = useState<RuleTerm[]>(paragraph?.rule ?? []);
  const [choice, setChoice] = useState<string | null>(paragraph?.choice ?? null);
  const [sample, setSample] = useState<Sample>(() => sampleFor(paragraph?.rule ?? [], system));
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const editor = useRef<LetterEditorHandle>(null);
  const editable = data.canEdit;

  const body = system ? '' : fromHtml(html);
  const name = label.trim();
  const ownChoice = paragraph?.key ?? OWN_CHOICE;
  const draft: BillingParagraph = {
    key: paragraph?.key ?? '__new',
    document,
    label: name || 'New paragraph',
    body,
    rule,
    choice,
    system,
    sortOrder: paragraph?.sortOrder ?? 0,
    archived: false,
  };
  const sameRule = (a: RuleTerm[], b: RuleTerm[]) =>
    a.length === b.length && a.every((t) => b.some((u) => u.fact === t.fact && u.is === t.is));
  const dirty = isNew
    ? !!name || !!plainText(body)
    : name !== paragraph!.label || (!system && (body !== paragraph!.body || !sameRule(rule, paragraph!.rule) || choice !== paragraph!.choice));
  const unknown = system ? [] : unknownFields(body);
  const empty = !system && !plainText(body);

  const previewList: BillingParagraph[] = data.paragraphs[document].map((p) => (p.key === paragraph?.key ? draft : p));
  if (isNew) {
    const at = after ? previewList.findIndex((p) => p.key === after) + 1 : previewList.length;
    previewList.splice(at, 0, draft);
  }

  const choiceOptions = [
    ...data.choices.filter((c) => c.key !== ownChoice),
    { key: ownChoice, label: isNew ? `${name || 'This paragraph'} (a new choice)` : `${paragraph!.label} (its own)` },
  ];

  function setTerm(fact: FactKey, value: boolean | null) {
    const next = [...rule.filter((t) => t.fact !== fact), ...(value === null ? [] : [{ fact, is: value }])];
    setRule(next);
    setSample(sampleFor(next, system));
  }

  async function save() {
    setBusy(true);
    try {
      const payload = isNew
        ? { document, label: name, body, rule, choice, after }
        : system
          ? { document, key: paragraph!.key, label: name }
          : { document, key: paragraph!.key, label: name, body, rule, choice };
      const res = await fetch('/api/finance/letter-template/paragraphs', {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not save the paragraph');
      toast.success(`${name} ${isNew ? 'added' : 'saved'}`);
      await onSaved(json.key);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the paragraph');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch('/api/finance/letter-template/paragraphs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document, key: paragraph!.key }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not delete the paragraph');
      setDeleting(false);
      toast.success(`${paragraph!.label} deleted`);
      await onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the paragraph');
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory() {
    const res = await fetch(`/api/content-revisions?entityType=billing_paragraph&entityId=${encodeURIComponent(`${document}:${paragraph!.key}`)}`);
    const json = await res.json().catch(() => ({}));
    setRevisions(json.revisions ?? []);
  }

  async function restoreRevision(rev: Revision) {
    setBusy(true);
    try {
      const res = await fetch('/api/content-revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType: 'billing_paragraph', revisionId: rev.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not restore that version');
      toast.success('Earlier version restored');
      await onSaved(paragraph!.key);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not restore that version');
    } finally {
      setBusy(false);
    }
  }

  const termOf = (fact: FactKey) => rule.find((t) => t.fact === fact)?.is ?? null;
  const chosenLabel = choiceOptions.find((c) => c.key === choice)?.label;

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{isNew ? 'New paragraph' : paragraph!.label}</h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {system
              ? <>{SYSTEM_PARAGRAPHS[system].when}. The app words it from the invoice&apos;s figures; you can rename and move it.</>
              : <>{describeRule(draft, chosenLabel)}.</>}
            {paragraph?.updatedAt && paragraph.updatedBy ? <> Edited by {paragraph.updatedBy} on {formatDate(toManilaDay(paragraph.updatedAt))}.</> : null}
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
            <label htmlFor="paragraph-name" className={LABEL}>Name</label>
            <input id="paragraph-name" value={label} onChange={(e) => setLabel(e.target.value)} disabled={busy || !editable} maxLength={120}
              placeholder="e.g. Acceptance fee deferred" className={INPUT} />
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">For finance only; the client never sees it.</p>
          </div>

          {!system && (
            <>
              <div>
                <label htmlFor="paragraph-wording" className={LABEL}>Wording</label>
                <LetterEditor
                  ref={editor}
                  id="paragraph-wording"
                  ariaLabel="Wording"
                  variant="rich"
                  formatting="basic"
                  placeholders={data.placeholders}
                  value={html}
                  disabled={busy || !editable}
                  onChange={setHtml}
                />
                <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                  Enter starts a new paragraph. Put [[ ]] around words that should drop out when a placeholder inside them is blank.
                </p>
              </div>
              {editable && <PlaceholderButtons placeholders={data.placeholders} editor={editor} disabled={busy} />}
              {unknown.length > 0 && (
                <p className="text-xs text-rose-600 dark:text-rose-400">
                  {unknown.map((f) => `{{${f}}}`).join(', ')} can&apos;t be filled in. Use one of the placeholders above.
                </p>
              )}

              <div>
                <p className={LABEL}>Shows when</p>
                <div className="rounded-lg border border-stone-200 dark:border-[rgba(255,255,255,0.1)] divide-y divide-stone-100 dark:divide-white/5">
                  {data.facts.map((f) => {
                    const v = termOf(f.key);
                    return (
                      <div key={f.key} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
                        <span className={v === null ? 'text-[var(--text-secondary)]' : 'text-foreground font-medium'}>{f.label}</span>
                        <span className="inline-flex shrink-0 rounded border border-stone-200 dark:border-[rgba(255,255,255,0.1)] overflow-hidden" role="group" aria-label={f.label}>
                          {([[null, 'Either'], [true, 'Yes'], [false, 'No']] as const).map(([val, l]) => (
                            <button key={l} type="button" disabled={busy || !editable} onClick={() => setTerm(f.key, val)} aria-pressed={v === val}
                              className={`px-2 py-0.5 cursor-pointer disabled:cursor-default ${v === val ? 'bg-navy-100 text-navy-800 dark:bg-gold-400/15 dark:text-gold-300' : 'text-[var(--text-secondary)] hover:bg-stone-50 dark:hover:bg-white/5'}`}>
                              {l}
                            </button>
                          ))}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <label className={`mt-3 flex items-start gap-2 text-xs ${editable ? 'cursor-pointer' : ''}`}>
                  <input type="checkbox" checked={!!choice} disabled={busy || !editable} className="rounded mt-0.5"
                    onChange={(e) => setChoice(e.target.checked ? ownChoice : null)} />
                  <span className="text-[var(--text-secondary)]">
                    And only where finance ticks it for the client (in their billing profile) or for the invoice
                  </span>
                </label>
                {choice && (
                  <div className="mt-1.5 ml-6 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                    <span>Ticked as</span>
                    {choiceOptions.map((c) => (
                      <button key={c.key} type="button" disabled={busy || !editable} onClick={() => setChoice(c.key)}
                        className={`px-2 py-0.5 rounded border cursor-pointer ${choice === c.key ? 'border-gold-400 bg-gold-50 text-gold-800 dark:bg-gold-400/10 dark:text-gold-300' : 'border-stone-200 dark:border-[rgba(255,255,255,0.1)]'}`}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
                {choice && choice !== ownChoice && (
                  <p className="mt-1 ml-6 text-[11px] text-[var(--text-muted)]">One tick covers every paragraph ticked as the same choice, in the letter and the email.</p>
                )}
              </div>
            </>
          )}

          {revisions && <RevisionList revisions={revisions} busy={busy} onRestore={editable ? (r) => void restoreRevision(r) : undefined} />}
        </div>

        <div className={`min-w-0 ${preview ? '' : 'hidden xl:block'}`}>
          <p className={LABEL}>Preview: as {SAMPLE_CLIENT} would get it, with every client choice ticked</p>
          <SampleControls sample={sample} onChange={setSample} />
          <DocumentPreview data={data} document={document} sample={sample} paragraphs={previewList} lines={data.lines} />
        </div>
      </div>

      {editable && (
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {!isNew && (
            <button type="button" onClick={() => void loadHistory()} disabled={busy} className={`${BTN} mr-auto`}>
              <History className="w-3.5 h-3.5" /> History
            </button>
          )}
          {!isNew && !system && (
            <button type="button" onClick={() => setDeleting(true)} disabled={busy} className={BTN}>
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )}
          {dirty && !isNew && (
            <button type="button" disabled={busy} className={BTN}
              onClick={() => { setLabel(paragraph!.label); setHtml(toHtml(paragraph!.body)); setRule(paragraph!.rule); setChoice(paragraph!.choice); }}>
              Discard changes
            </button>
          )}
          <button type="button" onClick={() => void save()} disabled={busy || !dirty || !name || empty || unknown.length > 0} className={SAVE}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {isNew ? 'Add paragraph' : 'Save'}
          </button>
        </div>
      )}

      {paragraph && !system && (
        <ConfirmDialog
          open={deleting}
          title="Delete this paragraph?"
          message={`"${paragraph.label}" comes out of the ${document}. Its wording stays in the history.`}
          confirmLabel="Delete"
          variant="danger"
          loading={busy}
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(false)}
        />
      )}
    </section>
  );
}

// ── One fixed line ─────────────────────────────────────────────────────

function LineCard({ data, document, line, onSaved }: { data: TemplateData; document: DocumentKind; line: Line; onSaved: () => Promise<void> }) {
  // The email subject is plain text; the letter's lines are letter markup.
  const plain = line.key === 'email_subject';
  const [html, setHtml] = useState(() => (plain ? line.body : markupToHtml(line.body)));
  const [sample, setSample] = useState<Sample>(BASE_SAMPLE);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const editor = useRef<LetterEditorHandle>(null);

  const body = plain ? html : htmlToMarkup(html);
  const dirty = body !== line.body;
  const unknown = unknownFields(body);
  const lines = data.lines.map((l) => (l.key === line.key ? { ...l, body } : l));
  const singleLine = plain || line.key === 'subject' || line.key.startsWith('phrase_');

  async function save() {
    setBusy(true);
    try {
      const res = await fetch('/api/finance/letter-template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: line.key, body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not save the line');
      toast.success(`${line.label} saved`);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the line');
    } finally {
      setBusy(false);
    }
  }

  async function restoreDefault() {
    setBusy(true);
    try {
      const res = await fetch('/api/finance/letter-template', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: line.key }),
      });
      if (!res.ok) throw new Error('Could not restore the default wording');
      setRestoring(false);
      toast.success(`${line.label} restored to the default`);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not restore the default wording');
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory() {
    const res = await fetch(`/api/content-revisions?entityType=billing_letter_block&entityId=${encodeURIComponent(line.key)}`);
    const json = await res.json().catch(() => ({}));
    setRevisions(json.revisions ?? []);
  }

  return (
    <section className={CARD}>
      <h2 className="text-base font-semibold text-foreground">{line.label}</h2>
      <p className="text-xs text-[var(--text-secondary)] mt-0.5">
        {line.when}.{' '}
        {line.updatedAt ? <>Edited by {line.updatedBy ?? 'finance'} on {formatDate(toManilaDay(line.updatedAt))}.</> : 'Using the built-in wording.'}
      </p>
      <div className="mt-4 grid gap-5 xl:grid-cols-2">
        <div className="space-y-4 min-w-0">
          <LetterEditor
            ref={editor}
            id="line-wording"
            ariaLabel={line.label}
            variant={singleLine ? 'line' : 'rich'}
            formatting="basic"
            placeholders={data.placeholders}
            value={html}
            disabled={busy || !data.canEdit}
            onChange={setHtml}
          />
          {data.canEdit && (
            <p className="-mt-2 text-[11px] text-[var(--text-secondary)]">
              Put [[ ]] around words that should drop out when a placeholder inside them is blank.
            </p>
          )}
          {data.canEdit && <PlaceholderButtons placeholders={data.placeholders} editor={editor} disabled={busy} />}
          {unknown.length > 0 && <p className="text-xs text-rose-600 dark:text-rose-400">{unknown.map((f) => `{{${f}}}`).join(', ')} can&apos;t be filled in.</p>}
          {revisions && <RevisionList revisions={revisions} busy={busy} />}
        </div>
        <div className="min-w-0">
          <p className={LABEL}>Preview: as {SAMPLE_CLIENT} would get it</p>
          <SampleControls sample={sample} onChange={setSample} />
          <DocumentPreview data={data} document={document} sample={sample} paragraphs={data.paragraphs[document]} lines={lines} />
        </div>
      </div>
      {data.canEdit && (
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={() => void loadHistory()} disabled={busy} className={`${BTN} mr-auto`}>
            <History className="w-3.5 h-3.5" /> History
          </button>
          {line.updatedAt && (
            <button type="button" onClick={() => setRestoring(true)} disabled={busy} className={BTN}>
              <RotateCcw className="w-3.5 h-3.5" /> Restore default
            </button>
          )}
          {dirty && (
            <button type="button" onClick={() => setHtml(plain ? line.body : markupToHtml(line.body))} disabled={busy} className={BTN}>
              Discard changes
            </button>
          )}
          <button type="button" onClick={() => void save()} disabled={busy || !dirty || unknown.length > 0 || !plainText(body)} className={SAVE}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Save
          </button>
        </div>
      )}
      <ConfirmDialog
        open={restoring}
        title="Restore the default wording?"
        message={`${line.label} goes back to the built-in wording. Your edited version stays in the history.`}
        confirmLabel="Restore default"
        variant="navy"
        loading={busy}
        onConfirm={() => void restoreDefault()}
        onCancel={() => setRestoring(false)}
      />
    </section>
  );
}
