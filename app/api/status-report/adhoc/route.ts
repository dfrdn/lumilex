import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { mintId } from '@/lib/ids';
import { getMatterTeamByRole } from '@/lib/queries/team-roles';
import { resolveStatusReportReviewer } from '@/lib/status-report-reviewer';
import { composeStatusReport } from '@/lib/ai/compose-status-report';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { manilaDate } from '@/lib/dates';

export const maxDuration = 300;

/**
 * POST /api/status-report/adhoc
 *
 * Body: { matterId: string, sinceDate?: string, model?: 'standard' | 'complex' }
 *
 * Generates a periodic status report that aggregates events since the last
 * Status Report (or since matter creation if none). Drafts it through the
 * shared Drafting Studio engine (grounded, house style), then creates a new
 * Status Report deliverable with the DOCX attached, assigned for final review.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { matterId, sinceDate, model } = await req.json();
  if (!matterId) {
    return NextResponse.json({ error: 'matterId required' }, { status: 400 });
  }

  try {
    const supabase = getServiceDbForFirm(session.firmId);

    // ── 1. Draft + lay out via the shared Studio engine ────────
    const { buffer: docxBuffer, draft, deliverableName, formattedDate } = await composeStatusReport({
      firmId: session.firmId,
      matterId,
      sinceDate,
      model: model === 'complex' ? 'complex' : 'standard',
    });

    // ── 2. Gather signatory team (for reviewer assignment) ─────
    const team = await getMatterTeamByRole(session.firmId, matterId);
    const reviewer = await resolveStatusReportReviewer(matterId, team, session.firmId);

    // Load matter for naming + display fields.
    const { data: matterRow } = await supabase
      .from('matters')
      .select('name, client_name')
      .eq('notion_id', matterId)
      .single();

    // ── 3. Upload DOCX to Supabase Storage ─────────────────────
    const deliverableId = mintId('deliverable');
    const safeDeliverableName = deliverableName.replace(/[^a-zA-Z0-9._\- ]/g, '_');
    const storagePath = `${deliverableId}/v1/${safeDeliverableName}.docx`;

    const { error: uploadErr } = await supabase.storage
      .from('files')
      .upload(storagePath, docxBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      });
    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    // ── 5. Create deliverable ──────────────────────────────────
    const externalDueDate = manilaDate(1);

    const { error: delivErr } = await supabase.from('deliverables').insert({
      notion_id: deliverableId,
      notion_url: '',
      name: deliverableName,
      matter_id: matterId,
      matter_name: matterRow?.name ?? '',
      client_name: matterRow?.client_name ?? '',
      type: 'Status Report',
      status: DELIVERABLE_STATUS.DRAFTING,
      drafter_ids: [],
      reviewer_ids: reviewer ? [reviewer.personId] : [],
      currently_with_ids: reviewer ? [reviewer.personId] : [],
      external_due_date: externalDueDate,
      review_dates: [],
      priority: '',
      date_done: null,
      revision_count: 0,
      parent_deliverable_id: null,
      related_hearing_id: null,
      source_deliverable_id: null,
      created_time: new Date().toISOString(),
      notion_last_edited_at: new Date().toISOString(),
      synced_at: new Date().toISOString(),
    });
    if (delivErr) {
      throw new Error(`Deliverable insert failed: ${delivErr.message}`);
    }

    const { error: fileErr } = await supabase.from('deliverable_files').insert({
      deliverable_id: deliverableId,
      version: 1,
      file_name: `${safeDeliverableName}.docx`,
      file_url: storagePath,
      file_size: docxBuffer.length,
      uploaded_by: 'system',
      action: 'ai-generated',
    });
    if (fileErr) {
      throw new Error(`Deliverable file insert failed: ${fileErr.message}`);
    }

    return NextResponse.json({
      ok: true,
      deliverableId,
      deliverableName,
      sinceDate: draft.sinceDate,
      includedRecap: draft.includedRecap,
      eventCount: draft.eventCount,
      inputTokens: draft.inputTokens,
      outputTokens: draft.outputTokens,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[status-report/adhoc] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
