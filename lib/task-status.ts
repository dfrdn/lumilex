/**
 * `tasks.status`. The task routes and the assistant write exactly these three
 * — marking a task done sets 'Done', un-marking it 'In progress'. Note the
 * casing: 'Not started' is shared with the deliverable vocabulary, and the
 * admin dropdown once offered 'Not Started' / 'In Progress', values nothing
 * else in the app recognises. Client-safe.
 */
export const TASK_STATUS = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export const TASK_STATUSES: readonly TaskStatus[] = [TASK_STATUS.NOT_STARTED, TASK_STATUS.IN_PROGRESS, TASK_STATUS.DONE];
