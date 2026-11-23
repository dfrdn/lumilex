/**
 * Seeds 6 sample invoices — one per billing type — into the live DB so the
 * finance UI can be exercised end-to-end (preview letter / breakdown PDF /
 * XLSX, regenerate, send, etc.).
 *
 * Tagged with a "[TEST]" client_name prefix so they're easy to spot and a
 * single DELETE cleans them up:
 *   DELETE FROM invoices WHERE client_name LIKE '[TEST]%';
 *
 * Run:  npx tsx scripts/seed-test-invoices.ts
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { generateBillingBreakdownPdf } from '../lib/pdf/billing-breakdown';
import { generateBillingLetterDocx } from '../lib/docx/billing-letter';
import { splitLineItemsAtCap } from '../lib/billing/cap-split';
import { loadFirmBrand } from '../lib/pdf/firm-brand';

// ── Load env ────────────────────────────────────────────────────────
const envContent = readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (match) {
    const [, k, v] = match;
    process.env[k] = v.replace(/^["']|["']$/g, '');
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** Which firm's brand the seeded documents render in. */
const FIRM_ID = process.env.SEED_FIRM_ID ?? '00000000-0000-4000-8000-000000000001';

const month = '2026-04';
const monthDisplay = 'April 2026';

const firm = {
  firmAddress: '123 Sample Street, Sample District',
  firmAddress2: 'NCR Fourth District Philippines',
  firmTIN: 'VAT Reg. TIN: 000-000-000-00000',
  billingPeriod: monthDisplay,
  includeVAT: true,
  vatRate: 0.12,
};

const commonExpenses = [
  { date: '2026-04-12', description: 'Filing fees — Regional Trial Court submission', amount: 3200 },
  { date: '2026-04-19', description: 'Photocopying — court pleadings and supporting documents', amount: 1800, photocopyDetail: { costPerPage: 2, numberOfSets: 4, pagesPerSet: 225, totalCopies: 900 } },
  { date: '2026-04-25', description: 'Notarial fees — verified pleadings', amount: 750 },
  { date: '2026-04-28', description: 'Transportation — court appearances', amount: 1450 },
];

const dtrEntries = [
  {
    lawyerName: 'Maria Santos', position: 'Managing Partner', hourlyRate: 8000,
    entries: [
      { date: '2026-04-08', remarks: 'Initial client meeting and case strategy session', decimalHours: 1.5 },
      { date: '2026-04-14', remarks: 'Drafting of complaint and supporting affidavits', decimalHours: 3.0 },
      { date: '2026-04-22', remarks: 'Court appearance — pre-trial conference', decimalHours: 2.0 },
    ],
  },
  {
    lawyerName: 'Jose Reyes', position: 'Partner', hourlyRate: 6000,
    entries: [
      { date: '2026-04-10', remarks: 'Legal research on procedural matters and applicable jurisprudence', decimalHours: 2.5 },
      { date: '2026-04-21', remarks: 'Review and revise complaint draft, finalize attachments', decimalHours: 1.5 },
    ],
  },
  {
    lawyerName: 'Ana Mendoza', position: 'Senior Associate', hourlyRate: 4500,
    entries: [
      { date: '2026-04-15', remarks: 'Review of documentary evidence and preparation of exhibit list', decimalHours: 4.0 },
      { date: '2026-04-26', remarks: 'Drafting of memorandum on jurisdictional issues', decimalHours: 3.5 },
    ],
  },
];

const buildLawyerBlocks = (items: typeof dtrEntries) =>
  items.map((l) => ({
    name: l.lawyerName,
    position: l.position,
    entries: l.entries.map((e) => ({
      date: e.date,
      hours: e.decimalHours,
      description: e.remarks,
      hourlyRate: l.hourlyRate,
    })),
  }));

// Lawyer-grouped lineItems shape that persists into invoices.line_items.
const buildLineItems = (items: typeof dtrEntries) =>
  items.map((l) => ({
    lawyerName: l.lawyerName,
    position: l.position,
    hourlyRate: l.hourlyRate,
    totalHours: l.entries.reduce((s, e) => s + e.decimalHours, 0),
    amount: l.entries.reduce((s, e) => s + e.decimalHours * l.hourlyRate, 0),
    entries: l.entries.map((e) => ({
      rawDtrId: null,
      date: e.date,
      remarks: e.remarks,
      task: '',
      hours: Math.floor(e.decimalHours),
      minutes: Math.round((e.decimalHours - Math.floor(e.decimalHours)) * 60),
      decimalHours: e.decimalHours,
      matterId: null,
    })),
  }));

const breakdownExpenses = commonExpenses.map((e) => ({
  date: e.date,
  description: e.description,
  amount: e.amount,
  photocopyDetail: 'photocopyDetail' in e ? e.photocopyDetail : undefined,
}));

const expenseItems = commonExpenses.map((e) => ({
  id: `test-exp-${Math.random().toString(36).slice(2, 10)}`,
  date: e.date,
  category: '',
  expense: e.description,
  amount: e.amount,
  matterName: null,
  source: 'reimbursement' as const,
}));

interface Scenario {
  label: string;            // human-readable for logs
  invoiceNumber: string;    // unique
  clientName: string;       // "[TEST] …" so it sorts to the top & is recognizable
  monthlyRetainer: number;
  retainerHoursCap: number | null;
  acceptanceFees: { clientOrMatter: string; caseDescription: string; amount: number }[];
  lineItems: ReturnType<typeof buildLineItems>;
  feeLines: Array<{ kind: 'fixed_fee' | 'action' | 'milestone' | 'informational_hours'; matterId: string | null; matterName: string | null; description: string; amount: number; quantity?: number; sourceIds?: number[] }>;
}

const scenarios: Scenario[] = [
  // 1. LITIGATION
  {
    label: 'Litigation',
    invoiceNumber: 'TEST-LIT-2026-04',
    clientName: '[TEST] Litigation — Dela Cruz & Ramos',
    monthlyRetainer: 0,
    retainerHoursCap: null,
    acceptanceFees: [
      { clientOrMatter: 'NLRC Case — Wrongful Termination', caseDescription: 'Dela Cruz & Ramos v. Acme Builders Corp.', amount: 100000 },
    ],
    lineItems: buildLineItems(dtrEntries),
    feeLines: [],
  },
  // 2. RETAINER
  {
    label: 'Retainer (cap 10h)',
    invoiceNumber: 'TEST-RET-2026-04',
    clientName: '[TEST] Retainer — Northwind Power Inc.',
    monthlyRetainer: 20000,
    retainerHoursCap: 10,
    acceptanceFees: [],
    lineItems: buildLineItems(dtrEntries),
    feeLines: [],
  },
  // 3. FIXED RETAINER
  {
    label: 'Fixed Retainer',
    invoiceNumber: 'TEST-FRT-2026-04',
    clientName: '[TEST] Fixed Retainer — Bright Skin Clinics (BSC)',
    monthlyRetainer: 50000,
    retainerHoursCap: null,
    acceptanceFees: [],
    lineItems: [],
    feeLines: [
      { kind: 'informational_hours', matterId: null, matterName: 'BSC General Counsel', description: '12.5 hrs rendered (absorbed by fixed retainer)', amount: 0 },
    ],
  },
  // 4. FIXED FEE
  {
    label: 'Fixed Fee',
    invoiceNumber: 'TEST-FF-2026-04',
    clientName: '[TEST] Fixed Fee — Acme Innovations, Inc.',
    monthlyRetainer: 0,
    retainerHoursCap: null,
    acceptanceFees: [],
    lineItems: [],
    feeLines: [
      { kind: 'fixed_fee', matterId: null, matterName: 'Incorporation — Acme Innovations, Inc.', description: 'Fixed Engagement Fee', amount: 75000 },
    ],
  },
  // 5. ACCEPTANCE + PER ACTION
  {
    label: 'Acceptance + Per Action',
    invoiceNumber: 'TEST-ACT-2026-04',
    clientName: '[TEST] Per Action — Acme Builders Corp.',
    monthlyRetainer: 0,
    retainerHoursCap: null,
    acceptanceFees: [
      { clientOrMatter: 'Sps. Reyes v. Acme Builders — RTC Civil Case', caseDescription: '', amount: 40000 },
    ],
    lineItems: [],
    feeLines: [
      { kind: 'action', matterId: null, matterName: 'Sps. Reyes v. Acme Builders', description: 'Court Appearance (appearance) × 3 of 4 cap', amount: 15000, quantity: 3 },
      { kind: 'action', matterId: null, matterName: 'Sps. Reyes v. Acme Builders', description: 'Pleading Page (page) × 18', amount: 9000, quantity: 18 },
      { kind: 'action', matterId: null, matterName: 'Sps. Reyes v. Acme Builders', description: 'Client Meeting (meeting) × 2', amount: 6000, quantity: 2 },
    ],
  },
  // 6. ACCEPTANCE + PER MILESTONE
  {
    label: 'Acceptance + Per Milestone',
    invoiceNumber: 'TEST-MS-2026-04',
    clientName: '[TEST] Per Milestone — Riverside Ambulatory Surgical Center',
    monthlyRetainer: 0,
    retainerHoursCap: null,
    acceptanceFees: [
      { clientOrMatter: 'Incorporation — BASC, Inc.', caseDescription: '', amount: 30000 },
    ],
    lineItems: [],
    feeLines: [
      { kind: 'milestone', matterId: null, matterName: 'Incorporation — BASC, Inc.', description: 'Milestone — Filing of SEC Forms', amount: 15000 },
      { kind: 'milestone', matterId: null, matterName: 'Incorporation — BASC, Inc.', description: 'Milestone — Receipt of Certificate of Incorporation', amount: 20000 },
    ],
  },
];

async function seedOne(s: Scenario) {
  // Apply cap-split for retainer scenarios
  const { within, beyond } = splitLineItemsAtCap(s.lineItems, s.retainerHoursCap);

  // Build the breakdown params
  const breakdownParams = {
    ...firm,
    monthlyRetainer: s.monthlyRetainer,
    acceptanceFees: s.acceptanceFees,
    withinRetainer: within,
    beyondRetainer: beyond,
    expenses: breakdownExpenses,
    previousBalance: 0,
    feeLines: s.feeLines.map((f) => ({
      kind: f.kind,
      matterName: f.matterName,
      description: f.description,
      amount: f.amount,
      quantity: f.quantity,
    })),
  };

  // Totals — mirror the math in computeTotalLegalFees
  const sumBlocks = (b: typeof within) => b.reduce((s, x) => s + x.entries.reduce((s2, e) => s2 + e.hours * e.hourlyRate, 0), 0);
  const withinAmt = sumBlocks(within);
  const beyondAmt = sumBlocks(beyond);
  const acceptAmt = s.acceptanceFees.reduce((s, a) => s + a.amount, 0);
  const feeLinesAmt = s.feeLines.reduce((s, f) => s + f.amount, 0);
  const dtrFees = s.monthlyRetainer > 0 ? s.monthlyRetainer + beyondAmt : withinAmt + beyondAmt;
  const totalLegalFees = dtrFees + acceptAmt + feeLinesAmt;
  const totalExpenses = commonExpenses.reduce((s, e) => s + e.amount, 0);
  const totalHours = [...within, ...beyond].reduce((s, b) => s + b.entries.reduce((s2, e) => s2 + e.hours, 0), 0);

  // Generate the documents
  const pdfBuf = await generateBillingBreakdownPdf(await loadFirmBrand(FIRM_ID), {
    ...breakdownParams,
    clientName: s.clientName,
    invoiceNumber: s.invoiceNumber,
    retainerHoursCap: s.retainerHoursCap,
  });
  const letterParams = {
    clientName: s.clientName,
    clientAddress: '',
    attnName: s.clientName,
    attnTitle: '',
    throughName: '',
    billingPeriod: monthDisplay,
    engagementDate: '',
    totalAmount: totalLegalFees + totalExpenses,
    actualHoursAmount: undefined as number | undefined,
    previousBalance: 0,
    previousBalanceLabel: '',
    includeVAT: true,
    dueDate: '8 May 2026',
    bankName: 'Sample Bank',
    bankAccountNo: '000000000000',
    bankAccountName: 'Test Firm Law Offices',
    signerName: 'NAME OF SIGNING PARTNER',
    invoiceNumber: s.invoiceNumber,
    retainerCap: s.monthlyRetainer || undefined,
    retainerHoursCap: s.retainerHoursCap ?? undefined,
  };

  const docxBuf = await generateBillingLetterDocx(FIRM_ID, letterParams);

  // Upload to storage
  const basePath = `invoices/${month}/${s.clientName.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const docxPath = `${basePath}/${s.invoiceNumber}.docx`;
  const breakdownPdfPath = `${basePath}/${s.invoiceNumber}-breakdown.pdf`;

  await Promise.all([
    supabase.storage.from('files').upload(docxPath, docxBuf, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    }),
    supabase.storage.from('files').upload(breakdownPdfPath, pdfBuf, {
      contentType: 'application/pdf',
      upsert: true,
    }),
  ]);

  // Build line_items for the invoice row in the same shape the rest of the
  // app expects (lawyer groups). For non-DTR billing types this will be empty.
  const invoiceLineItems = s.lineItems;

  // Insert (or upsert) the invoice row
  const { data, error } = await supabase
    .from('invoices')
    .upsert({
      invoice_number: s.invoiceNumber,
      client_id: null,
      client_name: s.clientName,
      matter_id: null,
      matter_name: null,
      billing_month: month,
      total_hours: Math.round(totalHours * 10) / 10,
      total_amount: Math.round(totalLegalFees * 100) / 100,
      total_expenses: Math.round(totalExpenses * 100) / 100,
      currency: 'PHP',
      status: 'draft',
      docx_storage_path: docxPath,
      pdf_storage_path: null,
      breakdown_pdf_storage_path: breakdownPdfPath,
      line_items: invoiceLineItems,
      expense_items: expenseItems,
      fee_lines: s.feeLines,
      billing_settings: {
        clientAddress: '',
        attnName: s.clientName,
        attnTitle: '',
        signerName: 'NAME OF SIGNING PARTNER',
        bankName: 'Sample Bank',
        bankAccountNo: '000000000000',
        bankAccountName: 'Test Firm Law Offices',
        includeVAT: 'true',
        retainerCap: s.monthlyRetainer || undefined,
        retainerHoursCap: s.retainerHoursCap ?? undefined,
        monthlyRetainer: s.monthlyRetainer || undefined,
        acceptanceFees: s.acceptanceFees,
      },
      generated_by: 'test-seed',
    }, { onConflict: 'invoice_number' })
    .select('id')
    .single();

  if (error) throw error;

  return {
    label: s.label,
    invoiceNumber: s.invoiceNumber,
    id: data.id,
    totalLegalFees,
    totalExpenses,
    grandTotal: Math.round((totalLegalFees + totalExpenses) * 1.12 * 100) / 100,
  };
}

async function main() {
  console.log('Seeding 6 [TEST] invoices into the live DB…\n');
  for (const s of scenarios) {
    try {
      const result = await seedOne(s);
      console.log(`✓ ${result.label.padEnd(28)} → ${result.invoiceNumber} (id ${result.id})`);
      console.log(`  Legal fees: ₱${result.totalLegalFees.toLocaleString('en-PH')}  Expenses: ₱${result.totalExpenses.toLocaleString('en-PH')}  Grand (w/VAT): ₱${result.grandTotal.toLocaleString('en-PH')}`);
    } catch (err) {
      console.error(`✗ ${s.label}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log('\nVisit /finance/invoices to inspect.');
  console.log('Clean up later:  DELETE FROM invoices WHERE client_name LIKE \'[TEST]%\';');
}

main().catch((err) => { console.error(err); process.exit(1); });
