import type {
  Corporation,
  CorporationPerson,
  CorporationFile,
  CorporationMeeting,
  Resolution,
  ResolutionTemplate,
  MeetingAgendaItem,
  MeetingAttendee,
  ResolutionVariableDef,
  CorporationAffiliation,
} from '@/types/corporations';
import type { ShareClass } from '@/lib/corporations/capital-structure';
import { linksFromRow } from '@/lib/corporations/matter-links';
import { isFirmFiling } from '@/lib/corporations/obligations';

type Row = Record<string, unknown>;

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const toStr = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s === '' ? null : s;
};

const toStrArr = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string') as string[];
};

const toBool = (v: unknown, fallback = false): boolean => {
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined) return fallback;
  return Boolean(v);
};

export function effectiveBillingMatterId(corp: {
  retainerMatterId: string | null;
  housekeepingMatterId: string | null;
  postIncorporationMatterId: string | null;
  incorporationMatterId: string | null;
}): string | null {
  return (
    corp.retainerMatterId ??
    corp.housekeepingMatterId ??
    corp.postIncorporationMatterId ??
    corp.incorporationMatterId ??
    null
  );
}

/**
 * A corporation row, read with CORPORATION_SELECT so its matter links come
 * embedded (lib/corporations/matter-links.ts). The four *MatterId fields and
 * isUnderRetainer are read off those links.
 */
export function rowToCorporation(row: Row): Corporation {
  const links = linksFromRow(row);
  const linkage = {
    retainerMatterId: links.retainer,
    housekeepingMatterId: links.housekeeping,
    postIncorporationMatterId: links.post_incorporation,
    incorporationMatterId: links.incorporation,
  };
  return {
    id: String(row.id),
    clientId: toStr(row.client_id),
    engagingClientId: toStr(row.engaging_client_id),
    ...linkage,
    effectiveBillingMatterId: effectiveBillingMatterId(linkage),

    handlesIncorporation: toBool(row.handles_incorporation, true),
    handlesPostIncorporation: toBool(row.handles_post_incorporation),
    handlesHousekeeping: toBool(row.handles_housekeeping),
    portalVisible: toBool(row.portal_visible, false),
    firmFiles: toStrArr(row.firm_files).filter(isFirmFiling),
    isUnderRetainer: links.retainer !== null,

    proposedNames: toStrArr(row.proposed_names),
    approvedName: toStr(row.approved_name),
    companyType: (toStr(row.company_type) as Corporation['companyType']) ?? null,
    industryClassification: toStr(row.industry_classification),
    primaryPurpose: toStr(row.primary_purpose),
    secondaryPurposes: toStrArr(row.secondary_purposes),

    authorizedCapitalStock: toNum(row.authorized_capital_stock),
    subscribedCapital: toNum(row.subscribed_capital),
    paidUpCapital: toNum(row.paid_up_capital),
    parValue: toNum(row.par_value),
    numberOfShares: toNum(row.number_of_shares),

    principalOfficeAddress: toStr(row.principal_office_address),
    officialEmail: toStr(row.official_email),
    alternateEmail: toStr(row.alternate_email),
    officialMobile: toStr(row.official_mobile),
    alternateMobile: toStr(row.alternate_mobile),
    website: toStr(row.website),

    contactFirstName: toStr(row.contact_first_name),
    contactLastName: toStr(row.contact_last_name),
    contactNationality: toStr(row.contact_nationality),
    contactGender: toStr(row.contact_gender),
    contactTin: toStr(row.contact_tin),
    contactPassportNumber: toStr(row.contact_passport_number),

    fiscalYearEndMonth: toNum(row.fiscal_year_end_month) ?? 12,

    esparcApplicationNo: toStr(row.esparc_application_no),
    esparcStatus: (toStr(row.esparc_status) as Corporation['esparcStatus']) ?? null,
    esparcSubmittedDate: toStr(row.esparc_submitted_date),

    secRegistrationNo: toStr(row.sec_registration_no),
    secRegistrationDate: toStr(row.sec_registration_date),

    birTin: toStr(row.bir_tin),
    birRdoCode: toStr(row.bir_rdo_code),
    birCorDate: toStr(row.bir_cor_date),
    birBooksRegistrationDate: toStr(row.bir_books_registration_date),
    birOrAuthorityDate: toStr(row.bir_or_authority_date),
    birOrusUsername: toStr(row.bir_orus_username),
    birOrusEnrolledDate: toStr(row.bir_orus_enrolled_date),
    businessTradeName: toStr(row.business_trade_name),
    annualMeetingBylaws: toStr(row.annual_meeting_bylaws),
    annualMeetingMonth: toNum(row.annual_meeting_month),
    annualMeetingDay: toNum(row.annual_meeting_day),
    geographicalCode: toStr(row.geographical_code),
    externalAuditorName: toStr(row.external_auditor_name),
    externalAuditorAccreditationNo: toStr(row.external_auditor_accreditation_no),
    telephoneNumber: toStr(row.telephone_number),
    faxNumber: toStr(row.fax_number),
    totalAssets: toNum(row.total_assets),
    totalAssetsAsOf: toStr(row.total_assets_as_of),
    secEfastUsername: toStr(row.sec_efast_username),
    secEfastEnrolledDate: toStr(row.sec_efast_enrolled_date),
    secHaborUsername: toStr(row.sec_habor_username),
    secHaborEnrolledDate: toStr(row.sec_habor_enrolled_date),

    businessPermitNo: toStr(row.business_permit_no),
    businessPermitLgu: toStr(row.business_permit_lgu),
    businessPermitIssuedDate: toStr(row.business_permit_issued_date),
    businessPermitExpiryDate: toStr(row.business_permit_expiry_date),

    sssEmployerNo: toStr(row.sss_employer_no),
    sssRegistrationDate: toStr(row.sss_registration_date),
    philhealthEmployerNo: toStr(row.philhealth_employer_no),
    philhealthRegistrationDate: toStr(row.philhealth_registration_date),
    pagibigEmployerNo: toStr(row.pagibig_employer_no),
    pagibigRegistrationDate: toStr(row.pagibig_registration_date),

    status: (toStr(row.status) as Corporation['status']) ?? 'Pre-Incorporation',

    notes: toStr(row.notes),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    createdBy: toStr(row.created_by),
  };
}

export function rowToCorporationPerson(row: Row): CorporationPerson {
  return {
    id: Number(row.id),
    corporationId: String(row.corporation_id),
    role: row.role as CorporationPerson['role'],
    personRecordId: toStr(row.person_id),
    firstName: String(row.first_name ?? ''),
    lastName: String(row.last_name ?? ''),
    nationality: toStr(row.nationality),
    gender: toStr(row.gender),
    residentialAddress: toStr(row.residential_address),
    tin: toStr(row.tin),
    passportNumber: toStr(row.passport_number),
    esapNo: toStr(row.esap_no),
    isJuridical: toBool(row.is_juridical, false),
    entityName: toStr(row.entity_name),
    entityType: (toStr(row.entity_type) as CorporationPerson['entityType']) ?? null,
    entityRegistrationNo: toStr(row.entity_registration_no),
    representativeName: toStr(row.representative_name),
    representativeTitle: toStr(row.representative_title),
    shareClass: toStr(row.share_class),
    sharesSubscribedCount: toNum(row.shares_subscribed_count),
    sharesSubscribedAmount: toNum(row.shares_subscribed_amount),
    sharesPaidAmount: toNum(row.shares_paid_amount),
    positionTitle: toStr(row.position_title),
    termStart: toStr(row.term_start),
    termEnd: toStr(row.term_end),
    isCurrent: toBool(row.is_current, true),
    sortOrder: toNum(row.sort_order) ?? 0,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export function rowToCorporationFile(row: Row): CorporationFile {
  return {
    filingYear: toNum(row.filing_year),
    clientVisible: toBool(row.client_visible, false),
    id: Number(row.id),
    corporationId: String(row.corporation_id),
    personId: row.person_id != null ? Number(row.person_id) : null,
    category: row.category as CorporationFile['category'],
    name: String(row.name ?? ''),
    storagePath: String(row.storage_path ?? ''),
    mimeType: toStr(row.mime_type),
    sizeBytes: toNum(row.size_bytes),
    uploadedBy: toStr(row.uploaded_by),
    uploadedAt: String(row.uploaded_at ?? ''),
  };
}

export function rowToCorporationMeeting(row: Row): CorporationMeeting {
  return {
    id: String(row.id),
    corporationId: String(row.corporation_id),
    meetingType: row.meeting_type as CorporationMeeting['meetingType'],
    meetingDate: String(row.meeting_date),
    meetingTime: toStr(row.meeting_time),
    meetingMode: (toStr(row.meeting_mode) as CorporationMeeting['meetingMode']) ?? null,
    venue: toStr(row.venue),
    noticeSentDate: toStr(row.notice_sent_date),
    quorumAchieved: toBool(row.quorum_achieved),
    sharesRepresented: toNum(row.shares_represented),
    totalSharesOutstanding: toNum(row.total_shares_outstanding),
    agenda: (Array.isArray(row.agenda) ? (row.agenda as MeetingAgendaItem[]) : []),
    attendees: (Array.isArray(row.attendees) ? (row.attendees as MeetingAttendee[]) : []),
    minutesStatus: (toStr(row.minutes_status) as CorporationMeeting['minutesStatus']) ?? 'Draft',
    minutesFilePath: toStr(row.minutes_file_path),
    attendanceSheetPath: toStr(row.attendance_sheet_path),
    recordingPath: toStr(row.recording_path),
    noticeFilePath: toStr(row.notice_file_path),
    waiverOfNoticeFilePath: toStr(row.waiver_of_notice_file_path),
    proxyFilePaths: toStrArr(row.proxy_file_paths),
    notes: toStr(row.notes),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    createdBy: toStr(row.created_by),
  };
}

export function rowToResolutionTemplate(row: Row): ResolutionTemplate {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    kind: row.kind as ResolutionTemplate['kind'],
    category: row.category as ResolutionTemplate['category'],
    description: toStr(row.description),
    bodyTemplate: String(row.body_template ?? ''),
    variableSchema: (Array.isArray(row.variable_schema) ? (row.variable_schema as ResolutionVariableDef[]) : []),
    isActive: toBool(row.is_active, true),
    sortOrder: toNum(row.sort_order) ?? 0,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export function rowToResolution(row: Row): Resolution {
  return {
    id: String(row.id),
    corporationId: String(row.corporation_id),
    meetingId: toStr(row.meeting_id),
    kind: row.kind as Resolution['kind'],
    title: String(row.title ?? ''),
    dateOfResolution: String(row.date_of_resolution ?? ''),
    templateId: toStr(row.template_id),
    variables: (row.variables && typeof row.variables === 'object' ? row.variables : {}) as Record<string, string>,
    freeFormBody: toStr(row.free_form_body),
    bundledResolutionIds: toStrArr(row.bundled_resolution_ids),
    generatedFilePath: toStr(row.generated_file_path),
    signedFilePath: toStr(row.signed_file_path),
    status: (toStr(row.status) as Resolution['status']) ?? 'Draft',
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    createdBy: toStr(row.created_by),
  };
}

export function rowToShareClass(row: Row): ShareClass {
  return {
    id: Number(row.id),
    corporationId: String(row.corporation_id),
    className: String(row.class_name ?? ''),
    parValue: toNum(row.par_value),
    authorizedShares: toNum(row.authorized_shares),
    sortOrder: Number(row.sort_order ?? 0),
  };
}

export function rowToAffiliation(row: Row): CorporationAffiliation {
  return {
    id: Number(row.id),
    corporationId: String(row.corporation_id),
    relation: (toStr(row.relation) as CorporationAffiliation['relation']) ?? 'Affiliate',
    name: String(row.name ?? ''),
    secRegistrationNo: toStr(row.sec_registration_no),
    address: toStr(row.address),
    sortOrder: Number(row.sort_order ?? 0),
  };
}
