/**
 * `matters.status`, which a CHECK constraint limits to exactly these three.
 * Not the deliverable vocabulary — 'Archived' is spelled the same in both, and
 * that collision is why each lives in its own module. Client-safe.
 */
export const MATTER_STATUS = {
  ONGOING: 'Ongoing',
  DONE: 'Done',
  ARCHIVED: 'Archived',
} as const;

export type MatterStatus = (typeof MATTER_STATUS)[keyof typeof MATTER_STATUS];

export const MATTER_STATUSES: readonly MatterStatus[] = [MATTER_STATUS.ONGOING, MATTER_STATUS.DONE, MATTER_STATUS.ARCHIVED];
