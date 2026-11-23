import { describe, expect, it } from 'vitest';
import { applyLetterOverride, readClientProfile } from './client-profile';

describe('readClientProfile', () => {
  it('keeps known settings of the right type and drops the rest', () => {
    expect(readClientProfile({
      attnName: ' Ms. Jane Doe ', includeVAT: true, includeLessenFeesNote: 'true', letterAddressee: 'person',
      optionalParagraphs: ['a', 'a', 7, ''], earlyPaymentDiscountPercent: '5', stray: 'x', clientAddress: '  ',
    })).toEqual({ attnName: 'Ms. Jane Doe', includeVAT: true, letterAddressee: 'person', optionalParagraphs: ['a'], earlyPaymentDiscountPercent: '5' });
    expect(readClientProfile(null)).toEqual({});
  });
});

describe('applyLetterOverride', () => {
  const profile = { initialStatement: false, optionalParagraphs: ['deferred-acceptance-fee'], letterAddressee: 'company' as const };

  it('uses the profile when the invoice overrides nothing', () => {
    expect(applyLetterOverride(profile, null)).toEqual({ initialStatement: false, optionalParagraphs: ['deferred-acceptance-fee'], letterAddressee: 'company' });
  });

  it('lets one invoice add, drop or switch paragraphs', () => {
    expect(applyLetterOverride(profile, {
      'optional:deferred-acceptance-fee': 'false', 'optional:payment-arrangement': 'true', initialStatement: 'true',
    })).toEqual({ initialStatement: true, optionalParagraphs: ['payment-arrangement'], letterAddressee: 'company' });
  });
});
