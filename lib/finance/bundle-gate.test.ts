import { describe, it, expect } from 'vitest';
import { bundleSkipReason, sentInvoiceSkipReason } from './bundle-gate';

describe('sentInvoiceSkipReason', () => {
  it('lets a bundle with no invoice yet through', () => {
    expect(sentInvoiceSkipReason(null)).toBeNull();
    expect(sentInvoiceSkipReason(undefined)).toBeNull();
  });

  it('lets a draft be refreshed', () => {
    expect(sentInvoiceSkipReason('draft')).toBeNull();
  });

  it('skips an invoice that has gone out, whatever has been paid', () => {
    expect(sentInvoiceSkipReason('sent')).toBe('Invoice already sent');
    expect(sentInvoiceSkipReason('partial')).toBe('Invoice already part-paid');
    expect(sentInvoiceSkipReason('paid')).toBe('Invoice already paid');
  });
});

describe('bundleSkipReason', () => {
  it('skips a bundle that was never submitted', () => {
    expect(bundleSkipReason(null)).toBe('Bundle not submitted for review');
  });

  it('skips a bundle still pending managing-partner review', () => {
    expect(bundleSkipReason({ status: 'pending', clearance_status: null })).toBe('Bundle is pending review');
  });

  it('skips a rejected bundle', () => {
    expect(bundleSkipReason({ status: 'rejected', clearance_status: null })).toBe('Bundle is changes requested');
  });

  it('skips an approved bundle the relationship partner has not cleared', () => {
    expect(bundleSkipReason({ status: 'approved', clearance_status: null })).toBe(
      'Awaiting relationship-partner clearance',
    );
  });

  it('skips an approved bundle whose clearance was declined', () => {
    expect(bundleSkipReason({ status: 'approved', clearance_status: 'declined' })).toBe(
      'Awaiting relationship-partner clearance',
    );
  });

  it('lets an approved and cleared bundle through', () => {
    expect(bundleSkipReason({ status: 'approved', clearance_status: 'cleared' })).toBeNull();
  });
});
