import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  FILE_ACTION_INTERNAL_DISCUSSION,
  FILE_ACTION_PREPARE_RESPONSE,
  FILE_ACTION_PREPARE_STATUS_REPORT,
  markFileActedUpon,
  releaseFileAction,
  type FileActionLabel,
} from '@/lib/file-action';

const VALID_LABELS: FileActionLabel[] = [
  FILE_ACTION_INTERNAL_DISCUSSION,
  FILE_ACTION_PREPARE_RESPONSE,
  FILE_ACTION_PREPARE_STATUS_REPORT,
];

/**
 * POST /api/file-action
 * Body: { fileId: string, label: FileActionLabel }
 *
 * Claims the file-level action slot for the current user. Returns 409 with
 * the existing action if another user (or the same user with a different
 * label) has already acted. Used by the inbox to lock out siblings before
 * opening the create-meeting / create-deliverable modal.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const fileId = body.fileId;
  const label = body.label as FileActionLabel;

  if (!fileId || !label) {
    return NextResponse.json({ error: 'fileId and label required' }, { status: 400 });
  }
  if (!VALID_LABELS.includes(label)) {
    return NextResponse.json({ error: `Unknown label: ${label}` }, { status: 400 });
  }

  const actorId = session.user.notionUserId;
  const result = await markFileActedUpon({ fileId, firmId: session.firmId, actorId, label });

  if (result.updated) {
    return NextResponse.json({ ok: true, label, actorId });
  }
  return NextResponse.json({
    error: 'already_acted_upon',
    existing: {
      action_taken: result.existing.actionTaken,
      acted_upon_by_ids: result.existing.actedUponByIds,
    },
  }, { status: 409 });
}

/**
 * DELETE /api/file-action
 * Body: { fileId: string, label: FileActionLabel }
 *
 * Releases the file-action claim the current user holds. Used by the inbox
 * when the user cancels the create-meeting / create-deliverable modal so
 * the file becomes actionable again. No-op if a different user holds the
 * claim or the action has already been promoted server-side.
 */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const fileId = body.fileId;
  const label = body.label as FileActionLabel;

  if (!fileId || !label) {
    return NextResponse.json({ error: 'fileId and label required' }, { status: 400 });
  }
  if (!VALID_LABELS.includes(label)) {
    return NextResponse.json({ error: `Unknown label: ${label}` }, { status: 400 });
  }

  const actorId = session.user.notionUserId;
  const result = await releaseFileAction({ fileId, firmId: session.firmId, actorId, label });
  if (!result.released) {
    console.warn('[file-action] DELETE did not release', { fileId, actorId, label });
    return NextResponse.json({ error: 'release_failed' }, { status: 409 });
  }
  return NextResponse.json({ ok: true, released: true });
}
