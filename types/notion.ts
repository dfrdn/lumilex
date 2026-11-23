export interface NotionTask {
  id: string;
  url: string;
  name: string;
  matter: string;
  dueDate: string | null;
  status: string;
  priority: string;
  done: boolean;
}

export interface NotionMeeting {
  id: string;
  url: string;
  name: string;
  date: string | null;
  endDate: string | null;
  matter: string;
  matterId: string | null;
  type: string;
  isAttended: boolean;
  attendeeIds: string[];
}

export interface NotionHearing {
  id: string;
  url: string;
  name: string;
  date: string | null;
  matter: string;
  matterId: string | null;
  type: string;
  status: string;
  isAttended: boolean;
  attendeeIds: string[];
}

export interface NotionFiling {
  id: string;
  url: string;
  name: string;
  date: string | null;
  matter: string;
  matterId: string | null;
  status: string;
  attendeeIds: string[];
}

export interface NotionFilingDetail extends NotionFiling, ResolvedClient {
  relatedDeliverableId: string | null;
  /** Deliverable type (e.g. 'Internal', 'Status Report', or external types). */
  type: string;
}

export type FilingListing = NotionFiling & {
  /** Files uploaded as the authoritative "Filed version" of this filing. */
  filedCopies: DeliverableFileVersion[];
};

export interface NotionDeliverable {
  id: string;
  url: string;
  name: string;
  matter: string;
  matterId: string | null;
  client: string;
  status: string;
  drafter: string[];
  reviewerIds: string[];
  currentlyWith: string[];
  externalDueDate: string | null;
  reviewDates: (string | null)[];
  priority: string;
  type: string;
  subtype?: string;
  createdTime: string | null;
  lastEditedAt?: string | null;
}

export interface FileAttachment {
  name: string;
  url: string;
  /** Supabase Storage path (bucket: 'files'). When present, url is generated on-demand. */
  path?: string;
}

export interface NotionFile {
  id: string;
  url: string;
  name: string;
  matter: string;
  matterId: string | null;
  personsReadIds: string[];
  fileUrls: FileAttachment[];
  dateReceived?: string | null;
  isCourtRecord?: boolean;
  /** Current action on this file. When non-empty the file is considered
   *  acted upon; workflow buttons (Set ID / Create Deliverable / Generate
   *  Report) are hidden for all users. Mark Read/Unread remains available. */
  actionTaken?: string | null;
  /** Person ids that have acted on this file (typically length 1 — first-actor-wins). */
  actedUponByIds?: string[];
  origin?: string | null;
}

export interface NotionAnnouncement {
  id: string;
  url: string;
  name: string;
  createdTime: string;
  content: string;
}

export interface NotionLeave {
  id: string;
  url: string;
  reason: string;
  personId: string | null;
  name: string;
  leaveType: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: string;
  approved: boolean;
}

export interface NotionAttendance {
  id: string;
  url: string;
  dateLabel: string;
  lawyerId: string | null;
  lawyerName: string;
  timeIn: string | null;
  timeOut: string | null;
}

export interface NotionReimbursement {
  id: string;
  url: string;
  expense: string;
  amount: number;
  expenseCategory: string;
  expenseDate: string | null;
  lawyerName: string;
  matterName: string;
  clientName: string;
  reimbursed: boolean;
}

// ── Detail view types (extend base types with FK IDs for linking) ──

export interface NotionClient {
  id: string;
  url: string;
  name: string;
  clientCode: string;
  status: string;
  fullCompanyName: string;
  tin: string;
  contactEmail: string;
  phoneNumber: string;
  pointPersons: string;
  discount: number | null;
  receivables: number | null;
  priority: boolean;
  relationshipPartnerId: string | null;
  createdTime: string | null;
}

export interface NotionMatter {
  id: string;
  url: string;
  name: string;
  matterCode: string;
  clientId: string | null;
  clientName: string;
  relatedMatterIds: string[];
  parentMatterId: string | null;
}

export interface NotionCase extends NotionMatter {
  type: string;
  status: string;
  caseTitle: string;
  caseNumber: string;
  court: string;
  outcome: string;
  teamPersonIds: string[];
}

/**
 * Owning client, resolved off the matter. Only `deliverables` denormalizes the
 * client name onto its own row; every other entity gets it via its matter, so
 * these are populated by the detail getters rather than by the table read.
 */
export interface ResolvedClient {
  client?: string;
  clientId?: string | null;
}

export interface NotionTaskDetail extends NotionTask, ResolvedClient {
  matterId: string | null;
  assigneeIds: string[];
}

export interface NotionMeetingDetail extends NotionMeeting, ResolvedClient {
  notes?: string;
  /** 0 until the first save. */
  notesVersion?: number;
  notesUpdatedAt?: string | null;
  notesUpdatedBy?: string | null;
}

export interface LinkedStatusReport {
  id: string;
  name: string;
  status: string;
}

export interface NotionHearingDetail extends NotionHearing, ResolvedClient {
  isFiled: boolean;
  /** Child Status Report deliverable auto-created after this hearing was attended. */
  statusReport?: LinkedStatusReport | null;
}

export interface NotionDeliverableDetail extends NotionDeliverable {
  /** The day it was filed or sent out (YYYY-MM-DD). */
  dateDone?: string | null;
  /** Linkable id for `client` — the row itself stores only the name. */
  clientId?: string | null;
  /** If this deliverable is itself a Status Report, the parent it covers. */
  parentLink?:
    | { kind: 'hearing'; id: string; name: string }
    | { kind: 'deliverable'; id: string; name: string }
    | { kind: 'file'; id: string; name: string }
    | null;
  /** Child Status Report deliverable auto-created after this one was filed. */
  statusReport?: LinkedStatusReport | null;
}

export interface DeliverableFileVersion {
  id: number;
  version: number;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  /** Storage object is missing — the file needs to be re-uploaded. */
  needsReupload: boolean;
  uploadedBy: string;
  action: string | null;
  createdAt: string;
}

export interface DeliverableActionLog {
  id: number;
  action: string;
  oldStatus: string;
  newStatus: string;
  performedBy: string;
  comment: string | null;
  mentions: string[];
  fileUrl: string | null;
  fileName: string | null;
  createdAt: string;
}

export interface CommentReaction {
  emoji: string;
  personIds: string[];
}

export interface DeliverableComment {
  id: number;
  deliverableId: string;
  parentType: 'action' | 'version' | null;
  parentId: number | null;
  comment: string;
  mentions: string[];
  personId: string;
  createdAt: string;
  reactions: CommentReaction[];
}

export interface NotionFileDetail extends NotionFile, ResolvedClient {
  matterId: string | null;
  createdTime: string;
  origin: string;
  actionTaken: string;
  dateReceived: string | null;
  dateSentFiled: string | null;
  documentDate: string | null;
  deliverableId: string | null;
  deliverableName: string;
  isCourtRecord: boolean;
}

// ── Listing types (extend base types with IDs needed for "My items" filtering) ──

export type TaskListing = NotionTask & { assigneeIds: string[] };
export type MeetingListing = NotionMeeting;
export type HearingListing = NotionHearing;
export type MatterListing = NotionMatter & {
  teamPersonIds: string[];
  type: string;
  status: string;
  teamInitials: string[];
  teamMembers: { personId: string; initials: string; name: string; avatarUrl: string | null }[];
  lastActivityAt: string | null;
};
export type DeliverableListing = NotionDeliverable;
export type StatusReportListing = NotionDeliverable & {
  parentKind: 'hearing' | 'filing' | 'file' | null;
  parentId: string | null;
  parentName: string | null;
};
export type ClientListing = NotionClient;
export type FileListing = NotionFile & {
  matterId: string | null;
  origin: string;
  actionTaken: string;
  dateReceived: string | null;
  dateSentFiled?: string | null;
  documentDate?: string | null;
  deliverableName?: string;
  /** Controlled-vocabulary type from file analysis; null until analyzed. */
  documentType?: string | null;
  createdTime: string;
  fileUrls: FileAttachment[];
};

// Re-export partner types
export type { UserRole } from '@/lib/queries/team';
export type { FirmDeliverableSummary, DTREntry, DTRSummary, LawyerStats } from '@/lib/queries/partner';

export interface DashboardData {
  todayTasks: NotionTask[];
  todayMeetings: NotionMeeting[];
  todayHearings: NotionHearing[];
  todayDeliverables: NotionDeliverable[];
  weekMeetings: NotionMeeting[];
  weekHearings: NotionHearing[];
  submissions: NotionDeliverable[];
  inbox: NotionFile[];
  newInbox: NotionFile[];
  readInbox: NotionFile[];
  deliverables: NotionDeliverable[];
  backlogs: NotionDeliverable[];
  firmCalendarMeetings: NotionMeeting[];
  firmCalendarHearings: NotionHearing[];
  announcements: NotionAnnouncement[];
}

// ── Trademarks ────────────────────────────────────────────────────

export type TrademarkStatus =
  | 'Prelim'
  | 'For Filing'
  | 'Pending'
  | 'Pending - OA'
  | 'Registered'
  | 'Abandoned';

export type TrademarkType = 'Wordmark' | 'Combined' | 'Device';

/**
 * Where a mark comes from: an application filed with IPOPHL; the
 * Philippines designated in a foreign owner's international registration
 * under the Madrid Protocol, which IPOPHL examines and protects; or another
 * country designated in an international registration resting on one of our
 * clients' Philippine marks, which that country's office examines.
 */
export type TrademarkOrigin = 'national' | 'madrid_in' | 'madrid_out';

/**
 * An international registration resting on a Philippine mark (its basic
 * mark), with IPOPHL as office of origin. Each country it designates is a
 * mark of origin `madrid_out` pointing at it.
 */
export interface InternationalRegistration {
  id: string;
  irNo: string | null;
  irDate: string | null;
  /** The international application filed with IPOPHL. */
  applicationFiledDate: string | null;
  renewalFilingDate: string | null;
  /** Ceased to have effect because the basic mark fell within its first five years. */
  ceasedDate: string | null;
  notes: string | null;
}

/** A filing a designated country requires, due on a date entered by hand. */
export interface TrademarkLocalDeadline {
  id: string;
  label: string;
  dueDate: string;
  filedDate: string | null;
}

export type GpoaStatus = 'To Follow' | 'Filed';

export interface Trademark {
  id: string;
  matterId: string | null;
  matterName: string;
  clientId: string | null;
  clientName: string;
  clientCode: number | null;
  clientIndex: number;

  mark: string;
  type: TrademarkType | null;
  classes: number[];
  /** The goods or services filed for, keyed by Nice class number. */
  goodsServices: Record<string, string>;
  country: string;
  owner: string | null;
  contactEmail: string | null;
  /** The application or registration number — or, for a designation, the international registration number. */
  regIrNo: string | null;

  origin: TrademarkOrigin;
  /** A designation's international registration date. */
  irDate: string | null;
  /** When the country was designated after the international registration, the date of that designation. */
  designationDate: string | null;
  /** A designation abroad: its international registration. */
  irId: string | null;
  /** A designation abroad: the agent before that country's office. */
  localAgent: string | null;
  /** A designation abroad: the months the country's office has to refuse (Protocol art. 5(2)). */
  refusalPeriodMonths: 12 | 18 | null;
  /** Filings due on dates entered by hand. */
  localDeadlines: TrademarkLocalDeadline[];
  /** The international registrations this mark is the basic mark of. */
  internationalRegistrations: InternationalRegistration[];
  /** A designation abroad: its international registration and the Philippine mark it rests on. Read with the mark's page only. */
  parentRegistration: (InternationalRegistration & { baseMark: { id: string; mark: string; status: TrademarkStatus } | null }) | null;

  markImagePath: string | null;

  gpoaStatus: GpoaStatus;
  gpoaFiledDate: string | null;
  /** Shown to the client in the portal. Off until the team turns it on. */
  portalVisible: boolean;
  gpoaFilePath: string | null;

  status: TrademarkStatus;

  filingDate: string | null;
  /** The Notice of Allowance's mailing date — the date on it. It approves publication for opposition. */
  noiDate: string | null;
  /** The day the firm received the Notice of Allowance. */
  noiReceivedDate: string | null;
  /**
   * The 1st publication fee paid on the Notice of Allowance — owed only by
   * applications filed on or before 13 Feb 2023; later filings paid it with
   * the filing fee.
   */
  noiPaymentDate: string | null;
  /** The Notice of Issuance's mailing date: sent when no opposition was filed, asking for the issuance and 2nd publication fees. */
  issuanceNoticeDate: string | null;
  issuanceNoticeReceivedDate: string | null;
  /** The issuance and 2nd publication fees paid — before the Notice of Issuance when paid in advance on allowance. */
  issuanceFeePaidDate: string | null;
  /** Published for opposition in the IPOPHL eGazette (Rule 700). */
  publishedDate: string | null;
  /** An opposition was filed against the application (Rule 703). */
  oppositionFiledDate: string | null;
  regDate: string | null;
  corReportedDate: string | null;

  /** Every examiner action, oldest first. */
  officeActions: TrademarkOfficeAction[];

  /** IPOPHL's notice of abandonment: the date on it, and when the firm received it (Rules 610, 703). */
  abandonmentMailingDate: string | null;
  abandonmentReceivedDate: string | null;
  revivalFiledDate: string | null;
  /** The firm decided not to revive, so the revival window is closed. */
  revivalDeclined: boolean;
  /** Times revived; an application revived once can't be revived again on the same issue (Rule 611). */
  revivalCount: number;
  statusBeforeAbandonment: TrademarkStatus | null;

  dau3FilingDate: string | null;
  dau3Motex: boolean;
  /** IPOPHL's decision on the 3-year DAU extension, once recorded. */
  dau3MotexDecision: ExtensionDecision | null;
  /** The date on IPOPHL's order. */
  dau3MotexDecidedOn: string | null;
  dau5FilingDate: string | null;
  renewalFilingDate: string | null;
  renewalDauFiledDate: string | null;
  renewalDau5FiledDate: string | null;
  /**
   * A designation's later upkeep, due on the dates entered by hand: no
   * Philippine rule for counting them is confirmed yet.
   */
  dau5DueDate: string | null;
  renewalDueDate: string | null;
  renewalDauDueDate: string | null;
  renewalDau5DueDate: string | null;

  nudge1: boolean;
  nudge2: boolean;
  nudge3: boolean;

  notes: string | null;
  billingInstructions: string | null;
  lastIncident: string | null;

  createdAt: string;
  updatedAt: string;
}

export type TrademarkListing = Pick<
  Trademark,
  | 'id' | 'mark' | 'type' | 'classes' | 'status'
  | 'matterId' | 'matterName'
  | 'clientId' | 'clientName' | 'clientCode' | 'clientIndex' | 'country'
  | 'filingDate' | 'regIrNo' | 'officeActions' | 'noiDate'
  | 'origin' | 'irDate' | 'designationDate' | 'dau5DueDate' | 'renewalDueDate' | 'renewalDauDueDate' | 'renewalDau5DueDate'
  | 'irId' | 'localAgent' | 'refusalPeriodMonths' | 'localDeadlines' | 'internationalRegistrations'
  | 'regDate' | 'markImagePath'
  | 'noiPaymentDate' | 'issuanceNoticeDate' | 'issuanceFeePaidDate' | 'dau3FilingDate' | 'dau5FilingDate'
  | 'renewalFilingDate' | 'renewalDauFiledDate' | 'renewalDau5FiledDate'
  | 'abandonmentMailingDate' | 'revivalFiledDate' | 'revivalDeclined'
>;

/**
 * An examiner's action on an application. The applicant may respond again
 * after a refusal that isn't final (Rule 608); a final one is met by appeal
 * or compliance (Rule 609). A designation's objections come as IPOPHL's
 * provisional refusal, with the response period stated on the notice.
 */
export type OfficeActionKind = 'office_action' | 'final_rejection' | 'provisional_refusal';

/** IPOPHL's answer to a request for extension. Until it comes, a filed request counts as granted. */
export type ExtensionDecision = 'granted' | 'denied';

export interface TrademarkOfficeAction {
  id: string;
  trademarkId: string;
  kind: OfficeActionKind;
  /** What IPOPHL called it, e.g. "Registrability Report". */
  title: string | null;
  /** The date on the document — the response period counts from it (Rule 504). */
  mailingDate: string;
  /** The day the firm received it. */
  receivedDate: string | null;
  /** A shorter period the examiner set (Rule 612); otherwise 2 months from mailing. */
  respondBy: string | null;
  motex: boolean;
  /** IPOPHL's decision on the extension request, once recorded. */
  motexDecision: ExtensionDecision | null;
  /** The date on IPOPHL's order. */
  motexDecidedOn: string | null;
  /** The response — or, to a final rejection, the appeal or compliance. */
  responseFiledDate: string | null;
}

export interface TrademarkFile {
  id: number;
  trademarkId: string;
  name: string;
  storagePath: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedBy: string | null;
  uploadedAt: string;
  /** The timeline step the paper belongs to, if it's been filed under one. */
  step: TrademarkFileStep | null;
  officeActionId: string | null;
}

/** The steps a paper can be filed under — mirrors `trademark_files_step_check`. */
export type TrademarkFileStep =
  | 'filing' | 'office_action' | 'oa_response' | 'oa_motex' | 'oa_motex_decision' | 'noi' | 'noi_payment'
  | 'publication' | 'opposition' | 'issuance' | 'issuance_payment' | 'cor' | 'abandonment' | 'revival'
  | 'dau_3' | 'dau_3_motex' | 'dau_3_motex_decision' | 'dau_5' | 'renewal' | 'renewal_dau' | 'renewal_dau_5';
