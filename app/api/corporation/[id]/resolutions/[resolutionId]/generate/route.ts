import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import {
  rowToCorporation,
  rowToResolution,
  rowToResolutionTemplate,
} from '@/lib/corporation-row';
import { generateResolutionDocx } from '@/lib/docx/resolution-generator';
import { GraphNotConfiguredError } from '@/lib/microsoft-graph';
import { CORPORATION_SELECT } from '@/lib/corporations/matter-links';

interface Ctx {
  params: Promise<{ id: string; resolutionId: string }>;
}

export async function POST(_req: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, resolutionId } = await params;
  const supabase = getServiceDbForFirm(session.firmId);
  const [{ data: corpRow }, { data: resRow }] = await Promise.all([
    supabase.from('corporations').select(CORPORATION_SELECT).eq('id', id).maybeSingle(),
    supabase.from('resolutions').select('*').eq('id', resolutionId).eq('corporation_id', id).maybeSingle(),
  ]);
  if (!corpRow || !resRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const corporation = rowToCorporation(corpRow as Record<string, unknown>);
  const resolution = rowToResolution(resRow as Record<string, unknown>);

  let template = null;
  if (resolution.templateId) {
    const { data: tplRow } = await supabase
      .from('resolution_templates')
      .select('*')
      .eq('id', resolution.templateId)
      .maybeSingle();
    if (tplRow) template = rowToResolutionTemplate(tplRow as Record<string, unknown>);
  }

  // Resolve signatory (default: current Corporate Secretary or President).
  let signatoryName = '';
  let signatoryPosition = '';
  const { data: officerRow } = await supabase
    .from('corporation_persons')
    .select('first_name, last_name, role')
    .eq('corporation_id', id)
    .in('role', ['Corporate Secretary', 'President'])
    .eq('is_current', true)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (officerRow) {
    signatoryName = `${officerRow.first_name ?? ''} ${officerRow.last_name ?? ''}`.trim();
    signatoryPosition = (officerRow.role as string) ?? '';
  }

  // For Secretary's Certificate, resolve the bundled resolutions + their
  // meetings so the generator can render a quoted body per item.
  type Bundle = {
    resolution: ReturnType<typeof rowToResolution>;
    template: ReturnType<typeof rowToResolutionTemplate> | null;
    meetingType: string | null;
    meetingDate: string | null;
  };
  let bundles: Bundle[] | undefined;
  if (resolution.kind === 'Secretarys Certificate' && resolution.bundledResolutionIds.length > 0) {
    const { data: bundledRows } = await supabase
      .from('resolutions')
      .select('*')
      .in('id', resolution.bundledResolutionIds);
    const orderedRows = resolution.bundledResolutionIds
      .map((bid) => (bundledRows ?? []).find((r) => (r as { id: string }).id === bid))
      .filter((r): r is Record<string, unknown> => !!r);

    const templateIds = Array.from(new Set(orderedRows.map((r) => r.template_id).filter((x): x is string => !!x)));
    const tplMap = new Map<string, ReturnType<typeof rowToResolutionTemplate>>();
    if (templateIds.length) {
      const { data: tplRows } = await supabase.from('resolution_templates').select('*').in('id', templateIds);
      for (const t of tplRows ?? []) {
        const tpl = rowToResolutionTemplate(t as Record<string, unknown>);
        tplMap.set(tpl.id, tpl);
      }
    }

    const meetingIds = Array.from(new Set(orderedRows.map((r) => r.meeting_id).filter((x): x is string => !!x)));
    const meetingMap = new Map<string, { type: string; date: string }>();
    if (meetingIds.length) {
      const { data: meetingRows } = await supabase
        .from('corporation_meetings')
        .select('id, meeting_type, meeting_date')
        .in('id', meetingIds);
      for (const m of meetingRows ?? []) {
        meetingMap.set((m as { id: string }).id, {
          type: (m as { meeting_type: string }).meeting_type,
          date: (m as { meeting_date: string }).meeting_date,
        });
      }
    }

    bundles = orderedRows.map((row) => {
      const bundled = rowToResolution(row);
      const meeting = bundled.meetingId ? meetingMap.get(bundled.meetingId) : null;
      return {
        resolution: bundled,
        template: bundled.templateId ? tplMap.get(bundled.templateId) ?? null : null,
        meetingType: meeting?.type ?? null,
        meetingDate: meeting?.date ?? null,
      };
    });
  }

  try {
    const { docxBuffer, pdfBuffer, oneDriveUrl } = await generateResolutionDocx({
      firmId: session.firmId,
      resolution,
      corporation,
      template,
      signatoryName,
      signatoryPosition,
      bundles,
    });

    const ts = Date.now();
    const baseFolder = firmStoragePath(session.firmId, `corporations/${corporation.id}/resolutions/${resolution.id}`);
    const docxPath = `${baseFolder}/${ts}.docx`;
    const pdfPath = `${baseFolder}/${ts}.pdf`;

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
      return NextResponse.json({ error: 'The document was generated but could not be saved. Try again.' }, { status: 500 });
    }

    const { data: updated, error: updateError } = await supabase
      .from('resolutions')
      .update({ generated_file_path: docxPath, status: 'For Signing' })
      .eq('id', resolution.id)
      .eq('corporation_id', id)
      .select('*')
      .single();
    if (updateError || !updated) {
      return NextResponse.json({ error: 'The document was saved but the record could not be updated.' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      docxPath,
      pdfPath,
      resolution: rowToResolution(updated as Record<string, unknown>),
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
