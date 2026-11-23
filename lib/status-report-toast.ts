import { toast } from 'sonner';

/**
 * Toast when an API response reports it auto-created a status-report deliverable.
 *
 * Pass the raw `fetch` Response on a success path (after the `res.ok` check) —
 * this consumes the body, so don't read it again afterwards. Used by every
 * caller that can trigger auto-creation (/api/mark-status, /api/deliverable-action).
 */
export async function notifyStatusReportCreated(res: Response): Promise<void> {
  const body = await res.json().catch(() => ({} as { statusReportCreated?: boolean }));
  if (body?.statusReportCreated) {
    toast.success('Status report deliverable created automatically');
  }
}
