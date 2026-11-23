import { describe, it, expect } from 'vitest';
import { mergeCcAddresses, type PartnerCcRecipient } from './invoice-cc';

const rp = (email: string): PartnerCcRecipient => ({
  kind: 'relationship_partner',
  personId: 'p1',
  name: 'Relationship Partner',
  email,
});

const mp = (email: string): PartnerCcRecipient => ({
  kind: 'managing_partner',
  personId: 'p2',
  name: 'Managing Partner',
  email,
});

describe('mergeCcAddresses', () => {
  it('appends partner copies after the invoice\'s own CC list', () => {
    const merged = mergeCcAddresses(
      [{ address: 'accounts@client.com' }],
      [rp('partner@example.law')],
      'billing@client.com',
    );
    expect(merged).toEqual([
      { address: 'accounts@client.com' },
      { address: 'partner@example.law' },
    ]);
  });

  it('drops the To address so the client is never also CC\'d', () => {
    const merged = mergeCcAddresses([{ address: 'Billing@Client.com' }], [], 'billing@client.com');
    expect(merged).toEqual([]);
  });

  it('copies a partner only once when they are both RP and MP', () => {
    const merged = mergeCcAddresses([], [rp('same@example.law'), mp('same@example.law')], 'c@client.com');
    expect(merged).toEqual([{ address: 'same@example.law' }]);
  });

  it('does not re-add a partner already listed in the stored CC list', () => {
    const merged = mergeCcAddresses(
      [{ address: 'Partner@EXAMPLE.law' }],
      [rp('partner@example.law')],
      'c@client.com',
    );
    expect(merged).toEqual([{ address: 'Partner@EXAMPLE.law' }]);
  });

  it('trims surrounding whitespace and skips blank entries', () => {
    const merged = mergeCcAddresses(
      [{ address: '  spaced@example.law  ' }, { address: '   ' }],
      [],
      'c@client.com',
    );
    expect(merged).toEqual([{ address: 'spaced@example.law' }]);
  });

  it('returns an empty list when nothing was requested', () => {
    expect(mergeCcAddresses([], [], 'c@client.com')).toEqual([]);
  });
});
