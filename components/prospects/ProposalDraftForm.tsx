'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { offeredFor, defaultScopeSlugs } from '@/lib/scope-library/select';
import type { LoadedScopeTemplate } from '@/lib/scope-library/types';
import type { AcceptanceFeeOption } from '@/lib/engagement-proposal/catalogue';
import type { ProposalQuote } from '@/lib/engagement-proposal/types';
import {
  ARRANGEMENTS, MultiPicker, Picker, inputCls, labelCls,
  type RetainerTierOption,
} from './proposal-ui';

/** What the drafting endpoints accept, minus the recipient the caller supplies. */
export interface ProposalDraftPayload {
  arrangement: string;
  tierLabel?: string;
  caseType?: string;
  scopeSlugs: string[];
  customFigures?: { retainerHours?: number; monthlyFee?: number };
  attnName?: string;
  attnTitle?: string;
  instructions?: string;
}

/**
 * The choices that go into one drafting run. Used both to open a new proposal
 * and to draft a further version of one that exists — the questions are the
 * same, only what the answers are attached to differs.
 *
 * Body and footer only: the surrounding chrome belongs to ProposalDraftModal,
 * so the form doesn't have to know it is in a dialog.
 */
export default function ProposalDraftForm({
  scopeTemplates, retainerTiers, acceptanceFees, proposedServices,
  submitLabel, busy, disabled, onDraft, onCancel, children,
}: {
  scopeTemplates: LoadedScopeTemplate[];
  retainerTiers: RetainerTierOption[];
  /** Contested matters the schedule prices, for the litigation arrangement. */
  acceptanceFees: AcceptanceFeeOption[];
  /** Services the intake recorded, used to pre-tick scope lines. Empty for a client. */
  proposedServices: string[];
  submitLabel: string;
  busy: boolean;
  disabled?: boolean;
  onDraft: (payload: ProposalDraftPayload) => void;
  onCancel?: () => void;
  /** Recipient picker, rendered above the fee arrangement. */
  children?: React.ReactNode;
}) {
  const [arrangement, setArrangement] = useState('retainer');
  const [tierLabel, setTierLabel] = useState('Tier II');
  const [caseType, setCaseType] = useState('');
  const [attnName, setAttnName] = useState('');
  const [attnTitle, setAttnTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [scopeSlugs, setScopeSlugs] = useState<string[]>([]);
  const [customHours, setCustomHours] = useState('');
  const [customMonthlyFee, setCustomMonthlyFee] = useState('');
  // A drafter who edits the selection owns it; changing the arrangement after
  // that must not silently throw their choices away.
  const scopeTouched = useRef(false);

  // Seed the scope selection from the arrangement and what the record holds,
  // using the same helper the drafting route falls back to. Once the drafter has
  // edited the selection it is theirs, but changing the arrangement still prunes
  // lines that are no longer offered — otherwise the route would silently drop
  // them and the letter could go out with no carve-outs at all.
  useEffect(() => {
    if (!scopeTemplates.length) return;
    const arr = arrangement as ProposalQuote['arrangement'];
    const seeded = defaultScopeSlugs(scopeTemplates, arr, proposedServices);
    if (!scopeTouched.current) {
      setScopeSlugs(seeded);
      return;
    }
    setScopeSlugs((prev) => {
      const offered = offeredFor(scopeTemplates, arr);
      const kept = offered.filter((t) => prev.includes(t.slug)).map((t) => t.slug);
      const hasExclusions = kept.some(
        (slug) => scopeTemplates.find((t) => t.slug === slug)?.content.role === 'exclusions',
      );
      if (hasExclusions) return kept;
      const replacement = seeded.filter(
        (slug) => scopeTemplates.find((t) => t.slug === slug)?.content.role === 'exclusions',
      );
      return offered.filter((t) => kept.includes(t.slug) || replacement.includes(t.slug)).map((t) => t.slug);
    });
  }, [scopeTemplates, proposedServices, arrangement]);

  useEffect(() => {
    if (!caseType && acceptanceFees.length) setCaseType(acceptanceFees[0].matter);
  }, [acceptanceFees, caseType]);

  // A tier the schedule prices "subject to negotiation" carries no figures, so
  // the drafter supplies them and the scope section's hour cap comes from there.
  const selectedTier = retainerTiers.find((t) => t.label === tierLabel);
  const negotiatedTier =
    arrangement === 'retainer' && selectedTier != null && selectedTier.monthlyFee == null;

  const submit = () => onDraft({
    arrangement,
    tierLabel: arrangement === 'retainer' ? tierLabel : undefined,
    caseType: arrangement === 'litigation' ? caseType || undefined : undefined,
    scopeSlugs,
    customFigures: negotiatedTier
      ? {
          retainerHours: customHours.trim() ? Number(customHours) : undefined,
          monthlyFee: customMonthlyFee.trim() ? Number(customMonthlyFee.replace(/,/g, '')) : undefined,
        }
      : undefined,
    attnName: attnName || undefined,
    attnTitle: attnTitle || undefined,
    instructions: instructions || undefined,
  });

  return (
    <>
      <div className="p-5 space-y-3">
        {children}
        <Picker label="Fee arrangement" value={arrangement} options={ARRANGEMENTS}
          onSelect={(id) => setArrangement(id ?? 'retainer')} />
        {arrangement === 'retainer' && (
          <Picker
            label="Retainer tier"
            value={tierLabel}
            options={(retainerTiers.length ? retainerTiers : [{ label: 'Tier II', hours: null, monthlyFee: null }]).map((t) => ({
              id: t.label,
              label: t.monthlyFee == null
                ? `${t.label} — subject to negotiation`
                : `${t.label} — P${t.monthlyFee.toLocaleString('en-PH')}/mo · ${t.hours} hrs`,
            }))}
            onSelect={(id) => setTierLabel(id ?? 'Tier II')}
          />
        )}
        {arrangement === 'litigation' && (
          <div>
            <Picker
              label="Case type"
              value={caseType || null}
              options={acceptanceFees.map((f) => ({
                id: f.matter,
                label: `${f.matter} — acceptance fee P${f.standard.toLocaleString('en-PH')}`,
              }))}
              placeholder={acceptanceFees.length ? 'Choose a case type…' : 'The fee schedule prices no acceptance fees'}
              onSelect={(id) => setCaseType(id ?? '')}
            />
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              The acceptance fee comes from the schedule. Hourly rates apply to the work as it
              proceeds, and the completion fee is settled with the client — state it under Instructions.
            </p>
          </div>
        )}
        {negotiatedTier && (
          <div className="rounded-lg border border-[var(--border-color)] p-3 space-y-2.5">
            <p className="text-[10px] text-[var(--text-muted)]">
              {tierLabel} carries no figures in the fee schedule. What you enter here is what the letter
              quotes and what the scope section states as the monthly cap.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className={labelCls}>Hours per month</span>
                <input className={inputCls} inputMode="decimal" value={customHours} placeholder="12.5"
                  onChange={(e) => setCustomHours(e.target.value)} />
              </div>
              <div>
                <span className={labelCls}>Monthly fee (P)</span>
                <input className={inputCls} inputMode="decimal" value={customMonthlyFee} placeholder="25000"
                  onChange={(e) => setCustomMonthlyFee(e.target.value)} />
              </div>
            </div>
          </div>
        )}
        <div>
          <MultiPicker
            label="Scope lines"
            values={scopeSlugs}
            placeholder="No scope lines selected"
            options={offeredFor(scopeTemplates, arrangement as ProposalQuote['arrangement']).map((t) => ({
              id: t.slug,
              label: t.name,
              sublabel: t.content.role === 'exclusions' ? 'carve-outs' : undefined,
            }))}
            onChange={(ids) => { scopeTouched.current = true; setScopeSlugs(ids); }}
          />
          <p className="text-[10px] text-[var(--text-muted)] mt-1">
            These go into the scope section word for word from the scope library, with the carve-outs last.
            Claude adds only the lines this matter needs on top.{' '}
            <a href="/dashboard/prospects/scope-library" className="underline hover:text-[var(--text-primary)]">
              Edit the wording in the Scope Library
            </a>.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={labelCls}>Contact person</span>
            <input className={inputCls} value={attnName} placeholder="Name of contact person"
              onChange={(e) => setAttnName(e.target.value)} />
          </div>
          <div>
            <span className={labelCls}>Their title</span>
            <input className={inputCls} value={attnTitle} placeholder="Their position, e.g. President"
              onChange={(e) => setAttnTitle(e.target.value)} />
          </div>
        </div>
        <p className="text-[10px] text-[var(--text-muted)] -mt-1">
          Type the contact person yourself — a name matched from the client list is often a different person, and this goes on the letter.
        </p>
        <div>
          <span className={labelCls}>Instructions (optional)</span>
          <textarea className={`${inputCls} leading-relaxed`} rows={4} value={instructions}
            placeholder="e.g. Include trademark registration as a separate service line, cross-referred to the trademark fee schedule."
            onChange={(e) => setInstructions(e.target.value)} />
        </div>
      </div>
      <div className="px-5 py-3.5 border-t border-[var(--border-color)] flex items-center justify-end gap-2.5">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}
            className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--subtle-bg)] rounded-lg transition-colors disabled:opacity-50">
            Cancel
          </button>
        )}
        <button type="button" onClick={submit} disabled={busy || disabled}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-navy-900 text-white hover:bg-navy-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {busy ? 'Drafting…' : submitLabel}
        </button>
      </div>
    </>
  );
}
