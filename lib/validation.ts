import { z } from 'zod';
import { TRADEMARK_ACTIONS, type TrademarkAction } from '@/lib/trademarks/actions';
import { REPORT_EVENT_KEYS, type ReportEvent } from '@/lib/trademarks/client-report';
import { MAX_ANNEXES } from '@/lib/client-reports/letter';
import { CORPORATE_REPORT_EVENT_KEYS, type CorporateReportEvent } from '@/lib/corporations/client-report';
import { STARTABLE_STEPS } from '@/lib/corporations/step-tasks';
import { DESIGNATION_STAGES, START_STAGES } from '@/lib/trademarks/create';
import { EXTENSION_PURPOSE_KEYS, EXTENSION_REASON_KEYS, type ExtensionPurpose, type ExtensionReason } from '@/lib/trademarks/extension-request';
import { DELIVERABLE_ACTIONS } from '@/lib/trademarks/deliverables';
import type { TrademarkFileStep } from '@/types/notion';
import { savedLayoutSchema } from '@/lib/dashboard-widgets';

// ── Reusable schemas ────────────────────────────────────────────

export const uuidSchema = z.string().regex(
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i,
  'Invalid ID format',
);

export const dateSchema = z.string().regex(
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
  'Date must be YYYY-MM-DD',
);

export const emailSchema = z.string().email().transform((v) => v.toLowerCase().trim());

// ── Partner client-management schemas ───────────────────────────

export const clientPrioritySchema = z.object({
  clientId: z.string().min(1),
  priority: z.boolean(),
});

export const clientRelationshipPartnerSchema = z.object({
  clientId: z.string().min(1),
  relationshipPartnerId: z.string().min(1).nullable(),
});

export const clientNoteCreateSchema = z.object({
  clientId: z.string().min(1),
  body: z.string().trim().min(1, 'Note cannot be empty').max(10000),
});

export const clientNoteUpdateSchema = z.object({
  id: z.number().int().positive(),
  body: z.string().trim().min(1, 'Note cannot be empty').max(10000),
});

export const clientNoteDeleteSchema = z.object({
  id: z.number().int().positive(),
});

// ── Dashboard layout ────────────────────────────────────────────

/** null puts the person back on their role's default. */
export const dashboardLayoutSaveSchema = z.object({
  layout: savedLayoutSchema.nullable(),
});

// ── Sidebar ─────────────────────────────────────────────────────

// A page's own path, never a URL. The route keeps only registered pages (cleanChoices).
const navHrefList = z.array(z.string().regex(/^\/[A-Za-z0-9/_?=&-]*$/).max(200)).max(300);

/** null puts the area back on the role's default. */
export const sidebarLayoutSaveSchema = z.object({
  area: z.enum(['dashboard', 'admin', 'finance', 'liaison']),
  choices: z.object({ pins: navHrefList, hides: navHrefList }).nullable(),
});

// ── Notification mutes ──────────────────────────────────────────
export const muteCreateSchema = z.object({
  entityId: z.string().min(1),
  label: z.string().trim().max(200).optional(),
});

export const muteDeleteSchema = z.object({
  entityId: z.string().min(1),
});

// ── Finance: on-account payments ────────────────────────────────

export const onAccountPaymentSchema = z.object({
  clientName: z.string().trim().min(1, 'clientName is required'),
  amount: z.number().positive('Amount must be greater than 0'),
  paymentDate: dateSchema,
  paymentMethod: z.string().trim().max(40).optional().default('bank_transfer'),
  referenceNumber: z.string().trim().max(120).optional().default(''),
  notes: z.string().trim().max(2000).optional().default(''),
});

// ── Finance: firm operating expenses ────────────────────────────

export const firmExpenseCreateSchema = z.object({
  expenseDate: dateSchema,
  category: z.string().trim().min(1, 'category is required').max(100),
  amount: z.number().positive('Amount must be greater than 0'),
  vendor: z.string().trim().max(200).optional().default(''),
  description: z.string().trim().max(2000).optional().default(''),
  paymentMethod: z.string().trim().max(40).optional().default(''),
  notes: z.string().trim().max(2000).optional().default(''),
});

export const firmExpenseUpdateSchema = z.object({
  id: z.number().int().positive(),
  expenseDate: dateSchema.optional(),
  category: z.string().trim().min(1).max(100).optional(),
  amount: z.number().positive().optional(),
  vendor: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  paymentMethod: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
});

// ── Finance: firm-wide invoice letterhead settings ──────────────

export const firmInvoiceSettingsSchema = z.object({
  firmAddress: z.string().trim().max(300),
  firmAddress2: z.string().trim().max(300),
  firmTIN: z.string().trim().max(120),
  bankName: z.string().trim().max(120),
  bankAccountNo: z.string().trim().max(60),
  bankAccountName: z.string().trim().max(200),
  signerName: z.string().trim().max(160),
  invoicePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,8}$/, 'Prefix must be 2-8 letters or digits'),
});

/** A client's billing profile — the letter and its recipient (lib/billing/client-profile.ts). */
const optionalText = (max: number) => z.string().trim().max(max).optional();
const percentText = z.string().trim().max(6).refine((v) => v === '' || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100), 'Must be a percent from 0 to 100').optional();
const daysText = z.string().trim().max(3).refine((v) => v === '' || (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 60), 'Must be whole days from 0 to 60').optional();
export const clientBillingProfileSchema = z.object({
  letterAddressee: z.enum(['company', 'person']).optional(),
  clientAddress: optionalText(600),
  attnName: optionalText(200),
  attnTitle: optionalText(200),
  throughName: optionalText(200),
  salutation: optionalText(200),
  clientEmail: z.string().trim().max(200).refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Not an email address').optional(),
  ccEmails: optionalText(1000),
  includeVAT: z.boolean().optional(),
  includeLessenFeesNote: z.boolean().optional(),
  initialStatement: z.boolean().optional(),
  optionalParagraphs: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  earlyPaymentDiscountPercent: percentText,
  earlyPaymentDays: daysText,
});

/** Saving one fixed line of the billing letter or email (lib/billing/letter-blocks.ts). */
export const billingLetterLineSchema = z.object({
  key: z.string().trim().min(1).max(80),
  body: z.string().max(4000),
});

const ruleTermSchema = z.object({
  fact: z.string().trim().min(1).max(40),
  is: z.boolean(),
});

/** Adding a paragraph to the billing letter or email (lib/billing/paragraphs.ts). */
export const billingParagraphCreateSchema = z.object({
  document: z.enum(['letter', 'email']),
  label: z.string().trim().min(1, 'Give the paragraph a name').max(120),
  body: z.string().max(6000),
  rule: z.array(ruleTermSchema).max(20).default([]),
  choice: z.string().trim().max(80).nullable().optional(),
  /** Placed right after this paragraph; at the end when absent. */
  after: z.string().trim().max(80).optional(),
});

/** Changing one paragraph: any of its name, wording, rule or client choice. */
export const billingParagraphUpdateSchema = z.object({
  document: z.enum(['letter', 'email']),
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1, 'Give the paragraph a name').max(120).optional(),
  body: z.string().max(6000).optional(),
  rule: z.array(ruleTermSchema).max(20).optional(),
  choice: z.string().trim().max(80).nullable().optional(),
});

/** The paragraphs of one document, in their new order. */
export const billingParagraphOrderSchema = z.object({
  document: z.enum(['letter', 'email']),
  keys: z.array(z.string().trim().min(1).max(80)).min(1).max(200),
});

export const EXPENSE_CADENCES = ['monthly', 'quarterly', 'annual'] as const;

export const firmExpenseTemplateCreateSchema = z.object({
  category: z.string().trim().min(1, 'category is required').max(100),
  amount: z.number().positive('Amount must be greater than 0'),
  vendor: z.string().trim().max(200).optional().default(''),
  description: z.string().trim().max(2000).optional().default(''),
  paymentMethod: z.string().trim().max(40).optional().default(''),
  cadence: z.enum(EXPENSE_CADENCES).optional().default('monthly'),
  dayOfMonth: z.number().int().min(1).max(28).optional().default(1),
  startDate: dateSchema,
  endDate: dateSchema.nullable().optional(),
  active: z.boolean().optional().default(true),
});

export const firmExpenseTemplateUpdateSchema = z.object({
  id: z.number().int().positive(),
  category: z.string().trim().min(1).max(100).optional(),
  amount: z.number().positive().optional(),
  vendor: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  paymentMethod: z.string().trim().max(40).optional(),
  cadence: z.enum(EXPENSE_CADENCES).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.nullable().optional(),
  active: z.boolean().optional(),
});

// ── DTR schemas ─────────────────────────────────────────────────

export const DTR_TASKS = [
  'Study', 'Correspondence', 'Draft', 'Review and Revise', 'Finalize',
  'Hearing', 'Meeting', 'Internal Discussion', 'Research', 'TM',
  'Bail Processing', 'Others',
] as const;

export const createDTRSchema = z.object({
  remarks: z.string().trim().min(1, 'Remarks are required').max(2000),
  task: z.enum(DTR_TASKS),
  date: dateSchema,
  hours: z.number().int().min(0).max(24).default(1),
  minutes: z.number().int().min(0).max(59).default(0),
  withIds: z.array(z.string()).optional().default([]),
  matterId: z.string().nullable().optional(),
});

export const updateDTRSchema = z.object({
  entryId: z.string().min(1),
  field: z.string().min(1),
  value: z.unknown(),
});

// ── Auth schemas ────────────────────────────────────────────────

export const setPasswordSchema = z.object({
  email: emailSchema,
  password: z.string().min(6, 'Password must be at least 6 characters').max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, 'Password must be at least 6 characters').max(128),
});

// ── File signing schemas ────────────────────────────────────────

// Spaces and parentheses occur in real keys: auto status reports keep spaces,
// and Drafting Studio names its output `<name> (draft).docx`.
const SAFE_PATH_REGEX = /^[a-zA-Z0-9_\-/. ()]+$/;

/** A key in the `files` storage bucket, as passed to a sign or download endpoint. */
export const storagePathSchema = z.string()
  .min(1)
  .max(500)
  // A traversal is a `..` segment; a name like "Acme Inc..pdf" is not one.
  .refine((p) => !p.split('/').some((seg) => seg === '..' || seg === '.'), 'Path traversal not allowed')
  .refine((p) => SAFE_PATH_REGEX.test(p), 'Invalid path characters');

export const fileSignSchema = z.object({
  paths: z.array(storagePathSchema).min(1).max(100),
  /** When provided, sign with Content-Disposition: attachment using this filename. */
  download: z.string().min(1).max(500).optional(),
});

// ── Filing calendar ─────────────────────────────────────────────

/** One year's AFS or ITR deadline for December year-ends (compliance_calendar). */
export const filingCalendarSchema = z
  .object({
    obligation: z.enum(['afs', 'itr']),
    filingYear: z.number().int().min(2000).max(2100),
    dueDate: dateSchema.nullable(),
    /** The date first set, when an extension has since moved dueDate. */
    originalDueDate: dateSchema.nullable().optional(),
    digitSchedule: z.record(z.string().regex(/^\d$/), z.string().regex(/^\d{2}-\d{2}$/)).nullable().optional(),
    source: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => (v.dueDate == null) !== (v.digitSchedule == null), {
    message: 'Set either one date or a schedule by registration digit',
  })
  .refine((v) => !v.dueDate || v.dueDate.startsWith(String(v.filingYear)), {
    message: 'The due date must fall in the filing year',
  });

export const filingCalendarRedateSchema = z.object({
  obligation: z.enum(['afs', 'itr']),
  filingYear: z.number().int().min(2000).max(2100),
  dryRun: z.boolean().optional(),
});

// ── Corporation meeting schemas ─────────────────────────────────

export const MEETING_TYPES = [
  'Organizational', 'Regular Board', 'Special Board', 'Annual Stockholders', 'Special Stockholders',
] as const;

export const MEETING_MODES = ['In-Person', 'Virtual', 'Hybrid'] as const;

const meetingAgendaItemSchema = z.object({
  order: z.number().int(),
  title: z.string().trim().min(1),
  notes: z.string().optional(),
});

const meetingAttendeeSchema = z.object({
  personId: z.number().int().nullable().optional(),
  name: z.string().trim().min(1),
  role: z.string().optional(),
  attended: z.boolean(),
  proxyFor: z.string().optional(),
  shares: z.number().nonnegative().nullable().optional(),
});

export const createMeetingSchema = z
  .object({
    meetingType: z.enum(MEETING_TYPES),
    meetingDate: dateSchema,
    meetingTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time must be HH:MM').nullable().optional(),
    meetingMode: z.enum(MEETING_MODES),
    venue: z.string().trim().min(1, 'Venue is required'),
    noticeSentDate: dateSchema.nullable().optional(),
    quorumAchieved: z.boolean(),
    sharesRepresented: z.number().nonnegative().nullable().optional(),
    totalSharesOutstanding: z.number().nonnegative().nullable().optional(),
    agenda: z.array(meetingAgendaItemSchema).default([]),
    attendees: z.array(meetingAttendeeSchema).default([]),
    notes: z.string().nullable().optional(),
  })
  .refine(
    (m) => m.meetingMode !== 'Virtual' || /^https?:\/\/\S+$/i.test(m.venue),
    { path: ['venue'], message: 'Venue must be a valid URL (https://…) for virtual meetings' },
  )
  .refine(
    (m) => !m.noticeSentDate || m.noticeSentDate <= m.meetingDate,
    { path: ['noticeSentDate'], message: 'Notice sent date cannot be after the meeting date' },
  )
  .refine(
    (m) =>
      m.sharesRepresented == null ||
      m.totalSharesOutstanding == null ||
      m.sharesRepresented <= m.totalSharesOutstanding,
    { path: ['sharesRepresented'], message: 'Shares represented cannot exceed total shares outstanding' },
  );

export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

// ── Matter summary schemas ──────────────────────────────────────

export const matterSummarySchema = z.object({
  matterId: z.string().min(1, 'matterId required'),
});

// ── Knowledge-search click attribution ──────────────────────────

export const knowledgeClickSchema = z.object({
  searchId: z.number().int().positive(),
  sourceType: z.string().trim().min(1).max(64),
  sourceId: z.string().trim().min(1).max(128),
});

// ── Mark status schemas ─────────────────────────────────────────

export const markStatusSchema = z.object({
  entity: z.enum(['meetings', 'hearings', 'filings']),
  notionId: z.string().min(1),
  action: z.enum(['attended', 'cancelled', 'filed']),
});

// ── Trademarks ──────────────────────────────────────────────────

const TRADEMARK_FILE_STEPS = [
  'filing', 'office_action', 'oa_response', 'oa_motex', 'oa_motex_decision', 'noi', 'noi_payment',
  'publication', 'opposition', 'issuance', 'issuance_payment', 'cor', 'abandonment', 'revival',
  'dau_3', 'dau_3_motex', 'dau_3_motex_decision', 'dau_5', 'renewal', 'renewal_dau', 'renewal_dau_5',
] as const satisfies readonly TrademarkFileStep[];

/**
 * Recording a step. `date` is the day it happened — filed, paid, or for
 * anything IPOPHL sends, received. A notice also carries `mailingDate`, the
 * date on the document, which its periods count from.
 */
export const trademarkActionSchema = z.object({
  action: z.enum([...TRADEMARK_ACTIONS] as [TrademarkAction, ...TrademarkAction[]]),
  date: dateSchema.optional(),
  regDate: dateSchema.optional(),
  mailingDate: dateSchema.optional(),
  officeActionId: uuidSchema.optional(),
  kind: z.enum(['office_action', 'final_rejection', 'provisional_refusal']).optional(),
  title: z.string().trim().max(200).optional(),
  respondBy: dateSchema.optional(),
  /** The notice came in, but not on a day anyone can confirm yet: its receipt date stays blank. */
  receivedUnconfirmed: z.boolean().optional(),
});

/** A deliverable started for one step of a mark, and the round when it answers one. */
export const trademarkDeliverableSchema = z.object({
  action: z.enum(DELIVERABLE_ACTIONS),
  officeActionId: uuidSchema.nullish(),
});

/** A new mark, and where it starts: before filing, or mid-prosecution with the steps already taken. */
export const trademarkCreateSchema = z.object({
  mark: z.string().trim().min(1, 'Mark is required').max(300),
  type: z.enum(['Wordmark', 'Combined', 'Device']).nullish(),
  classes: z.array(z.number().int().min(1).max(45)).max(45).default([]),
  matterId: z.string().trim().min(1).nullish(),
  owner: z.string().trim().max(300).nullish(),
  contactEmail: z.string().trim().max(300).nullish(),
  country: z.string().trim().min(2).max(4).default('PH'),
  start: z.object({
    stage: z.enum(START_STAGES),
    applicationNo: z.string().trim().max(60).optional(),
    filingDate: dateSchema.optional(),
    oaMailingDate: dateSchema.optional(),
    oaReceivedDate: dateSchema.optional(),
    oaKind: z.enum(['office_action', 'final_rejection']).optional(),
    oaTitle: z.string().trim().max(200).optional(),
    noiDate: dateSchema.optional(),
    noiPaymentDate: dateSchema.optional(),
    publishedDate: dateSchema.optional(),
    regDate: dateSchema.optional(),
    dau3FilingDate: dateSchema.optional(),
  }).default({ stage: 'new' }),
  /** A designation of the Philippines under the Madrid Protocol, in place of `start`. */
  origin: z.enum(['national', 'madrid_in']).default('national'),
  designation: z.object({
    stage: z.enum(DESIGNATION_STAGES),
    irNo: z.string().trim().max(60).optional(),
    irDate: dateSchema.optional(),
    designationDate: dateSchema.optional(),
    refusalMailingDate: dateSchema.optional(),
    refusalReceivedDate: dateSchema.optional(),
    refusalRespondBy: dateSchema.optional(),
    refusalKind: z.enum(['provisional_refusal', 'final_rejection']).optional(),
    refusalTitle: z.string().trim().max(200).optional(),
    publishedDate: dateSchema.optional(),
    grantDate: dateSchema.optional(),
    dau3FilingDate: dateSchema.optional(),
  }).optional(),
}).refine((v) => v.origin === 'national' || !!v.designation, { message: 'Say where the designation stands', path: ['designation'] });

const countryCodes = z.array(z.string().trim().regex(/^[A-Za-z]{2}$/, 'Use two-letter country codes')).min(1, 'Name at least one country').max(120);
const refusalMonths = z.union([z.literal(12), z.literal(18)]).default(12);

/** Extending a Philippine mark abroad: the international application and the countries it designates. */
export const internationalRegistrationCreateSchema = z.object({
  applicationFiledDate: dateSchema.optional(),
  irNo: z.string().trim().max(60).optional(),
  irDate: dateSchema.optional(),
  countries: countryCodes,
  refusalPeriodMonths: refusalMonths,
});

/** Correcting or completing an international registration. */
export const internationalRegistrationPatchSchema = z.object({
  irNo: z.string().trim().max(60).nullable().optional(),
  irDate: dateSchema.nullable().optional(),
  applicationFiledDate: dateSchema.nullable().optional(),
  renewalFilingDate: dateSchema.nullable().optional(),
  ceasedDate: dateSchema.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

/** Countries designated after the international registration. */
export const designationsAddSchema = z.object({
  countries: countryCodes,
  designationDate: dateSchema,
  refusalPeriodMonths: refusalMonths,
});

/** A filing a designated country requires, due on a date entered by hand. */
export const localDeadlineCreateSchema = z.object({
  label: z.string().trim().min(1, 'Say what is due').max(200),
  dueDate: dateSchema,
});

export const localDeadlinePatchSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  dueDate: dateSchema.optional(),
  filedDate: dateSchema.nullable().optional(),
});

/** A request for extension of time to IPOPHL: what it is for and why. */
export const trademarkExtensionRequestSchema = z.object({
  purpose: z.enum(EXTENSION_PURPOSE_KEYS as [ExtensionPurpose, ...ExtensionPurpose[]]),
  reasons: z.array(z.enum(EXTENSION_REASON_KEYS as [ExtensionReason, ...ExtensionReason[]])).max(EXTENSION_REASON_KEYS.length).default([]),
  otherReason: z.string().trim().max(300).optional(),
  documentNo: z.string().trim().max(60).optional(),
  examiner: z.string().trim().max(200).optional(),
  division: z.string().trim().max(60).optional(),
}).refine((v) => v.reasons.length > 0 || !!v.otherReason, { message: 'Give at least one reason', path: ['reasons'] });

/** A client report on a step taken on a mark — the letter's own fields, which the mark doesn't record. */
/** The papers that go with a trademark report, in annex order, each with what the letter calls it. */
export const trademarkReportAnnexesSchema = z.array(z.object({
  fileId: z.number().int().positive(),
  document: z.string().trim().max(200),
})).max(MAX_ANNEXES)
  .refine((a) => new Set(a.map((x) => x.fileId)).size === a.length, 'A paper is picked as two annexes');

export const trademarkClientReportSchema = z.object({
  event: z.enum(REPORT_EVENT_KEYS as [ReportEvent, ...ReportEvent[]]),
  letter: z.object({
    addressee: z.string().trim().max(300).optional(),
    attention: z.string().trim().max(300).optional(),
    salutation: z.string().trim().max(200).optional(),
  }).optional(),
  /** The papers to attach, in annex order; left out, the step's own paper goes as Annex "A". */
  annexes: trademarkReportAnnexesSchema.optional(),
});

/** A letter edited in Word, sent in place of the generated one: its file name and its bytes in base64. */
const editedLetterSchema = z.object({
  name: z.string().trim().min(1).max(200),
  base64: z.string().min(1).max(4_200_000),
});

/** The letter as it would go, for the preview: the generated one, or the person's edited one. */
export const trademarkClientReportPreviewSchema = trademarkClientReportSchema.extend({
  editedLetter: editedLetterSchema.optional(),
});

export const trademarkClientReportSendSchema = trademarkClientReportPreviewSchema.extend({
  to: z.array(emailSchema).min(1).max(10),
  cc: z.array(emailSchema).max(10).default([]),
  subject: z.string().trim().min(1).max(300),
  message: z.string().trim().min(1).max(5000),
});

/** Starting the task for a registration on a company. */
export const corporationStepTaskSchema = z.object({
  step: z.enum(STARTABLE_STEPS),
});

/** The company's papers to attach, in annex order, by the ids the report gave them (`c:12`, `d:40`, `m:<id>:minutes`). */
export const corporationReportAnnexesSchema = z.array(z.object({
  fileId: z.string().trim().min(3).max(120),
  document: z.string().trim().max(200),
})).max(MAX_ANNEXES)
  .refine((a) => new Set(a.map((x) => x.fileId)).size === a.length, 'A paper is picked as two annexes');

/** Which company report: the event, and for an item's report the item (a compliance deliverable, a meeting, a resolution). */
export const corporationClientReportSchema = z.object({
  event: z.enum(CORPORATE_REPORT_EVENT_KEYS as [CorporateReportEvent, ...CorporateReportEvent[]]),
  itemId: z.string().trim().min(1).max(200).optional(),
  letter: trademarkClientReportSchema.shape.letter,
  annexes: corporationReportAnnexesSchema.optional(),
});

export const corporationClientReportPreviewSchema = corporationClientReportSchema.extend({
  editedLetter: editedLetterSchema.optional(),
});

export const corporationClientReportSendSchema = corporationClientReportPreviewSchema.extend({
  to: z.array(emailSchema).min(1).max(10),
  cc: z.array(emailSchema).max(10).default([]),
  subject: z.string().trim().min(1).max(300),
  message: z.string().trim().min(1).max(5000),
});

/** What a report the team wrote itself is about: one of the mark's steps, or a title of its own. */
const uploadedReportAboutSchema = {
  event: z.enum(REPORT_EVENT_KEYS as [ReportEvent, ...ReportEvent[]]).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  /** Report files already uploaded to the mark's report folder, the letter first. */
  paths: z.array(z.string().min(1).max(500)).min(1).max(10),
  /** The status report deliverable this report is, if it is one; it is marked sent out with it. */
  deliverableId: z.string().trim().min(1).max(200).optional(),
};
const aboutOneThing = (v: { event?: unknown; title?: unknown }) => !!v.event !== !!v.title;
const ABOUT_MESSAGE = { message: 'Say which step the report is on, or give it a title', path: ['title'] };

/** Recording a report that went out by other means, with the files that went. */
export const trademarkReportRecordSchema = z.object({
  ...uploadedReportAboutSchema,
  sentOn: dateSchema,
  /** Who it went to, as the person recalls it — an address or a name. */
  sentTo: z.string().trim().max(500).default(''),
  subject: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(2000).optional(),
}).refine(aboutOneThing, ABOUT_MESSAGE);

/** Sending a report on the team's own paper from the firm's trademark mailbox. */
export const trademarkReportSendUploadedSchema = z.object({
  ...uploadedReportAboutSchema,
  to: z.array(emailSchema).min(1).max(10),
  cc: z.array(emailSchema).max(10).default([]),
  subject: z.string().trim().min(1).max(300),
  message: z.string().trim().min(1).max(5000),
  salutation: z.string().trim().max(200).optional(),
}).refine(aboutOneThing, ABOUT_MESSAGE);

/** One block of the trademark reports' standard wording. */
export const trademarkReportWordingSchema = z.object({
  key: z.string().trim().min(1).max(80),
  body: z.string().max(10000),
});

export const trademarkUndoSchema = z.object({
  action: z.enum([...TRADEMARK_ACTIONS] as [TrademarkAction, ...TrademarkAction[]]),
  previousStatus: z.enum(['Prelim', 'For Filing', 'Pending', 'Pending - OA', 'Registered', 'Abandoned']).optional(),
  officeActionId: uuidSchema.optional(),
});

/** Correcting a recorded round. Its dates can be changed; only the received date and a set period can be cleared. */
export const officeActionPatchSchema = z.object({
  kind: z.enum(['office_action', 'final_rejection', 'provisional_refusal']).optional(),
  title: z.string().trim().max(200).nullable().optional(),
  mailingDate: dateSchema.optional(),
  receivedDate: dateSchema.nullable().optional(),
  respondBy: dateSchema.nullable().optional(),
  responseFiledDate: dateSchema.optional(),
});

/** Filing a paper under a timeline step, or taking it out of one. */
export const trademarkFileTagSchema = z.object({
  step: z.enum(TRADEMARK_FILE_STEPS).nullable(),
  officeActionId: uuidSchema.nullable().optional(),
});

export const isTrademarkFileStep = (v: unknown): v is TrademarkFileStep =>
  typeof v === 'string' && (TRADEMARK_FILE_STEPS as readonly string[]).includes(v);

// ── Off-cycle invoices ──────────────────────────────────────────

const offCycleItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('acceptance'), matterId: z.string().min(1) }),
  z.object({ kind: z.literal('milestone'), milestoneId: z.number().int().positive() }),
  z.object({
    kind: z.literal('adhoc'),
    description: z.string().trim().min(1).max(300),
    amount: z.number().finite().positive().max(1e9),
    matterId: z.string().min(1).nullish(),
  }),
]);

export const offCycleRequestSchema = z.object({
  clientName: z.string().trim().min(1),
  items: z.array(offCycleItemSchema).min(1).max(30),
  /** What the letter says the bill is for; blank takes the default wording. */
  periodLabel: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const offCycleDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve'), notes: z.string().trim().max(2000).optional() }),
  z.object({ decision: z.literal('reject'), notes: z.string().trim().min(1, 'A note explaining the rejection is required').max(2000) }),
]);

export const offCycleActionSchema = z.object({ action: z.enum(['cancel', 'retry']) });

// ── Helper: validate request body ───────────────────────────────

import { NextResponse } from 'next/server';

type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; response: NextResponse };

export async function validateBody<T>(
  req: Request,
  schema: z.ZodSchema<T>,
): Promise<ValidationResult<T>> {
  try {
    const raw = await req.json();
    const result = schema.safeParse(raw);
    if (!result.success) {
      const errors = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return {
        success: false,
        response: NextResponse.json(
          { error: 'Validation failed', details: errors },
          { status: 400 },
        ),
      };
    }
    return { success: true, data: result.data };
  } catch {
    return {
      success: false,
      response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }),
    };
  }
}

// ── Cases ───────────────────────────────────────────────────────

const CASE_TRACKS = ['preliminary_investigation', 'petition_for_review', 'criminal_trial', 'civil_trial', 'summary_procedure', 'special_proceeding', 'appellate', 'labor', 'administrative'] as const;
const CLIENT_ROLES = ['complainant', 'respondent', 'plaintiff', 'defendant', 'petitioner', 'intervenor', 'other'] as const;
const CASE_OUTCOMES = ['won', 'lost', 'settled', 'dismissed', 'withdrawn', 'not_pursued', 'other'] as const;
const caseText = (max: number) => z.string().trim().max(max);

export const caseCreateSchema = z.object({
  workingTitle: caseText(300).min(1),
  nature: caseText(500).nullable().optional(),
  clientRole: z.enum(CLIENT_ROLES).nullable().optional(),
  matterIds: z.array(z.string().min(1).max(100)).max(20).default([]),
});

export const caseUpdateSchema = z
  .object({
    /** Setting a title pins it; null unpins and lets the proceedings title the case again. */
    pinnedTitle: caseText(300).min(1).nullable(),
    workingTitle: caseText(300),
    nature: caseText(500).nullable(),
    clientRole: z.enum(CLIENT_ROLES).nullable(),
    close: z.object({ outcome: z.enum(CASE_OUTCOMES), closedOn: dateSchema }),
    reopen: z.literal(true),
    demandSentOn: dateSchema.nullable(),
    demandDueOn: dateSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const proceedingCreateSchema = z.object({
  parentId: uuidSchema.nullable(),
  relation: z.enum(['original', 'referral', 'review', 'information', 'appeal', 'rule_45', 'rule_65', 'other']),
  forumType: z.enum(['court', 'prosecutor', 'doj', 'ombudsman', 'labor', 'law_enforcement', 'agency', 'unknown']),
  courtLevel: z.enum(['sc', 'ca', 'sandiganbayan', 'cta', 'rtc', 'mtc']).nullable(),
  office: caseText(300),
  docketNo: caseText(300).nullable(),
  caption: caseText(500),
  track: z.enum(CASE_TRACKS),
  filedOn: dateSchema.nullable(),
  matterIds: z.array(z.string().min(1).max(100)).max(20).default([]),
});

export const proceedingUpdateSchema = z
  .object({
    office: caseText(300),
    docketNo: caseText(300).nullable(),
    caption: caseText(500),
    track: z.enum(CASE_TRACKS),
    stage: caseText(60),
    filedOn: dateSchema.nullable(),
    decision: z.object({
      resolution: caseText(2000).nullable(),
      resolvedOn: dateSchema.nullable(),
      receivedOn: dateSchema.nullable(),
      mrDueOn: dateSchema.nullable(),
    }),
    mrFiled: z.literal(true),
    reopen: z.literal(true),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const caseMatterLinkSchema = z.object({
  matterId: z.string().min(1).max(100),
  /** The proceedings this matter handles; empty means it covers the evaluation. */
  proceedingIds: z.array(uuidSchema).max(20).default([]),
});


/**
 * POST /api/knowledge/search. A matter's own summary can be the query, so it
 * travels in the body: never in a URL, a request log or the browser's cache.
 */
export const knowledgeSearchSchema = z.object({
  q: z.string().max(8000),
  matterId: z.string().max(100).nullish(),
  excludeMatterId: z.string().max(100).nullish(),
  category: z.string().max(50).nullish(),
  type: z.string().max(100).nullish(),
  limit: z.number().int().min(1).max(50).nullish(),
});
