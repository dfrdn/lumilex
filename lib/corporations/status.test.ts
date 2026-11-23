import { describe, expect, it } from 'vitest';
import type { Corporation, CorporationFile } from '@/types/corporations';
import { buildCorporationStatus, type StatusInput, type TrackKey } from './status';

const TODAY = '2026-10-09';

function corp(p: Partial<Corporation> = {}): Corporation {
  return {
    id: 'c1',
    status: 'Registered',
    proposedNames: ['Acme Corp'],
    approvedName: 'Acme Corp',
    secRegistrationDate: '2024-05-22',
    secRegistrationNo: 'CS2024050151985',
    fiscalYearEndMonth: 12,
    annualMeetingMonth: null,
    annualMeetingDay: null,
    handlesIncorporation: true,
    handlesPostIncorporation: true,
    handlesHousekeeping: true,
    isUnderRetainer: false,
    firmFiles: ['gis', 'afs', 'itr', 'permit'],
    retainerMatterId: null,
    housekeepingMatterId: 'm-hk',
    postIncorporationMatterId: 'm-post',
    incorporationMatterId: 'm-inc',
    businessPermitNo: null,
    businessPermitIssuedDate: null,
    businessPermitExpiryDate: null,
    ...p,
  } as unknown as Corporation;
}

function input(p: Partial<StatusInput> = {}): StatusInput {
  return { corporation: corp(), files: [], people: [], deliverables: [], meetings: [], today: TODAY, ...p };
}

const file = (category: string, filingYear: number) => ({ category, filingYear } as unknown as CorporationFile);

function trackOf(i: StatusInput, key: TrackKey) {
  return buildCorporationStatus(i).tracks.find((t) => t.key === key)!;
}

describe('buildCorporationStatus', () => {
  it('holds the recurring tracks until SEC registration', () => {
    const s = buildCorporationStatus(input({ corporation: corp({ secRegistrationDate: null, status: 'Pre-Incorporation' }) }));
    expect(s.tracks[0].items.length).toBeGreaterThan(0);
    for (const t of s.tracks.slice(1)) expect(t.summary).toBe('Starts after SEC registration');
  });

  it('marks the application done once registered', () => {
    const t = trackOf(input(), 'application');
    expect(t.items.every((i) => i.state === 'done')).toBe(true);
    expect(t.summary).toMatch(/^Registered /);
  });

  it('shows a missed filing as overdue with no record, next to the upcoming one', () => {
    const gis = trackOf(input(), 'compliance').items.filter((i) => i.key.startsWith('gis'));
    expect(gis.map((i) => [i.period, i.state, i.dueDate])).toEqual([
      [2025, 'overdue', '2026-01-30'],
      [2026, 'not_started', '2027-01-30'],
    ]);
    expect(gis[0].detail).toBe('No filing on record');
  });

  it('counts an uploaded filed copy as done and drops the past year', () => {
    const t = trackOf(input({ files: [file('GIS', 2025)] }), 'compliance');
    expect(t.items.filter((i) => i.key.startsWith('gis')).map((i) => i.period)).toEqual([2026]);
  });

  it('reads the deliverable: filed, in progress, archived', () => {
    const d = (name: string, status: string) => ({ notionId: name, type: 'SEC AFS', name, externalDueDate: '2026-06-15', status });
    const filed = trackOf(input({ deliverables: [d('SEC AFS — Acme Corp (FY 2025)', 'Filed or Sent out')] }), 'compliance');
    expect(filed.items.find((i) => i.key === 'afs-2025')).toBeUndefined(); // finished past year drops away
    const working = trackOf(input({ today: '2026-06-01', deliverables: [d('SEC AFS — Acme Corp (FY 2025)', 'Drafting')] }), 'compliance');
    expect(working.items.find((i) => i.key === 'afs-2025')?.state).toBe('in_progress');
    const archived = trackOf(input({ today: '2026-06-01', deliverables: [d('SEC AFS — Acme Corp (FY 2025)', 'Archived')] }), 'compliance');
    expect(archived.items.find((i) => i.key === 'afs-2025')?.state).toBe('not_ours');
  });

  it('reads each filing against its own switch', () => {
    const c = corp({ firmFiles: ['gis'] });
    const t = trackOf(input({ corporation: c, today: '2026-07-01', deliverables: [
      { notionId: 'a', type: 'SEC AFS', name: 'SEC AFS — Acme Corp (FY 2025)', externalDueDate: '2026-04-30', status: 'Not started' },
    ] }), 'compliance');
    // Off: never overdue, even with a stray open deliverable; only the next period shows, greyed.
    expect(t.items.filter((i) => i.key.startsWith('afs')).map((i) => [i.key, i.state])).toEqual([['afs-2026', 'not_ours']]);
    expect(t.items.filter((i) => i.key.startsWith('itr')).map((i) => i.state)).toEqual(['not_ours']);
    expect(t.items.filter((i) => i.key.startsWith('permit')).every((i) => i.state === 'not_ours')).toBe(true);
    // On: tracked, and the beneficial-ownership declaration goes with the GIS.
    expect(t.items.find((i) => i.key === 'gis-2025')?.state).toBe('overdue');
    expect(t.items.find((i) => i.key === 'bo-2025')?.state).toBe('overdue');
    // Meetings still follow housekeeping, not the filing switches.
    const none = buildCorporationStatus(input({ corporation: corp({ firmFiles: [] }), today: '2026-07-01' }));
    expect(none.tracks.find((x) => x.key === 'compliance')!.summary).toBe('Not handled by the firm');
    expect(none.tracks.find((x) => x.key === 'housekeeping')!.summary).not.toBe('Not handled by the firm');
  });

  it("greys out obligations the firm doesn't carry", () => {
    const t = trackOf(input({ corporation: corp({ firmFiles: [] }) }), 'compliance');
    expect(t.items.every((i) => i.state === 'not_ours')).toBe(true);
    expect(t.health).toBe('grey');
    expect(t.summary).toBe('Not handled by the firm');
  });

  it('turns open work amber while a file request to the client is open', () => {
    const t = trackOf(input({ files: [file('GIS', 2025), file('AFS', 2025)], openRequestMatterIds: ['m-hk'], deliverables: [
      { notionId: 'i', type: 'BIR Filing', name: 'BIR 1702-RT (Annual Income Tax) — Acme Corp (FY 2025)', externalDueDate: '2026-05-15', status: 'Filed or Sent out' },
    ] }), 'compliance');
    expect(t.waitingOnClient).toBe(true);
    expect(t.items.some((i) => i.state === 'waiting_on_client')).toBe(true);
    expect(t.health).toBe('amber');
  });

  it('tracks the annual meeting by the meeting held and its minutes', () => {
    const c = corp({ annualMeetingMonth: 5, annualMeetingDay: 23 });
    const held = trackOf(input({ corporation: c, meetings: [{ meetingType: 'Annual Stockholders', meetingDate: '2026-05-23', minutesStatus: 'For Signing' }] }), 'housekeeping');
    expect(held.items.find((i) => i.key === 'asm-2025')).toMatchObject({ state: 'in_progress', detail: 'Held — minutes not yet signed' });
    const missed = trackOf(input({ corporation: c }), 'housekeeping');
    expect(missed.items.find((i) => i.key === 'asm-2025')?.state).toBe('overdue');
  });

  it('starts the GIS clock from the meeting actually held', () => {
    const t = trackOf(input({
      corporation: corp({ annualMeetingMonth: 5, annualMeetingDay: 23 }),
      meetings: [{ meetingType: 'Annual Stockholders', meetingDate: '2026-04-10', minutesStatus: 'Signed' }],
      today: '2026-04-20',
    }), 'compliance');
    expect(t.items.find((i) => i.key === 'gis-2025')?.dueDate).toBe('2026-05-10');
  });

  it('flags a permit renewal not recorded for this year', () => {
    const lapsed = trackOf(input({ corporation: corp({ businessPermitNo: 'BP-1', businessPermitIssuedDate: '2025-02-01' }) }), 'compliance');
    expect(lapsed.items.find((i) => i.key === 'permit-2026')).toMatchObject({ state: 'overdue', detail: 'No 2026 permit on record' });
    const current = trackOf(input({ corporation: corp({ businessPermitNo: 'BP-1', businessPermitIssuedDate: '2026-01-15' }) }), 'compliance');
    expect(current.items.find((i) => i.key === 'permit-2027')).toMatchObject({ state: 'not_started', dueDate: '2027-01-20' });
  });

  it('rolls up to red when anything is overdue', () => {
    const s = buildCorporationStatus(input());
    expect(s.health).toBe('red');
    expect(s.overdue).toBeGreaterThan(0);
  });

  it('follows the lifecycle: one phase in focus at a time', () => {
    const pre = buildCorporationStatus(input({ corporation: corp({ secRegistrationDate: null, status: 'Pre-Incorporation' }) }));
    expect([pre.phase, pre.focus]).toEqual(['application', ['application']]);

    // Registered with registrations still open, and overdue filings: the
    // overdue compliance track joins the focus; quiet housekeeping does not.
    const post = buildCorporationStatus(input());
    expect(post.phase).toBe('post_registration');
    expect(post.focus).toContain('registrations');
    expect(post.focus).toContain('compliance');

    // Registrations the firm doesn't handle are not "open": straight to ongoing.
    const ongoing = buildCorporationStatus(input({ corporation: corp({ handlesPostIncorporation: false }) }));
    expect([ongoing.phase, ongoing.focus]).toEqual(['ongoing', ['housekeeping', 'compliance']]);
  });

  it('files the BO declaration under compliance', () => {
    const s = buildCorporationStatus(input());
    expect(s.tracks.find((t) => t.key === 'compliance')!.items.some((i) => i.key.startsWith('bo-'))).toBe(true);
    expect(s.tracks.find((t) => t.key === 'housekeeping')!.items.some((i) => i.key.startsWith('bo-'))).toBe(false);
  });

  it('has nothing to monitor once dissolved', () => {
    const s = buildCorporationStatus(input({ corporation: corp({ status: 'Dissolved' }) }));
    expect(s.health).toBe('grey');
    expect(s.tracks.every((t) => t.items.length === 0)).toBe(true);
  });
});
