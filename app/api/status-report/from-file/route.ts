import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { ensureStatusReportForFile } from '@/lib/status-report-auto';
import {
  FILE_ACTION_PREPARE_STATUS_REPORT,
  fetchFileActionState,
  markFileActedUpon,
} from '@/lib/file-action';

/**
 * Inbox action: create a Status Report shell from an incoming file — no AI,
 * no DOCX. Drafters/reviewer come from the matter team. Subject to the same
 * file action exclusivity as the AI "Generate Status Report" flow.
 *
 * Body: { fileId: string }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { fileId } = (await req.json()) as { fileId?: string };
  if (!fileId) {
    return NextResponse.json({ error: 'Missing fileId' }, { status: 400 });
  }

  // Exclusivity guard — once any action is taken on a file, no other action
  // can run. Mirrors the gate in /api/status-report.
  const state = await fetchFileActionState(fileId, session.firmId);
  if (state?.actionTaken) {
    return NextResponse.json({
      error: 'already_acted_upon',
      existing: {
        action_taken: state.actionTaken,
        acted_upon_by_ids: state.actedUponByIds,
      },
    }, { status: 409 });
  }

  try {
    const result = await ensureStatusReportForFile(fileId, {
      performedBy: session.user.notionUserId,
      firmId: session.firmId,
    });

    if (!result.created || !result.deliverableId) {
      return NextResponse.json({
        error: result.reason ?? 'Failed to create status report',
        deliverableId: result.deliverableId,
      }, { status: 500 });
    }

    await markFileActedUpon({
      fileId,
      firmId: session.firmId,
      actorId: session.user.notionUserId,
      label: FILE_ACTION_PREPARE_STATUS_REPORT,
    });

    const { data: deliv } = await getServiceDbForFirm(session.firmId)
      .from('deliverables')
      .select('name')
      .eq('notion_id', result.deliverableId)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      deliverableId: result.deliverableId,
      deliverableName: deliv?.name ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[status-report/from-file]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
