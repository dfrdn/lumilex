import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RECEIVED_BUCKETS, receivedBucket } from './file-facets';

describe('receivedBucket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T09:00:00+08:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('buckets by age relative to now', () => {
    expect(receivedBucket('2026-09-17')).toBe('Past 7 days');
    expect(receivedBucket('2026-09-12')).toBe('Past 7 days');
    expect(receivedBucket('2026-09-01')).toBe('Past 30 days');
    expect(receivedBucket('2026-07-15')).toBe('Past 90 days');
    expect(receivedBucket('2026-01-10')).toBe('Past year');
    expect(receivedBucket('2024-03-01')).toBe('Older');
  });

  it('treats a missing or unparseable date as No date', () => {
    expect(receivedBucket(null)).toBe('No date');
    expect(receivedBucket(undefined)).toBe('No date');
    expect(receivedBucket('')).toBe('No date');
    expect(receivedBucket('not a date')).toBe('No date');
  });

  it('counts a future date as recent instead of dropping it', () => {
    expect(receivedBucket('2026-10-01')).toBe('Past 7 days');
  });

  it('accepts an explicit reference time', () => {
    expect(receivedBucket('2026-01-01', new Date('2026-01-20'))).toBe('Past 30 days');
  });

  it('only returns known buckets', () => {
    for (const d of ['2026-09-17', '2020-01-01', null]) {
      expect(RECEIVED_BUCKETS).toContain(receivedBucket(d));
    }
  });
});
