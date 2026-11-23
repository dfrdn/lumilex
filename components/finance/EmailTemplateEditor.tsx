'use client';

import { useState, useMemo, useRef } from 'react';
import { Eye, Pencil, Plus } from 'lucide-react';
import LetterEditor, { PLACEHOLDER_CHIP, type LetterEditorHandle } from '@/components/LetterEditor';
import type { LetterPlaceholder } from '@/lib/letter-placeholders';

/**
 * Template variables available for substitution.
 * Wrap in {{ }} in the template — e.g. {{clientName}}.
 */
export interface TemplateVars {
  clientName?: string;
  month?: string;           // e.g. "March 2026"
  amount?: string;          // e.g. "₱221,550.00" — total remittance, advance included
  dueDate?: string;         // e.g. "9 April 2026"
  invoiceNumber?: string;
  daysOverdue?: string;
  firmName?: string;
}

export interface EmailTemplate {
  subject: string;
  body: string;             // HTML string
}

// ── Default templates ───────────────────────────────────────────────

export const BILLING_TEMPLATE: EmailTemplate = {
  subject: 'Billing Statement – {{month}} | {{clientName}}',
  body: `<p>Good day,</p>
<p>Please find attached our billing statement for <strong>{{month}}</strong> in the amount of <strong>{{amount}}</strong>.</p>
<p>Should you have any questions, please do not hesitate to contact us.</p>
<br/>
<p>Best regards,<br/><strong>{{firmName}}</strong><br/>Finance Department</p>`,
};

export const REMINDER_TEMPLATE: EmailTemplate = {
  subject: 'Reminder: Billing Statement – {{month}} | {{clientName}}',
  body: `<p>Good day,</p>
<p>This is a gentle reminder that your billing statement for <strong>{{month}}</strong> in the amount of <strong>{{amount}}</strong> is due on <strong>{{dueDate}}</strong>.</p>
<p>Kindly disregard this reminder if payment has already been made. Please find the original billing statement attached for your reference.</p>
<br/>
<p>Best regards,<br/><strong>{{firmName}}</strong><br/>Finance Department</p>`,
};

export const OVERDUE_TEMPLATE: EmailTemplate = {
  subject: 'Overdue: Billing Statement – {{month}} | {{clientName}}',
  body: `<p>Good day,</p>
<p>Your billing statement for <strong>{{month}}</strong> amounting to <strong>{{amount}}</strong> is now <strong>{{daysOverdue}} days overdue</strong>.</p>
<p>We kindly request your prompt attention to this matter. Please find the billing statement attached for your reference.</p>
<br/>
<p>Best regards,<br/><strong>{{firmName}}</strong><br/>Finance Department</p>`,
};

export const FINAL_TEMPLATE: EmailTemplate = {
  subject: 'Final Notice: Outstanding Balance – {{month}} | {{clientName}}',
  body: `<p>Good day,</p>
<p>This is a <strong>final notice</strong> regarding your outstanding balance of <strong>{{amount}}</strong> for the billing period of <strong>{{month}}</strong>, which is now <strong>{{daysOverdue}} days overdue</strong>.</p>
<p>We urge your immediate attention to this matter. Please find the billing statement attached.</p>
<br/>
<p>Best regards,<br/><strong>{{firmName}}</strong><br/>Finance Department</p>`,
};

export const FOLLOWUP_TEMPLATES = {
  reminder: REMINDER_TEMPLATE,
  overdue: OVERDUE_TEMPLATE,
  final: FINAL_TEMPLATE,
} as const;

// ── Substitution helper ─────────────────────────────────────────────

export function substituteVars(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return (vars as Record<string, string | undefined>)[key] ?? `{{${key}}}`;
  });
}

// ── Placeholders ────────────────────────────────────────────────────

/**
 * The fields a follow-up email (reminder, overdue, final notice) fills in —
 * what /api/finance/send-followup supplies. The billing email itself is no
 * longer a template: it is written on the Billing Letter page.
 */
export const EMAIL_PLACEHOLDERS: (LetterPlaceholder & { key: keyof TemplateVars })[] = [
  { key: 'clientName', label: 'Client', meaning: 'the client' },
  { key: 'month', label: 'Billing period', meaning: 'the billing period, e.g. March 2026' },
  { key: 'amount', label: 'Amount', meaning: 'the amount still owed on the invoice' },
  { key: 'dueDate', label: 'Due date', meaning: 'the payment due date' },
  { key: 'invoiceNumber', label: 'Invoice no.', meaning: 'the invoice number' },
  { key: 'daysOverdue', label: 'Days overdue', meaning: 'the number of days past due' },
  { key: 'firmName', label: 'Firm name', meaning: "the firm's own name" },
];

const KNOWN = new Set<string>(EMAIL_PLACEHOLDERS.map((p) => p.key));

/** Tokens in the template the email can't fill, e.g. a misspelt {{clientNmae}}. */
export function unknownEmailFields(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].filter((m) => !KNOWN.has(m[1])).map((m) => m[0]))];
}

// ── Component ───────────────────────────────────────────────────────

// Styled as the billing letter and applicant letter editors.
const LABEL = 'block text-xs font-medium text-[var(--text-secondary)] mb-1';
const BTN =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-stone-200 dark:border-[rgba(255,255,255,0.1)] hover:bg-stone-50 dark:hover:bg-white/5 disabled:opacity-50 transition-colors cursor-pointer';

interface Props {
  template: EmailTemplate;
  onChange: (template: EmailTemplate) => void;
  /** Sample variables for the live preview */
  sampleVars: TemplateVars;
  /** If given, buttons to start from one of these. */
  presets?: { label: string; value: string; template: EmailTemplate }[];
  /** The firm's own billing mailbox, resolved server-side. Blank hides the line. */
  financeAddress: string;
  className?: string;
}

/**
 * The invoice email's subject and body, edited the way the billing letter is:
 * fields as chips, the email as it will be sent beside it (or behind a
 * Preview button on a narrow screen).
 */
export default function EmailTemplateEditor({
  template,
  onChange,
  sampleVars,
  presets,
  financeAddress,
  className,
}: Props) {
  const [preview, setPreview] = useState(false);
  const subjectRef = useRef<LetterEditorHandle>(null);
  const bodyRef = useRef<LetterEditorHandle>(null);
  const lastFocus = useRef<'subject' | 'body'>('body');

  const previewSubject = useMemo(() => substituteVars(template.subject, sampleVars), [template.subject, sampleVars]);
  const previewBody = useMemo(() => substituteVars(template.body, sampleVars), [template.body, sampleVars]);
  const unknown = unknownEmailFields(`${template.subject}\n${template.body}`);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        {presets && presets.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <span>Start from</span>
            {presets.map((p) => (
              <button key={p.value} type="button" onClick={() => onChange(p.template)} className="px-2 py-1 rounded-md border border-stone-200 dark:border-[rgba(255,255,255,0.1)] hover:bg-stone-50 dark:hover:bg-white/5 cursor-pointer">
                {p.label}
              </button>
            ))}
          </div>
        ) : <span />}
        <button type="button" onClick={() => setPreview((v) => !v)} className={`${BTN} lg:hidden`}>
          {preview ? <Pencil className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className={`space-y-3 min-w-0 ${preview ? 'hidden lg:block' : ''}`}>
          <div>
            <label htmlFor="email-template-subject" className={LABEL}>Subject</label>
            <LetterEditor
              ref={subjectRef}
              id="email-template-subject"
              ariaLabel="Subject"
              variant="line"
              placeholders={EMAIL_PLACEHOLDERS}
              value={template.subject}
              onFocus={() => (lastFocus.current = 'subject')}
              onChange={(subject) => onChange({ ...template, subject })}
            />
          </div>
          <div>
            <label htmlFor="email-template-body" className={LABEL}>Message</label>
            <LetterEditor
              ref={bodyRef}
              id="email-template-body"
              ariaLabel="Message"
              variant="rich"
              placeholders={EMAIL_PLACEHOLDERS}
              value={template.body}
              onFocus={() => (lastFocus.current = 'body')}
              onChange={(body) => onChange({ ...template, body })}
            />
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Shift+Enter starts a new line in the same paragraph. The billing letter and breakdown are attached.</p>
          </div>
          <div>
            <p className={LABEL}>Placeholders</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {EMAIL_PLACEHOLDERS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  title={`Insert ${p.meaning}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => (lastFocus.current === 'subject' ? subjectRef : bodyRef).current?.insertPlaceholder(p.key)}
                  className={`${PLACEHOLDER_CHIP} inline-flex items-center gap-1 py-0.5 cursor-pointer hover:bg-gold-100 dark:hover:bg-gold-400/20`}
                >
                  <Plus className="w-3 h-3" />
                  {p.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--text-secondary)]">
              Each is filled in for the invoice when the follow-up is sent. Click to insert at the cursor, or type its token, e.g. <code className="font-mono">{'{{clientName}}'}</code>.
            </p>
          </div>
          {unknown.length > 0 && (
            <p className="text-xs text-rose-600 dark:text-rose-400">
              {unknown.join(', ')} can&apos;t be filled in. Use one of the placeholders above.
            </p>
          )}
        </div>

        <div className={`min-w-0 ${preview ? '' : 'hidden lg:block'}`}>
          <p className={LABEL}>Preview: as {sampleVars.clientName || 'the client'} would get it</p>
          <div className="rounded-lg border border-stone-200 dark:border-[rgba(255,255,255,0.1)] bg-white overflow-hidden">
            <div className="px-4 py-2.5 border-b border-stone-200 bg-stone-50 text-xs text-stone-500 space-y-0.5">
              {financeAddress && <div><span className="font-medium">From</span> <span className="text-stone-700">{financeAddress}</span></div>}
              <div><span className="font-medium">Subject</span> <span className="text-stone-800">{previewSubject}</span></div>
              <div><span className="font-medium">Attached</span> <span className="text-stone-700">Billing Letter.pdf, Breakdown.pdf</span></div>
            </div>
            <div
              className="px-6 py-5 text-sm text-stone-800 leading-relaxed [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: previewBody }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
