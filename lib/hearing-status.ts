/**
 * `hearings.status`. New hearings are written 'Scheduled' and a cancelled one
 * 'Cancelled'; the admin table sets the rest. Whether a hearing was attended
 * is also recorded on `is_attended`. Client-safe.
 */
export const HEARING_STATUSES = ['Scheduled', 'Attended', 'Postponed', 'Cancelled'] as const;

export type HearingStatus = (typeof HEARING_STATUSES)[number];
