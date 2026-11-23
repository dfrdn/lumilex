import { describe, it, expect } from 'vitest';
import { buildLifecyclePlan } from './stages';
import type { Corporation, CorporationFile, CorporationPerson } from '@/types/corporations';

function corp(over: Partial<Corporation> = {}): Corporation {
  return {
    id: 'c1',
    status: 'Pre-Incorporation',
    proposedNames: [],
    approvedName: null,
    companyType: null,
    primaryPurpose: null,
    principalOfficeAddress: null,
    authorizedCapitalStock: null,
    parValue: null,
    secRegistrationNo: null,
    secRegistrationDate: null,
    esparcApplicationNo: null,
    esparcSubmittedDate: null,
    birCorDate: null,
    birBooksRegistrationDate: null,
    birOrAuthorityDate: null,
    birOrusUsername: null,
    birOrusEnrolledDate: null,
    secEfastUsername: null,
    secEfastEnrolledDate: null,
    secHaborUsername: null,
    secHaborEnrolledDate: null,
    businessPermitNo: null,
    businessPermitIssuedDate: null,
    sssEmployerNo: null,
    philhealthEmployerNo: null,
    pagibigEmployerNo: null,
    handlesPostIncorporation: true,
    ...over,
  } as Corporation;
}

const file = (category: string): CorporationFile => ({ category } as CorporationFile);
const incorporator = (): CorporationPerson => ({ role: 'Incorporator' } as CorporationPerson);

const plan = (c: Corporation, files: CorporationFile[] = [], people: CorporationPerson[] = []) =>
  buildLifecyclePlan({ corporation: c, files, people });

describe('buildLifecyclePlan', () => {
  it('starts a blank corporation in Pre-Incorporation', () => {
    const p = plan(corp());
    expect(p.currentStage?.key).toBe('pre_incorporation');
    expect(p.nextItem?.key).toBe('proposed_name');
  });

  it('points at the first thing actually missing', () => {
    const p = plan(corp({ proposedNames: ['Acme Inc.'], companyType: 'Stock' }));
    expect(p.nextItem?.key).toBe('primary_purpose');
  });

  it('counts incorporators from the people list, not a flag', () => {
    const base = corp({ proposedNames: ['Acme Inc.'] });
    expect(plan(base).stages[0].items.find((i) => i.key === 'incorporators')?.done).toBe(false);
    expect(
      plan(base, [], [incorporator()]).stages[0].items.find((i) => i.key === 'incorporators')?.done,
    ).toBe(true);
  });

  it('satisfies document items from uploaded files', () => {
    const p = plan(corp(), [file('AOI')]);
    expect(p.stages[0].items.find((i) => i.key === 'aoi')?.done).toBe(true);
    expect(p.stages[0].items.find((i) => i.key === 'bylaws')?.done).toBe(false);
  });

  it('offers a COR upload as the way through the registration stage', () => {
    const p = plan(corp({ status: 'In SEC' }));
    const cor = p.stages.find((s) => s.key === 'registered')!.items[0];
    expect(cor.done).toBe(false);
    expect(cor.action).toEqual({ kind: 'upload', category: 'SEC COR' });
  });

  it('asks for the details when a COR is filed but the registration was never recorded', () => {
    const p = plan(corp(), [file('SEC COR')]);
    const cor = p.stages.find((s) => s.key === 'registered')!.items[0];
    expect(cor.action).toEqual({ kind: 'record_registration' });
  });

  it('treats everything before registration as settled once the COR is recorded', () => {
    // The firm routinely inherits an already-registered corporation and will
    // never hold its Articles or filing receipt.
    const p = plan(corp({ status: 'Registered', secRegistrationDate: '2025-03-20' }));
    expect(p.stages.find((s) => s.key === 'pre_incorporation')?.complete).toBe(true);
    expect(p.stages.find((s) => s.key === 'in_sec')?.complete).toBe(true);
    expect(p.currentStage?.key).toBe('post_incorporation');
    expect(p.nextItem?.key).toBe('bir_cor');
  });

  it('does not chase post-incorporation work the firm was not engaged for', () => {
    const p = plan(corp({
      status: 'Registered',
      secRegistrationDate: '2025-03-20',
      handlesPostIncorporation: false,
    }));
    expect(p.stages.find((s) => s.key === 'post_incorporation')?.items).toEqual([]);
    expect(p.currentStage).toBeNull();
    expect(p.outstandingCount).toBe(0);
  });

  it('reaches Active on BIR COR + business permit, without employer numbers', () => {
    const p = plan(corp({
      status: 'Active',
      secRegistrationDate: '2025-03-20',
      birCorDate: '2025-04-02',
      businessPermitNo: 'BP-1',
    }));
    expect(p.stages.some((s) => s.key === 'active')).toBe(true);
    // Active is reached on BIR COR + permit, but the rest of post-incorporation
    // stays outstanding: books, ATP, ORUS, barangay, sanitary, fire safety,
    // three employer registrations, eFAST and HABOR.
    expect(p.outstandingCount).toBe(11);
  });

  it('tracks the BIR books and Authority to Print off their own dates', () => {
    const base = corp({ status: 'Registered', secRegistrationDate: '2025-03-20' });
    const items = (c: Corporation) =>
      Object.fromEntries(
        plan(c).stages.find((s) => s.key === 'post_incorporation')!.items.map((i) => [i.key, i.done]),
      );
    expect(items(base).bir_books).toBe(false);
    expect(items(base).bir_atp).toBe(false);
    expect(
      items(corp({
        status: 'Registered',
        secRegistrationDate: '2025-03-20',
        birBooksRegistrationDate: '2025-04-05',
        birOrAuthorityDate: '2025-04-08',
      })),
    ).toMatchObject({ bir_books: true, bir_atp: true });
  });

  it('treats an e-filing platform as enrolled on either the account or the date', () => {
    const at = (over: Partial<Corporation>) =>
      Object.fromEntries(
        plan(corp({ status: 'Registered', secRegistrationDate: '2025-03-20', ...over }))
          .stages.find((s) => s.key === 'post_incorporation')!
          .items.map((i) => [i.key, i.done]),
      );
    expect(at({ birOrusUsername: 'acme@example.law' }).bir_orus).toBe(true);
    expect(at({ secEfastEnrolledDate: '2025-05-01' }).sec_efast).toBe(true);
    expect(at({ secHaborUsername: 'acme' }).sec_habor).toBe(true);
    expect(at({}).sec_efast).toBe(false);
  });

  it('requires the LGU clearances as documents', () => {
    const base = corp({ status: 'Registered', secRegistrationDate: '2025-03-20' });
    const done = (files: CorporationFile[]) =>
      Object.fromEntries(
        plan(base, files).stages.find((s) => s.key === 'post_incorporation')!.items.map((i) => [i.key, i.done]),
      );
    expect(done([])).toMatchObject({
      barangay_clearance: false,
      sanitary_permit: false,
      fire_safety: false,
    });
    expect(
      done([file('Barangay Clearance'), file('Sanitary Permit'), file('Fire Safety Inspection')]),
    ).toMatchObject({ barangay_clearance: true, sanitary_permit: true, fire_safety: true });
  });

  it('gives a dissolved corporation nothing to do', () => {
    const p = plan(corp({ status: 'Dissolved', secRegistrationDate: '2025-03-20' }));
    expect(p.stages).toEqual([]);
    expect(p.currentStage).toBeNull();
    expect(p.nextItem).toBeNull();
  });

  it('treats a blank string as unfilled', () => {
    const p = plan(corp({ proposedNames: ['Acme Inc.'], companyType: 'Stock', primaryPurpose: '   ' }));
    expect(p.nextItem?.key).toBe('primary_purpose');
  });
});
