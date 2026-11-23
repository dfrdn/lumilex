/**
 * Derives the non-DTR fee lines (retainer, fixed-fee, acceptance, per-action
 * aggregates, milestones, informational hours) for one client's matters from
 * the raw billing config + action + milestone rows.
 *
 * Extracted from fetch-billing-data so the same logic can drive BOTH the
 * persisted invoice (via fetchBillingData) and lighter-weight previews like the
 * billing-review dashboard's per-client "total legal fees" — without the two
 * ever drifting apart.
 *
 * Ad-hoc per-invoice items are NOT derived here: they live on the per-bundle
 * invoice_settings_override and are merged in at generation/preview time.
 */

import type { FeeLine } from '@/lib/billing/fetch-billing-data';

export interface DeriveFeeLinesInput {
  /** matter_billing_configs rows for the client's matters. */
  configs: Array<{
    matter_id: string;
    billing_type: string;
    monthly_retainer: number | null;
    fixed_fee_amount: number | null;
    acceptance_fee: number | null;
    acceptance_fee_paid: boolean;
  }>;
  /** matter_billing_actions rows (action definitions). */
  actions: Array<{ id: number; matter_id: string; name: string; rate: number; cap: number | null; unit_label: string }>;
  /** matter_action_entries rows within the billing month (any invoiced state). */
  actionEntries: Array<{ id: number; action_id: number; matter_id: string; quantity: number; invoiced: boolean }>;
  /** matter_billing_milestones rows. */
  milestones: Array<{ id: number; matter_id: string; name: string; fee: number; reached_at: string | null; invoiced: boolean }>;
  /** Billable decimal hours per matter (used for fixed-retainer informational rows). */
  hoursByMatter: Record<string, number>;
  /** matter notion_id → display name. */
  matterNameById: Record<string, string>;
}

/** Fee-line kinds that contribute a real charge (excludes the retainer line —
 *  counted once via monthlyRetainer — and informational rows which are 0). */
const CHARGED_KINDS = new Set(['fixed_fee', 'acceptance', 'action', 'milestone', 'discount', 'adhoc']);

/** Sum of the charged fee lines (what the client actually pays from non-DTR
 *  sources). Negative discount lines net down the total. */
export function sumChargedFeeLines(feeLines: Array<{ kind: string; amount?: number | null }>): number {
  return (feeLines ?? [])
    .filter((f) => CHARGED_KINDS.has(f.kind))
    .reduce((s, f) => s + (f.amount ?? 0), 0);
}

/**
 * Parse the free-form ad-hoc items stored on a bundle's invoice_settings_override
 * into 'adhoc' fee lines. The ONE place this jsonb shape is read (preview,
 * generation, dashboard) so the parsing + 2-decimal rounding can't drift.
 * Amounts are rounded to centavos here so the preview, the persisted invoice,
 * and the breakdown all agree to the cent.
 */
export function parseAdHocFeeLines(override: Record<string, unknown> | null | undefined): FeeLine[] {
  const raw = override?.adHocItems;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}))
    .map((r) => ({
      kind: 'adhoc' as const,
      matterId: null,
      matterName: typeof r.matterName === 'string' ? r.matterName : null,
      description: String(r.description ?? '').trim() || 'Additional item',
      amount: Math.round(Number(r.amount) * 100) / 100,
    }))
    .filter((r) => Number.isFinite(r.amount) && r.amount !== 0);
}

export function deriveFeeLines(input: DeriveFeeLinesInput): FeeLine[] {
  const { configs, actions, actionEntries, milestones, hoursByMatter, matterNameById } = input;
  const feeLines: FeeLine[] = [];

  const configByMatter: Record<string, DeriveFeeLinesInput['configs'][number]> = {};
  for (const c of configs) configByMatter[c.matter_id] = c;

  for (const c of Object.values(configByMatter)) {
    const mName = matterNameById[c.matter_id] ?? null;

    // Acceptance fee — once, when unpaid (litigation / per-action / per-milestone)
    if (
      !c.acceptance_fee_paid &&
      c.acceptance_fee != null &&
      c.acceptance_fee > 0 &&
      (c.billing_type === 'litigation' ||
        c.billing_type === 'acceptance_per_action' ||
        c.billing_type === 'acceptance_per_milestone')
    ) {
      feeLines.push({
        kind: 'acceptance',
        matterId: c.matter_id,
        matterName: mName,
        description: 'Acceptance Fee',
        amount: Number(c.acceptance_fee),
      });
    }

    if ((c.billing_type === 'retainer' || c.billing_type === 'fixed_retainer') && c.monthly_retainer) {
      feeLines.push({
        kind: 'retainer',
        matterId: c.matter_id,
        matterName: mName,
        description: c.billing_type === 'fixed_retainer'
          ? `Monthly Retainer (flat)`
          : `Monthly Retainer`,
        amount: Number(c.monthly_retainer),
      });
    }

    if (c.billing_type === 'fixed_retainer') {
      const hrs = hoursByMatter[c.matter_id] ?? 0;
      if (hrs > 0) {
        feeLines.push({
          kind: 'informational_hours',
          matterId: c.matter_id,
          matterName: mName,
          description: `${(Math.round(hrs * 10) / 10)} hrs rendered (not charged)`,
          amount: 0,
        });
      }
    }

    if (c.billing_type === 'fixed_fee' && c.fixed_fee_amount) {
      feeLines.push({
        kind: 'fixed_fee',
        matterId: c.matter_id,
        matterName: mName,
        description: 'Fixed Fee',
        amount: Number(c.fixed_fee_amount),
      });
    }
  }

  // Action entries: aggregate per action, respecting per-action monthly cap.
  const actionDefById: Record<number, DeriveFeeLinesInput['actions'][number]> = {};
  for (const a of actions) actionDefById[a.id] = a;

  // Group all month entries (any invoiced state) per action so we can both
  // (a) enforce the cap globally across already-billed + unbilled entries
  // and (b) bill only the unbilled ones up to the remaining cap.
  const entriesByAction: Record<number, Array<{ id: number; quantity: number; invoiced: boolean }>> = {};
  for (const e of actionEntries) {
    (entriesByAction[e.action_id] ??= []).push({ id: e.id, quantity: e.quantity ?? 1, invoiced: e.invoiced });
  }

  for (const [actionIdStr, rows] of Object.entries(entriesByAction)) {
    const actionId = Number(actionIdStr);
    const def = actionDefById[actionId];
    if (!def) continue;
    rows.sort((a, b) => a.id - b.id);
    const cap = def.cap ?? Infinity;
    const alreadyBilledQty = rows.filter((r) => r.invoiced).reduce((s, r) => s + r.quantity, 0);
    let remaining = cap - alreadyBilledQty;
    const billedSourceIds: number[] = [];
    let billedQuantity = 0;
    for (const r of rows) {
      if (r.invoiced) continue;
      if (remaining <= 0) break;
      if (r.quantity > remaining) break;
      billedSourceIds.push(r.id);
      billedQuantity += r.quantity;
      remaining -= r.quantity;
    }
    if (billedQuantity > 0) {
      const mName = matterNameById[def.matter_id] ?? null;
      feeLines.push({
        kind: 'action',
        matterId: def.matter_id,
        matterName: mName,
        description: `${def.name}${def.unit_label ? ` (${def.unit_label})` : ''} × ${billedQuantity}`,
        amount: Number(def.rate) * billedQuantity,
        quantity: billedQuantity,
        sourceIds: billedSourceIds,
      });
    }
  }

  // Milestones: reached + not yet invoiced go into feeLines.
  for (const m of milestones) {
    if (!m.reached_at || m.invoiced) continue;
    const mName = matterNameById[m.matter_id] ?? null;
    feeLines.push({
      kind: 'milestone',
      matterId: m.matter_id,
      matterName: mName,
      description: `Milestone — ${m.name}`,
      amount: Number(m.fee),
      sourceIds: [m.id],
    });
  }

  return feeLines;
}
