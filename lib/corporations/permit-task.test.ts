import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computeBusinessPermitTask, hasBusinessPermit, spawnBusinessPermitTask } from './permit-task';
import type { Corporation } from '@/types/corporations';

function corp(p: Partial<Corporation> = {}): Corporation {
  return { proposedNames: [], ...p } as unknown as Corporation;
}

const REGISTERED = { secRegistrationDate: '2026-06-26', approvedName: 'Acme Corp' };

// "Inherited vs fresh" and the record-task due date are both relative to now.
const TODAY = new Date('2026-09-24T00:00:00Z');

describe('computeBusinessPermitTask', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
  });
  afterEach(() => vi.useRealTimers());

  it('returns nothing when the corp has no registration or incorporation date', () => {
    expect(computeBusinessPermitTask(corp())).toBeNull();
  });

  it('files the INITIAL application when no permit is on record', () => {
    // The bug this replaces: a corporation registered in June with no permit
    // anywhere on its record was handed "Business Permit Renewal — 2027",
    // while the application it actually owed had no due date at all.
    const task = computeBusinessPermitTask(corp(REGISTERED))!;
    expect(task.key).toBe('initial');
    expect(task.name).toBe("Initial Business Permit (Mayor's Permit) — Acme Corp");
    expect(task.dueDate).toBe('2026-07-26'); // SEC registration + 30 days
  });

  it('switches to the renewal once a permit is on record', () => {
    const taskFor = (p: Partial<Corporation>) =>
      computeBusinessPermitTask(corp({ ...REGISTERED, ...p }))!;

    // LGU permits are calendar-year: one covers the year it was issued in and
    // lapses on 31 December, so renewal falls due the following 20 January
    // (LGC §167).
    const t = taskFor({ businessPermitNo: 'MKT-2026-001', businessPermitIssuedDate: '2026-07-06' });
    expect(t.stage).toBe('renewal');
    expect(t.key).toBe('renewal-2027');
    expect(t.name).toBe('Business Permit Renewal — Acme Corp (2027)');
    expect(t.dueDate).toBe('2027-01-20');

    // A permit number with no dates at all falls back to the registration year.
    expect(taskFor({ businessPermitNo: 'MKT-2026-001' }).dueDate).toBe('2027-01-20');

    // A permit issued in a later year renews the year after THAT one, not the
    // year after registration.
    expect(taskFor({ businessPermitIssuedDate: '2028-03-04' }).key).toBe('renewal-2029');
  });

  it('anchors the renewal on the ISSUE date, not a recorded expiry', () => {
    // Several live rows hold expiry = issue + 1 year rather than a date read
    // off the permit (Gigi Vibes and Tritone Studios both said 2027-04-28 for
    // a permit issued 2026-04-28). Trusting expiry pushed their renewal to
    // January 2028, a full year late. Under calendar-year permits the issue
    // date is the fact that matters.
    const t = computeBusinessPermitTask(corp({
      ...REGISTERED,
      businessPermitNo: '24-910374',
      businessPermitIssuedDate: '2026-04-28',
      businessPermitExpiryDate: '2027-04-28',
    }))!;
    expect(t.dueDate).toBe('2027-01-20');
  });

  it('falls back to expiry only when no issue date was recorded', () => {
    expect(computeBusinessPermitTask(corp({
      ...REGISTERED,
      businessPermitNo: 'MKT-1',
      businessPermitExpiryDate: '2026-12-31',
    }))!.key).toBe('renewal-2027');
  });

  it('asks for the RECORD when an inherited corporation has no permit on file', () => {
    // A corporation registered in 2005 plainly holds a permit —
    // nobody typed the number in. Dating an "initial application" to
    // registration gave it a deadline in 2005.
    const t = computeBusinessPermitTask(corp({
      secRegistrationDate: '2005-04-05',
      approvedName: 'Old Harbour Trading Inc.',
    }))!;
    expect(t.stage).toBe('record');
    expect(t.key).toBe('record');
    expect(t.name).toBe('Confirm and record business permit — Old Harbour Trading Inc.');
    expect(t.dueDate).toBe('2026-10-08'); // today + 14 days
    expect(t.priority).toBe('Medium'); // a records gap, not a filing deadline
  });

  it('still files an application for a corporation inside its first year', () => {
    // Registered two months ago: the permit genuinely may not exist yet.
    const t = computeBusinessPermitTask(corp({
      secRegistrationDate: '2026-08-04',
      approvedName: 'Coella Global',
    }))!;
    expect(t.stage).toBe('initial');
    expect(t.dueDate).toBe('2026-09-03');
  });

  it('draws the inherited line at one year from registration', () => {
    const stageAt = (regDate: string) =>
      computeBusinessPermitTask(corp({ secRegistrationDate: regDate, approvedName: 'X' }))!.stage;
    expect(stageAt('2025-09-25')).toBe('initial'); // 364 days old
    expect(stageAt('2025-09-23')).toBe('record');  // 366 days old
  });

  it('treats a blank permit number as no permit', () => {
    // The corporations table holds '' as readily as NULL; a whitespace-only
    // number would otherwise flip the corporation to "renewal" with nothing
    // behind it.
    expect(hasBusinessPermit(corp({ businessPermitNo: '   ', businessPermitIssuedDate: '' }))).toBe(false);
    expect(computeBusinessPermitTask(corp({ ...REGISTERED, businessPermitNo: '  ' }))!.key).toBe('initial');
  });

  it('names the task after the corporation, not the matter', () => {
    // Several corporations can share one billing matter; a task list grouped
    // by matter would otherwise show identical rows.
    const named = (p: Partial<Corporation>) =>
      computeBusinessPermitTask(corp({ secRegistrationDate: '2026-06-26', ...p }))!.name;
    expect(named({ approvedName: 'Acme Corp' })).toContain('Acme Corp');
    expect(named({ approvedName: null, proposedNames: ['Beta Inc'] })).toContain('Beta Inc');
    expect(named({ approvedName: null, proposedNames: [] })).toContain('Corporation');
  });
});

describe('spawnBusinessPermitTask', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
  });
  afterEach(() => vi.useRealTimers());

  function client(insertError: { code?: string } | null = null, team: string[] = []) {
    const inserted: Array<Record<string, unknown>> = [];
    return {
      inserted,
      from(table: string) {
        if (table === 'matters') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { name: 'Post-Incorporation — Acme', team_person_ids: team } }) }),
            }),
          };
        }
        return {
          insert: async (row: Record<string, unknown>) => {
            if (insertError) return { error: insertError };
            inserted.push(row);
            return { error: null };
          },
        };
      },
    };
  }

  const registered = corp({
    ...REGISTERED,
    id: 'corp-1',
    postIncorporationMatterId: 'matter-1',
    handlesPostIncorporation: true,
  });

  it('writes the task against the corporation billing matter', async () => {
    const c = client();
    const id = await spawnBusinessPermitTask(registered, c as never, 'firm-1', 'user-1');
    expect(id).toBe('temp-corp-permit-corp-1-initial');
    expect(c.inserted).toHaveLength(1);
    expect(c.inserted[0]).toMatchObject({
      firm_id: 'firm-1',
      matter_id: 'matter-1',
      matter_name: 'Post-Incorporation — Acme',
      subject_id: 'corp-1',
      corporation_step: 'business_permit',
      due_date: '2026-07-26',
      done: false,
      assignee_ids: ['user-1'],
    });
  });

  it("assigns the billing matter's team, not whoever triggered it", async () => {
    const c = client(null, ['lawyer-1', 'lawyer-2']);
    await spawnBusinessPermitTask(registered, c as never, 'firm-1', 'user-1');
    expect(c.inserted[0].assignee_ids).toEqual(['lawyer-1', 'lawyer-2']);
  });

  it('is idempotent — a primary-key conflict is success, not failure', async () => {
    // The id is derived from (corporation, stage) precisely so the three paths
    // that spawn it can all run. The deliverable spawn learned this the hard
    // way: one corporation got two complete copies six minutes apart.
    const c = client({ code: '23505' });
    expect(await spawnBusinessPermitTask(registered, c as never, 'firm-1', 'user-1'))
      .toBe('temp-corp-permit-corp-1-initial');
    expect(c.inserted).toHaveLength(0);
  });

  it('keys the renewal separately so it can coexist with the application', async () => {
    const permitted = corp({
      ...REGISTERED,
      id: 'corp-1',
      postIncorporationMatterId: 'matter-1',
      handlesPostIncorporation: true,
      businessPermitNo: 'MKT-2026-001',
      businessPermitIssuedDate: '2026-07-06',
    });
    const c = client();
    expect(await spawnBusinessPermitTask(permitted, c as never, 'firm-1', 'user-1'))
      .toBe('temp-corp-permit-corp-1-renewal-2027');
  });

  it('does nothing when the corporation has no billing matter', async () => {
    const c = client();
    expect(await spawnBusinessPermitTask(corp(REGISTERED), c as never, 'firm-1', 'user-1')).toBeNull();
    expect(c.inserted).toHaveLength(0);
  });

  it('reports a real insert failure rather than swallowing it', async () => {
    const c = client({ code: '42501' });
    expect(await spawnBusinessPermitTask(registered, c as never, 'firm-1', 'user-1')).toBeNull();
  });
});
