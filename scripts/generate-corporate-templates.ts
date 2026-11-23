/**
 * Generate the four outer DOCX templates for the Corporate Services module
 * using the `docx` library (already a project dependency), upload them to the
 * Supabase `templates` storage bucket, and register them in `document_templates`.
 *
 * Run: `npx tsx scripts/generate-corporate-templates.ts`
 *
 * The placeholders ({{corporation_name}}, {{resolution_body}}, etc.) are
 * embedded as literal text in fresh paragraphs, so each one lives in its own
 * <w:t> run — substituteDocxPlaceholders() will find them on first pass.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  PageBreak,
  Header,
  Footer,
  PageNumber,
  Spacing,
} from 'docx';
import { createClient } from '@supabase/supabase-js';

// ----- Style helpers -----

const FONT = 'Calibri';
const BODY_SIZE = 22; // half-points -> 11pt
const HEADER_SIZE = 28; // 14pt
const TITLE_SIZE = 36;  // 18pt

function p(text: string | TextRun[], opts: { bold?: boolean; align?: keyof typeof AlignmentType; spaceAfter?: number; indent?: number } = {}): Paragraph {
  const runs = Array.isArray(text) ? text : [new TextRun({ text, bold: opts.bold, font: FONT, size: BODY_SIZE })];
  return new Paragraph({
    children: runs,
    alignment: opts.align ? AlignmentType[opts.align] : AlignmentType.JUSTIFIED,
    spacing: { after: opts.spaceAfter ?? 120 },
    indent: opts.indent ? { firstLine: opts.indent } : undefined,
  });
}

function heading(text: string, size = HEADER_SIZE, align: keyof typeof AlignmentType = 'CENTER'): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, font: FONT, size })],
    alignment: AlignmentType[align],
    spacing: { before: 240, after: 240 },
  });
}

function blank(): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: '', font: FONT, size: BODY_SIZE })] });
}

// ----- Board_Resolution.docx -----

function buildBoardResolution(): Document {
  return new Document({
    styles: { default: { document: { run: { font: FONT, size: BODY_SIZE } } } },
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: [
        heading('{{corporation_name}}', TITLE_SIZE),
        p('SEC Reg. No. {{sec_registration_no}}', { align: 'CENTER', spaceAfter: 240 }),
        heading('BOARD RESOLUTION', HEADER_SIZE),
        p([
          new TextRun({ text: '{{title}}', bold: true, font: FONT, size: BODY_SIZE }),
        ], { align: 'CENTER', spaceAfter: 360 }),
        p('At a duly called meeting of the Board of Directors of {{corporation_name}} (the "Corporation") held on {{date_of_resolution}}, at which a quorum was present and acting throughout, the following resolution was adopted:'),
        blank(),
        p('{{resolution_body}}'),
        blank(),
        p('IN WITNESS WHEREOF, the foregoing resolution has been duly adopted on {{date_of_resolution}}.'),
        blank(),
        blank(),
        blank(),
        p('_______________________________', { align: 'LEFT', spaceAfter: 60 }),
        p([new TextRun({ text: '{{signatory_name}}', bold: true, font: FONT, size: BODY_SIZE })], { align: 'LEFT', spaceAfter: 60 }),
        p([new TextRun({ text: '{{signatory_position}}', italics: true, font: FONT, size: BODY_SIZE })], { align: 'LEFT' }),
      ],
    }],
  });
}

// ----- Secretarys_Certificate.docx -----

function buildSecretarysCertificate(): Document {
  return new Document({
    styles: { default: { document: { run: { font: FONT, size: BODY_SIZE } } } },
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: [
        heading('{{corporation_name}}', TITLE_SIZE),
        p('SEC Reg. No. {{sec_registration_no}}', { align: 'CENTER', spaceAfter: 360 }),
        heading("SECRETARY'S CERTIFICATE", HEADER_SIZE),
        blank(),
        p('I, {{secretary_name}}, of legal age, Filipino, and duly elected and qualified Corporate Secretary of {{corporation_name}} (the "Corporation"), a corporation duly organized and existing under the laws of the Republic of the Philippines, with principal office address on file with the Securities and Exchange Commission, do hereby certify that:'),
        blank(),
        p('At a duly convened meeting of the Board of Directors of the Corporation held on {{board_meeting_date}}, at which a quorum was present and acting throughout, the following resolution was adopted and remains in full force and effect as of the date hereof:'),
        blank(),
        p([new TextRun({ text: '{{resolution_quoted_body}}', italics: true, font: FONT, size: BODY_SIZE })], { indent: 720 }),
        blank(),
        p('IN WITNESS WHEREOF, I have hereunto set my hand this {{date}}, at Makati City, Philippines.'),
        blank(),
        blank(),
        blank(),
        p('_______________________________', { align: 'LEFT', spaceAfter: 60 }),
        p([new TextRun({ text: '{{secretary_name}}', bold: true, font: FONT, size: BODY_SIZE })], { align: 'LEFT', spaceAfter: 60 }),
        p([new TextRun({ text: 'Corporate Secretary', italics: true, font: FONT, size: BODY_SIZE })], { align: 'LEFT' }),
        blank(),
        blank(),
        p('{{notary_block}}', { spaceAfter: 60 }),
      ],
    }],
  });
}

// ----- Minutes_Board.docx -----

function buildMinutesBoard(): Document {
  return new Document({
    styles: { default: { document: { run: { font: FONT, size: BODY_SIZE } } } },
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: [
        heading('{{corporation_name}}', TITLE_SIZE),
        p('SEC Reg. No. {{sec_registration_no}}', { align: 'CENTER', spaceAfter: 240 }),
        heading('MINUTES OF THE MEETING OF THE BOARD OF DIRECTORS', HEADER_SIZE),
        p('Held on {{meeting_date}} at {{meeting_time}} ({{meeting_mode}})', { align: 'CENTER' }),
        p('Venue: {{venue}}', { align: 'CENTER', spaceAfter: 360 }),

        p([new TextRun({ text: 'I. CALL TO ORDER AND ATTENDANCE', bold: true, font: FONT, size: BODY_SIZE })], { align: 'LEFT', spaceAfter: 120 }),
        p('The meeting was called to order by the Chairman. The following directors and officers were present:'),
        p('{{attendees_block}}'),
        blank(),
        p('{{quorum_statement}}'),
        blank(),

        p([new TextRun({ text: 'II. AGENDA', bold: true, font: FONT, size: BODY_SIZE })], { align: 'LEFT', spaceAfter: 120 }),
        p('{{agenda_block}}'),
        blank(),

        p([new TextRun({ text: 'III. RESOLUTIONS PASSED', bold: true, font: FONT, size: BODY_SIZE })], { align: 'LEFT', spaceAfter: 120 }),
        p('{{resolutions_block}}'),
        blank(),

        p([new TextRun({ text: 'IV. ADJOURNMENT', bold: true, font: FONT, size: BODY_SIZE })], { align: 'LEFT', spaceAfter: 120 }),
        p('There being no further business, the meeting was duly adjourned.'),
        blank(),
        blank(),
        blank(),
        p('Certified true and correct:', { spaceAfter: 240 }),
        p('_______________________________', { align: 'LEFT', spaceAfter: 60 }),
        p('{{secretary_signature_block}}', { align: 'LEFT', spaceAfter: 60 }),
        p([new TextRun({ text: 'Corporate Secretary', italics: true, font: FONT, size: BODY_SIZE })], { align: 'LEFT' }),
      ],
    }],
  });
}

// ----- Minutes_Stockholders.docx -----

function buildMinutesStockholders(): Document {
  return new Document({
    styles: { default: { document: { run: { font: FONT, size: BODY_SIZE } } } },
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: [
        heading('{{corporation_name}}', TITLE_SIZE),
        p('SEC Reg. No. {{sec_registration_no}}', { align: 'CENTER', spaceAfter: 240 }),
        heading('MINUTES OF THE MEETING OF THE STOCKHOLDERS', HEADER_SIZE),
        p('Held on {{meeting_date}}', { align: 'CENTER' }),
        p('Venue: {{venue}}', { align: 'CENTER', spaceAfter: 360 }),

        p([new TextRun({ text: 'I. CALL TO ORDER AND QUORUM', bold: true, font: FONT, size: BODY_SIZE })], { align: 'LEFT', spaceAfter: 120 }),
        p('The following stockholders were present in person or by proxy:'),
        p('{{stockholders_present_block}}'),
        blank(),
        p('Shares represented: {{shares_represented}}. Total shares outstanding: {{total_shares_outstanding}}.'),
        p('{{quorum_statement}}'),
        blank(),

        p([new TextRun({ text: 'II. AGENDA', bold: true, font: FONT, size: BODY_SIZE })], { align: 'LEFT', spaceAfter: 120 }),
        p('{{agenda_block}}'),
        blank(),

        p([new TextRun({ text: 'III. RESOLUTIONS PASSED', bold: true, font: FONT, size: BODY_SIZE })], { align: 'LEFT', spaceAfter: 120 }),
        p('{{resolutions_block}}'),
        blank(),

        p([new TextRun({ text: 'IV. ADJOURNMENT', bold: true, font: FONT, size: BODY_SIZE })], { align: 'LEFT', spaceAfter: 120 }),
        p('There being no further business, the meeting was duly adjourned.'),
        blank(),
        blank(),
        blank(),
        p('Certified true and correct:', { spaceAfter: 240 }),
        p('_______________________________', { align: 'LEFT', spaceAfter: 60 }),
        p('{{secretary_signature_block}}', { align: 'LEFT', spaceAfter: 60 }),
        p([new TextRun({ text: 'Corporate Secretary', italics: true, font: FONT, size: BODY_SIZE })], { align: 'LEFT' }),
      ],
    }],
  });
}

// ----- Main: generate, upload, register -----

interface TemplateSpec {
  /** Stored as document_templates.subcategory; the resolution-generator looks
   *  up by (category='corporate', subcategory=<kind>) so the admin
   *  TemplateManager UI groups all four under one 'Corporate' badge. */
  subcategory: 'board_resolution' | 'secretarys_certificate' | 'minutes_board' | 'minutes_stockholders';
  displayName: string;
  description: string;
  storagePath: string;
  placeholders: { key: string; label: string }[];
  build: () => Document;
}

const SPECS: TemplateSpec[] = [
  {
    subcategory: 'board_resolution',
    displayName: 'Board Resolution',
    description: 'Outer template for board resolutions. Resolution body is filled from a curated resolution_templates row or free-form input.',
    storagePath: 'corporate/Board_Resolution.docx',
    placeholders: [
      { key: 'corporation_name', label: 'Corporation Name' },
      { key: 'sec_registration_no', label: 'SEC Reg. No.' },
      { key: 'date_of_resolution', label: 'Date of Resolution' },
      { key: 'title', label: 'Resolution Title' },
      { key: 'resolution_body', label: 'Resolution Body' },
      { key: 'signatory_name', label: 'Signatory Name' },
      { key: 'signatory_position', label: 'Signatory Position' },
    ],
    build: buildBoardResolution,
  },
  {
    subcategory: 'secretarys_certificate',
    displayName: "Secretary's Certificate",
    description: "Outer template for Secretary's Certificates attesting to a board resolution.",
    storagePath: 'corporate/Secretarys_Certificate.docx',
    placeholders: [
      { key: 'corporation_name', label: 'Corporation Name' },
      { key: 'sec_registration_no', label: 'SEC Reg. No.' },
      { key: 'secretary_name', label: 'Corporate Secretary' },
      { key: 'board_meeting_date', label: 'Board Meeting Date' },
      { key: 'resolution_quoted_body', label: 'Resolution Quoted Body' },
      { key: 'date', label: 'Certificate Date' },
      { key: 'notary_block', label: 'Notary Block (optional)' },
    ],
    build: buildSecretarysCertificate,
  },
  {
    subcategory: 'minutes_board',
    displayName: 'Minutes of Board Meeting',
    description: 'Minutes for board of directors meetings, with attendee, agenda, and resolutions blocks.',
    storagePath: 'corporate/Minutes_Board.docx',
    placeholders: [
      { key: 'corporation_name', label: 'Corporation Name' },
      { key: 'sec_registration_no', label: 'SEC Reg. No.' },
      { key: 'meeting_date', label: 'Meeting Date' },
      { key: 'meeting_time', label: 'Meeting Time' },
      { key: 'meeting_mode', label: 'Meeting Mode' },
      { key: 'venue', label: 'Venue' },
      { key: 'attendees_block', label: 'Attendees (multiline)' },
      { key: 'quorum_statement', label: 'Quorum Statement' },
      { key: 'agenda_block', label: 'Agenda (multiline)' },
      { key: 'resolutions_block', label: 'Resolutions (multiline)' },
      { key: 'secretary_signature_block', label: 'Secretary Signature Block' },
    ],
    build: buildMinutesBoard,
  },
  {
    subcategory: 'minutes_stockholders',
    displayName: 'Minutes of Stockholders Meeting',
    description: 'Minutes for annual and special stockholders meetings, with quorum/shares-represented metrics.',
    storagePath: 'corporate/Minutes_Stockholders.docx',
    placeholders: [
      { key: 'corporation_name', label: 'Corporation Name' },
      { key: 'sec_registration_no', label: 'SEC Reg. No.' },
      { key: 'meeting_date', label: 'Meeting Date' },
      { key: 'venue', label: 'Venue' },
      { key: 'stockholders_present_block', label: 'Stockholders Present (multiline)' },
      { key: 'shares_represented', label: 'Shares Represented' },
      { key: 'total_shares_outstanding', label: 'Total Shares Outstanding' },
      { key: 'quorum_statement', label: 'Quorum Statement' },
      { key: 'agenda_block', label: 'Agenda (multiline)' },
      { key: 'resolutions_block', label: 'Resolutions (multiline)' },
      { key: 'secretary_signature_block', label: 'Secretary Signature Block' },
    ],
    build: buildMinutesStockholders,
  },
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  for (const spec of SPECS) {
    console.log(`[gen] building corporate/${spec.subcategory}…`);
    const buffer = await Packer.toBuffer(spec.build());

    console.log(`[gen] uploading to templates/${spec.storagePath}…`);
    const { error: upErr } = await supabase.storage
      .from('templates')
      .upload(spec.storagePath, buffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      });
    if (upErr) {
      console.error(`[gen] upload failed for ${spec.subcategory}:`, upErr.message);
      process.exit(1);
    }

    // Deactivate any prior rows for this (category, subcategory) combo,
    // including legacy rows that were registered with the bare subcategory
    // string as their category.
    await supabase
      .from('document_templates')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .or(`and(category.eq.corporate,subcategory.eq.${spec.subcategory}),category.eq.${spec.subcategory}`);

    const { error: insErr } = await supabase
      .from('document_templates')
      .insert({
        name: spec.displayName,
        category: 'corporate',
        subcategory: spec.subcategory,
        description: spec.description,
        generation_mode: 'placeholder',
        template_storage_path: spec.storagePath,
        placeholders: spec.placeholders,
        is_active: true,
      });
    if (insErr) {
      console.error(`[gen] document_templates insert failed for ${spec.subcategory}:`, insErr.message);
      process.exit(1);
    }

    console.log(`[gen] corporate/${spec.subcategory} ready`);
  }

  console.log(`\n[gen] all ${SPECS.length} templates uploaded and registered`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
