import { describe, it, expect } from 'vitest';
import { quorumError } from './meeting-quorum';
import type { CreateMeetingInput } from './validation';

type QuorumArg = Pick<
  CreateMeetingInput,
  'meetingType' | 'quorumAchieved' | 'attendees' | 'sharesRepresented' | 'totalSharesOutstanding'
>;

function meeting(overrides: Partial<QuorumArg> = {}): QuorumArg {
  return {
    meetingType: 'Regular Board',
    quorumAchieved: true,
    attendees: [],
    sharesRepresented: null,
    totalSharesOutstanding: null,
    ...overrides,
  };
}

const present = (name: string) => ({ name, attended: true });
const absent = (name: string) => ({ name, attended: false });

describe('quorumError', () => {
  it('returns null when quorum is not being claimed', () => {
    expect(quorumError(meeting({ quorumAchieved: false }), { totalDirectors: 9, corporationShares: null })).toBeNull();
  });

  describe('stockholders meetings', () => {
    it('asks for share counts when they are missing', () => {
      const result = quorumError(
        meeting({ meetingType: 'Annual Stockholders' }),
        { totalDirectors: 0, corporationShares: null },
      );
      expect(result).toMatch(/shares represented and total shares/i);
    });

    it('fails when represented shares are not a majority', () => {
      const result = quorumError(
        meeting({ meetingType: 'Annual Stockholders', sharesRepresented: 500, totalSharesOutstanding: 1000 }),
        { totalDirectors: 0, corporationShares: null },
      );
      expect(result).toMatch(/majority of 1,000 shares/);
    });

    it('passes when represented shares are a majority', () => {
      const result = quorumError(
        meeting({ meetingType: 'Special Stockholders', sharesRepresented: 501, totalSharesOutstanding: 1000 }),
        { totalDirectors: 0, corporationShares: null },
      );
      expect(result).toBeNull();
    });

    it('falls back to the corporation share count when the form omits the total', () => {
      const result = quorumError(
        meeting({ meetingType: 'Annual Stockholders', sharesRepresented: 600, totalSharesOutstanding: null }),
        { totalDirectors: 0, corporationShares: 1000 },
      );
      expect(result).toBeNull();
    });
  });

  describe('board meetings', () => {
    it('requires a majority of directors present', () => {
      const result = quorumError(
        meeting({ attendees: [present('A'), present('B'), absent('C'), absent('D'), absent('E')] }),
        { totalDirectors: 5, corporationShares: null },
      );
      // need = floor(5/2)+1 = 3, only 2 present
      expect(result).toMatch(/needs 3 of 5 directors/);
    });

    it('passes when a majority of directors are present', () => {
      const result = quorumError(
        meeting({ attendees: [present('A'), present('B'), present('C'), absent('D'), absent('E')] }),
        { totalDirectors: 5, corporationShares: null },
      );
      expect(result).toBeNull();
    });

    it('ignores blank-name attendee rows when counting heads', () => {
      const result = quorumError(
        meeting({ attendees: [present('A'), present('B'), present('   '), { name: '', attended: true }] }),
        { totalDirectors: 5, corporationShares: null },
      );
      // only A and B count → still short of 3
      expect(result).toMatch(/needs 3 of 5 directors/);
    });

    it('accepts any present attendee when the director count is unknown', () => {
      expect(
        quorumError(meeting({ attendees: [present('A')] }), { totalDirectors: 0, corporationShares: null }),
      ).toBeNull();
      expect(
        quorumError(meeting({ attendees: [absent('A')] }), { totalDirectors: 0, corporationShares: null }),
      ).toMatch(/at least one present attendee/i);
    });
  });
});
