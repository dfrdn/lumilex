import { describe, it, expect } from 'vitest';
import { resolveLawyerPositions, UnresolvedLawyerError } from '@/lib/billing/lawyer-positions';

const FIRM = 'firm-a';
const TEAM = [
  { firm_id: FIRM, person_id: 'p1', name: 'Alexandra Example', position: 'Partner', initials: 'AXE' },
  { firm_id: FIRM, person_id: 'p2', name: 'Sam Sample', position: 'Junior Associate', initials: 'SS' },
  { firm_id: FIRM, person_id: 'p3', name: 'No Initials', position: 'Of Counsel', initials: null },
  { firm_id: 'firm-b', person_id: 'p9', name: 'Other Firm Person', position: 'Partner', initials: 'OFP' },
];

/** Stands in for PostgREST: `.select().eq('firm_id', …).in(column, …)`. */
function makeClient() {
  const queries: Array<{ firm: string; column: string; values: string[] }> = [];
  const client = {
    from() {
      return {
        select() {
          return {
            eq(_col: string, firm: string) {
              return {
                in(column: string, values: string[]) {
                  queries.push({ firm, column, values });
                  return Promise.resolve({
                    data: TEAM.filter(
                      (t) => t.firm_id === firm && values.includes((t as Record<string, unknown>)[column] as string),
                    ),
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, queries };
}

describe('resolveLawyerPositions', () => {
  it('resolves a name that matches a team row', async () => {
    const { client } = makeClient();
    const r = await resolveLawyerPositions(client, FIRM, [{ lawyerName: 'Sam Sample', lawyerPersonId: 'p2' }]);
    expect(r.positionByLawyerName['Sam Sample']).toBe('Junior Associate');
    expect(r.initialsByLawyerName['Sam Sample']).toBe('SS');
    expect(r.unresolved).toEqual([]);
  });

  it('prices a STALE name off the person id — the rename case', async () => {
    const { client } = makeClient();
    const r = await resolveLawyerPositions(client, FIRM, [{ lawyerName: 'Alex Example', lawyerPersonId: 'p1' }]);
    // The name on the row no longer exists in `team`, but it still prices as a
    // Partner rather than falling through to a junior default.
    expect(r.positionByLawyerName['Alex Example']).toBe('Partner');
    expect(r.initialsByLawyerName['Alex Example']).toBe('AXE');
    expect(r.currentNameByStaleName['Alex Example']).toBe('Alexandra Example');
    expect(r.unresolved).toEqual([]);
  });

  it('reports a name that matches nothing by either route', async () => {
    const { client } = makeClient();
    const r = await resolveLawyerPositions(client, FIRM, [{ lawyerName: 'Nobody Here' }]);
    expect(r.unresolved).toEqual(['Nobody Here']);
    expect(r.positionByLawyerName['Nobody Here']).toBeUndefined();
  });

  it('resolves attendees by name', async () => {
    const { client } = makeClient();
    const r = await resolveLawyerPositions(client, FIRM, [
      { lawyerName: 'Alex Example', lawyerPersonId: 'p1', withNames: ['Sam Sample', 'Ghost'] },
    ]);
    expect(r.positionByLawyerName['Sam Sample']).toBe('Junior Associate');
    expect(r.unresolved).toEqual(['Ghost']);
  });

  it('never resolves a person from another firm', async () => {
    const { client, queries } = makeClient();
    const r = await resolveLawyerPositions(client, FIRM, [{ lawyerName: 'Other Firm Person', lawyerPersonId: 'p9' }]);
    expect(queries.every((q) => q.firm === FIRM)).toBe(true);
    expect(r.unresolved).toEqual(['Other Firm Person']);
  });

  it('accepts snake_case rows too (raw DTR rows, not snapshots)', async () => {
    const { client } = makeClient();
    const r = await resolveLawyerPositions(client, FIRM, [
      { lawyer_name: 'Alex Example', lawyer_person_id: 'p1', with_names: ['Sam Sample'] },
    ]);
    expect(r.positionByLawyerName['Alex Example']).toBe('Partner');
    expect(r.positionByLawyerName['Sam Sample']).toBe('Junior Associate');
  });

  it('authorName prefers the team row over the stored snapshot', async () => {
    const { client } = makeClient();
    const row = { lawyerName: 'Alex Example', lawyerPersonId: 'p1' };
    const orphan = { lawyerName: 'Nobody Here' };
    const r = await resolveLawyerPositions(client, FIRM, [row, orphan]);
    expect(r.authorName(row)).toBe('Alexandra Example');
    expect(r.authorName(orphan)).toBe('Nobody Here');
  });

  it('omits initials for a team row that has none', async () => {
    const { client } = makeClient();
    const r = await resolveLawyerPositions(client, FIRM, [{ lawyerName: 'No Initials', lawyerPersonId: 'p3' }]);
    expect(r.positionByLawyerName['No Initials']).toBe('Of Counsel');
    expect(r.initialsByLawyerName['No Initials']).toBeUndefined();
  });

  it('skips the team queries entirely when there is nothing to resolve', async () => {
    const { client, queries } = makeClient();
    const r = await resolveLawyerPositions(client, FIRM, [{ lawyerName: '', lawyerPersonId: null }]);
    expect(queries).toHaveLength(0);
    expect(r.unresolved).toEqual([]);
  });
});

describe('UnresolvedLawyerError', () => {
  it('names the people who matched no team row', () => {
    const err = new UnresolvedLawyerError(['Pat Placeholder', 'Quinn Placeholder']);
    expect(err.message).toContain('Pat Placeholder, Quinn Placeholder');
    expect(err.message).toContain('These names are');
    expect(err.names).toEqual(['Pat Placeholder', 'Quinn Placeholder']);
  });

  it('reads correctly for a single name and says why it blocks', () => {
    const msg = new UnresolvedLawyerError(['Pat Placeholder']).message;
    expect(msg).toContain('This name is');
    expect(msg).toMatch(/position .*hourly rate/);
  });
});
