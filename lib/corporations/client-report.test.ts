import { describe, it, expect } from 'vitest';
import type { Corporation, CorporationMeeting, Resolution } from '@/types/corporations';
import { buildCorporateReport, recordedRegistrations, type CorporateReportContext } from './client-report';

function corp(p: Partial<Corporation> = {}): Corporation {
  return { proposedNames: [], approvedName: 'Acme Holdings, Inc.', secRegistrationNo: '2026060012345', ...p } as unknown as Corporation;
}

function ctx(p: Partial<CorporateReportContext> = {}): CorporateReportContext {
  return { corporation: corp(), clientName: 'Acme Group', refNo: 'ACM-001', upcoming: [], ...p };
}

const opts = { today: '2026-10-30', signatory: { name: 'Juana Cruz', position: 'Associate' }, annexes: [] as string[] };
const text = (r: ReturnType<typeof buildCorporateReport>) => r.paragraphs.map((p) => p.text).join('\n');

describe('buildCorporateReport', () => {
  it('reports the SEC registration from the record, with its number and the annex', () => {
    const r = buildCorporateReport(ctx({ corporation: corp({ secRegistrationDate: '2026-06-26' }) }), 'sec_registration', {
      ...opts, annexes: ['the Certificate of Incorporation'],
    });
    expect(r.eventDate).toBe('2026-06-26');
    expect(text(r)).toContain('approved the registration of Acme Holdings, Inc. on 26 June 2026, under SEC Registration No. 2026060012345.');
    expect(text(r)).toContain('A copy of the Certificate of Incorporation is attached as Annex “A”.');
    expect(r.subject).toBe('Acme Holdings, Inc. | SEC Registration Report (ACM-001)');
    expect(r.problems).toEqual([]);
  });

  it('refuses an event the company has not recorded', () => {
    expect(() => buildCorporateReport(ctx(), 'bir_registration', opts)).toThrow(/not recorded/);
  });

  it('drops a clause whose field is blank', () => {
    const r = buildCorporateReport(ctx({ corporation: corp({ birCorDate: '2026-07-10' }) }), 'bir_registration', opts);
    expect(text(r)).toContain('was registered with the Bureau of Internal Revenue (BIR) on 10 July 2026.');
    expect(r.problems).toContain('No TIN on the company.');
  });

  it('names the agency of a compliance filing and lists the next deadlines, not the filing itself', () => {
    const filed = { id: 'd1', name: 'SEC GIS — Acme Holdings, Inc. (2026)', type: 'SEC GIS', status: 'Filed or Sent out', dueDate: '2026-07-30', doneOn: '2026-07-20' };
    const afs = { id: 'd2', name: 'SEC AFS — Acme Holdings, Inc. (FY 2026)', type: 'SEC AFS', status: 'Not started', dueDate: '2027-04-15', doneOn: null };
    const r = buildCorporateReport(ctx({ compliance: filed, upcoming: [filed, afs] }), 'compliance', opts);
    expect(text(r)).toContain('we filed the General Information Sheet (GIS) for 2026 of Acme Holdings, Inc. with the Securities and Exchange Commission (SEC) on 20 July 2026.');
    expect(r.subject).toBe('Acme Holdings, Inc. | SEC GIS (2026) Filing Report (ACM-001)');
    expect(text(r)).toContain('Audited Financial Statements (AFS) for fiscal year 2026 — due on **15 April 2027**.');
    expect(r.caption.find((c) => c.label === 'Upcoming Deadline')?.value).toBe('SEC AFS (FY 2026) — 15 April 2027');
    expect(r.emailCaption).toContainEqual({ label: 'Upcoming Deadline (SEC AFS (FY 2026))', value: '15 April 2027', bold: true });
    expect(r.message).toContain('We will continue to monitor');
  });

  it('leaves out the deadline when nothing is open', () => {
    const r = buildCorporateReport(ctx({ corporation: corp({ birBooksRegistrationDate: '2026-07-12' }) }), 'bir_books', opts);
    expect(r.caption.some((c) => c.label === 'Upcoming Deadline')).toBe(false);
    expect(r.message).not.toContain('monitor');
  });

  it('reports a meeting held and a resolution only once signed', () => {
    const meeting = { meetingType: 'Annual Stockholders', meetingDate: '2026-06-15', venue: 'Makati City' } as CorporationMeeting;
    expect(text(buildCorporateReport(ctx({ meeting }), 'meeting', opts)))
      .toContain('the annual meeting of the stockholders of Acme Holdings, Inc. was held on 15 June 2026 at Makati City.');

    const resolution = { kind: 'Board Resolution', title: 'Opening of a bank account', dateOfResolution: '2026-08-01', status: 'For Signing' } as Resolution;
    expect(() => buildCorporateReport(ctx({ resolution }), 'resolution', opts)).toThrow();
    const signed = buildCorporateReport(ctx({ resolution: { ...resolution, status: 'Signed' } }), 'resolution', opts);
    expect(text(signed)).toContain('resolution of the Board of Directors of Acme Holdings, Inc. on Opening of a bank account, dated 1 August 2026, has been signed.');
  });
});

describe('recordedRegistrations', () => {
  it('lists the registrations on the record, each with its day', () => {
    expect(recordedRegistrations(corp({ secRegistrationDate: '2026-06-26', sssRegistrationDate: '2026-08-01' }))).toEqual([
      { event: 'sec_registration', date: '2026-06-26' },
      { event: 'sss', date: '2026-08-01' },
    ]);
  });
});
