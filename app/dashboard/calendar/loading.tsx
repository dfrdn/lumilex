import { PageSkeleton } from '@/components/ui/Skeletons';

/**
 * Header and tabs over a plain panel. A loading file can't read ?tab=, and the
 * Hearings and Meetings tabs, which wait on the server longest, are tables
 * where the month tab is a grid.
 */
export default function Loading() {
  return <PageSkeleton tabs />;
}
