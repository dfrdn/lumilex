import type { TrademarkFile, TrademarkFileStep, TrademarkOfficeAction } from '@/types/notion';
import { officeActionName } from './office-actions';

/** Steps that belong to one Office Action round, and so name it. */
export const ROUND_STEPS: ReadonlySet<TrademarkFileStep> = new Set<TrademarkFileStep>(['office_action', 'oa_response', 'oa_motex', 'oa_motex_decision']);

/** What a round's own steps are called after the round's name. */
export const ROUND_STEP_SUFFIX: Record<Exclude<TrademarkFileStep, keyof typeof STEP_LABEL>, string | null> = {
  office_action: null,
  oa_response: 'response',
  oa_motex: 'extension',
  oa_motex_decision: 'decision on the extension',
};

/** What each step is called when a paper is filed under it, in timeline order. */
export const STEP_LABEL: Record<Exclude<TrademarkFileStep, 'office_action' | 'oa_response' | 'oa_motex' | 'oa_motex_decision'>, string> = {
  filing: 'Filing',
  noi: 'Notice of Allowance',
  noi_payment: '1st publication fee',
  publication: 'Publication',
  opposition: 'Opposition',
  issuance: 'Notice of Issuance',
  issuance_payment: 'Issuance fees',
  cor: 'COR',
  abandonment: 'Notice of abandonment',
  revival: 'Revival',
  dau_3: '3-year DAU',
  dau_3_motex: '3-year DAU extension',
  dau_3_motex_decision: '3-year DAU extension — decision',
  dau_5: '5-year DAU',
  renewal: 'Renewal',
  renewal_dau: 'Renewal DAU',
  renewal_dau_5: 'Renewal 5-year DAU',
};

/** The step a paper is filed under, as its tag reads ("Office Action 2 — response", "COR"); null when it isn't on the timeline. */
export function fileStepLabel(f: Pick<TrademarkFile, 'step' | 'officeActionId'>, oas: TrademarkOfficeAction[]): string | null {
  if (!f.step) return null;
  if (!ROUND_STEPS.has(f.step)) return STEP_LABEL[f.step as keyof typeof STEP_LABEL];
  const oa = oas.find((o) => o.id === f.officeActionId);
  const name = oa ? officeActionName(oas, oa) : 'Office Action';
  const suffix = ROUND_STEP_SUFFIX[f.step as keyof typeof ROUND_STEP_SUFFIX];
  return suffix ? `${name} — ${suffix}` : name;
}

/** Every place a paper can be filed, for the tag picker: each round's three, then the rest. Ids are `step|roundId`. */
export function stepOptions(oas: TrademarkOfficeAction[]): { id: string; label: string }[] {
  const rounds = oas.flatMap((oa) => {
    const name = officeActionName(oas, oa);
    return [
      { id: `office_action|${oa.id}`, label: name },
      { id: `oa_response|${oa.id}`, label: `${name} — response` },
      { id: `oa_motex|${oa.id}`, label: `${name} — extension` },
      { id: `oa_motex_decision|${oa.id}`, label: `${name} — decision on the extension` },
    ];
  });
  const [filing, ...rest] = Object.entries(STEP_LABEL).map(([step, label]) => ({ id: `${step}|`, label }));
  return [filing, ...rounds, ...rest];
}
