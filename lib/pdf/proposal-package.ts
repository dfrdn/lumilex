/**
 * Binds an engagement proposal into the single PDF the client receives:
 *
 *   proposal letter
 *   → Annex "A" divider → each selected fee schedule
 *   → Annex "B" divider → the firm profile
 *
 * The annexes are generated at assembly time from the live `fee_schedules` and
 * `firm_profiles` rows rather than stored alongside the proposal, so a package
 * downloaded today carries today's rate card and today's firm profile. A
 * proposal already sent keeps its own PDF in storage; regenerating produces a
 * current one, which is the intended behaviour for an unsent draft.
 */

import { PDFDocument } from 'pdf-lib';
import {
  PAGE, M, CONTENT_W, FONT,
  brandedDocument, drawMark, keyline, collect, type Brand, type BrandedDoc,
} from './brand';
import { loadFirmBrand } from './firm-brand';
import { generateEngagementProposalPdf } from './engagement-proposal';
import { generateFeeSchedulePdf } from './fee-schedule';
import { generateFirmProfilePdf } from './firm-profile';
import { loadFeeSchedules } from '@/lib/fee-schedule/load';
import { loadFirmProfile, loadPaymentDetails } from '@/lib/firm-profile/load';
import type { EngagementProposalContent } from '@/lib/engagement-proposal/types';
import { formatProposalDate } from '@/lib/engagement-proposal/types';

/**
 * A divider page announcing the annex that follows: cream field, gold rule,
 * the annex letter in navy caps, its subtitle in gold, and an italic reference
 * line tying the annex back to the proposal it belongs to.
 */
function renderDivider(doc: BrandedDoc, letter: string, subtitle: string, reference: string) {
  const C = doc.brand.palette;
  // The same tinted field and accent keyline the interior pages carry, minus the
  // running header — a divider announces, it doesn't continue.
  doc.rect(0, 0, PAGE.w, PAGE.h).fill(C.surface);
  keyline(doc, C.accentLine);

  const midY = PAGE.h * 0.38;
  drawMark(doc, PAGE.w / 2, midY - 78, 40);

  doc.save().lineWidth(1.2).strokeColor(C.accent)
    .moveTo(PAGE.w / 2 - 40, midY - 16).lineTo(PAGE.w / 2 + 40, midY - 16).stroke().restore();

  doc.font(FONT.dispSb).fontSize(30).fillColor(C.primaryDeep)
    .text(`ANNEX “${letter}”`, M.left, midY, { width: CONTENT_W, align: 'center', characterSpacing: 4 });

  doc.font(FONT.disp).fontSize(15).fillColor(C.accent)
    .text(subtitle, M.left, doc.y + 12, { width: CONTENT_W, align: 'center', characterSpacing: 1.6 });

  doc.font(FONT.bodyIt).fontSize(9.5).fillColor(C.inkMuted)
    .text(reference, M.left + 60, doc.y + 28, { width: CONTENT_W - 120, align: 'center' });
}

function dividerPdf(brand: Brand, letter: string, subtitle: string, reference: string): Promise<Buffer> {
  const doc = brandedDocument(brand, {
    info: { Title: `Annex "${letter}" — ${subtitle}`, Author: brand.documentName },
  });
  return collect(doc, () => {
    renderDivider(doc, letter, subtitle, reference);
  });
}

async function mergePdfs(parts: Buffer[]): Promise<Buffer> {
  const merged = await PDFDocument.create();
  for (const part of parts) {
    const src = await PDFDocument.load(part);
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return Buffer.from(await merged.save());
}

export interface ProposalPackage {
  buffer: Buffer;
  /** Annex captions, in bound order — also printed on the letter's closing note. */
  annexLabels: string[];
  /** Schedule slugs that were requested but no longer exist. */
  missingSlugs: string[];
}

/**
 * Assemble the full package. `letterOnly` skips the annexes, for the preview a
 * drafter looks at while editing.
 */
export async function buildProposalPackage(
  firmId: string,
  content: EngagementProposalContent,
  opts: { letterOnly?: boolean } = {},
): Promise<ProposalPackage> {
  const reference = `${content.client.name} — Engagement Proposal dated ${formatProposalDate(content.date)}`;

  // One kit for the whole package: the letter, every schedule bound behind it,
  // the dividers, and the profile all render from the same resolved brand.
  const brand = await loadFirmBrand(firmId);

  // The cover band and the payment section are the proposal's own, so a
  // drafter's edit prints. Only a draft that predates either field borrows the
  // firm's current one — a letter is never sent without somewhere to pay.
  const profile = content.firmContact ? null : await loadFirmProfile(firmId);
  const letter: EngagementProposalContent = {
    ...content,
    ...(profile
      ? {
          firmContact: {
            addressLines: profile.contact.addressLines,
            phone: profile.contact.phone,
            email: profile.contact.email,
            website: profile.contact.website,
          },
        }
      : {}),
    ...(content.payment ? {} : { payment: await loadPaymentDetails(firmId) }),
  };

  if (opts.letterOnly) {
    return { buffer: await generateEngagementProposalPdf(brand, letter), annexLabels: [], missingSlugs: [] };
  }

  // Only a proposal that asks for a fee annex needs the rate card, and the
  // loader throws for a firm that has published none — so loading it up front
  // would fail a profile-only package that never quotes a figure.
  const wanted = content.annexes.feeScheduleSlugs;
  const available = wanted.length > 0 ? await loadFeeSchedules(firmId) : [];
  const schedules = wanted
    .map((slug) => available.find((s) => s.slug === slug))
    .filter((s): s is NonNullable<typeof s> => !!s);
  const missingSlugs = wanted.filter((slug) => !available.some((s) => s.slug === slug));

  const annexLabels: string[] = [];
  if (schedules.length) {
    annexLabels.push(`Annex “A” — ${schedules.length > 1 ? 'Schedules of Fees' : 'Schedule of Fees'}`);
  }
  if (content.annexes.includeFirmProfile) {
    annexLabels.push(`Annex “${schedules.length ? 'B' : 'A'}” — Firm Profile`);
  }

  // The letter is rendered last-but-first: it needs the annex labels that only
  // the assembly step knows.
  const parts: Buffer[] = [await generateEngagementProposalPdf(brand, letter, { annexLabels })];

  if (schedules.length) {
    const subtitle = schedules.length > 1 ? 'Schedules of Fees' : 'Schedule of Fees';
    parts.push(await dividerPdf(brand, 'A', subtitle, reference));
    for (const schedule of schedules) {
      parts.push(await generateFeeSchedulePdf(brand, schedule.content));
    }
  }

  if (content.annexes.includeFirmProfile) {
    parts.push(await dividerPdf(brand, schedules.length ? 'B' : 'A', 'Firm Profile', reference));
    parts.push(await generateFirmProfilePdf(brand, profile ?? (await loadFirmProfile(firmId))));
  }

  return { buffer: await mergePdfs(parts), annexLabels, missingSlugs };
}
