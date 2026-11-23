import { describe, it, expect } from 'vitest';
import {
  EMPTY_FIRM_INVOICE_SETTINGS,
  INVOICE_PLACEHOLDER_PREFIX,
  invoicePlaceholder,
  isInvoicePlaceholder,
  isFirmInvoiceSettingsComplete,
  missingInvoiceSettings,
  type FirmInvoiceSettings,
} from './firm-defaults';

/**
 * The rule that decides whether a firm may print an invoice at all. Provisioning
 * writes the placeholder row; finance completes it. Everything between those two
 * moments must be treated as "we do not know where the money goes".
 */

const COMPLETE: FirmInvoiceSettings = {
  firmAddress: '12 Example Street, Makati City',
  firmAddress2: '',
  firmTIN: '000-000-000-000',
  bankName: 'Example Bank',
  bankAccountNo: '1234567890',
  bankAccountName: 'Example Law Offices',
  signerName: 'A. Example',
  invoicePrefix: 'EXA',
};

describe('invoicePlaceholder', () => {
  it('is recognised by isInvoicePlaceholder', () => {
    expect(isInvoicePlaceholder(invoicePlaceholder('bank name'))).toBe(true);
  });

  it('names the field so the settings form reads as an instruction', () => {
    expect(invoicePlaceholder('bank name')).toContain('bank name');
    expect(invoicePlaceholder('bank name').startsWith(INVOICE_PLACEHOLDER_PREFIX)).toBe(true);
  });

  it('does not mistake a real value for a placeholder', () => {
    expect(isInvoicePlaceholder('BDO Unibank')).toBe(false);
    expect(isInvoicePlaceholder('')).toBe(false);
  });
});

describe('missingInvoiceSettings', () => {
  it('accepts a fully completed row', () => {
    expect(missingInvoiceSettings(COMPLETE)).toEqual([]);
    expect(isFirmInvoiceSettingsComplete(COMPLETE)).toBe(true);
  });

  it('does not require the optional second address line', () => {
    expect(missingInvoiceSettings({ ...COMPLETE, firmAddress2: '' })).toEqual([]);
  });

  it('reports every blank required field', () => {
    expect(missingInvoiceSettings(EMPTY_FIRM_INVOICE_SETTINGS)).toEqual([
      'firm address',
      'TIN',
      'bank name',
      'bank account number',
      'bank account name',
      'signer name',
      'invoice prefix',
    ]);
  });

  it('treats whitespace as blank', () => {
    expect(missingInvoiceSettings({ ...COMPLETE, bankAccountNo: '   ' })).toEqual([
      'bank account number',
    ]);
  });

  // The provisioning case: a real prefix (allocate_invoice_number needs one)
  // alongside placeholder bank details must still refuse.
  it('treats a provisioning placeholder as missing, prefix notwithstanding', () => {
    const provisioned: FirmInvoiceSettings = {
      ...EMPTY_FIRM_INVOICE_SETTINGS,
      invoicePrefix: 'EXA',
      firmAddress: invoicePlaceholder('firm address'),
      firmTIN: invoicePlaceholder('TIN'),
      bankName: invoicePlaceholder('bank name'),
      bankAccountNo: invoicePlaceholder('bank account number'),
      bankAccountName: invoicePlaceholder('bank account name'),
      signerName: invoicePlaceholder('signer name'),
    };
    expect(isFirmInvoiceSettingsComplete(provisioned)).toBe(false);
    expect(missingInvoiceSettings(provisioned)).toEqual([
      'firm address',
      'TIN',
      'bank name',
      'bank account number',
      'bank account name',
      'signer name',
    ]);
  });

  it('goes complete once finance replaces the placeholders', () => {
    const half: FirmInvoiceSettings = { ...COMPLETE, bankAccountNo: invoicePlaceholder('bank account number') };
    expect(missingInvoiceSettings(half)).toEqual(['bank account number']);
    expect(isFirmInvoiceSettingsComplete({ ...half, bankAccountNo: '9876543210' })).toBe(true);
  });
});
