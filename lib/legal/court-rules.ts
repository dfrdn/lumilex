/**
 * Philippine Court Rules — Deadline Chain Definitions
 *
 * Each RuleSet defines a trigger event and cascading deadlines that auto-create
 * deliverables (filings) and hearings in the system.
 *
 * Sources:
 * - 2019 Amended Rules of Civil Procedure (A.M. No. 19-10-20-SC)
 * - NLRC 2011 Revised Rules of Procedure
 * - Revised Rules of the Court of Tax Appeals (A.M. No. 05-11-07-CTA)
 * - Rules of Court (Criminal Procedure)
 */

export interface RuleDeadline {
  id: string;
  label: string;
  legalBasis: string;
  daysFromTrigger: number;
  calendarType: 'calendar' | 'business';
  dependsOn?: string;
  entityType: 'deliverable' | 'hearing';
  hearingType?: string;
  isReglementary: boolean;
  notes?: string;
}

export interface RuleSet {
  id: string;
  name: string;
  triggerEventLabel: string;
  applicableMatterTypes: string[];
  deadlines: RuleDeadline[];
}

// ── Litigation Rule Sets ────────────────────────────────────────────

const LITIGATION_SERVICE_REGULAR: RuleSet = {
  id: 'litigation_service_regular',
  name: 'Service of Summons (Regular Procedure)',
  triggerEventLabel: 'Date of service of summons on defendant',
  applicableMatterTypes: ['Litigation'],
  deadlines: [
    {
      id: 'file_answer',
      label: 'File Answer',
      legalBasis: 'Rule 11, Sec. 1, 2019 Amended Rules',
      daysFromTrigger: 30,
      calendarType: 'calendar',
      entityType: 'deliverable',
      isReglementary: true,
      notes: '30 calendar days from service of summons. Non-extendable for ordinary civil actions.',
    },
    {
      id: 'pretrial_brief',
      label: 'Pre-Trial Brief',
      legalBasis: 'Rule 18, Sec. 6, 2019 Amended Rules',
      daysFromTrigger: 3,
      calendarType: 'calendar',
      dependsOn: 'file_answer',
      entityType: 'deliverable',
      isReglementary: false,
      notes: 'Filed at least 3 days before the pre-trial conference.',
    },
  ],
};

const LITIGATION_SERVICE_SUMMARY: RuleSet = {
  id: 'litigation_service_summary',
  name: 'Service of Summons (Summary Procedure)',
  triggerEventLabel: 'Date of service of summons on defendant',
  applicableMatterTypes: ['Litigation'],
  deadlines: [
    {
      id: 'file_answer_summary',
      label: 'File Answer (Summary)',
      legalBasis: 'Rule on Summary Procedure, Sec. 5',
      daysFromTrigger: 10,
      calendarType: 'calendar',
      entityType: 'deliverable',
      isReglementary: true,
      notes: '10 calendar days. No motion to dismiss or motion for extension allowed.',
    },
  ],
};

const LITIGATION_ADVERSE_JUDGMENT: RuleSet = {
  id: 'litigation_adverse_judgment',
  name: 'Receipt of Adverse Judgment',
  triggerEventLabel: 'Date of receipt of judgment or final order',
  applicableMatterTypes: ['Litigation'],
  deadlines: [
    {
      id: 'notice_of_appeal',
      label: 'File Notice of Appeal',
      legalBasis: 'Rule 41, Sec. 3, 2019 Amended Rules',
      daysFromTrigger: 15,
      calendarType: 'calendar',
      entityType: 'deliverable',
      isReglementary: true,
      notes: '15 calendar days from notice of judgment. Jurisdictional — non-extendable.',
    },
    {
      id: 'record_on_appeal',
      label: 'File Record on Appeal',
      legalBasis: 'Rule 41, Sec. 3, 2019 Amended Rules',
      daysFromTrigger: 30,
      calendarType: 'calendar',
      entityType: 'deliverable',
      isReglementary: true,
      notes: 'Required only in special proceedings and multiple/separate appeals.',
    },
    {
      id: 'appellants_brief',
      label: "File Appellant's Brief",
      legalBasis: 'Rule 44, Sec. 7',
      daysFromTrigger: 45,
      calendarType: 'calendar',
      entityType: 'deliverable',
      isReglementary: false,
      notes: '45 days from receipt of notice from clerk of court. Extendable for good cause.',
    },
  ],
};

const LITIGATION_MR: RuleSet = {
  id: 'litigation_mr',
  name: 'Receipt of Resolution/Order',
  triggerEventLabel: 'Date of receipt of resolution or order',
  applicableMatterTypes: ['Litigation'],
  deadlines: [
    {
      id: 'motion_for_reconsideration',
      label: 'File Motion for Reconsideration',
      legalBasis: 'Rule 37, Sec. 1; Rule 52, Sec. 1',
      daysFromTrigger: 15,
      calendarType: 'calendar',
      entityType: 'deliverable',
      isReglementary: true,
      notes: '15 calendar days from notice. Filing tolls the period to appeal.',
    },
  ],
};

const LITIGATION_CERTIORARI: RuleSet = {
  id: 'litigation_certiorari',
  name: 'Petition for Certiorari (Rule 65)',
  triggerEventLabel: 'Date of receipt of assailed order/resolution',
  applicableMatterTypes: ['Litigation'],
  deadlines: [
    {
      id: 'petition_certiorari',
      label: 'File Petition for Certiorari',
      legalBasis: 'Rule 65, Sec. 4, 2019 Amended Rules',
      daysFromTrigger: 60,
      calendarType: 'calendar',
      entityType: 'deliverable',
      isReglementary: true,
      notes: '60 calendar days from notice. Non-extendable.',
    },
  ],
};

// ── Labor (NLRC) Rule Sets ──────────────────────────────────────────

const LABOR_SUMMONS: RuleSet = {
  id: 'labor_summons',
  name: 'Receipt of Summons (NLRC)',
  triggerEventLabel: 'Date of receipt of summons/notice of hearing',
  applicableMatterTypes: ['Labor'],
  deadlines: [
    {
      id: 'position_paper',
      label: 'File Position Paper',
      legalBasis: 'NLRC Rules, Rule V, Sec. 11',
      daysFromTrigger: 10,
      calendarType: 'calendar',
      entityType: 'deliverable',
      isReglementary: true,
      notes: '10 calendar days from receipt. Non-extendable under 2011 NLRC Rules.',
    },
    {
      id: 'labor_mandatory_conference',
      label: 'Mandatory Conciliation/Mediation Conference',
      legalBasis: 'NLRC Rules, Rule V, Sec. 7',
      daysFromTrigger: 10,
      calendarType: 'calendar',
      entityType: 'hearing',
      hearingType: 'Initial Hearing',
      isReglementary: false,
      notes: 'Typically scheduled within 10 days of receipt of complaint.',
    },
  ],
};

const LABOR_DECISION: RuleSet = {
  id: 'labor_decision',
  name: 'Receipt of LA Decision (NLRC)',
  triggerEventLabel: 'Date of receipt of Labor Arbiter decision',
  applicableMatterTypes: ['Labor'],
  deadlines: [
    {
      id: 'labor_appeal_memo',
      label: 'File Appeal Memorandum to NLRC',
      legalBasis: 'NLRC Rules, Rule VI, Sec. 1; Labor Code Art. 229',
      daysFromTrigger: 10,
      calendarType: 'calendar',
      entityType: 'deliverable',
      isReglementary: true,
      notes: '10 calendar days from receipt of decision. Jurisdictional.',
    },
  ],
};

const LABOR_NLRC_RESOLUTION: RuleSet = {
  id: 'labor_nlrc_resolution',
  name: 'Receipt of NLRC Resolution',
  triggerEventLabel: 'Date of receipt of NLRC resolution',
  applicableMatterTypes: ['Labor'],
  deadlines: [
    {
      id: 'labor_mr',
      label: 'File Motion for Reconsideration (NLRC)',
      legalBasis: 'NLRC Rules, Rule VII, Sec. 15',
      daysFromTrigger: 10,
      calendarType: 'calendar',
      entityType: 'deliverable',
      isReglementary: true,
      notes: '10 calendar days. Only one MR allowed.',
    },
    {
      id: 'labor_certiorari_ca',
      label: 'File Petition for Certiorari (CA)',
      legalBasis: 'Rule 65, Sec. 4; St. Martin Funeral Homes doctrine',
      daysFromTrigger: 60,
      calendarType: 'calendar',
      entityType: 'deliverable',
      isReglementary: true,
      notes: '60 calendar days from receipt of NLRC resolution denying MR.',
    },
  ],
};

// ── Tax (CTA) Rule Sets ─────────────────────────────────────────────

const TAX_ASSESSMENT: RuleSet = {
  id: 'tax_assessment',
  name: 'Receipt of Final Assessment Notice',
  triggerEventLabel: 'Date of receipt of Final Assessment Notice (FAN)',
  applicableMatterTypes: ['Tax'],
  deadlines: [
    {
      id: 'tax_protest',
      label: 'File Administrative Protest',
      legalBasis: 'NIRC Sec. 228; RR No. 12-99',
      daysFromTrigger: 30,
      calendarType: 'calendar',
      entityType: 'deliverable',
      isReglementary: true,
      notes: '30 days from receipt of FAN. Failure renders assessment final and executory.',
    },
  ],
};

const TAX_ADVERSE_DECISION: RuleSet = {
  id: 'tax_adverse_decision',
  name: 'Receipt of Adverse CIR Decision',
  triggerEventLabel: 'Date of receipt of adverse decision or inaction by CIR',
  applicableMatterTypes: ['Tax'],
  deadlines: [
    {
      id: 'tax_petition_review',
      label: 'File Petition for Review (CTA)',
      legalBasis: 'RA 1125, Sec. 11; CTA Rules, Rule 4, Sec. 3',
      daysFromTrigger: 30,
      calendarType: 'calendar',
      entityType: 'deliverable',
      isReglementary: true,
      notes: '30 days from receipt of decision or expiry of 180-day period of inaction.',
    },
  ],
};

const TAX_CTA_PETITION: RuleSet = {
  id: 'tax_cta_petition',
  name: 'Filing of CTA Petition',
  triggerEventLabel: 'Date of filing of Petition for Review with CTA',
  applicableMatterTypes: ['Tax'],
  deadlines: [
    {
      id: 'tax_cta_answer',
      label: "File CIR's Answer",
      legalBasis: 'CTA Rules, Rule 6, Sec. 3',
      daysFromTrigger: 30,
      calendarType: 'calendar',
      entityType: 'deliverable',
      isReglementary: false,
      notes: "30 days from service of petition. CIR's deadline — track for monitoring.",
    },
  ],
};

// ── Exported Rule Sets ──────────────────────────────────────────────

export const RULE_SETS: RuleSet[] = [
  // Litigation
  LITIGATION_SERVICE_REGULAR,
  LITIGATION_SERVICE_SUMMARY,
  LITIGATION_ADVERSE_JUDGMENT,
  LITIGATION_MR,
  LITIGATION_CERTIORARI,
  // Labor
  LABOR_SUMMONS,
  LABOR_DECISION,
  LABOR_NLRC_RESOLUTION,
  // Tax
  TAX_ASSESSMENT,
  TAX_ADVERSE_DECISION,
  TAX_CTA_PETITION,
];

export function getRuleSetsForMatterType(matterType: string): RuleSet[] {
  return RULE_SETS.filter((rs) => rs.applicableMatterTypes.includes(matterType));
}

export function getRuleSetById(id: string): RuleSet | undefined {
  return RULE_SETS.find((rs) => rs.id === id);
}

// ── Async DB-backed functions ──────────────────────────────────────

import { getSupabase } from '@/lib/supabase';

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapDbRuleSet(row: any): RuleSet {
  return {
    id: row.id,
    name: row.name,
    triggerEventLabel: row.trigger_event_label,
    applicableMatterTypes: row.applicable_matter_types ?? [],
    deadlines: (row.rule_deadlines ?? [])
      .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((d: any): RuleDeadline => ({
        id: d.id,
        label: d.label,
        legalBasis: d.legal_basis ?? '',
        daysFromTrigger: d.days_from_trigger,
        calendarType: d.calendar_type,
        dependsOn: d.depends_on ?? undefined,
        entityType: d.entity_type,
        hearingType: d.hearing_type ?? undefined,
        isReglementary: d.is_reglementary ?? false,
        notes: d.notes ?? undefined,
      })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// `rule_sets` / `rule_deadlines` are global tables (PH court rules are the same
// for every firm), so these reads stay on the raw service client by design.
export async function fetchAllRuleSets(): Promise<RuleSet[]> {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('rule_sets')
      .select('*, rule_deadlines(*)')
      .order('name');
    if (!data || data.length === 0) return RULE_SETS;
    return data.map(mapDbRuleSet);
  } catch {
    return RULE_SETS;
  }
}

export async function fetchRuleSetsForMatterType(matterType: string): Promise<RuleSet[]> {
  const all = await fetchAllRuleSets();
  return all.filter((rs) =>
    rs.applicableMatterTypes.some((t) =>
      matterType.toLowerCase().includes(t.toLowerCase()),
    ),
  );
}

export async function fetchRuleSetById(id: string): Promise<RuleSet | undefined> {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('rule_sets')
      .select('*, rule_deadlines(*)')
      .eq('id', id)
      .single();
    if (data) return mapDbRuleSet(data);
  } catch {}
  return RULE_SETS.find((rs) => rs.id === id);
}
