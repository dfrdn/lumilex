import { describe, expect, it } from 'vitest';
import { buildCasePlan, type SourceMatter } from './backfill-plan';
import { backfillSql, idFor } from './backfill-sql';

const m = (over: Partial<SourceMatter>): SourceMatter => ({
  id: 'x', code: '1-20-1', name: 'A v. B', type: 'Litigation', status: 'Ongoing', clientId: 'c', clientName: 'C',
  caseNumber: '', court: '', caseTitle: '', relatedMatterIds: [], ...over,
});

describe('backfillSql', () => {
  const plan = buildCasePlan(
    [
      m({ id: 'm1', code: '5-20-2', name: "O'Neil v. Navarro (OCP)", status: 'Done', caseNumber: 'NPS XV-1', court: 'OCP, Quezon City' }),
      m({ id: 'm2', code: '5-20-6', name: "O'Neil v. Navarro (DOJ)", caseNumber: 'NPS XV-1', court: 'DOJ, Manila' }),
    ],
    new Map([['m1', 3]]),
  );
  const FIRM = '00000000-0000-0000-0000-0000000000f1';
  const sql = backfillSql(plan, FIRM);

  it('runs in one transaction with matter activity skipped', () => {
    expect(sql.startsWith("BEGIN;\nSET LOCAL lumilex.skip_activity = 'on';")).toBe(true);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('writes parents before children and escapes quotes', () => {
    const ocp = sql.indexOf("'prosecutor'");
    const doj = sql.indexOf("'doj'");
    expect(ocp).toBeGreaterThan(-1);
    expect(doj).toBeGreaterThan(ocp);
    expect(sql).toContain("'O''Neil v. Navarro'");
  });

  it('is the same SQL for the same plan', () => {
    expect(backfillSql(plan, FIRM)).toBe(sql);
    expect(idFor('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('stamps the firm on every row and moves only its hearings', () => {
    for (const line of sql.split('\n').filter((l) => l.startsWith('INSERT'))) expect(line).toContain(`'${FIRM}'`);
    expect(sql).toContain(`WHERE firm_id = '${FIRM}' AND matter_id IN`);
  });

  it('gives another firm other ids for the same plan', () => {
    const other = backfillSql(plan, '00000000-0000-0000-0000-0000000000f2');
    const ids = (s: string) => s.match(/'[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}'/g) ?? ([] as string[]);
    expect(ids(other).some((id) => ids(sql).includes(id))).toBe(false);
  });

  it('links every matter to its case and moves hearings only once', () => {
    expect(sql.match(/INTO public\.matter_subjects/g)).toHaveLength(2);
    expect(sql).toContain('AND proceeding_id IS NULL');
  });
});
