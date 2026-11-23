import type { FirmFiling } from '@/lib/corporations/obligations';
export type CompanyType = 'Stock' | 'Non-Stock' | 'OPC' | 'Partnership';

/**
 * 'Registered' and 'Active' are derived from the registration record (see
 * lib/corporation-lifecycle.ts and the trg_corporations_derive_status trigger),
 * never hand-set. 'Post-Incorporation' was retired as a status — it lives on
 * as a matter type.
 */
export type CorporationStatus =
  | 'Pre-Incorporation'
  | 'In SEC'
  | 'Registered'
  | 'Active'
  | 'Dissolved';

export type EsparcStatus =
  | 'Not Started'
  | 'Name Verification'
  | 'Drafting'
  | 'For Payment'
  | 'For SEC Approval'
  | 'Approved'
  | 'Rejected';

export type CorporationPersonRole =
  | 'Incorporator'
  | 'Director'
  | 'Officer'
  | 'Stockholder'
  | 'Treasurer'
  | 'Corporate Secretary'
  | 'President'
  | 'Chairman'
  | 'Compliance Officer'
  | 'Nominee'
  | 'Alternate Nominee';

export type CorporationFileCategory =
  | 'AOI'
  | 'By-Laws'
  | 'Treasurer Affidavit'
  | 'Name Verification Slip'
  | 'Inward Remittance Cert'
  | 'SEC Filing Receipt'
  | 'SEC COR'
  | 'BIR COR'
  | 'BIR Books'
  | 'Authority to Print'
  | 'Business Permit'
  | 'Barangay Clearance'
  | 'Sanitary Permit'
  | 'Fire Safety Inspection'
  | 'SSS R-1'
  | 'PhilHealth ER1'
  | 'Pag-IBIG EFR'
  | 'Stock Certificate'
  | 'Deed of Assignment'
  | 'GIS'
  | 'AFS'
  | 'Beneficial Ownership Declaration'
  | 'ID Copy'
  | 'Other';

export type MeetingType =
  | 'Organizational'
  | 'Regular Board'
  | 'Special Board'
  | 'Annual Stockholders'
  | 'Special Stockholders';

export type MeetingMode = 'In-Person' | 'Virtual' | 'Hybrid';

export type MinutesStatus = 'Draft' | 'For Signing' | 'Signed';

export type ResolutionKind =
  | 'Board Resolution'
  | 'Stockholders Resolution'
  | 'Secretarys Certificate';

export type ResolutionStatus = 'Draft' | 'For Signing' | 'Signed';

export type ResolutionCategory =
  | 'Banking'
  | 'Real Estate'
  | 'Corporate Governance'
  | 'Capital & Shares'
  | 'HR'
  | 'Tax'
  | 'Litigation'
  | 'Government'
  | 'Loans & Credit';

export interface ResolutionVariableDef {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'select';
  required: boolean;
  options?: string[];
  placeholder?: string;
}

export interface MeetingAttendee {
  personId?: number | null;
  name: string;
  role?: string;
  attended: boolean;
  /** When this attendee holds a proxy: name of the absent principal they represent. */
  proxyFor?: string;
  /** Shares the attendee carries — used for stockholders meetings (own + proxy). */
  shares?: number | null;
}

export interface MeetingAgendaItem {
  order: number;
  title: string;
  notes?: string;
}

export interface Corporation {
  id: string;

  // Linkage
  clientId: string | null;
  engagingClientId: string | null;
  incorporationMatterId: string | null;
  postIncorporationMatterId: string | null;
  housekeepingMatterId: string | null;
  retainerMatterId: string | null;

  // Computed: priority chain for billing
  effectiveBillingMatterId: string | null;

  // Scope toggles
  handlesIncorporation: boolean;
  handlesPostIncorporation: boolean;
  handlesHousekeeping: boolean;
  /** The reportorial requirements the firm files for the company (lib/corporations/obligations.ts). */
  firmFiles: FirmFiling[];
  /** Shown to the client in the portal. Off until the team says the record is ready. */
  portalVisible: boolean;
  isUnderRetainer: boolean;

  // Pre-incorp
  proposedNames: string[];
  approvedName: string | null;
  companyType: CompanyType | null;
  industryClassification: string | null;
  primaryPurpose: string | null;
  secondaryPurposes: string[];

  // Capital
  authorizedCapitalStock: number | null;
  subscribedCapital: number | null;
  paidUpCapital: number | null;
  parValue: number | null;
  numberOfShares: number | null;

  // Address & comms
  principalOfficeAddress: string | null;
  officialEmail: string | null;
  alternateEmail: string | null;
  officialMobile: string | null;
  alternateMobile: string | null;
  website: string | null;

  // Contact person
  contactFirstName: string | null;
  contactLastName: string | null;
  contactNationality: string | null;
  contactGender: string | null;
  contactTin: string | null;
  contactPassportNumber: string | null;

  // Fiscal
  fiscalYearEndMonth: number;

  // eSPARC
  esparcApplicationNo: string | null;
  esparcStatus: EsparcStatus | null;
  esparcSubmittedDate: string | null;

  // SEC
  secRegistrationNo: string | null;
  /** Trade name the corporation operates under, when different from the registered name. */
  businessTradeName: string | null;
  /** Annual meeting date per the by-laws — usually a rule, e.g. "third Monday of June". */
  annualMeetingBylaws: string | null;
  /**
   * The by-laws meeting rule resolved to a calendar month and day, which is
   * what the GIS deadline can actually be computed from. Null when the by-laws
   * date hasn't been read into the record yet.
   */
  annualMeetingMonth: number | null;
  annualMeetingDay: number | null;
  geographicalCode: string | null;
  externalAuditorName: string | null;
  externalAuditorAccreditationNo: string | null;
  telephoneNumber: string | null;
  faxNumber: string | null;
  /** Total assets per the latest audited financial statements, for the GIS. */
  totalAssets: number | null;
  totalAssetsAsOf: string | null;
  /** SEC eFAST account identifier — required to file GIS and AFS. */
  secEfastUsername: string | null;
  secEfastEnrolledDate: string | null;
  /** SEC HABOR account identifier. */
  secHaborUsername: string | null;
  secHaborEnrolledDate: string | null;
  secRegistrationDate: string | null;

  // BIR
  birTin: string | null;
  birRdoCode: string | null;
  birCorDate: string | null;
  birBooksRegistrationDate: string | null;
  birOrAuthorityDate: string | null;
  /** BIR ORUS account identifier. The password is never stored here. */
  birOrusUsername: string | null;
  birOrusEnrolledDate: string | null;

  // Business permit
  businessPermitNo: string | null;
  businessPermitLgu: string | null;
  businessPermitIssuedDate: string | null;
  businessPermitExpiryDate: string | null;

  // SSS/PhilHealth/Pag-IBIG
  sssEmployerNo: string | null;
  sssRegistrationDate: string | null;
  philhealthEmployerNo: string | null;
  philhealthRegistrationDate: string | null;
  pagibigEmployerNo: string | null;
  pagibigRegistrationDate: string | null;

  // Lifecycle
  status: CorporationStatus;

  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}


export type JuridicalEntityType = 'Corporation' | 'Partnership' | 'Association' | 'Cooperative' | 'Other';

/**
 * One role a person holds in a company (a corporation_roles row, read through
 * the corporation_persons view). `id` is the role's id — what files attach to;
 * the identity fields are the person's, shared by every role they hold.
 */
export interface CorporationPerson {
  id: number;
  corporationId: string;
  role: CorporationPersonRole;
  /** The people record — the same id across all of this person's roles, in any company. */
  personRecordId: string | null;

  // Natural-person identity. Always populated for natural persons; may be
  // blank for juridical entities (use entityName instead).
  firstName: string;
  lastName: string;
  nationality: string | null;
  gender: string | null;
  residentialAddress: string | null;
  tin: string | null;
  passportNumber: string | null;
  esapNo: string | null;

  // Juridical-entity flag and fields. Only meaningful for Incorporator /
  // Stockholder. Directors and Officers must be natural persons per RCC.
  isJuridical: boolean;
  entityName: string | null;
  entityType: JuridicalEntityType | null;
  entityRegistrationNo: string | null;
  representativeName: string | null;
  representativeTitle: string | null;

  sharesSubscribedAmount: number | null;
  sharesPaidAmount: number | null;
  /** Share class held, matching corporation_share_classes.class_name. */
  shareClass: string | null;
  /** Number of shares subscribed, as distinct from the peso amount. */
  sharesSubscribedCount: number | null;

  positionTitle: string | null;
  termStart: string | null;
  termEnd: string | null;
  isCurrent: boolean;
  sortOrder: number;

  createdAt: string;
  updatedAt: string;
}

export interface CorporationFile {
  id: number;
  corporationId: string;
  /** When the file is attached to a specific person (e.g. ID copy of an
   *  incorporator), this is the id of one of their roles (CorporationPerson.id);
   *  it shows on every role of the same person. NULL for files that
   *  belong to the corporation as a whole (AOI, By-Laws, SEC COR, etc.). */
  personId: number | null;
  category: CorporationFileCategory;
  name: string;
  storagePath: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedBy: string | null;
  uploadedAt: string;
  /** Year a reportorial document (GIS, AFS) covers. Null for everything else. */
  filingYear: number | null;
  /** Shared with the client in the portal. Never true for a person's file. */
  clientVisible: boolean;
}

export interface CorporationMeeting {
  id: string;
  corporationId: string;
  meetingType: MeetingType;
  meetingDate: string;
  meetingTime: string | null;
  meetingMode: MeetingMode | null;
  venue: string | null;
  noticeSentDate: string | null;
  quorumAchieved: boolean;
  sharesRepresented: number | null;
  totalSharesOutstanding: number | null;
  agenda: MeetingAgendaItem[];
  attendees: MeetingAttendee[];
  minutesStatus: MinutesStatus;
  minutesFilePath: string | null;
  attendanceSheetPath: string | null;
  recordingPath: string | null;
  noticeFilePath: string | null;
  waiverOfNoticeFilePath: string | null;
  proxyFilePaths: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface ResolutionTemplate {
  id: string;
  name: string;
  kind: ResolutionKind;
  category: ResolutionCategory;
  description: string | null;
  bodyTemplate: string;
  variableSchema: ResolutionVariableDef[];
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Resolution {
  id: string;
  corporationId: string;
  meetingId: string | null;
  kind: ResolutionKind;
  title: string;
  dateOfResolution: string;
  templateId: string | null;
  variables: Record<string, string>;
  freeFormBody: string | null;
  /** Secretary's Certificate only: ordered list of resolution IDs whose
   *  bodies are quoted in this certificate. Each may reference a different
   *  meeting; the generator looks up each linked resolution and renders
   *  the appropriate "At a meeting of … held on … the following resolution
   *  was adopted" preamble per item. */
  bundledResolutionIds: string[];
  generatedFilePath: string | null;
  signedFilePath: string | null;
  status: ResolutionStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export type AffiliationRelation = 'Parent' | 'Subsidiary' | 'Affiliate';

/** An intercompany affiliation, for GIS page 1. */
export interface CorporationAffiliation {
  id: number;
  corporationId: string;
  relation: AffiliationRelation;
  name: string;
  secRegistrationNo: string | null;
  address: string | null;
  sortOrder: number;
}
