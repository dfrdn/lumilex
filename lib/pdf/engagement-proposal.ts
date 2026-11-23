/**
 * Branded PDF rendering of an engagement proposal letter.
 *
 *   1. Cover   → navy lockup panel, cream title panel naming the client, gold contact band
 *   2+. Letter → privilege line, date, addressee block, attention/subject rows,
 *                salutation, intro, numbered sections, closing
 *   N. Signature → firm block, signing partner, and the conforme the client signs
 *
 * The letter shares its chrome with the fee schedules bound behind it
 * (lib/pdf/letterhead.ts), so the merged package reads as one document. The
 * annexes themselves are appended by lib/pdf/proposal-package.ts.
 *
 * Layout follows the firm's settled house pattern: the entity name alone carries
 * the addressee block (no postal address), Attention and Subject sit in a
 * borderless label/value grid, and a corporate client signs the conforme through
 * an entity block rather than as a bare name over the signature line.
 */

import {
  PAGE, M, CONTENT_W, FONT,
  brandedDocument, collect, type Brand, type BrandedDoc,
} from './brand';
import {
  BODY_TOP, BODY_BOTTOM,
  paintLetterPage, renderPanelCover, runningFooter, sectionBand, subheading,
  paragraph, labelledParagraph, labelledHeight, withCurrencyPrefix,
} from './letterhead';
import type { EngagementProposalContent, ProposalBlock, ProposalPayment } from '@/lib/engagement-proposal/types';
import { formatProposalDate } from '@/lib/engagement-proposal/types';

const FOOTER_TEXT = 'Strictly Confidential — for the addressee named above';

/**
 * Re-prefix the amounts that arrive as content with the symbol this firm's
 * faces can print.
 *
 * The fee schedules bound behind the letter format every figure through
 * `peso()` at render time, so they always match the set. The letter's own
 * figures do not: the fee table and the filled scope lines were written when the
 * draft was made, and a partner may have typed one by hand. A firm that has
 * changed `branding.fontSet` since — or a proposal drafted before the prefix
 * followed the set at all — would print one prefix in the letter and the other
 * in Annex "A" of the same bound package.
 *
 * Only the prose and figure fields are walked. Names are deliberately left
 * alone: "P2 Logistics, Inc." is a client, not an amount.
 */
function inBrandCurrency(
  content: EngagementProposalContent,
  symbol: string,
): EngagementProposalContent {
  const fix = (text: string) => withCurrencyPrefix(text, symbol);
  const fixBlock = (block: ProposalBlock): ProposalBlock => {
    switch (block.kind) {
      case 'para':
      case 'subheading':
        return { ...block, text: fix(block.text) };
      case 'labelled':
        return { ...block, label: fix(block.label), text: fix(block.text) };
      case 'list':
        return { ...block, items: block.items.map(fix) };
      case 'feeTable':
        return {
          ...block,
          rows: block.rows.map((r) => ({ fee: fix(r.fee), amount: fix(r.amount), when: fix(r.when) })),
        };
    }
  };

  return {
    ...content,
    intro: content.intro.map(fix),
    sections: content.sections.map((s) => ({ ...s, blocks: s.blocks.map(fixBlock) })),
    closing: content.closing.map(fix),
    ...(content.payment ? { payment: { ...content.payment, note: fix(content.payment.note) } } : {}),
  };
}

/** Roughly three lines of body text, kept with a subheading across a break. */
const SUBHEADING_KEEP_WITH = 46;

/** Letterspaced caps — the stand-in for true small caps, which none of the
 *  curated body faces cut. */
function smallCaps(doc: BrandedDoc, text: string, x: number, y: number, opts: {
  size?: number; color?: string; bold?: boolean; spacing?: number; width?: number;
} = {}): number {
  doc.font(opts.bold === false ? FONT.body : FONT.bodyB)
    .fontSize(opts.size ?? 11)
    .fillColor(opts.color ?? doc.brand.palette.primary)
    .text(text.toUpperCase(), x, y, {
      characterSpacing: opts.spacing ?? 1.1,
      width: opts.width ?? CONTENT_W,
    });
  return doc.y;
}

// ── Cover ───────────────────────────────────────────────────────────
function renderCover(doc: BrandedDoc, content: EngagementProposalContent) {
  // The contact band is the proposal's own. lib/pdf/proposal-package.ts fills in
  // the firm's live block for a draft saved before the band became editable, so
  // by the time we render there is nothing left to stand in for.
  const contact = content.firmContact;
  renderPanelCover(doc, {
    titleLines: ['Engagement', 'Proposal'],
    kicker: 'Prepared for',
    subject: content.client.name,
    metaLines: [formatProposalDate(content.date), 'Strictly Confidential'],
    addressLines: contact?.addressLines ?? [],
    contactLines: [contact?.email, contact?.website, contact?.phone].filter((v): v is string => Boolean(v)),
  });
}

// ── Addressee block ─────────────────────────────────────────────────
const LABEL_W = 88;   // right-aligned label column
const COLON_W = 12;

/** One row of the borderless Attention / Subject grid. */
function addressRow(doc: BrandedDoc, label: string, value: string, y: number, secondLine?: string): number {
  const C = doc.brand.palette;
  doc.font(FONT.bodyB).fontSize(10.5).fillColor(C.ink)
    .text(label, M.left, y, { width: LABEL_W, align: 'right', lineBreak: false });
  doc.font(FONT.bodyB).fontSize(10.5).fillColor(C.ink)
    .text(':', M.left + LABEL_W, y, { width: COLON_W, align: 'center', lineBreak: false });
  const valueX = M.left + LABEL_W + COLON_W;
  const valueW = CONTENT_W - LABEL_W - COLON_W;
  doc.font(FONT.bodyB).fontSize(10.5).fillColor(C.ink).text(value, valueX, y, { width: valueW });
  let bottom = doc.y;
  if (secondLine) {
    doc.font(FONT.bodyIt).fontSize(10.5).fillColor(C.ink).text(secondLine, valueX, bottom, { width: valueW });
    bottom = doc.y;
  }
  return bottom;
}

// ── Blocks ──────────────────────────────────────────────────────────
function feeTable(doc: BrandedDoc, rows: { fee: string; amount: string; when: string }[], y: number): number {
  const C = doc.brand.palette;
  const widths = [CONTENT_W * 0.36, CONTENT_W * 0.22, CONTENT_W * 0.42];
  const padX = 8;
  const padY = 6;

  const headerH = 22;
  doc.rect(M.left, y, CONTENT_W, headerH).fill(C.primary);
  ['Fee', 'Amount', 'When billed'].forEach((label, i) => {
    const x = M.left + widths.slice(0, i).reduce((s, v) => s + v, 0);
    doc.font(FONT.bodyB).fontSize(8.6).fillColor(C.white)
      .text(label.toUpperCase(), x + padX, y + 6.5, {
        width: widths[i] - padX * 2, align: i === 0 ? 'left' : 'center', characterSpacing: 0.6,
      });
  });
  let cursor = y + headerH;

  rows.forEach((row) => {
    const cells = [row.fee, row.amount, row.when];
    const h = Math.max(
      22,
      ...cells.map((text, i) => {
        doc.font(i === 1 ? FONT.bodyB : FONT.body).fontSize(9.6);
        return doc.heightOfString(text, { width: widths[i] - padX * 2 }) + padY * 2;
      }),
    );
    doc.rect(M.left, cursor, CONTENT_W, h).fill(C.white);
    cells.forEach((text, i) => {
      const x = M.left + widths.slice(0, i).reduce((s, v) => s + v, 0);
      doc.font(i === 1 ? FONT.bodyB : FONT.body).fontSize(9.6).fillColor(i === 1 ? C.primary : C.ink)
        .text(text, x + padX, cursor + padY, { width: widths[i] - padX * 2, align: i === 1 ? 'center' : 'left' });
    });
    doc.save().lineWidth(0.4).strokeColor(C.hairline)
      .moveTo(M.left, cursor + h).lineTo(PAGE.w - M.right, cursor + h).stroke().restore();
    cursor += h;
  });

  doc.save().lineWidth(0.7).strokeColor(C.accentLine).rect(M.left, y, CONTENT_W, cursor - y).stroke().restore();
  return cursor + 14;
}

/** Rough height of a block, so a page break lands between blocks not inside one. */
function blockHeight(doc: BrandedDoc, block: ProposalBlock): number {
  switch (block.kind) {
    case 'subheading':
      doc.font(FONT.bodyB).fontSize(11);
      return doc.heightOfString(block.text.toUpperCase(), { width: CONTENT_W, characterSpacing: 1.2 }) + 12;
    case 'labelled':
      return labelledHeight(doc, block.label, block.text);
    case 'list':
      doc.font(FONT.body).fontSize(10.5);
      return block.items.reduce(
        (s, it) => s + doc.heightOfString(it, { width: CONTENT_W - 46, lineGap: 2 }) + 5,
        8,
      );
    case 'feeTable':
      return 22 + block.rows.length * 26 + 14;
    default:
      doc.font(FONT.body).fontSize(10.5);
      return doc.heightOfString(block.text, { width: CONTENT_W, align: 'justify', lineGap: 2 }) + 10;
  }
}

function drawBlock(doc: BrandedDoc, block: ProposalBlock, y: number): number {
  const C = doc.brand.palette;
  switch (block.kind) {
    case 'subheading':
      return subheading(doc, block.text, y);
    case 'labelled':
      return labelledParagraph(doc, block.label, block.text, y, { italicLabel: true });
    case 'list': {
      let cursor = y;
      block.items.forEach((item, i) => {
        const marker = block.ordered ? `${i + 1})` : '·';
        doc.font(FONT.body).fontSize(10.5).fillColor(C.primary)
          .text(marker, M.left + 22, cursor, { width: 20, align: 'right', lineBreak: false });
        doc.font(FONT.body).fontSize(10.5).fillColor(C.ink)
          .text(item, M.left + 48, cursor, { width: CONTENT_W - 48, lineGap: 2 });
        cursor = doc.y + 5;
      });
      return cursor + 6;
    }
    case 'feeTable':
      return feeTable(doc, block.rows, y);
    default:
      return paragraph(doc, block.text, y);
  }
}

// ── Signature and conforme ──────────────────────────────────────────
const SIGNATURE_BLOCK_H = 300;

function renderSignature(doc: BrandedDoc, content: EngagementProposalContent, y: number): number {
  const C = doc.brand.palette;
  let cursor = y;

  doc.font(FONT.body).fontSize(10.5).fillColor(C.ink).text('Very truly yours,', M.left, cursor);
  doc.font(FONT.body).fontSize(10.5).fillColor(C.ink).text('For the Firm:', M.left, doc.y + 1);
  cursor = doc.y + 16;

  cursor = smallCaps(doc, doc.brand.documentName, M.left, cursor, { size: 12, spacing: 1.4 });
  cursor += 42; // room for a wet signature

  doc.font(FONT.bodyB).fontSize(11.5).fillColor(C.ink)
    .text(content.signer.name.toUpperCase(), M.left, cursor, { characterSpacing: 0.4 });
  doc.font(FONT.bodyIt).fontSize(10.5).fillColor(C.ink).text(content.signer.position, M.left, doc.y + 1);
  cursor = doc.y + 26;

  cursor = smallCaps(doc, 'Conforme:', M.left, cursor, { size: 11, spacing: 1.1 });
  cursor += 10;

  // A corporation binds itself through the entity, with the officer signing for
  // it — never the officer's name alone above the line.
  if (content.client.isCorporate) {
    cursor = smallCaps(doc, content.client.name, M.left, cursor, { size: 11.5, spacing: 1.2 });
    doc.font(FONT.body).fontSize(10.5).fillColor(C.ink).text('By:', M.left, cursor + 2);
    cursor = doc.y + 30;
  } else {
    cursor += 24;
  }

  doc.save().lineWidth(0.8).strokeColor(C.ink)
    .moveTo(M.left, cursor).lineTo(M.left + 230, cursor).stroke().restore();
  cursor += 4;

  if (content.client.attnName) {
    doc.font(FONT.bodyB).fontSize(10.5).fillColor(C.ink).text(content.client.attnName, M.left, cursor);
    cursor = doc.y;
    if (content.client.attnTitle) {
      doc.font(FONT.body).fontSize(10.5).fillColor(C.ink).text(content.client.attnTitle, M.left, cursor);
      cursor = doc.y;
    }
  }

  cursor += 10;
  doc.font(FONT.body).fontSize(10.5).fillColor(C.ink).text('Date:', M.left, cursor, { lineBreak: false });
  doc.save().lineWidth(0.8).strokeColor(C.ink)
    .moveTo(M.left + 38, cursor + 11).lineTo(M.left + 230, cursor + 11).stroke().restore();
  return cursor + 24;
}

/** The line naming what is bound behind the letter. */
function renderAnnexNote(doc: BrandedDoc, annexLabels: string[], y: number) {
  const C = doc.brand.palette;
  if (!annexLabels.length) return;
  doc.save().lineWidth(0.5).strokeColor(C.hairline)
    .moveTo(M.left, y).lineTo(PAGE.w - M.right, y).stroke().restore();
  doc.font(FONT.bodyIt).fontSize(8.8).fillColor(C.accent)
    .text('Annexes — attached to and forming an integral part of this proposal:', M.left, y + 7);
  doc.font(FONT.bodyIt).fontSize(8.8).fillColor(C.accent)
    .text(annexLabels.join('     ·     '), M.left, doc.y + 2);
}

// ── Entry point ─────────────────────────────────────────────────────
/**
 * The account the client pays into, set as a label/value block under a section
 * band of its own. It is the last numbered section and it is always present:
 * a client who has just signed should not have to ask where to send the money.
 */
function paymentSection(doc: BrandedDoc, index: number, payment: ProposalPayment, y: number): number {
  const C = doc.brand.palette;
  let cursor = sectionBand(doc, index, 'Payment Details', y);

  cursor = paragraph(
    doc,
    'Fees and reimbursable expenses are payable to the Firm by deposit or transfer to the account below. '
    + 'Kindly indicate the invoice number on the transfer and send proof of payment to the Firm.',
    cursor,
  );

  const rows: [string, string][] = [
    ['Bank', payment.bankName],
    ['Account name', payment.accountName],
    ['Account number', payment.accountNo],
    ['TIN', payment.tin],
  ].filter((r): r is [string, string] => Boolean(r[1]?.trim()));

  const LABEL = 110;
  for (const [label, value] of rows) {
    doc.font(FONT.body).fontSize(10.5).fillColor(C.inkSoft)
      .text(label, M.left, cursor, { width: LABEL, lineBreak: false });
    doc.font(FONT.bodyB).fontSize(10.5).fillColor(C.ink)
      .text(value, M.left + LABEL, cursor, { width: CONTENT_W - LABEL });
    cursor = doc.y + 3;
  }

  if (payment.note.trim()) cursor = paragraph(doc, payment.note, cursor + 5);

  return cursor + 6;
}

/** Height of the payment block, so it is never split across a page break. */
function paymentHeight(payment: ProposalPayment): number {
  const rows = [payment.bankName, payment.accountName, payment.accountNo, payment.tin]
    .filter((v) => v?.trim()).length;
  return 130 + rows * 17 + (payment.note.trim() ? 40 : 0);
}

export interface ProposalRenderOptions {
  /** Annex captions for the closing note, e.g. ['Annex "A" — Schedule of Fees']. */
  annexLabels?: string[];
}

export function generateEngagementProposalPdf(
  brand: Brand,
  stored: EngagementProposalContent,
  opts: ProposalRenderOptions = {},
): Promise<Buffer> {
  const content = inBrandCurrency(stored, brand.pesoSymbol);
  const doc = brandedDocument(brand, {
    bufferPages: true,
    info: {
      Title: content.subject,
      Author: brand.documentName,
      Subject: 'Engagement Proposal',
    },
  });

  return collect(doc, () => {
    renderCover(doc, content);

    const newPage = (): number => {
      doc.addPage();
      return paintLetterPage(doc, 'Engagement Proposal');
    };

    const C = brand.palette;
    let y = newPage();

    // Privilege line, date, addressee.
    y = smallCaps(doc, content.privilegeLine, M.left, y, { size: 10.5, color: C.ink, spacing: 1 }) + 16;
    doc.font(FONT.body).fontSize(10.5).fillColor(C.ink).text(formatProposalDate(content.date), M.left, y);
    y = doc.y + 18;

    y = smallCaps(doc, content.client.name, M.left, y, { size: 11.5, color: C.ink, spacing: 1.2 }) + 12;

    if (content.client.attnName) {
      y = addressRow(doc, 'Attention', content.client.attnName, y, content.client.attnTitle || undefined) + 8;
    }
    y = addressRow(doc, 'Subject', content.subject, y) + 16;

    doc.font(FONT.body).fontSize(10.5).fillColor(C.ink).text(content.salutation, M.left, y);
    y = doc.y + 12;

    for (const para of content.intro) y = paragraph(doc, para, y);

    content.sections.forEach((section, i) => {
      // Never strand a section band at the foot of a page.
      if (y + 90 > BODY_BOTTOM) y = newPage();
      y = sectionBand(doc, i + 1, section.heading, y);
      for (const block of section.blocks) {
        // A subheading is a label for what follows it; alone at the foot of a
        // page it reads as a heading whose clause went missing. Claim room for
        // the opening lines of the block it introduces, not just for itself.
        const h = blockHeight(doc, block) + (block.kind === 'subheading' ? SUBHEADING_KEEP_WITH : 0);
        // Break before a block that won't fit, unless it is taller than a whole
        // page — then let it flow and split naturally.
        if (y + h > BODY_BOTTOM && h < BODY_BOTTOM - BODY_TOP) y = newPage();
        y = drawBlock(doc, block, y);
      }
      y += 4;
    });

    // A draft saved before the section existed carries no block of its own;
    // lib/pdf/proposal-package.ts fills the firm's current one in beforehand.
    if (content.payment) {
      if (y + paymentHeight(content.payment) > BODY_BOTTOM) y = newPage();
      y = paymentSection(doc, content.sections.length + 1, content.payment, y);
    }

    for (const para of content.closing) {
      const h = blockHeight(doc, { kind: 'para', text: para });
      if (y + h > BODY_BOTTOM) y = newPage();
      y = paragraph(doc, para, y);
    }

    // The signature and conforme must not be split across a page break — a
    // conforme orphaned from the firm's own block reads as an unsigned page.
    if (y + SIGNATURE_BLOCK_H > BODY_BOTTOM) y = newPage();
    y = renderSignature(doc, content, y + 6);

    const labels = opts.annexLabels ?? [];
    if (labels.length) {
      if (y + 40 > BODY_BOTTOM) y = newPage();
      renderAnnexNote(doc, labels, y);
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start + 1; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      runningFooter(doc, FOOTER_TEXT, i);
    }
  });
}
