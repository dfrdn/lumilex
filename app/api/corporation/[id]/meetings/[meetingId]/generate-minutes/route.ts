import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import {
  rowToCorporation,
  rowToCorporationMeeting,
  rowToResolution,
} from '@/lib/corporation-row';
import { generateMinutesDocx } from '@/lib/docx/resolution-generator';
import { GraphNotConfiguredError } from '@/lib/microsoft-graph';
import { CORPORATION_SELECT } from '@/lib/corporations/matter-links';

interface Ctx {
  params: Promise<{ id: string; meetingId: string }>;
}

export async function POST(_req: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, meetingId } = await params;
  const supabase = getServiceDbForFirm(session.firmId);

  const [{ data: corpRow }, { data: meetingRow }, { data: resolutionRows }] = await Promise.all([
    supabase.from('corporations').select(CORPORATION_SELECT).eq('id', id).maybeSingle(),
    supabase.from('corporation_meetings').select('*').eq('id', meetingId).eq('corporation_id', id).maybeSingle(),
    supabase.from('resolutions').select('*').eq('meeting_id', meetingId),
  ]);
  if (!corpRow || !meetingRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const corporation = rowToCorporation(corpRow as Record<string, unknown>);
  const meeting = rowToCorporationMeeting(meetingRow as Record<string, unknown>);
  const linkedResolutions = (resolutionRows ?? []).map((r) => rowToResolution(r as Record<string, unknown>));

  let secretaryName = session.user.name ?? '';
  const { data: secRow } = await supabase
    .from('corporation_persons')
    .select('first_name, last_name')
    .eq('corporation_id', id)
    .eq('role', 'Corporate Secretary')
    .eq('is_current', true)
    .maybeSingle();
  if (secRow) {
    secretaryName = `${secRow.first_name ?? ''} ${secRow.last_name ?? ''}`.trim();
  }

  try {
    const { docxBuffer, pdfBuffer, oneDriveUrl } = await generateMinutesDocx({
      firmId: session.firmId,
      meeting,
      corporation,
      linkedResolutions,
      secretaryName,
    });

    // Save DOCX and PDF to Supabase storage.
    const ts = Date.now();
    const baseFolder = firmStoragePath(session.firmId, `corporations/${corporation.id}/meetings/${meeting.id}`);
    const docxPath = `${baseFolder}/${ts}-minutes.docx`;
    const pdfPath = `${baseFolder}/${ts}-minutes.pdf`;

    const [docxUp, pdfUp] = await Promise.all([
      supabase.storage.from('files').upload(docxPath, docxBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      }),
      supabase.storage.from('files').upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      }),
    ]);
    if (docxUp.error || pdfUp.error) {
      return NextResponse.json({ error: 'The minutes were generated but could not be saved. Try again.' }, { status: 500 });
    }

    const { data: updated, error: updateError } = await supabase
      .from('corporation_meetings')
      .update({ minutes_file_path: docxPath, minutes_status: 'For Signing' })
      .eq('id', meeting.id)
      .eq('corporation_id', id)
      .select('*')
      .single();
    if (updateError || !updated) {
      return NextResponse.json({ error: 'The minutes were saved but the meeting could not be updated.' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      docxPath,
      pdfPath,
      meeting: rowToCorporationMeeting(updated as Record<string, unknown>),
      oneDriveUrl,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: msg },
      { status: e instanceof GraphNotConfiguredError ? 503 : 500 },
    );
  }
}
