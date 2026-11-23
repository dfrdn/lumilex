import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { generateDocumentDocx } from '@/lib/docx/template-generator';
import { generatePleadingDocx } from '@/lib/docx/pleading-generator';
import { loadDocxBrand } from '@/lib/docx/brand';
import { assembleDraftGrounding } from '@/lib/ai/draft-grounding';
import { logAudit, getClientIP } from '@/lib/audit';

// A revision re-runs the model, so allow the same headroom as a fresh draft.
export const maxDuration = 300;

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_DRAFT_TEXT = 120_000;

const DRAFT_MODELS = {
  standard: 'claude-sonnet-5',
  complex: 'claude-opus-4-8',
} as const;

/**
 * POST /api/drafting/generations/[id]/refine  (multipart)
 *   file        = the current (possibly edited) DOCX
 *   instruction = natural-language revision (e.g. "strengthen the prayer")
 *   format      = 'pleading' | 'letter'
 *   documentType, model
 *
 * Re-drafts the document with the revision applied on top of the current text,
 * overwrites the same storage object (so the deliverable and recent-drafts
 * download serve the revised version), and returns a fresh signed URL so the
 * studio can reload the preview.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const docId = Number(id);
  if (!Number.isFinite(docId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const instruction = String(form?.get('instruction') ?? '').trim();
  const format = String(form?.get('format') ?? 'pleading') === 'letter' ? 'letter' : 'pleading';
  const documentType = String(form?.get('documentType') ?? 'document').trim().slice(0, 200) || 'document';
  const modelKey = String(form?.get('model') ?? 'standard') === 'complex' ? 'complex' : 'standard';

  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ error: 'File missing or too large' }, { status: 400 });
  if (instruction.length < 3) return NextResponse.json({ error: 'Describe the revision you want' }, { status: 400 });
  if (instruction.length > 4000) return NextResponse.json({ error: 'Revision instruction is too long' }, { status: 400 });

  const service = getServiceDbForFirm(session.firmId);
  const { data: doc } = await service
    .from('generated_documents')
    .select('storage_path, matter_id, matter_name, client_name, file_name')
    .eq('id', docId)
    .maybeSingle();
  if (!doc?.storage_path) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // RLS gate + matter context: the caller must be able to access the matter.
  let matterContext: Record<string, string | undefined> = {
    name: doc.matter_name ?? undefined,
    clientName: doc.client_name ?? undefined,
  };
  if (doc.matter_id) {
    const authed = await getSupabaseServerAuthClient();
    const { data: matter } = await authed
      .from('matters')
      .select('notion_id, name, matter_code, type, case_title, case_number, court, client_name')
      .eq('notion_id', doc.matter_id)
      .maybeSingle();
    if (!matter) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    matterContext = {
      name: matter.name ?? undefined,
      matterCode: matter.matter_code ?? undefined,
      type: matter.type ?? undefined,
      caseTitle: matter.case_title ?? undefined,
      caseNumber: matter.case_number ?? undefined,
      court: matter.court ?? undefined,
      clientName: matter.client_name ?? undefined,
    };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const mammoth = await import('mammoth');
    const { value: rawText } = await mammoth.extractRawText({ buffer });
    let currentText = (rawText ?? '').trim();
    if (!currentText) return NextResponse.json({ error: 'Could not read the current draft' }, { status: 400 });
    if (currentText.length > MAX_DRAFT_TEXT) currentText = `${currentText.slice(0, MAX_DRAFT_TEXT)}\n\n[Draft truncated]`;

    // Re-ground so revisions that add arguments stay tied to the matter + firm
    // KB. Authorities are OFF here: the drafter curated them at generate time
    // (exclusions aren't persisted on the generation), so a fresh juris.ph pass
    // could re-inject a case they explicitly rejected — and status-report
    // refines must stay jurisprudence-free. Approved citations already live in
    // the draft text being revised.
    const grounding = doc.matter_id
      ? await assembleDraftGrounding({
          firmId: session.firmId,
          matterId: doc.matter_id,
          documentType,
          extraQuery: instruction,
          includeAuthorities: false,
        })
      : null;

    const model = DRAFT_MODELS[modelKey];
    const maxTokens = format === 'letter' ? 16_000 : 24_000;
    const reviseFrom = { currentText, instruction };

    const { buffer: docxBuffer, truncated } = format === 'letter'
      ? await generateDocumentDocx({
          firmId: session.firmId,
          templatePrompt: `Revise the "${documentType}" for this matter per the revision below.`,
          matterContext,
          groundingContext: grounding?.promptBlock,
          reviseFrom,
          model,
          maxTokens,
        })
      : await generatePleadingDocx({
            firmId: session.firmId,
          documentType,
          matterContext,
          firmName: (await loadDocxBrand(session.firmId)).firmName,
          groundingContext: grounding?.promptBlock,
          reviseFrom,
          model,
          maxTokens,
        });

    const { error: upErr } = await service.storage
      .from('files')
      .upload(doc.storage_path, docxBuffer, { contentType: DOCX_CONTENT_TYPE, upsert: true });
    if (upErr) return NextResponse.json({ error: `Save failed: ${upErr.message}` }, { status: 500 });

    // Keep any attached deliverable's file size in sync (same storage object).
    await service.from('deliverable_files').update({ file_size: docxBuffer.length }).eq('file_url', doc.storage_path);

    logAudit({
      firmId: session.firmId,
      entityType: 'AIDraft',
      entityId: doc.storage_path,
      action: 'edited',
      performedBy: session.user.notionUserId,
      ipAddress: getClientIP(req),
    });

    const { data: signed } = await service.storage
      .from('files')
      .createSignedUrl(doc.storage_path, 60 * 5, { download: true });

    return NextResponse.json({ ok: true, truncated, downloadUrl: signed?.signedUrl ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Revision failed';
    console.error('[drafting/refine] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
