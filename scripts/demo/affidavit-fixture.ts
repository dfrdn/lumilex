import PDFDocument from 'pdfkit';
import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx';

/**
 * A judicial affidavit written to exercise the affidavit checker.
 *
 * It is deliberately defective. Each Q&A is written to trigger a specific
 * objection type from lib/ai/affidavit-review.ts, and the affidavit omits the
 * A.M. No. 12-8-8-SC formalities (statement of purpose, the Sec. 4 lawyer's
 * attestation, the jurat, the false-testimony reminder) so the
 * `ja_rule_defect` path has something to find. A few questions are clean on
 * purpose — a checker that flags everything is as useless as one that flags
 * nothing. `intended` is the grading key and is never rendered.
 *
 * Entirely fictional: invented parties, invented facts, invented docket. It is
 * attached to the collection case's Judicial Affidavit deliverable by
 * scripts/demo/content.ts so it shows in the checker's picker without an upload.
 */

export interface FixtureParties {
  court: string;
  plaintiff: string;
  defendant: string;
  docket: string;
  nature: string;
  counsel: string;
}

export const FIXTURE_AFFIANT = 'ANA MARIE B. BERNARDO';

interface QA {
  q: string;
  a: string;
  intended: string[];
}

const QA_ITEMS: QA[] = [
  {
    q: 'Please state your name, age, civil status, and residence.',
    a: 'I am Ana Marie B. Bernardo, 41 years old, married, and a resident of No. 24 Sampaguita Street, Barangay Poblacion, Makati City.',
    intended: [],
  },
  {
    q: 'You are the Finance Head of Luntian Harbor Logistics Corporation, are you not?',
    a: 'Yes, sir.',
    intended: ['leading'],
  },
  {
    q: 'Please tell the Honorable Court everything you know about this case, from the beginning up to the present.',
    a: 'Well, it started sometime in 2023 when we began dealing with Dapithapon Freight, and there were many shipments, and then payments became irregular, and eventually we had to elevate the matter, and there were meetings, and it went on for months until we decided to file this case.',
    intended: ['narrative'],
  },
  {
    q: 'What are your duties as Finance Head?',
    a: 'I supervise billing, collections, and the reconciliation of accounts with our counterparties.',
    intended: [],
  },
  {
    q: 'When you discovered that Dapithapon Freight deliberately concealed its insolvency from your company, what did you do?',
    a: 'I immediately escalated the matter to our President.',
    intended: ['assumes_facts', 'misleading'],
  },
  {
    q: 'What did you learn about the defendant’s financial condition?',
    a: 'My supervisor, Mr. Carlo Ybañez, told me that Dapithapon Freight had already been sued by three other creditors and that its bank accounts had been garnished.',
    intended: ['hearsay'],
  },
  {
    q: 'In your opinion, was the defendant negligent, and did it act in bad faith?',
    a: 'Yes, it was clearly negligent and it acted in evident bad faith.',
    intended: ['opinion', 'compound'],
  },
  {
    q: 'What does the Statement of Account dated 15 January 2025 say the defendant owes?',
    a: 'It states that the defendant owes PHP 4,382,500.00 exclusive of interest. I do not have the original with me; I am recalling it from memory.',
    intended: ['original_document'],
  },
  {
    q: 'Why do you think the defendant refused to pay?',
    a: 'I believe they were planning to close down the company and avoid their obligations.',
    intended: ['speculation'],
  },
  {
    q: 'Wouldn’t you agree that the defendant’s conduct was plainly dishonest and deserving of exemplary damages?',
    a: 'Yes, I agree.',
    intended: ['argumentative', 'leading'],
  },
  {
    q: 'Again, what are your duties as Finance Head of the plaintiff corporation?',
    a: 'As I said, I supervise billing, collections, and account reconciliation.',
    intended: ['asked_answered'],
  },
  {
    q: 'Where were you on 12 March 2025, what were you doing at that time, and who was with you?',
    a: 'I was in our Makati office reviewing the aging report, together with our accounting staff.',
    intended: ['compound'],
  },
  {
    q: 'Describe the arrangement.',
    a: 'It was the usual arrangement we had with them.',
    intended: ['vague'],
  },
  {
    q: 'The written Master Services Agreement provides for payment within thirty (30) days. Was there any other agreement on the payment period?',
    a: 'Yes. Although the signed contract says thirty days, we verbally agreed with their operations manager that they could pay within ninety days.',
    intended: ['parol_evidence'],
  },
  {
    q: 'What did your lawyer, Atty. Salazar, advise you regarding the filing of this case?',
    a: 'He told me that our documentary evidence on the last two invoices was weak, but that we should file anyway to pressure them into settling.',
    intended: ['privilege'],
  },
  {
    q: 'How much did the defendant’s president spend on his daughter’s wedding last year?',
    a: 'I heard it cost around three million pesos.',
    intended: ['relevance', 'hearsay'],
  },
  {
    q: 'What was the exact outstanding balance as of 31 December 2024?',
    a: 'PHP 4,180,000.00. I did not personally prepare or review the ledger for that period — that was handled by our previous accountant who has since resigned.',
    intended: ['foundation', 'incompetent'],
  },
  {
    q: 'Please tell the Court about the defendant’s prior conviction for estafa in 2015.',
    a: 'I understand its former treasurer was convicted of estafa involving another client.',
    intended: ['relevance', 'hearsay'],
  },
  {
    q: 'Do you recognize the Delivery Receipt marked as Exhibit "C"?',
    a: 'Yes. It bears my initials on the lower right corner, which I affixed when I verified the delivery against our records on 3 April 2024.',
    intended: [],
  },
  {
    q: 'What did the defendant say when you made a demand for payment on 20 May 2025?',
    a: 'Their Finance Officer, Ms. Rivera, told me on the phone that they acknowledged the balance but could not pay it that month.',
    intended: [],
  },
];

/** What the checker ought to catch, by objection type → question numbers. */
export function fixtureGradingKey(): Map<string, number[]> {
  const key = new Map<string, number[]>();
  QA_ITEMS.forEach((item, i) => {
    for (const t of item.intended) key.set(t, [...(key.get(t) ?? []), i + 1]);
  });
  return key;
}

function captionLines(p: FixtureParties): string[] {
  return [
    `${p.plaintiff.toUpperCase()},`,
    '                    Plaintiff,',
    '',
    '        - versus -',
    '',
    `${p.defendant.toUpperCase()},`,
    '                    Defendant.',
  ];
}

const OPENING =
  `I, ${FIXTURE_AFFIANT}, of legal age, Filipino, married, and with office address at 12/F Luntian Harbor Centre, 1450 Kalayaan Avenue, Makati City, after being duly sworn, depose and state:`;
const EXAMINATION = (p: FixtureParties) =>
  `That the examination was conducted by Atty. ${p.counsel} at the offices of counsel; and that the following are the questions propounded to me and my answers thereto:`;
const WITNESS_CLAUSE = 'IN WITNESS WHEREOF, I have hereunto set my hand this ____ day of ____________, at Makati City.';

export function renderFixtureDocx(p: FixtureParties): Promise<Buffer> {
  const F = 'Times New Roman';
  const P = (text: string, opts: { bold?: boolean; center?: boolean; size?: number } = {}) =>
    new Paragraph({
      alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [new TextRun({ text, bold: opts.bold, font: F, size: opts.size ?? 22 })],
    });
  const out: Paragraph[] = [
    P('Republic of the Philippines', { center: true }),
    P(p.court.toUpperCase(), { center: true, bold: true }),
    P(''),
    ...captionLines(p).map((l) => P(l)),
    P(''),
    P(p.docket),
    P(p.nature),
    P('x - - - - - - - - - - - - - - - - - - - - - - - - - - - x'),
    P(''),
    P(`JUDICIAL AFFIDAVIT OF ${FIXTURE_AFFIANT}`, { center: true, bold: true, size: 24 }),
    P(''),
    P(OPENING),
    P(''),
    P(EXAMINATION(p)),
    P(''),
  ];
  QA_ITEMS.forEach((item, i) => {
    out.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      children: [new TextRun({ text: `Q${i + 1}. `, bold: true, font: F, size: 22 }), new TextRun({ text: item.q, font: F, size: 22 })],
    }));
    out.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 160 },
      children: [new TextRun({ text: `A${i + 1}. `, bold: true, font: F, size: 22 }), new TextRun({ text: item.a, font: F, size: 22 })],
    }));
  });
  out.push(P(''), P(WITNESS_CLAUSE), P(''), P(''), P(FIXTURE_AFFIANT, { bold: true, center: true }), P('Affiant', { center: true }));
  // No jurat, no Sec. 4 attestation, no statement of purpose — intentional.
  return Packer.toBuffer(new Document({ sections: [{ children: out }] }));
}

export function renderFixturePdf(p: FixtureParties): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'LEGAL', margins: { top: 72, bottom: 72, left: 90, right: 72 } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const width = doc.page.width - 90 - 72;

  doc.font('Times-Roman').fontSize(11);
  doc.text('Republic of the Philippines', { align: 'center' });
  doc.font('Times-Bold').text(p.court.toUpperCase(), { align: 'center' });
  doc.font('Times-Roman').moveDown(1);
  const top = doc.y;
  doc.text(captionLines(p).join('\n'), 90, top, { width: width * 0.55 });
  const bottom = doc.y;
  doc.text(`${p.docket}\n${p.nature}`, 90 + width * 0.62, top, { width: width * 0.38 });
  doc.y = Math.max(bottom, doc.y);
  doc.x = 90;
  doc.moveDown(0.4);
  doc.moveTo(90, doc.y).lineTo(90 + width, doc.y).stroke();
  doc.moveDown(1);
  doc.font('Times-Bold').fontSize(12).text(`JUDICIAL AFFIDAVIT OF ${FIXTURE_AFFIANT}`, { align: 'center' });
  doc.font('Times-Roman').fontSize(11).moveDown(1);
  doc.text(OPENING, { align: 'justify', lineGap: 3, paragraphGap: 8, indent: 28 });
  doc.text(EXAMINATION(p), { align: 'justify', lineGap: 3, paragraphGap: 10, indent: 28 });
  QA_ITEMS.forEach((item, i) => {
    doc.font('Times-Bold').text(`Q${i + 1}. `, { continued: true, indent: 28 });
    doc.font('Times-Roman').text(item.q, { align: 'justify', lineGap: 2 });
    doc.font('Times-Bold').text(`A${i + 1}. `, { continued: true, indent: 28 });
    doc.font('Times-Roman').text(item.a, { align: 'justify', lineGap: 2, paragraphGap: 9 });
  });
  doc.moveDown(1);
  doc.text(WITNESS_CLAUSE, { align: 'justify', indent: 28 });
  doc.moveDown(2);
  doc.font('Times-Bold').text(FIXTURE_AFFIANT, { align: 'center' });
  doc.font('Times-Roman').text('Affiant', { align: 'center' });
  doc.end();
  return done;
}
