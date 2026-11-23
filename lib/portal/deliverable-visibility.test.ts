import { describe, expect, it } from 'vitest';
import {
  isClientDeliverable,
  isClientVisibleFileRow,
  isFiledDeliverable,
  isFiledVersion,
  isSentStatusReport,
  wasFiledWithAuthority,
} from './deliverable-visibility';

describe('isClientDeliverable', () => {
  it('admits finished external and for-client work', () => {
    expect(isFiledDeliverable({ type: 'External', status: 'Filed or Sent out' })).toBe(true);
    expect(isFiledDeliverable({ type: 'For Client', status: 'Filed or Sent out' })).toBe(true);
  });

  it('never admits internal work, whatever its status', () => {
    expect(isClientDeliverable({ type: 'Internal', status: 'Filed or Sent out' })).toBe(false);
    expect(isClientDeliverable({ type: 'Internal', status: 'Acknowledged' })).toBe(false);
  });

  it('keeps unfinished work out', () => {
    expect(isClientDeliverable({ type: 'External', status: 'Drafting' })).toBe(false);
    expect(isClientDeliverable({ type: 'External', status: null })).toBe(false);
  });

  it('admits a status report only once sent', () => {
    expect(isSentStatusReport({ type: 'Status Report', status: 'Filed or Sent out' })).toBe(true);
    expect(isFiledDeliverable({ type: 'Status Report', status: 'Filed or Sent out' })).toBe(false);
    expect(isClientDeliverable({ type: 'Status Report', status: 'Drafting' })).toBe(false);
  });
});

describe('wasFiledWithAuthority', () => {
  it('reads only external work as filed', () => {
    expect(wasFiledWithAuthority('External')).toBe(true);
    expect(wasFiledWithAuthority('For Client')).toBe(false);
    expect(wasFiledWithAuthority(null)).toBe(false);
  });
});

describe('isFiledVersion', () => {
  it('matches the filed-version tag and its variants only', () => {
    expect(isFiledVersion({ action: 'Filed version' })).toBe(true);
    expect(isFiledVersion({ action: 'Filed version — migrated from linked file' })).toBe(true);
    expect(isFiledVersion({ action: 'Draft' })).toBe(false);
    expect(isFiledVersion({ action: null })).toBe(false);
  });
});

describe('isClientVisibleFileRow', () => {
  const shown = new Set(['d1']);
  it('shows loose rows and rows of a shown deliverable', () => {
    expect(isClientVisibleFileRow({ deliverable_id: null }, shown)).toBe(true);
    expect(isClientVisibleFileRow({ deliverable_id: 'd1' }, shown)).toBe(true);
  });
  it('hides a row tied to a deliverable the client cannot see', () => {
    expect(isClientVisibleFileRow({ deliverable_id: 'd2' }, shown)).toBe(false);
  });
});
