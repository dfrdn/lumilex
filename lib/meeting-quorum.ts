import type { CreateMeetingInput } from './validation';

/**
 * Quorum consistency check (cross-record, so it can't live in the pure zod schema).
 * Board meetings need a majority of the corporation's directors present; stockholders
 * meetings need a majority of outstanding shares represented. Returns an error message,
 * or null when quorum is unchecked or satisfied.
 *
 * Pure (no server imports) so it can run in both the API route and the client form.
 */
export function quorumError(
  m: Pick<CreateMeetingInput, 'meetingType' | 'quorumAchieved' | 'attendees' | 'sharesRepresented' | 'totalSharesOutstanding'>,
  ctx: { totalDirectors: number; corporationShares: number | null },
): string | null {
  if (!m.quorumAchieved) return null;

  if (m.meetingType.includes('Stockholders')) {
    const rep = m.sharesRepresented ?? null;
    const tot = m.totalSharesOutstanding ?? ctx.corporationShares ?? null;
    if (rep == null || tot == null || tot <= 0) {
      return 'Enter shares represented and total shares to confirm quorum';
    }
    if (rep <= tot / 2) {
      return `Quorum needs a majority of ${tot.toLocaleString()} shares; only ${rep.toLocaleString()} represented`;
    }
    return null;
  }

  // Board-type meeting: a majority of the directors must be present (head count).
  // Match the server, which strips blank-name attendees before saving — otherwise
  // empty "+ Add attendee" rows would inflate the client-side count.
  const present = m.attendees.filter((a) => a.attended && (a.name ?? '').trim()).length;
  if (ctx.totalDirectors <= 0) {
    return present > 0 ? null : 'Add at least one present attendee to claim quorum';
  }
  const need = Math.floor(ctx.totalDirectors / 2) + 1;
  if (present < need) {
    return `Quorum needs ${need} of ${ctx.totalDirectors} directors present; only ${present} marked present`;
  }
  return null;
}
