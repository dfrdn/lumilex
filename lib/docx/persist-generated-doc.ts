import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

export interface PersistGeneratedDocInput {
  firmId: string;
  docxBuffer: Buffer;
  fileName: string;
  storagePath: string;
  templateName: string;
  templateId?: number | null;
  matterId?: string | null;
  matterName?: string | null;
  clientName?: string | null;
  generatedBy: string;
  generatedByName?: string | null;
}

const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Upload a generated DOCX to storage, log it in generated_documents, and
 * return a short-lived signed download URL. Shared by the Document Generator
 * (/api/templates/generate) and the Drafting Studio (/api/drafting/generate)
 * so the persistence tail doesn't drift between them. Service-role: storage +
 * the document log are privileged writes.
 */
export async function persistGeneratedDoc(
  input: PersistGeneratedDocInput,
): Promise<{ downloadUrl: string | null; generationId: number | null }> {
  const supabase = getServiceDbForFirm(input.firmId);

  const { error: uploadErr } = await supabase.storage
    .from('files')
    .upload(input.storagePath, input.docxBuffer, { contentType: DOCX_CONTENT_TYPE, upsert: true });
  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

  const { data: genRow } = await supabase.from('generated_documents').insert({
    template_id: input.templateId ?? null,
    template_name: input.templateName,
    matter_id: input.matterId ?? null,
    matter_name: input.matterName ?? null,
    client_name: input.clientName ?? null,
    file_name: input.fileName,
    storage_path: input.storagePath,
    generated_by: input.generatedBy,
    generated_by_name: input.generatedByName ?? null,
  }).select('id').single();

  const { data: signData } = await supabase.storage
    .from('files')
    .createSignedUrl(input.storagePath, 60 * 60, { download: true });

  return { downloadUrl: signData?.signedUrl ?? null, generationId: genRow?.id ?? null };
}
