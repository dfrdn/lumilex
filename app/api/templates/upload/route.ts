import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';

export const maxDuration = 60;

/**
 * POST /api/templates/upload
 * Upload a DOCX template file for placeholder-mode templates.
 *
 * FormData:
 *   templateId: string (numeric ID)
 *   file: File   — the .docx template file
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.role || !['partner', 'admin', 'super_user'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
    }
    const templateId = body.templateId as string | number | null;
    const name = String(body.name ?? '').trim();

    if (!templateId || !name) {
      return NextResponse.json({ error: 'Missing templateId or file name' }, { status: 400 });
    }

    const id = typeof templateId === 'number' ? templateId : parseInt(templateId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid templateId' }, { status: 400 });
    }

    // Validate file type
    if (!name.toLowerCase().endsWith('.docx')) {
      return NextResponse.json({ error: 'Only .docx files are accepted' }, { status: 400 });
    }

    const supabase = getServiceDbForFirm(session.firmId);

    // Verify template exists
    const { data: template, error: fetchErr } = await supabase
      .from('document_templates')
      .select('id, name, generation_mode')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (fetchErr || !template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Sanitize file name
    const sanitizedName = name
      .replace(/[\[\](){}]/g, '')
      .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    const storagePath = firmStoragePath(session.firmId, `${id}/${sanitizedName}`);

    if (body.commit !== true) {
      // Phase 1. upsert:true because the path is deterministic and re-uploading
      // a template is meant to replace it — signing with upsert avoids the
      // window where the old template is deleted and the new one hasn't landed.
      const { data, error } = await supabase.storage
        .from('templates')
        .createSignedUploadUrl(storagePath, { upsert: true });
      if (error || !data) {
        console.error('[templates upload] createSignedUploadUrl failed', error);
        return NextResponse.json({ error: `Failed to prepare upload for ${name}` }, { status: 500 });
      }
      return NextResponse.json({ storagePath, signedUrl: data.signedUrl, token: data.token });
    }

    // ── Phase 2: confirm the object landed ─────────────────────────────────
    if (String(body.storagePath ?? '') !== storagePath) {
      return NextResponse.json({ error: 'storagePath does not match this template' }, { status: 400 });
    }
    const { data: listed } = await supabase.storage
      .from('templates')
      .list(String(id), { search: sanitizedName });
    if (!listed?.some((o) => o.name === sanitizedName)) {
      return NextResponse.json(
        { error: 'The upload did not complete — the file was not found in storage.' },
        { status: 409 },
      );
    }

    // Update template record with storage path
    const { error: updateErr } = await supabase
      .from('document_templates')
      .update({
        template_storage_path: storagePath,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateErr) {
      throw new Error(`DB update failed: ${updateErr.message}`);
    }

    const sizeBytes = Number(body.size) || null;
    console.log(`[templates/upload] Uploaded template file "${name}" for template #${id}`);

    return NextResponse.json({
      ok: true,
      storagePath,
      fileName: name,
      size: sizeBytes,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[templates/upload] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
