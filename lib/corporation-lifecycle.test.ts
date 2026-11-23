import { describe, it, expect } from 'vitest';
import {
  deriveCorporationStatus,
  hasDerivedStatus,
  isPostIncorporationComplete,
  missingRegistrationFacts,
} from './corporation-lifecycle';
import type { Corporation } from '@/types/corporations';

type Lifecycle = Pick<
  Corporation,
  'status' | 'secRegistrationDate' | 'birCorDate' | 'businessPermitNo' | 'businessPermitIssuedDate'
>;

function corp(over: Partial<Lifecycle> = {}): Lifecycle {
  return {
    status: 'Pre-Incorporation',
    secRegistrationDate: null,
    birCorDate: null,
    businessPermitNo: null,
    businessPermitIssuedDate: null,
    ...over,
  };
}

describe('deriveCorporationStatus', () => {
  it('leaves pre-SEC corporations to the human', () => {
    expect(deriveCorporationStatus(corp({ status: 'Pre-Incorporation' }))).toBeNull();
    expect(deriveCorporationStatus(corp({ status: 'In SEC' }))).toBeNull();
  });

  it('is Registered once SEC registration is recorded', () => {
    expect(deriveCorporationStatus(corp({ status: 'In SEC', secRegistrationDate: '2025-03-20' }))).toBe('Registered');
  });

  it('is Active once BIR COR and a business permit are on file', () => {
    const c = corp({
      status: 'Registered',
      secRegistrationDate: '2025-03-20',
      birCorDate: '2025-04-02',
      businessPermitNo: 'BP-2025-114',
    });
    expect(deriveCorporationStatus(c)).toBe('Active');
  });

  it('accepts a permit issue date in place of a permit number', () => {
    const c = corp({
      status: 'Registered',
      secRegistrationDate: '2025-03-20',
      birCorDate: '2025-04-02',
      businessPermitIssuedDate: '2025-05-01',
    });
    expect(deriveCorporationStatus(c)).toBe('Active');
  });

  it('stays Registered when only one half of post-incorporation is done', () => {
    expect(deriveCorporationStatus(corp({ secRegistrationDate: '2025-03-20', birCorDate: '2025-04-02' }))).toBe('Registered');
    expect(deriveCorporationStatus(corp({ secRegistrationDate: '2025-03-20', businessPermitNo: 'BP-1' }))).toBe('Registered');
  });

  it('does not gate Active on employer registrations', () => {
    // A holding company with no employees never files SSS/PhilHealth/Pag-IBIG.
    const c = corp({
      secRegistrationDate: '2025-03-20',
      birCorDate: '2025-04-02',
      businessPermitNo: 'BP-2025-114',
    });
    expect(isPostIncorporationComplete(c)).toBe(true);
  });

  it('lets Dissolved override the registration record', () => {
    const c = corp({
      status: 'Dissolved',
      secRegistrationDate: '2025-03-20',
      birCorDate: '2025-04-02',
      businessPermitNo: 'BP-1',
    });
    expect(deriveCorporationStatus(c)).toBe('Dissolved');
    expect(hasDerivedStatus(c)).toBe(false);
  });

  it('treats a blank permit number as absent', () => {
    const c = corp({ secRegistrationDate: '2025-03-20', birCorDate: '2025-04-02', businessPermitNo: '' });
    expect(deriveCorporationStatus(c)).toBe('Registered');
  });
});

describe('missingRegistrationFacts', () => {
  const complete = {
    approvedName: 'Tritone Studios Inc.',
    secRegistrationNo: '2023020084756-44',
    secRegistrationDate: '2023-02-06',
  };

  it('passes a complete set', () => {
    expect(missingRegistrationFacts(complete)).toEqual([]);
  });

  it('names each missing fact', () => {
    expect(missingRegistrationFacts({})).toEqual([
      'approved name',
      'SEC registration number',
      'SEC registration date',
    ]);
  });

  it('rejects whitespace-only values', () => {
    expect(missingRegistrationFacts({ ...complete, approvedName: '   ' })).toEqual(['approved name']);
  });

  it('rejects a non-ISO date', () => {
    expect(missingRegistrationFacts({ ...complete, secRegistrationDate: '06/02/2023' })).toEqual([
      'a valid SEC registration date',
    ]);
  });
});
