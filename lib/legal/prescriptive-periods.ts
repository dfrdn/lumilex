/**
 * Philippine Prescriptive Periods (Statutes of Limitation)
 *
 * Sources:
 * - Civil Code of the Philippines (R.A. No. 386)
 * - Revised Penal Code (Act No. 3815)
 * - Labor Code of the Philippines (P.D. No. 442)
 * - National Internal Revenue Code (R.A. No. 8424)
 */

export interface PrescriptivePeriod {
  id: string;
  category: 'Civil' | 'Criminal' | 'Labor' | 'Tax';
  causeOfAction: string;
  legalBasis: string;
  years: number;
  notes?: string;
}

// ── Civil ───────────────────────────────────────────────────────────

const CIVIL_PERIODS: PrescriptivePeriod[] = [
  {
    id: 'civil_written_contract',
    category: 'Civil',
    causeOfAction: 'Breach of Written Contract',
    legalBasis: 'Civil Code Art. 1144(1)',
    years: 10,
    notes: 'From the time the right of action accrues (breach or discovery of breach).',
  },
  {
    id: 'civil_obligation_written',
    category: 'Civil',
    causeOfAction: 'Obligation Created by Law (Written)',
    legalBasis: 'Civil Code Art. 1144(2)',
    years: 10,
  },
  {
    id: 'civil_judgment',
    category: 'Civil',
    causeOfAction: 'Action Upon a Judgment',
    legalBasis: 'Civil Code Art. 1144(3)',
    years: 10,
    notes: 'From finality of judgment. Judgment may be executed within 5 years by motion, then by action.',
  },
  {
    id: 'civil_mortgage',
    category: 'Civil',
    causeOfAction: 'Mortgage Action',
    legalBasis: 'Civil Code Art. 1142',
    years: 10,
  },
  {
    id: 'civil_oral_contract',
    category: 'Civil',
    causeOfAction: 'Breach of Oral Contract',
    legalBasis: 'Civil Code Art. 1145(1)',
    years: 6,
  },
  {
    id: 'civil_quasi_contract',
    category: 'Civil',
    causeOfAction: 'Quasi-Contract (Solutio Indebiti, Negotiorum Gestio)',
    legalBasis: 'Civil Code Art. 1145(2)',
    years: 6,
  },
  {
    id: 'civil_quasi_delict',
    category: 'Civil',
    causeOfAction: 'Quasi-Delict (Tort / Negligence)',
    legalBasis: 'Civil Code Art. 1146(1)',
    years: 4,
    notes: 'From the day the quasi-delict is committed or damage is sustained.',
  },
  {
    id: 'civil_injury_rights',
    category: 'Civil',
    causeOfAction: 'Injury to Rights (Not from Contract/Quasi-Delict)',
    legalBasis: 'Civil Code Art. 1146(2)',
    years: 4,
  },
  {
    id: 'civil_fraud',
    category: 'Civil',
    causeOfAction: 'Action Based on Fraud',
    legalBasis: 'Civil Code Art. 1146',
    years: 4,
    notes: 'From discovery of fraud.',
  },
  {
    id: 'civil_defamation',
    category: 'Civil',
    causeOfAction: 'Defamation (Civil Action)',
    legalBasis: 'Civil Code Art. 1147',
    years: 1,
  },
  {
    id: 'civil_forcible_entry',
    category: 'Civil',
    causeOfAction: 'Forcible Entry / Unlawful Detainer',
    legalBasis: 'Civil Code Art. 1147; Rule 70',
    years: 1,
    notes: '1 year from unlawful deprivation (forcible entry) or last demand (unlawful detainer).',
  },
  {
    id: 'civil_rescission',
    category: 'Civil',
    causeOfAction: 'Rescission of Contract',
    legalBasis: 'Civil Code Art. 1389',
    years: 4,
  },
  {
    id: 'civil_annulment_contract',
    category: 'Civil',
    causeOfAction: 'Annulment of Voidable Contract',
    legalBasis: 'Civil Code Art. 1391',
    years: 4,
    notes: 'From cessation of intimidation/violence/undue influence, or discovery of mistake/fraud.',
  },
];

// ── Criminal ────────────────────────────────────────────────────────

const CRIMINAL_PERIODS: PrescriptivePeriod[] = [
  {
    id: 'criminal_death_reclusion',
    category: 'Criminal',
    causeOfAction: 'Offense Punishable by Death / Reclusion Perpetua',
    legalBasis: 'RPC Art. 90',
    years: 20,
    notes: 'Heinous crimes under R.A. 7659.',
  },
  {
    id: 'criminal_reclusion_temporal',
    category: 'Criminal',
    causeOfAction: 'Offense Punishable by Reclusion Temporal (12-20 years)',
    legalBasis: 'RPC Art. 90',
    years: 20,
  },
  {
    id: 'criminal_prision_mayor',
    category: 'Criminal',
    causeOfAction: 'Offense Punishable by Prisión Mayor (6-12 years)',
    legalBasis: 'RPC Art. 90',
    years: 15,
  },
  {
    id: 'criminal_correctional',
    category: 'Criminal',
    causeOfAction: 'Offense Punishable by Correctional Penalty (6 mo - 6 years)',
    legalBasis: 'RPC Art. 90',
    years: 10,
  },
  {
    id: 'criminal_arresto',
    category: 'Criminal',
    causeOfAction: 'Offense Punishable by Arresto (1 day - 6 months)',
    legalBasis: 'RPC Art. 90',
    years: 5,
  },
  {
    id: 'criminal_light_offense',
    category: 'Criminal',
    causeOfAction: 'Light Offense (Fine / Arresto Menor)',
    legalBasis: 'RPC Art. 90',
    years: 2,
    notes: '2 months for light offenses under RPC, but 2 years commonly applied.',
  },
  {
    id: 'criminal_libel',
    category: 'Criminal',
    causeOfAction: 'Libel',
    legalBasis: 'RPC Art. 90; Act No. 3326',
    years: 1,
    notes: 'Special law: 1 year from publication or discovery.',
  },
];

// ── Labor ───────────────────────────────────────────────────────────

const LABOR_PERIODS: PrescriptivePeriod[] = [
  {
    id: 'labor_money_claims',
    category: 'Labor',
    causeOfAction: 'Money Claims (Wages, Benefits, Damages)',
    legalBasis: 'Labor Code Art. 306 (formerly Art. 291)',
    years: 3,
    notes: 'From accrual of cause of action. Covers unpaid wages, overtime, 13th month, separation pay.',
  },
  {
    id: 'labor_illegal_dismissal',
    category: 'Labor',
    causeOfAction: 'Illegal Dismissal',
    legalBasis: 'Labor Code Art. 306; Callanta v. Carnation (1988)',
    years: 4,
    notes: '4 years from date of dismissal. Based on Art. 1146 of Civil Code by analogy.',
  },
  {
    id: 'labor_ulp',
    category: 'Labor',
    causeOfAction: 'Unfair Labor Practice',
    legalBasis: 'Labor Code Art. 305 (formerly Art. 290)',
    years: 1,
    notes: '1 year from accrual of the ULP act.',
  },
  {
    id: 'labor_offenses',
    category: 'Labor',
    causeOfAction: 'Offenses Under Labor Code (Criminal)',
    legalBasis: 'Labor Code Art. 305',
    years: 3,
  },
];

// ── Tax ─────────────────────────────────────────────────────────────

const TAX_PERIODS: PrescriptivePeriod[] = [
  {
    id: 'tax_assessment_regular',
    category: 'Tax',
    causeOfAction: 'BIR Assessment (Regular)',
    legalBasis: 'NIRC Sec. 203',
    years: 3,
    notes: '3 years from date of filing of return or last day for filing, whichever is later.',
  },
  {
    id: 'tax_assessment_fraud',
    category: 'Tax',
    causeOfAction: 'BIR Assessment (Fraud / Failure to File)',
    legalBasis: 'NIRC Sec. 222(a)',
    years: 10,
    notes: '10 years from discovery of fraud, falsity, or omission.',
  },
  {
    id: 'tax_collection',
    category: 'Tax',
    causeOfAction: 'Tax Collection (After Assessment)',
    legalBasis: 'NIRC Sec. 222(c)',
    years: 5,
    notes: '5 years from date of assessment.',
  },
  {
    id: 'tax_refund',
    category: 'Tax',
    causeOfAction: 'Tax Refund / Credit Claim',
    legalBasis: 'NIRC Sec. 229',
    years: 2,
    notes: '2 years from date of payment of the tax. Must file both admin and judicial claims within the period.',
  },
];

// ── Exports ─────────────────────────────────────────────────────────

export const PRESCRIPTIVE_PERIODS: PrescriptivePeriod[] = [
  ...CIVIL_PERIODS,
  ...CRIMINAL_PERIODS,
  ...LABOR_PERIODS,
  ...TAX_PERIODS,
];

export const PRESCRIPTIVE_CATEGORIES = ['Civil', 'Criminal', 'Labor', 'Tax'] as const;

export function getPeriodsByCategory(category: string): PrescriptivePeriod[] {
  return PRESCRIPTIVE_PERIODS.filter((p) => p.category === category);
}

export function getPeriodById(id: string): PrescriptivePeriod | undefined {
  return PRESCRIPTIVE_PERIODS.find((p) => p.id === id);
}
