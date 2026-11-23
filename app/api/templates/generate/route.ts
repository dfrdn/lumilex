import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { generateDocumentDocx } from '@/lib/docx/template-generator';
import { persistGeneratedDoc } from '@/lib/docx/persist-generated-doc';
import { substituteDocxPlaceholders } from '@/lib/docx/placeholder-substitution';
import { getFirmConfig } from '@/lib/firm/config';

export const maxDuration = 120; // Skills API can take longer

/**
 * GET /api/templates/generate
 * Fetch recent generated documents for the current user, or get a signed download URL.
 * Query params:
 *   ?recent=1           – return last 20 generated documents
 *   ?download=<path>    – return a signed download URL for the given storage path
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = req.nextUrl;
  const supabase = getServiceDbForFirm(session.firmId);

  // ── Signed download URL ─────────────────────────────────
  const downloadPath = url.searchParams.get('download');
  if (downloadPath) {
    const { data: signData } = await supabase.storage
      .from('files')
      .createSignedUrl(downloadPath, 60 * 60, { download: true });

    return NextResponse.json({ downloadUrl: signData?.signedUrl ?? null });
  }

  // ── Recent documents ────────────────────────────────────
  const { data, error } = await supabase
    .from('generated_documents')
    .select('id, template_name, matter_name, client_name, file_name, storage_path, created_at')
    .eq('generated_by', session.user.notionUserId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('[templates/generate] Recent docs error:', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

/**
 * POST /api/templates/generate
 * Generate a document from a template.
 *
 * Body: {
 *   templateId: number,
 *   matterId?: string,
 *   additionalInstructions?: string,
 *   placeholders?: Record<string, string>,
 *   signerName?: string,
 *   signerPosition?: string,
 * }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { templateId, matterId, additionalInstructions, placeholders, signerName, signerPosition } = body;

    if (!templateId) {
      return NextResponse.json({ error: 'templateId is required' }, { status: 400 });
    }

    const supabase = getServiceDbForFirm(session.firmId);

    // ── 1. Fetch template ─────────────────────────────────────────
    const { data: template, error: templateErr } = await supabase
      .from('document_templates')
      .select('id, name, category, generation_mode, ai_prompt, placeholders, template_storage_path')
      .eq('id', templateId)
      .eq('is_active', true)
      .single();

    if (templateErr || !template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // ── 2. Fetch matter context (if provided) ─────────────────────
    let matterContext: {
      name?: string;
      matterCode?: string;
      type?: string;
      caseTitle?: string;
      caseNumber?: string;
      court?: string;
      clientName?: string;
      parties?: string;
    } = {};
    let matterName = '';
    let clientName = '';

    if (matterId) {
      const { data: matterRow } = await supabase
        .from('matters')
        .select('name, matter_code, type, case_title, case_number, court, client_name, parties')
        .eq('notion_id', matterId)
        .single();

      if (matterRow) {
        matterContext = {
          name: matterRow.name ?? undefined,
          matterCode: matterRow.matter_code ?? undefined,
          type: matterRow.type ?? undefined,
          caseTitle: matterRow.case_title ?? undefined,
          caseNumber: matterRow.case_number ?? undefined,
          court: matterRow.court ?? undefined,
          clientName: matterRow.client_name ?? undefined,
          parties: matterRow.parties ?? undefined,
        };
        matterName = matterRow.name ?? '';
        clientName = matterRow.client_name ?? '';
      }
    }

    let docxBuffer: Buffer;
    let fileName: string;

    // ── 3A. AI generation mode ────────────────────────────────────
    if (template.generation_mode === 'ai') {
      if (!template.ai_prompt) {
        return NextResponse.json({ error: 'Template has no AI prompt configured' }, { status: 400 });
      }

      ({ buffer: docxBuffer } = await generateDocumentDocx({
          firmId: session.firmId,
        templatePrompt: template.ai_prompt,
        matterContext,
        additionalInstructions,
        signerName,
        signerPosition,
      }));

      const safeName = template.name.replace(/[^a-zA-Z0-9._\- ]/g, '_');
      fileName = `${safeName}.docx`;

    // ── 3B. Placeholder mode ──────────────────────────────────────
    } else {
      if (!template.template_storage_path) {
        return NextResponse.json({ error: 'Template has no uploaded DOCX file' }, { status: 400 });
      }

      if (!placeholders || Object.keys(placeholders).length === 0) {
        return NextResponse.json({ error: 'placeholders are required for placeholder mode' }, { status: 400 });
      }

      // Download template DOCX from Supabase Storage
      const { data: fileData, error: dlErr } = await supabase.storage
        .from('templates')
        .download(template.template_storage_path);

      if (dlErr || !fileData) {
        return NextResponse.json(
          { error: `Failed to download template file: ${dlErr?.message ?? 'not found'}` },
          { status: 500 },
        );
      }

      const templateBuffer = Buffer.from(await fileData.arrayBuffer());
      const stringValues: Record<string, string> = {};
      for (const [key, value] of Object.entries(placeholders)) {
        stringValues[key] = String(value);
      }
      // The sign-off is the firm's own name, never a value the caller supplies.
      // Unset, `{{firm_name}}` stays visible rather than printing anything else.
      const firmName = (await getFirmConfig(session.firmId)).branding.documentName.trim();
      if (firmName) stringValues.firm_name = firmName;
      docxBuffer = await substituteDocxPlaceholders(templateBuffer, stringValues);

      const safeName = template.name.replace(/[^a-zA-Z0-9._\- ]/g, '_');
      fileName = `${safeName}.docx`;
    }

    // ── 4-6. Upload, log to generated_documents, and sign (shared helper).
    const storagePath = firmStoragePath(
      session.firmId,
      matterId ? `documents/${matterId}/${fileName}` : `documents/general/${Date.now()}_${fileName}`,
    );

    const { downloadUrl } = await persistGeneratedDoc({
      firmId: session.firmId,
      docxBuffer,
      fileName,
      storagePath,
      templateId: template.id,
      templateName: template.name,
      matterId: matterId || null,
      matterName: matterName || null,
      clientName: clientName || null,
      generatedBy: session.user.notionUserId,
      generatedByName: session.user.name || null,
    });

    console.log(`[templates/generate] Generated "${fileName}" for template "${template.name}" (${(docxBuffer.length / 1024).toFixed(1)}KB)`);

    return NextResponse.json({
      ok: true,
      fileName,
      storagePath,
      downloadUrl,
      size: docxBuffer.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[templates/generate] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
