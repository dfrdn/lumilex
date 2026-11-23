import ExcelJS from 'exceljs';
import path from 'path';
import type { Corporation, CorporationPerson, CorporationAffiliation } from '@/types/corporations';
import { buildCapitalStructure, type HoldingRow, type ShareClass } from '@/lib/corporations/capital-structure';

const TEMPLATE_PATH = path.join(process.cwd(), 'public', 'forms', 'sec-gis-stock-2026.xlsx');

/**
 * Fill SEC's official General Information Sheet (Stock) from the registry.
 *
 * The workbook is SEC's own file, filled in place rather than rebuilt: the
 * Commission rejects forms that don't match its layout, so every merge, column
 * width and print setting has to survive untouched. Only cell *values* are
 * written — never structure.
 *
 * Anything the registry doesn't hold is left blank for the filer rather than
 * guessed. `unfilled` reports exactly what those are so the UI can say so
 * instead of implying a complete form.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface GisFillResult {
  buffer: Buffer;
  /** Human-readable labels for fields the registry can't supply. */
  unfilled: string[];
  /** Directors/officers and stockholders written. */
  counts: { directorsOfficers: number; stockholders: number };
}

export interface GisInput {
  corporation: Corporation;
  people: CorporationPerson[];
  shareClasses?: ShareClass[];
  affiliations?: CorporationAffiliation[];
  /** Calendar year the GIS covers. */
  year: number;
  /** Date of the annual meeting actually held, when one was recorded. */
  actualMeetingDate?: string | null;
}

function personName(p: CorporationPerson): string {
  if (p.isJuridical) return p.entityName ?? '';
  return [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
}

/** SEC wants name and residential address in one block, address on its own line. */
function nameAndAddress(p: CorporationPerson): string {
  const name = personName(p);
  const addr = p.residentialAddress?.trim();
  return addr ? `${name}\n${addr}` : name;
}

const DIRECTOR_ROLES = new Set([
  'Director', 'Officer', 'Chairman', 'President', 'Treasurer',
  'Corporate Secretary', 'Compliance Officer', 'Nominee', 'Alternate Nominee',
]);

/** Roles that name a post, as opposed to describing how someone holds shares. */
const OFFICER_TITLES = new Set([
  'Officer', 'Chairman', 'President', 'Treasurer',
  'Corporate Secretary', 'Compliance Officer', 'Nominee', 'Alternate Nominee',
]);

const BOARD_ROLES = new Set(['Director', 'Chairman']);

interface PersonGroup {
  /** Representative row — identity fields are the same across the group. */
  person: CorporationPerson;
  roles: Set<string>;
}

/**
 * One row per human, not per role.
 *
 * A person is routinely recorded three times over — Incorporator, Director and
 * President are separate rows in corporation_persons. The GIS wants them on a
 * single line with the INC'R / BOARD / OFFICER columns ticked, so the roles are
 * collapsed into flags rather than repeated down the page.
 */
function groupByPerson(people: CorporationPerson[]): PersonGroup[] {
  const groups = new Map<string, PersonGroup>();
  for (const p of people) {
    const key = (p.tin?.trim() || personName(p).toLowerCase()) || `id-${p.id}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { person: { ...p }, roles: new Set([p.role]) });
      continue;
    }
    existing.roles.add(p.role);
    // Identity detail is entered unevenly across a person's role rows — one
    // carries the address, another the gender. Take the fullest value of each
    // rather than trusting whichever row happened to come first.
    const m = existing.person as unknown as Record<string, unknown>;
    const incoming = p as unknown as Record<string, unknown>;
    for (const field of ['nationality', 'gender', 'residentialAddress', 'tin', 'positionTitle', 'sharesSubscribedAmount', 'sharesPaidAmount']) {
      if ((m[field] === null || m[field] === undefined || m[field] === '') && incoming[field] != null) {
        m[field] = incoming[field];
      }
    }
  }
  return [...groups.values()];
}

/** Holding shares makes someone a stockholder whether or not a row says so. */
function holdsShares(g: PersonGroup): boolean {
  return g.roles.has('Stockholder') || (g.person.sharesSubscribedAmount ?? 0) > 0;
}

export async function fillSecGis({
  corporation: c,
  people,
  shareClasses = [],
  affiliations = [],
  year,
  actualMeetingDate,
}: GisInput): Promise<GisFillResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);

  const unfilled: string[] = [];
  const corporateName = c.approvedName ?? c.proposedNames[0] ?? '';

  // ── Page 1: corporate identity ─────────────────────────────────────────
  const p1 = wb.getWorksheet('page 1');
  if (!p1) throw new Error('GIS template is missing "page 1" — wrong template file?');

  set(p1, 'A2', `FOR THE YEAR ${year}`);
  set(p1, 'D21', corporateName);
  set(p1, 'A24', c.businessTradeName ?? '');
  set(p1, 'M22', c.secRegistrationDate ?? '');
  set(p1, 'A26', c.secRegistrationNo ?? '');
  set(p1, 'M26', MONTHS[(c.fiscalYearEndMonth || 12) - 1]);
  set(p1, 'N29', c.birTin ?? '');
  set(p1, 'A29', c.annualMeetingBylaws ?? '');
  set(p1, 'H30', actualMeetingDate ?? '');
  set(p1, 'N31', c.website ?? '');
  set(p1, 'A33', c.principalOfficeAddress ?? '');
  set(p1, 'N34', c.officialEmail ?? '');
  set(p1, 'A38', c.principalOfficeAddress ?? '');
  set(p1, 'A40', c.officialEmail ?? '');
  set(p1, 'E40', c.alternateEmail ?? '');
  set(p1, 'I40', c.officialMobile ?? '');
  set(p1, 'N40', c.alternateMobile ?? '');
  set(p1, 'M38', c.faxNumber ?? '');
  set(p1, 'N42', c.telephoneNumber ?? '');
  set(p1, 'A43', c.externalAuditorName ?? '');
  set(p1, 'I43', c.externalAuditorAccreditationNo ?? '');
  set(p1, 'A45', c.primaryPurpose ?? '');
  set(p1, 'I45', c.industryClassification ?? '');
  set(p1, 'N45', c.geographicalCode ?? '');

  if (!c.birTin) unfilled.push('Corporate TIN');
  if (!actualMeetingDate) unfilled.push('Actual date of annual meeting');
  if (!c.principalOfficeAddress) unfilled.push('Principal office address');
  if (!c.industryClassification) unfilled.push('Industry classification');
  if (!c.officialEmail) unfilled.push('Official e-mail address');
  if (!c.officialMobile) unfilled.push('Official mobile number');
  if (!c.businessTradeName) unfilled.push('Business/trade name');
  if (!c.annualMeetingBylaws) unfilled.push('Date of annual meeting per by-laws');
  if (!c.geographicalCode) unfilled.push('Geographical code');
  if (!c.externalAuditorName) unfilled.push('External auditor');
  if (!c.externalAuditorAccreditationNo) unfilled.push('External auditor SEC accreditation number');
  if (!c.telephoneNumber) unfilled.push('Telephone number');
  if (!c.faxNumber) unfilled.push('Fax number');
  // Lists, not scalars — these want their own tables before the form can carry
  // them, so they stay manual for now.
  if (affiliations.length === 0) {
    unfilled.push('Intercompany affiliations, if any (parent, subsidiaries)');
  }

  // The corporate name repeats as a header on every subsequent page.
  const nameHeaderCells: Record<string, string> = {
    page2: 'C4', page3: 'D8', page4: 'D8', page5: 'C6', page6: 'C6', page7: 'C7',
  };
  for (const [sheet, addr] of Object.entries(nameHeaderCells)) {
    const ws = wb.getWorksheet(sheet);
    if (ws) set(ws, addr, corporateName);
  }

  // ── Page 3: capital structure ──────────────────────────────────────────
  // Authorized capital comes from the declared share classes; subscribed and
  // paid-up are derived from who actually holds what, split Filipino/foreign
  // exactly as the grid is laid out.
  const p3 = wb.getWorksheet('page3');
  if (p3) {
    const cap = buildCapitalStructure(shareClasses, people);

    if (shareClasses.length === 0) {
      // Nothing declared — fall back to the single aggregate the corporation
      // record carries, so the form isn't emptier than it needs to be.
      const shares = c.numberOfShares ?? null;
      const par = c.parValue ?? null;
      set(p3, 'D13', shares || par ? 'Common' : '');
      if (shares !== null) set(p3, 'F13', shares);
      if (par !== null) set(p3, 'G13', par);
      if (c.authorizedCapitalStock !== null) set(p3, 'I13', c.authorizedCapitalStock);
      unfilled.push('Share classes (add them under Capital Structure to break the form down properly)');
    } else {
      // Four template rows, 13-16.
      cap.authorized.slice(0, 4).forEach((row, i) => {
        const r = 13 + i;
        set(p3, `D${r}`, row.className);
        if (row.shares !== null) set(p3, `F${r}`, row.shares);
        if (row.parValue !== null) set(p3, `G${r}`, row.parValue);
        if (row.amount !== null) set(p3, `I${r}`, row.amount);
      });
      if (cap.authorized.length > 4) {
        unfilled.push(`${cap.authorized.length - 4} more share classes (the form holds 4)`);
      }
    }

    const authorizedTotal = cap.authorizedTotal ?? c.authorizedCapitalStock;
    if (authorizedTotal !== null) set(p3, 'I17', authorizedTotal);

    // Subscribed: Filipino rows 20-23, foreign rows 26-30.
    writeHoldings(p3, cap.subscribed.filipino, 20, 4, { publicSharesCol: true });
    writeHoldings(p3, cap.subscribed.foreign, 26, 5, { publicSharesCol: true, nationalityCol: true });
    const filSubscribed = cap.subscribed.filipino.reduce((n, r) => n + r.amount, 0);
    const forSubscribed = cap.subscribed.foreign.reduce((n, r) => n + r.amount, 0);
    if (cap.subscribed.total > 0) {
      set(p3, 'I24', filSubscribed);
      set(p3, 'I31', forSubscribed);
      // The foreign-equity percentage has no dedicated cell; the % column of
      // the foreign total row is where it belongs.
      set(p3, 'J31', round2(cap.foreignEquityPercent));
      set(p3, 'I32', cap.subscribed.total);
    } else if (c.subscribedCapital !== null) {
      set(p3, 'I32', c.subscribedCapital);
      unfilled.push('Subscribed capital by nationality (record each holding on the People tab)');
    }

    // Paid-up: Filipino rows 35-39 (amount column is one merged cell for the
    // whole block), foreign rows 42-46.
    writeHoldings(p3, cap.paidUp.filipino, 35, 5, { mergedAmountAnchor: 'I35', parCol: 'G' });
    writeHoldings(p3, cap.paidUp.foreign, 42, 5, { nationalityCol: true, parCol: 'G' });
    const filPaid = cap.paidUp.filipino.reduce((n, r) => n + r.amount, 0);
    const forPaid = cap.paidUp.foreign.reduce((n, r) => n + r.amount, 0);
    if (cap.paidUp.total > 0) {
      set(p3, 'I40', filPaid);
      set(p3, 'I47', forPaid);
      set(p3, 'I48', cap.paidUp.total);
    } else if (c.paidUpCapital !== null) {
      set(p3, 'I48', c.paidUpCapital);
    }
  }

  // ── Page 1: intercompany affiliations ──────────────────────────────────
  const parent = affiliations.find((a) => a.relation === 'Parent');
  if (parent) {
    set(p1, 'A49', parent.name);
    set(p1, 'F49', parent.secRegistrationNo ?? '');
    set(p1, 'J49', parent.address ?? '');
  }
  const others = affiliations.filter((a) => a.relation !== 'Parent');
  others.slice(0, 5).forEach((a, i) => {
    const r = 52 + i * 2;
    set(p1, `A${r}`, a.name);
    set(p1, `F${r}`, a.secRegistrationNo ?? '');
    set(p1, `J${r}`, a.address ?? '');
  });
  if (others.length > 5) {
    unfilled.push(`${others.length - 5} more subsidiaries/affiliates (the form holds 5)`);
  }

  // ── Page 4: directors and officers ─────────────────────────────────────
  // Two template rows per person (name on the first, address on the second).
  const p4 = wb.getWorksheet('page4');
  const boardAndOfficers = groupByPerson(people).filter((g) =>
    [...g.roles].some((r) => DIRECTOR_ROLES.has(r)),
  );
  let directorsWritten = 0;
  if (p4) {
    boardAndOfficers.slice(0, 12).forEach((g, i) => {
      const row = 12 + i * 2;
      const p = g.person;
      const titles = [...g.roles].filter((r) => OFFICER_TITLES.has(r));
      set(p4, `C${row}`, nameAndAddress(p));
      set(p4, `F${row}`, p.nationality ?? '');
      set(p4, `G${row}`, flag(g.roles.has('Incorporator')));
      set(p4, `H${row}`, flag([...g.roles].some((r) => BOARD_ROLES.has(r))));
      set(p4, `I${row}`, p.gender ?? '');
      set(p4, `J${row}`, flag(holdsShares(g)));
      set(p4, `K${row}`, p.positionTitle ?? titles.join(' / '));
      set(p4, `M${row}`, p.tin ?? '');
      directorsWritten += 1;
    });
    if (boardAndOfficers.length > 12) {
      unfilled.push(`${boardAndOfficers.length - 12} more directors/officers (page 4 holds 12)`);
    }

    // SEC requires gender and TIN for every director and officer, so a gap
    // here fails the filing rather than merely looking untidy.
    for (const g of boardAndOfficers.slice(0, 12)) {
      const missing = [
        !g.person.gender && 'gender',
        !g.person.tin && 'TIN',
        !g.person.residentialAddress && 'residential address',
      ].filter(Boolean);
      if (missing.length) unfilled.push(`${personName(g.person)}: ${missing.join(', ')}`);
    }
  }

  // ── Pages 5-7: stockholders, 7 per page ────────────────────────────────
  const stockholders = people.filter(
    (p) => p.role === 'Stockholder' || p.role === 'Incorporator' || p.sharesSubscribedAmount !== null,
  );
  const dedupedStockholders = dedupeByIdentity(stockholders);
  const pages: { sheet: string; firstRow: number; step: number; count: number }[] = [
    { sheet: 'page5', firstRow: 13, step: 4, count: 7 },
    { sheet: 'page6', firstRow: 13, step: 4, count: 7 },
    { sheet: 'page7', firstRow: 14, step: 4, count: 7 },
  ];

  let written = 0;
  for (const { sheet, firstRow, step, count } of pages) {
    const ws = wb.getWorksheet(sheet);
    if (!ws) continue;
    set(ws, sheet === 'page7' ? 'D9' : 'D8', dedupedStockholders.length);
    if (c.totalAssets !== null) set(ws, sheet === 'page7' ? 'D10' : 'D9', c.totalAssets);
    for (let i = 0; i < count; i++) {
      const p = dedupedStockholders[written];
      if (!p) break;
      const row = firstRow + i * step;
      set(ws, `B${row}`, stockholderBlock(p));
      set(ws, `E${row}`, p.sharesSubscribedAmount ?? '');
      set(ws, `H${row}`, p.sharesPaidAmount ?? '');
      set(ws, `J${row}`, p.tin ?? '');
      written += 1;
    }
  }
  if (dedupedStockholders.length > written) {
    unfilled.push(`${dedupedStockholders.length - written} more stockholders (the form holds 21)`);
  }
  if (c.totalAssets === null) unfilled.push('Total assets per latest audited financial statements');

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return {
    buffer,
    unfilled,
    counts: { directorsOfficers: directorsWritten, stockholders: written },
  };
}


const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Write holding rows into one block of the page-3 grid.
 *
 * The subscribed and paid-up blocks share a shape but not their columns: the
 * subscribed grid has a "shares in the hands of the public" column at G and par
 * at H, while paid-up puts par at G. The Filipino paid-up block also merges its
 * amount column across all five rows, so it takes a single block total.
 */
function writeHoldings(
  ws: ExcelJS.Worksheet,
  rows: HoldingRow[],
  firstRow: number,
  capacity: number,
  opts: {
    nationalityCol?: boolean;
    publicSharesCol?: boolean;
    parCol?: 'G' | 'H';
    mergedAmountAnchor?: string;
  } = {},
) {
  const parCol = opts.parCol ?? (opts.publicSharesCol ? 'H' : 'G');
  rows.slice(0, capacity).forEach((row, i) => {
    const r = firstRow + i;
    if (opts.nationalityCol) set(ws, `B${r}`, row.nationality);
    set(ws, `C${r}`, row.stockholders);
    set(ws, `D${r}`, row.className);
    if (row.shares !== null) set(ws, `F${r}`, row.shares);
    if (row.parValue !== null) set(ws, `${parCol}${r}`, row.parValue);
    if (!opts.mergedAmountAnchor) set(ws, `I${r}`, row.amount);
    set(ws, `J${r}`, round2(row.percent));
  });
  if (opts.mergedAmountAnchor && rows.length) {
    set(ws, opts.mergedAmountAnchor, rows.reduce((n, r) => n + r.amount, 0));
  }
}

/** SEC wants name, nationality and address together in the stockholder cell. */
function stockholderBlock(p: CorporationPerson): string {
  return [personName(p), p.nationality, p.residentialAddress].filter(Boolean).join('\n');
}

/**
 * A person can hold several roles and therefore appear as several rows. On the
 * stockholder pages they are one holder — collapse on TIN, falling back to name
 * when the TIN isn't recorded.
 */
function dedupeByIdentity(people: CorporationPerson[]): CorporationPerson[] {
  const byKey = new Map<string, CorporationPerson>();
  for (const p of people) {
    const key = (p.tin?.trim() || personName(p).toLowerCase()) || `id-${p.id}`;
    const existing = byKey.get(key);
    // Keep whichever row actually carries the shareholding.
    if (!existing || (existing.sharesSubscribedAmount == null && p.sharesSubscribedAmount != null)) {
      byKey.set(key, p);
    }
  }
  return [...byKey.values()];
}

const flag = (on: boolean) => (on ? '✓' : '');

/**
 * Write a value without disturbing the template's formatting. Blank values are
 * skipped so the form's own placeholder styling survives.
 */
function set(ws: ExcelJS.Worksheet, address: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return;
  ws.getCell(address).value = value;
}
