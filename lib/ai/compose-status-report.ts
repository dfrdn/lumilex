// Status-report composition — the single path both entry points share.
//
// The Drafting Studio (format: 'status_report') and the Matters-page ad-hoc
// button both call this so there is ONE status-report brain: the same
// grounded, house-style draft (generateAdhocStatusReport) laid out by the same
// firm-letterhead DOCX builder (generateStatusReportDocx). Callers own their
// own persistence + deliverable creation, which differ.

import { generateAdhocStatusReport, type AdhocStatusReportResult } from '@/lib/ai/status-report-adhoc';
import { assembleDraftGrounding, type DraftGrounding } from '@/lib/ai/draft-grounding';
import { getMatterTeamByRole } from '@/lib/queries/team-roles';
import { generateStatusReportDocx } from '@/lib/docx/status-report';
import { loadDocxBrand } from '@/lib/docx/brand';
import { manilaToday } from '@/lib/dates';


const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface ComposeStatusReportOptions {
  firmId: string;
  matterId: string;
  sinceDate?: string;
  model?: 'standard' | 'complex';
  instructions?: string;
  excludeGrounding?: {
    ownWorkTitles?: string[];
    priorWorkKeys?: string[];
    kbPageIds?: number[];
    authorityCaseNumbers?: string[];
  };
}

export interface ComposedStatusReport {
  buffer: Buffer;
  draft: AdhocStatusReportResult;
  deliverableName: string;
  formattedDate: string;
  /** Signatory team (most senior first), for whoever creates the deliverable. */
  signers: { personId: string | null; name: string; position?: string }[];
  /** What the report was grounded on — surfaced in the Studio's "grounded on" panel. */
  grounding: DraftGrounding;
}

/**
 * Draft a grounded, house-style status report and lay it out on the firm
 * letterhead. Returns the DOCX buffer plus the structured draft + signers so
 * the caller can persist it and create the appropriate deliverable.
 */
export async function composeStatusReport(opts: ComposeStatusReportOptions): Promise<ComposedStatusReport> {
  // Assemble grounding once here so it can be both fed to the drafter and
  // surfaced in the Studio's "grounded on" panel.
  const grounding = await assembleDraftGrounding({
    firmId: opts.firmId,
    matterId: opts.matterId,
    documentType: 'Status Report letter to client',
    extraQuery: opts.instructions,
    exclude: opts.excludeGrounding,
    // Status reports are factual updates — jurisprudence grounding is noise.
    includeAuthorities: false,
  });

  const draft = await generateAdhocStatusReport({
    firmId: opts.firmId,
    matterId: opts.matterId,
    sinceDate: opts.sinceDate,
    model: opts.model,
    instructions: opts.instructions,
    grounding,
  });

  const team = await getMatterTeamByRole(opts.firmId, opts.matterId);
  const signers = team.length > 0
    ? team.map((m) => ({ personId: m.personId, name: m.name, position: m.position }))
    : [{ personId: null, name: '_______________', position: undefined }];

  const today = manilaToday();
  const formattedDate = `${Number(today.slice(8, 10))} ${MONTHS[Number(today.slice(5, 7)) - 1]} ${today.slice(0, 4)}`;
  const deliverableName = `Status Report — ${formattedDate}`;

  const buffer = await generateStatusReportDocx({
    date: formattedDate,
    addressee: {
      name: draft.addressee.name,
      address: draft.addressee.address ?? undefined,
      email: draft.addressee.email ?? undefined,
      throughName: draft.addressee.throughName ?? undefined,
      throughTitle: draft.addressee.throughTitle ?? undefined,
    },
    salutation: draft.salutation,
    reLines: draft.reLines,
    bodyParagraphs: draft.bodyParagraphs,
    annexes: draft.annexes.length > 0 ? draft.annexes : undefined,
    signers: signers.map((s) => ({ name: s.name, position: s.position })),
    brand: await loadDocxBrand(opts.firmId),
  });

  return { buffer, draft, deliverableName, formattedDate, signers, grounding };
}
