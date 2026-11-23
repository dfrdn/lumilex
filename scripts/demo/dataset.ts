import type { DemoPersonaKey } from '../../lib/demo/personas';
import { MATTER_STATUS, type MatterStatus } from '../../lib/matter-status';

/**
 * The public demo's cast, client book and matter list. Every person, company,
 * adverse party, docket number, address and figure here is invented: the demo
 * is reachable by anyone, so nothing in it may belong to a real client or firm.
 * Public institutions (courts, the NLRC, SEC, BIR, IPOPHL) are real on purpose —
 * a Philippine firm's work is filed with them.
 *
 * Contact addresses use the reserved `.example` TLD, TINs and bank numbers are
 * zero-filled, and staff sign in at the demo's own domain.
 */

export const FIRM = {
  name: 'Lumilex & Partners',
  letterhead: 'LUMILEX & PARTNERS',
  tagline: 'Attorneys and Counsellors at Law',
  address: '18/F Tala Pointe Tower, 88 Dela Rosa Street, Legazpi Village, Makati City 1229',
  address2: 'Metro Manila, Philippines',
  phone: '(02) 8000 0000',
  email: 'office@demo.lumilex.co',
  tin: '000-000-000-00000',
  bankName: 'Demo Savings Bank (fictional)',
  bankAccountName: 'Lumilex & Partners Law Offices',
  bankAccountNo: '0000-0000-00',
};

export const STAFF_DOMAIN = 'demo.lumilex.co';

export interface StaffSeed {
  /** A handle used only inside this seed to refer to the person. */
  key: string;
  name: string;
  nickname: string;
  position: string;
  role: string;
  salary: number;
  yearsAtFirm: number;
  /** Bills time and appears on matters. */
  feeEarner: boolean;
  persona?: DemoPersonaKey;
}

/**
 * Thirteen people. Grace Bautista, the office manager, is the first admin that
 * provisioning already created from firm.json — her row is reused, not made.
 */
export const STAFF: StaffSeed[] = [
  { key: 'isabel', name: 'Isabel R. Navarro', nickname: 'Isabel', position: 'Managing Partner', role: 'partner', salary: 320000, yearsAtFirm: 14, feeEarner: true, persona: 'partner' },
  { key: 'elena', name: 'Elena M. Soriano', nickname: 'Elena', position: 'Founding Partner', role: 'partner', salary: 300000, yearsAtFirm: 16, feeEarner: true },
  { key: 'aurora', name: 'Aurora T. Villanueva', nickname: 'Aurora', position: 'Partner', role: 'partner', salary: 240000, yearsAtFirm: 9, feeEarner: true },
  { key: 'ferdinand', name: 'Ferdinand L. Ocampo', nickname: 'Ferdy', position: 'Of Counsel', role: 'lawyer', salary: 150000, yearsAtFirm: 5, feeEarner: true },
  { key: 'diego', name: 'Diego R. Salazar', nickname: 'Diego', position: 'Senior Associate', role: 'lawyer', salary: 120000, yearsAtFirm: 6, feeEarner: true, persona: 'lawyer' },
  { key: 'katrina', name: 'Katrina A. Lim', nickname: 'Kat', position: 'Mid-level Associate', role: 'lawyer', salary: 95000, yearsAtFirm: 4, feeEarner: true },
  { key: 'paolo', name: 'Paolo J. Mendoza', nickname: 'Paolo', position: 'Junior Associate', role: 'lawyer', salary: 70000, yearsAtFirm: 2, feeEarner: true },
  { key: 'bianca', name: 'Bianca S. Cruz', nickname: 'Bianca', position: 'Junior Associate', role: 'lawyer', salary: 70000, yearsAtFirm: 1, feeEarner: true },
  { key: 'sofia', name: 'Sofia G. Alcantara', nickname: 'Sofia', position: 'Underbar Associate', role: 'lawyer', salary: 45000, yearsAtFirm: 1, feeEarner: true },
  { key: 'grace', name: 'Grace Bautista', nickname: 'Grace', position: 'Office Manager', role: 'admin', salary: 65000, yearsAtFirm: 8, feeEarner: false, persona: 'admin' },
  { key: 'marilou', name: 'Marilou D. Santos', nickname: 'Marilou', position: 'Head Secretary & Finance Officer', role: 'finance', salary: 60000, yearsAtFirm: 11, feeEarner: false, persona: 'finance' },
  { key: 'rico', name: 'Rico P. Delos Santos', nickname: 'Rico', position: 'Chief Liaison Officer', role: 'chief_liaison_officer', salary: 42000, yearsAtFirm: 7, feeEarner: false, persona: 'liaison' },
  { key: 'pascual', name: 'Jun C. Pascual', nickname: 'Jun', position: 'Liaison Officer', role: 'liaison_officer', salary: 32000, yearsAtFirm: 3, feeEarner: false },
];

/** Invented hourly rates, one per position in lib/billing/seniority.ts. */
export const HOURLY_RATES: ReadonlyArray<{ position: string; hourlyRate: number }> = [
  { position: 'Founding Partner', hourlyRate: 12000 },
  { position: 'Managing Partner', hourlyRate: 12000 },
  { position: 'Monitoring Partner', hourlyRate: 11000 },
  { position: 'Partner', hourlyRate: 10000 },
  { position: 'Of Counsel', hourlyRate: 9000 },
  { position: 'Senior Associate', hourlyRate: 7000 },
  { position: 'Mid-level Associate', hourlyRate: 5500 },
  { position: 'Junior Associate', hourlyRate: 4500 },
  { position: 'Underbar Associate', hourlyRate: 2500 },
];

export interface ClientSeed {
  key: string;
  name: string;
  full: string;
  code: number;
  /** A person at the client, for the point-persons field and letters. */
  contact: string;
  contactTitle: string;
  emailDomain: string;
  partner: string;
  priority: boolean;
  discount: number | null;
  collectionRisk: boolean;
  individual: boolean;
}

export const CLIENTS: ClientSeed[] = [
  { key: 'luntian', name: 'Luntian Harbor Logistics', full: 'Luntian Harbor Logistics Corporation', code: 101, contact: 'Ana Marie B. Bernardo', contactTitle: 'Finance Head', emailDomain: 'luntian-harbor.example', partner: 'isabel', priority: true, discount: null, collectionRisk: false, individual: false },
  { key: 'bantayog', name: 'Bantayog Ridge Realty', full: 'Bantayog Ridge Realty Corporation', code: 102, contact: 'Mark Dizon', contactTitle: 'Chief Financial Officer', emailDomain: 'bantayog-ridge.example', partner: 'isabel', priority: true, discount: null, collectionRisk: false, individual: false },
  { key: 'amihan', name: 'Amihan Crest BPO', full: 'Amihan Crest BPO Services, Inc.', code: 103, contact: 'Liza Ramos', contactTitle: 'HR Director', emailDomain: 'amihan-crest.example', partner: 'elena', priority: true, discount: 10, collectionRisk: false, individual: false },
  { key: 'kalamansi', name: 'Kalamansi Grove Foods', full: 'Kalamansi Grove Food Manufacturing Corp.', code: 104, contact: 'Carlo Yap', contactTitle: 'President', emailDomain: 'kalamansi-grove.example', partner: 'aurora', priority: true, discount: null, collectionRisk: false, individual: false },
  { key: 'pilakbato', name: 'Pilakbato Mining', full: 'Pilakbato Mining Corporation', code: 105, contact: 'Ernesto Galvez', contactTitle: 'VP for Legal and Permits', emailDomain: 'pilakbato-mining.example', partner: 'isabel', priority: false, discount: null, collectionRisk: false, individual: false },
  { key: 'sinag', name: 'Sinag Microfinance', full: 'Sinag Microfinance, Inc.', code: 106, contact: 'Teresita Llamas', contactTitle: 'Compliance Officer', emailDomain: 'sinag-microfinance.example', partner: 'elena', priority: false, discount: 5, collectionRisk: false, individual: false },
  { key: 'habilin', name: 'Habilin Textile Mills', full: 'Habilin Textile Mills, Inc.', code: 107, contact: 'Ramil Estrada', contactTitle: 'Plant Manager', emailDomain: 'habilin-textile.example', partner: 'elena', priority: false, discount: null, collectionRisk: false, individual: false },
  { key: 'halcyon', name: 'Halcyon Digital', full: 'Halcyon Digital Solutions, Inc.', code: 108, contact: 'Nadine Uy', contactTitle: 'Chief Operating Officer', emailDomain: 'halcyon-digital.example', partner: 'aurora', priority: false, discount: null, collectionRisk: true, individual: false },
  { key: 'silab', name: 'Silab Ridge Energy', full: 'Silab Ridge Energy Holdings Corp.', code: 109, contact: 'Victor Samonte', contactTitle: 'Treasurer', emailDomain: 'silab-ridge.example', partner: 'isabel', priority: false, discount: null, collectionRisk: false, individual: false },
  { key: 'palayan', name: 'Palayan Verde Agri-Ventures', full: 'Palayan Verde Agri-Ventures, Inc.', code: 110, contact: 'Josefina Macaraeg', contactTitle: 'General Manager', emailDomain: 'palayan-verde.example', partner: 'aurora', priority: false, discount: null, collectionRisk: false, individual: false },
  { key: 'dalampasigan', name: 'Dalampasigan Bay Hospitality', full: 'Dalampasigan Bay Hospitality Group, Inc.', code: 111, contact: 'Paula Enriquez', contactTitle: 'Legal Manager', emailDomain: 'dalampasigan-bay.example', partner: 'elena', priority: false, discount: null, collectionRisk: false, individual: false },
  { key: 'bakal', name: 'Bakal Forge Fabricators', full: 'Bakal Forge Fabricators, Inc.', code: 112, contact: 'Oscar Tuazon', contactTitle: 'Operations Director', emailDomain: 'bakal-forge.example', partner: 'isabel', priority: false, discount: null, collectionRisk: false, individual: false },
  { key: 'pahina', name: 'Pahina Lakan Publishing', full: 'Pahina Lakan Publishing House, Inc.', code: 113, contact: 'Celia Arguelles', contactTitle: 'Publisher', emailDomain: 'pahina-lakan.example', partner: 'aurora', priority: false, discount: null, collectionRisk: false, individual: false },
  { key: 'lunas', name: 'Lunas Crest Pharma', full: 'Lunas Crest Pharma Distributors, Inc.', code: 114, contact: 'Gilbert Ong', contactTitle: 'Commercial Director', emailDomain: 'lunas-crest.example', partner: 'elena', priority: false, discount: null, collectionRisk: false, individual: false },
  { key: 'villareal', name: 'Sps. Villareal', full: 'Spouses Antonio and Carmen Villareal', code: 115, contact: 'Carmen Villareal', contactTitle: 'Client', emailDomain: 'villareal-family.example', partner: 'elena', priority: false, discount: null, collectionRisk: false, individual: true },
  { key: 'gutierrez', name: 'R. Gutierrez', full: 'Rafael M. Gutierrez', code: 116, contact: 'Rafael M. Gutierrez', contactTitle: 'Client', emailDomain: 'gutierrez-family.example', partner: 'elena', priority: false, discount: null, collectionRisk: false, individual: true },
  { key: 'bagwis', name: 'Bagwis Ventures', full: 'Bagwis Ventures Holdings, Inc.', code: 117, contact: 'Leandro Sison', contactTitle: 'Managing Director', emailDomain: 'bagwis-ventures.example', partner: 'isabel', priority: false, discount: null, collectionRisk: false, individual: false },
  { key: 'sibol', name: 'Sibol Pag-asa Coop', full: 'Sibol Pag-asa Multi-Purpose Cooperative', code: 118, contact: 'Rosario Dimaano', contactTitle: 'Chairperson', emailDomain: 'sibol-pagasa.example', partner: 'aurora', priority: false, discount: null, collectionRisk: false, individual: false },
];

/** Deliverable types, as the firm's enum_options name them. */
export const DTYPE = {
  EXTERNAL: 'External',
  INTERNAL: 'Internal',
  FOR_CLIENT: 'For Client',
  STATUS_REPORT: 'Status Report',
} as const;

export type WorkStage = 'done' | 'open' | 'early' | 'archived';

/** How a document is laid out when rendered. */
export type DocLayout = 'pleading' | 'letter' | 'memorandum' | 'agreement' | 'certificate';

export interface WorkSeed {
  title: string;
  type: string;
  subtype: string;
  layout: DocLayout;
  stage: WorkStage;
  /** Affiant of a judicial affidavit. */
  witness?: string;
  /** Marks the one deliverable that carries the affidavit-checker fixture. */
  affidavitFixture?: boolean;
  /** Letters: who it is addressed to, one line per row of the address block. */
  to?: string[];
}

export interface CaseSeed {
  court: string;
  docket: string;
  nature: string;
  clientRole: string;
  adverse: string;
  adverseRole: string;
  /** The client is the one who filed (plaintiff, opposer) rather than the one answering. */
  clientFiled: boolean;
  forum: 'court' | 'labor' | 'ipophl';
  description: string;
}

export interface MatterSeed {
  key: string;
  client: string;
  name: string;
  type: string;
  status: MatterStatus;
  /** Days before today the matter was opened. */
  openedDaysAgo: number;
  /** Staff keys: partner first, then the associates who work it. */
  team: string[];
  billing: 'litigation' | 'retainer' | 'fixed_fee' | 'none';
  case?: CaseSeed;
  work: WorkSeed[];
}

const W = (
  title: string,
  type: string,
  subtype: string,
  layout: DocLayout,
  stage: WorkStage,
  extra: Partial<WorkSeed> = {},
): WorkSeed => ({ title, type, subtype, layout, stage, ...extra });

const { EXTERNAL, INTERNAL, FOR_CLIENT, STATUS_REPORT } = DTYPE;
const { ONGOING, DONE, ARCHIVED } = MATTER_STATUS;

export const MATTERS: MatterSeed[] = [
  {
    key: 'collection', client: 'luntian', name: 'Collection Case v. Dapithapon Freight', type: 'Litigation', status: ONGOING,
    openedDaysAgo: 410, team: ['isabel', 'diego', 'paolo'], billing: 'litigation',
    case: {
      court: 'Regional Trial Court, Branch 137, Makati City', docket: 'Civil Case No. R-MKT-25-00417-CV',
      nature: 'For: Sum of Money and Damages', clientRole: 'Plaintiff', adverse: 'Dapithapon Freight Services, Inc.', adverseRole: 'Defendant',
      clientFiled: true, forum: 'court',
      description: 'Action to collect unpaid freight-forwarding invoices under a 2023 master services agreement, with interest and attorney’s fees. Defendant answered claiming partial payment and set-off.',
    },
    work: [
      W('Complaint for Sum of Money and Damages', EXTERNAL, 'Complaint', 'pleading', 'done'),
      W('Reply to Defendant’s Answer', EXTERNAL, 'Reply', 'pleading', 'done'),
      W('Pre-Trial Brief for Plaintiff', EXTERNAL, 'Pre-Trial Brief', 'pleading', 'open'),
      W('Judicial Affidavit of Ana Marie B. Bernardo', EXTERNAL, 'Judicial Affidavit', 'pleading', 'open', { witness: 'Ana Marie B. Bernardo', affidavitFixture: true }),
      W('Judicial Affidavit of Rodel S. Magbanua', EXTERNAL, 'Judicial Affidavit', 'pleading', 'early', { witness: 'Rodel S. Magbanua' }),
      W('Status Report — Collection Case', STATUS_REPORT, 'Other', 'letter', 'open'),
      W('Manifestation of Compliance with the Pre-Trial Order', EXTERNAL, 'Manifestation', 'pleading', 'early'),
    ],
  },
  {
    key: 'luntian-housekeeping', client: 'luntian', name: 'Annual Corporate Housekeeping 2026', type: 'Corporate Housekeeping', status: ONGOING,
    openedDaysAgo: 260, team: ['aurora', 'katrina', 'sofia'], billing: 'fixed_fee',
    work: [
      W('General Information Sheet 2026', EXTERNAL, 'Compliance', 'letter', 'done', { to: ['Securities and Exchange Commission', 'Company Registration and Monitoring Department', 'Makati City'] }),
      W('Secretary’s Certificate — Annual Stockholders’ Meeting', FOR_CLIENT, 'Other', 'certificate', 'open'),
      W('Board Resolution — Change of Bank Signatories', FOR_CLIENT, 'Other', 'certificate', 'early'),
    ],
  },
  {
    key: 'luntian-retainer', client: 'luntian', name: 'General Retainer 2026', type: 'Retainer', status: ONGOING,
    openedDaysAgo: 270, team: ['isabel', 'diego', 'bianca'], billing: 'retainer',
    work: [
      W('Legal Opinion — Liability for Cargo Lost in Transit', FOR_CLIENT, 'Memorandum', 'memorandum', 'open'),
      W('Review of Warehouse Lease Agreement', FOR_CLIENT, 'Contract/Agreement', 'agreement', 'done'),
      W('Demand Letter — Unreturned Container Deposits', EXTERNAL, 'Demand Letter', 'letter', 'open', { to: ['The General Manager', 'Bagtikan Container Yard Services, Inc.', 'Harbor Road, Port Area, Manila'] }),
      W('Monthly Retainer Report', STATUS_REPORT, 'Other', 'letter', 'done'),
      W('Legal Opinion — Data Sharing with Freight Partners', FOR_CLIENT, 'Memorandum', 'memorandum', 'done'),
    ],
  },
  {
    key: 'ramirez', client: 'amihan', name: 'Illegal Dismissal — Ramirez', type: 'Labor', status: ONGOING,
    openedDaysAgo: 180, team: ['elena', 'katrina', 'bianca'], billing: 'litigation',
    case: {
      court: 'NLRC National Capital Region Arbitration Branch, Quezon City', docket: 'NLRC NCR Case No. 03-04512-26',
      nature: 'For: Illegal Dismissal, Backwages and Damages', clientRole: 'Respondents', adverse: 'Jose P. Ramirez', adverseRole: 'Complainant',
      clientFiled: false, forum: 'labor',
      description: 'A former team lead claims he was dismissed without the twin-notice procedure. The client’s position is abandonment after eleven consecutive unexplained absences.',
    },
    work: [
      W('Position Paper for Respondents', EXTERNAL, 'Position Paper', 'pleading', 'done'),
      W('Motion for Extension of Time to File Reply', EXTERNAL, 'Motion', 'pleading', 'done'),
      W('Reply to Complainant’s Position Paper', EXTERNAL, 'Reply', 'pleading', 'open'),
      W('Memorandum on Exposure to Monetary Awards', INTERNAL, 'Memorandum', 'memorandum', 'open'),
      W('Status Report — Ramirez Case', STATUS_REPORT, 'Other', 'letter', 'done'),
    ],
  },
  {
    key: 'handbook', client: 'amihan', name: 'Employee Handbook Revision', type: 'Labor', status: ONGOING,
    openedDaysAgo: 95, team: ['elena', 'katrina', 'sofia'], billing: 'fixed_fee',
    work: [
      W('Revised Employee Handbook (Chapters 1–6)', FOR_CLIENT, 'Other', 'agreement', 'open'),
      W('Memorandum on Hybrid-Work Attendance Rules', INTERNAL, 'Memorandum', 'memorandum', 'done'),
    ],
  },
  {
    key: 'amihan-retainer', client: 'amihan', name: 'General Retainer 2026', type: 'Retainer', status: ONGOING,
    openedDaysAgo: 272, team: ['elena', 'diego', 'paolo'], billing: 'retainer',
    work: [
      W('Legal Opinion — Night-Shift Differential for Remote Agents', FOR_CLIENT, 'Memorandum', 'memorandum', 'done'),
      W('Notice to Explain — Template Set', FOR_CLIENT, 'Notice', 'letter', 'open', { to: ['[Name of Employee]', '[Position and Department]'] }),
    ],
  },
  {
    key: 'lease', client: 'bantayog', name: 'Breach of Lease v. Kalye Uno Retail', type: 'Litigation', status: ONGOING,
    openedDaysAgo: 300, team: ['isabel', 'diego', 'bianca'], billing: 'litigation',
    case: {
      court: 'Regional Trial Court, Branch 62, Makati City', docket: 'Civil Case No. R-MKT-25-00288-CV',
      nature: 'For: Breach of Contract and Damages', clientRole: 'Plaintiff', adverse: 'Kalye Uno Retail Ventures Corp.', adverseRole: 'Defendant',
      clientFiled: true, forum: 'court',
      description: 'The lessee of a ground-floor commercial unit pre-terminated a five-year lease in its second year and stopped paying rent. The client claims unpaid rentals and the pre-termination penalty.',
    },
    work: [
      W('Complaint for Breach of Contract and Damages', EXTERNAL, 'Complaint', 'pleading', 'done'),
      W('Comment/Opposition to Motion to Dismiss', EXTERNAL, 'Comment/Opposition', 'pleading', 'done'),
      W('Motion to Declare Defendant in Default', EXTERNAL, 'Motion', 'pleading', 'open'),
      W('Judicial Affidavit of Mark Dizon', EXTERNAL, 'Judicial Affidavit', 'pleading', 'open', { witness: 'Mark Dizon' }),
      W('Status Report — Lease Case', STATUS_REPORT, 'Other', 'letter', 'open'),
    ],
  },
  {
    key: 'opposition', client: 'bantayog', name: 'Trademark Opposition — "BANTAYOG"', type: 'Intellectual Property', status: ONGOING,
    openedDaysAgo: 150, team: ['aurora', 'ferdinand', 'sofia'], billing: 'litigation',
    case: {
      court: 'Intellectual Property Office of the Philippines, Bureau of Legal Affairs', docket: 'Inter Partes Case No. 4-2026-00123',
      nature: 'Opposition to Application No. 4-2025-0098765', clientRole: 'Opposer', adverse: 'Bantayog Home Goods Trading', adverseRole: 'Respondent-Applicant',
      clientFiled: true, forum: 'ipophl',
      description: 'Opposition to a third party’s application to register BANTAYOG for household goods, on the ground of confusing similarity with the client’s registered mark.',
    },
    work: [
      W('Verified Notice of Opposition', EXTERNAL, 'Petition', 'pleading', 'done'),
      W('Position Paper for Opposer', EXTERNAL, 'Position Paper', 'pleading', 'open'),
      W('Judicial Affidavit of Mylene Tabora', EXTERNAL, 'Judicial Affidavit', 'pleading', 'early', { witness: 'Mylene Tabora' }),
    ],
  },
  {
    key: 'sec-2025', client: 'bantayog', name: 'SEC Reportorial Filings 2025', type: 'Corporate Housekeeping', status: DONE,
    openedDaysAgo: 330, team: ['aurora', 'katrina'], billing: 'fixed_fee',
    work: [
      W('General Information Sheet 2025', EXTERNAL, 'Compliance', 'letter', 'done', { to: ['Securities and Exchange Commission', 'Company Registration and Monitoring Department', 'Makati City'] }),
      W('Audited Financial Statements 2025 — Filing Letter', EXTERNAL, 'Compliance', 'letter', 'done', { to: ['Securities and Exchange Commission', 'Financial Reporting Division', 'Makati City'] }),
    ],
  },
  {
    key: 'marikit', client: 'kalamansi', name: 'Sum of Money v. Marikit Trading', type: 'Litigation', status: ONGOING,
    openedDaysAgo: 120, team: ['aurora', 'diego', 'paolo'], billing: 'litigation',
    case: {
      court: 'Metropolitan Trial Court, Branch 65, Makati City', docket: 'Civil Case No. M-MKT-26-00931-SC',
      nature: 'For: Sum of Money (Small Claims)', clientRole: 'Plaintiff', adverse: 'Marikit Trading Co.', adverseRole: 'Defendant',
      clientFiled: true, forum: 'court',
      description: 'Small-claims action over three dishonoured checks issued for calamansi concentrate deliveries.',
    },
    work: [
      W('Statement of Claim with Annexes', EXTERNAL, 'Complaint', 'pleading', 'done'),
      W('Manifestation re: Hearing Date', EXTERNAL, 'Manifestation', 'pleading', 'open'),
      W('Status Report — Small Claims Case', STATUS_REPORT, 'Other', 'letter', 'done'),
    ],
  },
  {
    key: 'tm-portfolio', client: 'kalamansi', name: 'Trademark Portfolio Management', type: 'Intellectual Property', status: ONGOING,
    openedDaysAgo: 340, team: ['aurora', 'katrina', 'sofia'], billing: 'retainer',
    work: [
      W('Declaration of Actual Use — KALAMANSI GROVE', EXTERNAL, 'Compliance', 'letter', 'done', { to: ['Intellectual Property Office of the Philippines', 'Bureau of Trademarks', 'Taguig City'] }),
      W('Trademark Watch Report — Q3', FOR_CLIENT, 'Memorandum', 'memorandum', 'open'),
    ],
  },
  {
    key: 'supply', client: 'kalamansi', name: 'Supply Agreement Review', type: 'Special Project', status: ONGOING,
    openedDaysAgo: 40, team: ['elena', 'ferdinand', 'bianca'], billing: 'fixed_fee',
    work: [
      W('Supply Agreement — Redlined Draft', FOR_CLIENT, 'Contract/Agreement', 'agreement', 'open'),
      W('Issues List — Supplier Draft', INTERNAL, 'Memorandum', 'memorandum', 'done'),
    ],
  },
  {
    key: 'delapaz', client: 'habilin', name: 'Constructive Dismissal — Dela Paz', type: 'Labor', status: ONGOING,
    openedDaysAgo: 85, team: ['elena', 'diego', 'paolo'], billing: 'litigation',
    case: {
      court: 'NLRC National Capital Region Arbitration Branch, Quezon City', docket: 'NLRC NCR Case No. 06-07731-26',
      nature: 'For: Constructive Dismissal and Money Claims', clientRole: 'Respondents', adverse: 'Liberty M. Dela Paz', adverseRole: 'Complainant',
      clientFiled: false, forum: 'labor',
      description: 'A quality-control supervisor claims her transfer to the second plant was a demotion amounting to constructive dismissal. The client maintains the transfer was a valid exercise of management prerogative with no loss of pay.',
    },
    work: [
      W('Position Paper for Respondents', EXTERNAL, 'Position Paper', 'pleading', 'open'),
      W('Memorandum on Management Prerogative to Transfer', INTERNAL, 'Memorandum', 'memorandum', 'done'),
      W('Reply to Complainant’s Position Paper', EXTERNAL, 'Reply', 'pleading', 'early'),
    ],
  },
  {
    key: 'wage-order', client: 'habilin', name: 'Wage Order Compliance Review', type: 'Labor', status: DONE,
    openedDaysAgo: 230, team: ['elena', 'katrina'], billing: 'fixed_fee',
    work: [
      W('Wage Order Compliance Memorandum', FOR_CLIENT, 'Memorandum', 'memorandum', 'done'),
    ],
  },
  {
    key: 'incorporation', client: 'halcyon', name: 'Incorporation of Subsidiary', type: 'Incorporation', status: ONGOING,
    openedDaysAgo: 60, team: ['aurora', 'katrina', 'sofia'], billing: 'fixed_fee',
    work: [
      W('Articles of Incorporation and By-Laws — Halcyon Digital Labs', FOR_CLIENT, 'Other', 'agreement', 'done'),
      W('Treasurer’s Affidavit', EXTERNAL, 'Compliance', 'certificate', 'open'),
      W('Name Verification and Reservation', EXTERNAL, 'Compliance', 'letter', 'done', { to: ['Securities and Exchange Commission', 'Company Registration and Monitoring Department', 'Makati City'] }),
    ],
  },
  {
    key: 'post-inc', client: 'halcyon', name: 'Post-Incorporation Compliance', type: 'Post-Incorporation', status: ONGOING,
    openedDaysAgo: 200, team: ['aurora', 'sofia', 'bianca'], billing: 'fixed_fee',
    work: [
      W('BIR Registration Checklist', INTERNAL, 'Other', 'memorandum', 'done'),
      W('Mayor’s Permit Application Letter', EXTERNAL, 'Compliance', 'letter', 'open', { to: ['The Business Permits and Licensing Office', 'City Hall of Taguig'] }),
    ],
  },
  {
    key: 'visas', client: 'halcyon', name: 'Working Visa Applications — 4 Expats', type: 'Immigration', status: ONGOING,
    openedDaysAgo: 75, team: ['elena', 'ferdinand', 'paolo'], billing: 'fixed_fee',
    work: [
      W('Alien Employment Permit Applications', EXTERNAL, 'Compliance', 'letter', 'done', { to: ['Department of Labor and Employment', 'National Capital Region Office', 'Manila'] }),
      W('9(g) Pre-arranged Employment Visa Petitions', EXTERNAL, 'Petition', 'letter', 'open', { to: ['The Commissioner', 'Bureau of Immigration', 'Intramuros, Manila'] }),
    ],
  },
  {
    key: 'bir-protest', client: 'silab', name: 'BIR Assessment Protest — FY2024', type: 'Tax', status: ONGOING,
    openedDaysAgo: 110, team: ['isabel', 'ferdinand', 'katrina'], billing: 'litigation',
    work: [
      W('Reply to Preliminary Assessment Notice', EXTERNAL, 'Reply', 'letter', 'done', { to: ['The Regional Director', 'Bureau of Internal Revenue', 'Revenue Region No. 8A – Makati City'] }),
      W('Protest to Final Assessment Notice (Request for Reinvestigation)', EXTERNAL, 'Petition', 'letter', 'open', { to: ['The Regional Director', 'Bureau of Internal Revenue', 'Revenue Region No. 8A – Makati City'] }),
      W('Tax Exposure Memorandum', INTERNAL, 'Memorandum', 'memorandum', 'done'),
      W('Status Report — BIR Protest', STATUS_REPORT, 'Other', 'letter', 'open'),
    ],
  },
  {
    key: 'spa', client: 'silab', name: 'Share Purchase Agreement', type: 'Special Project', status: DONE,
    openedDaysAgo: 250, team: ['isabel', 'ferdinand', 'diego'], billing: 'fixed_fee',
    work: [
      W('Share Purchase Agreement — Execution Version', FOR_CLIENT, 'Contract/Agreement', 'agreement', 'done'),
      W('Closing Checklist', INTERNAL, 'Other', 'memorandum', 'done'),
    ],
  },
  {
    key: 'palayan-tm', client: 'palayan', name: 'Wordmark Application — "PALAYAN FRESH"', type: 'Intellectual Property', status: ONGOING,
    openedDaysAgo: 190, team: ['aurora', 'sofia'], billing: 'fixed_fee',
    work: [
      W('Trademark Application — PALAYAN FRESH', EXTERNAL, 'Compliance', 'letter', 'done', { to: ['Intellectual Property Office of the Philippines', 'Bureau of Trademarks', 'Taguig City'] }),
      W('Response to Office Action — PALAYAN FRESH', EXTERNAL, 'Reply', 'letter', 'open', { to: ['The Examiner', 'Bureau of Trademarks', 'Intellectual Property Office of the Philippines'] }),
    ],
  },
  {
    key: 'ejectment', client: 'palayan', name: 'Ejectment v. Occupants of Lot 7', type: 'Litigation', status: ONGOING,
    openedDaysAgo: 140, team: ['isabel', 'diego', 'paolo'], billing: 'litigation',
    case: {
      court: 'Municipal Trial Court in Cities, Branch 2, San Pablo City', docket: 'Civil Case No. 2026-0117',
      nature: 'For: Forcible Entry', clientRole: 'Plaintiff', adverse: 'Occupants of Lot 7, Barangay Malinaw', adverseRole: 'Defendants',
      clientFiled: true, forum: 'court',
      description: 'Forcible-entry action to recover a fenced seedling nursery occupied without the client’s consent in March.',
    },
    work: [
      W('Complaint for Forcible Entry', EXTERNAL, 'Complaint', 'pleading', 'done'),
      W('Position Paper for Plaintiff', EXTERNAL, 'Position Paper', 'pleading', 'open'),
    ],
  },
  {
    key: 'franchise', client: 'dalampasigan', name: 'Franchise Agreement Drafting', type: 'Special Project', status: ONGOING,
    openedDaysAgo: 55, team: ['elena', 'ferdinand', 'bianca'], billing: 'fixed_fee',
    work: [
      W('Master Franchise Agreement — First Draft', FOR_CLIENT, 'Contract/Agreement', 'agreement', 'open'),
      W('Memorandum on Franchise Disclosure Practice', INTERNAL, 'Memorandum', 'memorandum', 'open'),
    ],
  },
  {
    key: 'detainer', client: 'dalampasigan', name: 'Unlawful Detainer v. Tenant Group', type: 'Litigation', status: ARCHIVED,
    openedDaysAgo: 520, team: ['isabel', 'paolo'], billing: 'none',
    case: {
      court: 'Metropolitan Trial Court, Branch 81, Parañaque City', docket: 'Civil Case No. 2025-0442',
      nature: 'For: Unlawful Detainer', clientRole: 'Plaintiff', adverse: 'Tenant Group of Building C', adverseRole: 'Defendants',
      clientFiled: true, forum: 'court',
      description: 'Ejectment of holdover tenants from staff housing. Settled by compromise; the tenants vacated and the case was dismissed.',
    },
    work: [
      W('Complaint for Unlawful Detainer', EXTERNAL, 'Complaint', 'pleading', 'done'),
      W('Compromise Agreement', EXTERNAL, 'Contract/Agreement', 'agreement', 'done'),
      W('Motion for Issuance of Writ of Execution', EXTERNAL, 'Motion', 'pleading', 'archived'),
    ],
  },
  {
    key: 'replevin', client: 'bakal', name: 'Replevin v. Bakod Equipment Leasing', type: 'Litigation', status: ONGOING,
    openedDaysAgo: 160, team: ['isabel', 'diego', 'bianca'], billing: 'litigation',
    case: {
      court: 'Regional Trial Court, Branch 24, Manila', docket: 'Civil Case No. R-MNL-26-01876-CV',
      nature: 'For: Recovery of Personal Property with Replevin', clientRole: 'Plaintiff', adverse: 'Bakod Equipment Leasing, Inc.', adverseRole: 'Defendant',
      clientFiled: true, forum: 'court',
      description: 'Recovery of a CNC plasma cutter retained by the lessor after the lease was fully paid.',
    },
    work: [
      W('Complaint for Replevin', EXTERNAL, 'Complaint', 'pleading', 'done'),
      W('Motion for Issuance of Writ of Replevin', EXTERNAL, 'Motion', 'pleading', 'done'),
      W('Pre-Trial Brief for Plaintiff', EXTERNAL, 'Pre-Trial Brief', 'pleading', 'open'),
      W('Judicial Affidavit of Oscar Tuazon', EXTERNAL, 'Judicial Affidavit', 'pleading', 'open', { witness: 'Oscar Tuazon' }),
      W('Status Report — Replevin Case', STATUS_REPORT, 'Other', 'letter', 'early'),
    ],
  },
  {
    key: 'bakal-housekeeping', client: 'bakal', name: 'Corporate Housekeeping 2026', type: 'Corporate Housekeeping', status: ONGOING,
    openedDaysAgo: 250, team: ['aurora', 'katrina', 'sofia'], billing: 'fixed_fee',
    work: [
      W('General Information Sheet 2026', EXTERNAL, 'Compliance', 'letter', 'done', { to: ['Securities and Exchange Commission', 'Company Registration and Monitoring Department', 'Makati City'] }),
      W('Minutes of the Annual Stockholders’ Meeting', FOR_CLIENT, 'Other', 'certificate', 'open'),
    ],
  },
  {
    key: 'mining', client: 'pilakbato', name: 'Mining Permit Renewal', type: 'Special Project', status: ONGOING,
    openedDaysAgo: 130, team: ['isabel', 'ferdinand', 'katrina'], billing: 'fixed_fee',
    work: [
      W('Application for Renewal of Mineral Production Sharing Agreement', EXTERNAL, 'Petition', 'letter', 'open', { to: ['The Regional Director', 'Mines and Geosciences Bureau', 'Regional Office No. IV-A'] }),
      W('Permit Compliance Matrix', INTERNAL, 'Other', 'memorandum', 'done'),
      W('Status Report — Permit Renewal', STATUS_REPORT, 'Other', 'letter', 'done'),
    ],
  },
  {
    key: 'privacy', client: 'sinag', name: 'Data Privacy Compliance Audit', type: 'Special Project', status: ONGOING,
    openedDaysAgo: 90, team: ['elena', 'katrina', 'bianca'], billing: 'fixed_fee',
    work: [
      W('Data Privacy Gap Assessment Report', FOR_CLIENT, 'Memorandum', 'memorandum', 'open'),
      W('Privacy Manual', FOR_CLIENT, 'Other', 'agreement', 'early'),
      W('Personal Data Breach Response Playbook', FOR_CLIENT, 'Other', 'agreement', 'open'),
    ],
  },
  {
    key: 'sinag-loan', client: 'sinag', name: 'Loan Restructuring Advisory', type: 'Special Project', status: ONGOING,
    openedDaysAgo: 45, team: ['isabel', 'ferdinand', 'diego'], billing: 'litigation',
    work: [
      W('Memorandum on Restructuring Options', FOR_CLIENT, 'Memorandum', 'memorandum', 'done'),
      W('Loan Restructuring Agreement', FOR_CLIENT, 'Contract/Agreement', 'agreement', 'open'),
    ],
  },
  {
    key: 'estate', client: 'villareal', name: 'Estate Settlement — Villareal', type: 'Special Project', status: ONGOING,
    openedDaysAgo: 100, team: ['elena', 'diego', 'sofia'], billing: 'fixed_fee',
    work: [
      W('Deed of Extrajudicial Settlement of Estate', FOR_CLIENT, 'Contract/Agreement', 'agreement', 'open'),
      W('Estate Tax Computation', INTERNAL, 'Memorandum', 'memorandum', 'done'),
      W('Status Report — Estate Settlement', STATUS_REPORT, 'Other', 'letter', 'open'),
    ],
  },
  {
    key: 'copyright', client: 'pahina', name: 'Copyright Infringement Demand', type: 'Intellectual Property', status: DONE,
    openedDaysAgo: 280, team: ['aurora', 'bianca'], billing: 'fixed_fee',
    work: [
      W('Cease-and-Desist Letter', EXTERNAL, 'Demand Letter', 'letter', 'done', { to: ['The Proprietor', 'Kislap Print and Copy Center', 'España Boulevard, Sampaloc, Manila'] }),
    ],
  },
  {
    key: 'estate-planning', client: 'gutierrez', name: 'Estate Planning Advisory — Gutierrez', type: 'Special Project', status: DONE,
    openedDaysAgo: 360, team: ['elena', 'sofia'], billing: 'fixed_fee',
    work: [
      W('Memorandum on Succession and Estate Planning', FOR_CLIENT, 'Memorandum', 'memorandum', 'done'),
    ],
  },
  {
    key: 'distribution', client: 'lunas', name: 'Distribution Agreement Review', type: 'Special Project', status: ONGOING,
    openedDaysAgo: 30, team: ['elena', 'ferdinand', 'paolo'], billing: 'fixed_fee',
    work: [
      W('Distribution Agreement — Review Memorandum', FOR_CLIENT, 'Memorandum', 'memorandum', 'open'),
      W('Distribution Agreement — Redlined Draft', FOR_CLIENT, 'Contract/Agreement', 'agreement', 'early'),
    ],
  },
];

/** People who appear inside the clients' corporate records. */
export const CORPORATE_OFFICERS = [
  'Alfredo Bonifacio', 'Teresa Manalo', 'Victor Aguila', 'Lourdes Pangan', 'Emilio Zamora',
  'Nenita Rosales', 'Crisanto Belmonte', 'Mylene Tabora', 'Gerardo Salcedo', 'Imelda Quiambao',
  'Benedicto Arcega', 'Rowena Catacutan',
];
