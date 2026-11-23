/**
 * Resolution / Minutes / Secretary's Certificate generation for the
 * Corporate Services module. Mirrors lib/docx/billing-letter-template.ts:
 *
 *   1. Pull the outer DOCX template from Supabase Storage (templates bucket)
 *      via the document_templates registry — category identifies which
 *      template to use.
 *   2. Render inner placeholders (the resolution body clause) from the
 *      curated resolution_templates row + the resolution's variables JSONB.
 *   3. Call substituteDocxPlaceholders to fill the outer template's flat
 *      {{placeholders}}, with attendee-list keys passed via multilineKeys.
 *   4. Upload to OneDrive + convert to PDF via Microsoft Graph (same as
 *      billing letters).
 */

import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { uploadAndConvertToPdf } from '@/lib/microsoft-graph';
import { requireFeature } from '@/lib/firm/features';
import { getFirmConfig, documentRoot } from '@/lib/firm/config';
import { substituteDocxPlaceholders } from './placeholder-substitution';
import type {
  Corporation,
  Resolution,
  ResolutionTemplate,
  CorporationMeeting,
} from '@/types/corporations';

export type OuterTemplateCategory =
  | 'board_resolution'
  | 'secretarys_certificate'
  | 'minutes_board'
  | 'minutes_stockholders';

/**
 * Pure-string handlebars-light substitution for the inner template body.
 * Missing keys render as empty string.
 */
export function renderInnerPlaceholders(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

/**
 * Look up the active outer template from the document_templates table.
 * Corporate templates use category='corporate' + subcategory=<kind> so they
 * show up correctly in /admin/templates alongside legal/letter/form/report.
 *
 * There is deliberately no shared default: an outer template IS the firm's
 * letterhead, so a fallback to a common storage path renders one firm's
 * letterhead on another firm's board resolutions.
 */
export async function getOuterTemplate(
  category: OuterTemplateCategory,
  firmId: string,
): Promise<Buffer> {
  const { data: template } = await getServiceDbForFirm(firmId)
    .from('document_templates')
    .select('template_storage_path')
    .eq('category', 'corporate')
    .eq('subcategory', category)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const storagePath = template?.template_storage_path as string | undefined;
  if (!storagePath) {
    throw new Error(
      `No corporate "${category}" template is configured for this firm. ` +
      `Upload one on the document templates admin page before generating this document.`,
    );
  }

  // Storage handles are not firm-scoped by the facade; the raw client is
  // correct for the bucket read itself.
  const { data, error } = await getSupabase().storage.from('templates').download(storagePath);
  if (error || !data) {
    throw new Error(
      `Failed to download corporate template "${category}" at ${storagePath}: ${error?.message ?? 'not found'}. ` +
      `Upload one via the document templates admin page.`,
    );
  }
  return Buffer.from(await data.arrayBuffer());
}

function formatLongDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function pickResolutionOuterCategory(kind: Resolution['kind']): OuterTemplateCategory {
  if (kind === 'Secretarys Certificate') return 'secretarys_certificate';
  return 'board_resolution';
}

function pickMeetingOuterCategory(meetingType: CorporationMeeting['meetingType']): OuterTemplateCategory {
  if (meetingType.includes('Stockholders')) return 'minutes_stockholders';
  return 'minutes_board';
}

const MULTILINE_KEYS = [
  'attendees_block',
  'agenda_block',
  'resolutions_block',
  'stockholders_present_block',
];

export interface GeneratedDoc {
  docxBuffer: Buffer;
  pdfBuffer: Buffer;
  oneDriveUrl: string;
}

/** Build the inner body of a single resolution (used when generating a board
 *  resolution and as the source quoted-text inside a sec cert). */
function buildResolutionInnerBody(
  resolution: Pick<Resolution, 'variables' | 'freeFormBody'>,
  template: ResolutionTemplate | null,
): string {
  return template
    ? renderInnerPlaceholders(template.bodyTemplate, resolution.variables)
    : resolution.freeFormBody ?? '';
}

/** Render the quoted-body block for a Secretary's Certificate that bundles
 *  multiple resolutions, each potentially from a different meeting. Each
 *  bundled resolution gets a preamble noting the meeting type + date, then
 *  the resolution's body. Returns a single multi-line string ready for the
 *  multilineKeys substitution. */
function buildSecCertQuotedBody(args: {
  bundles: Array<{
    resolution: Resolution;
    template: ResolutionTemplate | null;
    meetingType: string | null;
    meetingDate: string | null;
  }>;
  fallbackResolution: Resolution;
  fallbackTemplate: ResolutionTemplate | null;
}): string {
  if (args.bundles.length === 0) {
    return buildResolutionInnerBody(args.fallbackResolution, args.fallbackTemplate);
  }
  const sections = args.bundles.map((b) => {
    const body = buildResolutionInnerBody(b.resolution, b.template);
    const meetingClause = b.meetingDate
      ? `At a duly convened ${(b.meetingType ?? 'meeting').toLowerCase()} held on ${formatLongDate(b.meetingDate)}, the following resolution was adopted:`
      : 'The following resolution was duly adopted:';
    return `${meetingClause}\n\n${b.resolution.title}\n\n${body}`;
  });
  return sections.join('\n\n— — —\n\n');
}

/**
 * Generate a single-resolution document (board resolution / stockholders
 * resolution / sec-cert). For free-form resolutions, pass template=null and
 * resolution.free_form_body is used verbatim. For Secretary's Certificates
 * that bundle multiple resolutions, pass `bundles` covering each bundled
 * resolution + its meeting context.
 */
export async function generateResolutionDocx(args: {
  firmId: string;
  resolution: Resolution;
  corporation: Corporation;
  template: ResolutionTemplate | null;
  signatoryName?: string;
  signatoryPosition?: string;
  /** For Secretary's Certificate kind: resolutions to bundle into the cert. */
  bundles?: Array<{
    resolution: Resolution;
    template: ResolutionTemplate | null;
    meetingType: string | null;
    meetingDate: string | null;
  }>;
}): Promise<GeneratedDoc> {
  const { resolution, corporation, template } = args;

  const isSecCert = resolution.kind === 'Secretarys Certificate';
  const innerBody = isSecCert
    ? buildSecCertQuotedBody({
        bundles: args.bundles ?? [],
        fallbackResolution: resolution,
        fallbackTemplate: template,
      })
    : buildResolutionInnerBody(resolution, template);

  const outerCategory = pickResolutionOuterCategory(resolution.kind);
  const outerBuffer = await getOuterTemplate(outerCategory, args.firmId);

  const corpName = corporation.approvedName ?? corporation.proposedNames[0] ?? 'the Corporation';

  // For a sec cert, the cover meeting date is the date of the *cert*, not the
  // underlying resolutions (each of which carries its own meeting clause in
  // the quoted body above).
  const values: Record<string, string> = {
    corporation_name: corpName,
    sec_registration_no: corporation.secRegistrationNo ?? '',
    date_of_resolution: formatLongDate(resolution.dateOfResolution),
    title: resolution.title,
    resolution_body: innerBody,
    resolution_quoted_body: innerBody,
    signatory_name: args.signatoryName ?? '',
    signatory_position: args.signatoryPosition ?? '',
    secretary_name: args.signatoryName ?? '',
    date: formatLongDate(resolution.dateOfResolution),
    board_meeting_date: '',
    notary_block: '',
  };

  // resolution_body / resolution_quoted_body may contain multi-line text
  // (especially for bundled sec certs), so treat them as multilineKeys so
  // `\n` becomes a Word soft-break.
  const docxBuffer = await substituteDocxPlaceholders(outerBuffer, values, {
    multilineKeys: [...MULTILINE_KEYS, 'resolution_body', 'resolution_quoted_body'],
  });

  const safeName = corpName.replace(/[^a-zA-Z0-9 ._-]/g, '_');
  const folderPath = `${documentRoot(await getFirmConfig(args.firmId), 'corporate')}/${safeName}/Resolutions`;
  const fileName = `${formatLongDate(resolution.dateOfResolution)} — ${resolution.title}.docx`;

  await requireFeature(args.firmId, 'docx_pdf');
  const { pdfBuffer, docxWebUrl } = await uploadAndConvertToPdf(args.firmId, docxBuffer, folderPath, fileName);

  return { docxBuffer, pdfBuffer, oneDriveUrl: docxWebUrl };
}

/**
 * Generate minutes of a board or stockholders meeting.
 */
export async function generateMinutesDocx(args: {
  firmId: string;
  meeting: CorporationMeeting;
  corporation: Corporation;
  linkedResolutions: Resolution[];
  secretaryName?: string;
}): Promise<GeneratedDoc> {
  const { meeting, corporation, linkedResolutions } = args;
  const outerCategory = pickMeetingOuterCategory(meeting.meetingType);
  const outerBuffer = await getOuterTemplate(outerCategory, args.firmId);
  const corpName = corporation.approvedName ?? corporation.proposedNames[0] ?? 'the Corporation';

  const attendeesText = meeting.attendees
    .map((a) => `${a.name}${a.role ? ` (${a.role})` : ''}${a.attended ? '' : ' — absent'}`)
    .join('\n');

  const agendaText = meeting.agenda
    .map((it, i) => `${i + 1}. ${it.title}${it.notes ? ` — ${it.notes}` : ''}`)
    .join('\n');

  const resolutionsText = linkedResolutions
    .map((r, i) => `${i + 1}. ${r.title}`)
    .join('\n');

  const stockholdersPresentText = meeting.attendees
    .filter((a) => /stockholder|shareholder/i.test(a.role ?? ''))
    .map((a) => a.name)
    .join('\n');

  const quorum = meeting.quorumAchieved
    ? 'A quorum was duly constituted.'
    : 'No quorum was constituted.';

  const values: Record<string, string> = {
    corporation_name: corpName,
    sec_registration_no: corporation.secRegistrationNo ?? '',
    meeting_date: formatLongDate(meeting.meetingDate),
    meeting_time: meeting.meetingTime ?? '',
    meeting_mode: meeting.meetingMode ?? '',
    venue: meeting.venue ?? '',
    attendees_block: attendeesText,
    agenda_block: agendaText,
    resolutions_block: resolutionsText,
    stockholders_present_block: stockholdersPresentText,
    quorum_statement: quorum,
    shares_represented: meeting.sharesRepresented?.toString() ?? '',
    total_shares_outstanding: meeting.totalSharesOutstanding?.toString() ?? '',
    secretary_signature_block: args.secretaryName ?? '',
  };

  const docxBuffer = await substituteDocxPlaceholders(outerBuffer, values, {
    multilineKeys: MULTILINE_KEYS,
  });

  const safeName = corpName.replace(/[^a-zA-Z0-9 ._-]/g, '_');
  const folderPath = `${documentRoot(await getFirmConfig(args.firmId), 'corporate')}/${safeName}/Meetings`;
  const fileName = `${formatLongDate(meeting.meetingDate)} — ${meeting.meetingType} Minutes.docx`;

  await requireFeature(args.firmId, 'docx_pdf');
  const { pdfBuffer, docxWebUrl } = await uploadAndConvertToPdf(args.firmId, docxBuffer, folderPath, fileName);

  return { docxBuffer, pdfBuffer, oneDriveUrl: docxWebUrl };
}
