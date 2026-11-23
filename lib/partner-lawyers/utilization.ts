/**
 * Utilization scoring for lawyers.
 * Blends monthly hours, deliverable activity (pending + submitted),
 * and matter count into a single 0..∞ score where 1.0 ≈ balanced
 * for the position.
 */

export type UtilizationBucket = 'Free' | 'Balanced' | 'Busy' | 'Overworked';

export interface UtilizationBaseline {
  hours: number;            // target billable hours per month
  deliverables: number;     // expected in-flight deliverables at any time
  submittedPerMonth: number; // expected deliverables submitted / filed per month
  matters: number;          // expected active matters
}

const DEFAULT_BASELINE: UtilizationBaseline = {
  hours: 140,
  deliverables: 12,
  submittedPerMonth: 8,
  matters: 12,
};

// Keyed by position. Tune conservatively — real ones get added over time.
export const POSITION_BASELINES: Record<string, UtilizationBaseline> = {
  // Partners: mostly supervisory — high matter count, lower hours
  'Founding Partner':    { hours: 60,  deliverables: 6,  submittedPerMonth: 12, matters: 60 },
  'Managing Partner':    { hours: 60,  deliverables: 8,  submittedPerMonth: 12, matters: 60 },
  'Monitoring Partner':  { hours: 60,  deliverables: 10, submittedPerMonth: 12, matters: 60 },
  'Partner':             { hours: 60,  deliverables: 10, submittedPerMonth: 12, matters: 60 },
  'Of Counsel':          { hours: 80,  deliverables: 8,  submittedPerMonth: 6,  matters: 15 },
  'Senior Associate':    { hours: 100, deliverables: 15, submittedPerMonth: 18, matters: 12 },
  'Mid-level Associate': { hours: 110, deliverables: 14, submittedPerMonth: 15, matters: 11 },
  'Junior Associate':    { hours: 120, deliverables: 12, submittedPerMonth: 10, matters: 10 },
  'Underbar Associate':  { hours: 80,  deliverables: 8,  submittedPerMonth: 6,  matters: 6  },
};

export function getBaseline(position: string | null | undefined): UtilizationBaseline {
  return POSITION_BASELINES[position ?? ''] ?? DEFAULT_BASELINE;
}

export interface UtilizationInputs {
  hoursThisMonth: number;
  pendingDeliverables: number;
  submittedThisMonth: number;
  totalMatters: number;
}

export interface UtilizationBreakdown {
  score: number;
  bucket: UtilizationBucket;
  hoursRatio: number;
  deliverablesRatio: number;    // combined pending + submitted vs. baseline
  pendingRatio: number;
  submittedRatio: number;
  mattersRatio: number;
  baseline: UtilizationBaseline;
}

const WEIGHTS = { hours: 0.5, deliverables: 0.3, matters: 0.2 };

export function computeUtilization(
  position: string | null | undefined,
  inputs: UtilizationInputs,
): UtilizationBreakdown {
  const baseline = getBaseline(position);
  const hoursRatio = baseline.hours > 0 ? inputs.hoursThisMonth / baseline.hours : 0;
  const pendingRatio = baseline.deliverables > 0 ? inputs.pendingDeliverables / baseline.deliverables : 0;
  const submittedRatio = baseline.submittedPerMonth > 0
    ? inputs.submittedThisMonth / baseline.submittedPerMonth
    : 0;
  // Blend pending (current load) and submitted (throughput this month) equally:
  // a lawyer who cleared 15 filings this month is doing real work, even if
  // their pending count looks small.
  const deliverablesRatio = (pendingRatio + submittedRatio) / 2;
  const mattersRatio = baseline.matters > 0 ? inputs.totalMatters / baseline.matters : 0;

  const score =
    WEIGHTS.hours * hoursRatio +
    WEIGHTS.deliverables * deliverablesRatio +
    WEIGHTS.matters * mattersRatio;

  return {
    score,
    bucket: toBucket(score),
    hoursRatio,
    deliverablesRatio,
    pendingRatio,
    submittedRatio,
    mattersRatio,
    baseline,
  };
}

export function toBucket(score: number): UtilizationBucket {
  if (score < 0.5) return 'Free';
  if (score < 0.9) return 'Balanced';
  if (score < 1.2) return 'Busy';
  return 'Overworked';
}

export const BUCKET_ORDER: UtilizationBucket[] = ['Overworked', 'Busy', 'Balanced', 'Free'];

export const BUCKET_STYLES: Record<UtilizationBucket, {
  pill: string;
  bar: string;
  ring: string;
  description: string;
}> = {
  Overworked: {
    pill: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    bar: 'bg-red-500',
    ring: 'ring-red-300/50',
    description: 'Above 120% of baseline load',
  },
  Busy: {
    pill: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    bar: 'bg-amber-500',
    ring: 'ring-amber-300/50',
    description: '90–120% of baseline load',
  },
  Balanced: {
    pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    bar: 'bg-emerald-500',
    ring: 'ring-emerald-300/50',
    description: '50–90% of baseline load',
  },
  Free: {
    pill: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400',
    bar: 'bg-stone-400',
    ring: 'ring-stone-300/50',
    description: 'Below 50% of baseline load',
  },
};
