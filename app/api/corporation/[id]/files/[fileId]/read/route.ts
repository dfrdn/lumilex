import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { isPathUnder } from '@/lib/storage/upload-path';
import { refuseIfDisabled } from '@/lib/ai/gate';
import { isExtractable } from '@/lib/ai/corporation-doc-extract';
import { readDocument } from '@/lib/corporations/read-document';

/**
 * POST /api/corporation/[id]/files/[fileId]/read
 * Read a registration document already on record — one uploaded before
 * documents were read on upload, or one whose first read was dismissed — and
 * hand back the values for confirmation. Never writes to the company: even a
 * SEC COR comes back for review.
 *
 * The company is checked on the caller's own client (RLS on `corporations`);
 * the file row and the download then go through the firm-scoped service
 * client, as on upload. Reading sends the document to the model, so the firm's
 * `ai_analysis` consent is asked first.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, fileId } = await params;

  const refused = await refuseIfDisabled(session.firmId, 'ai_analysis');
  if (refused) return refused;

  const authed = await getSupabaseServerAuthClient();
  const { data: corp } = await authed.from('corporations').select('id').eq('id', id).maybeSingle();
  if (!corp) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: file } = await getServiceDbForFirm(session.firmId)
    .from('corporation_files')
    .select('category, storage_path, name')
    .eq('id', Number(fileId))
    .eq('corporation_id', id)
    .maybeSingle();
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Only an object under this company's own folder in the firm's prefix is read,
  // the same rule the upload commit holds a path to.
  if (!isPathUnder(file.storage_path as string, firmStoragePath(session.firmId, `corporations/${id}`))) {
    return NextResponse.json({ error: 'This file is not stored under the company and cannot be read.' }, { status: 409 });
  }

  const category = file.category as string;
  if (!isExtractable(category)) {
    return NextResponse.json({ error: `A ${category} isn't one of the documents that can be read.` }, { status: 400 });
  }

  const registration = await readDocument(
    session.firmId, id, category, file.storage_path as string, file.name as string, session.user.notionUserId, { autoApply: false },
  );
  if (!registration) {
    return NextResponse.json({ error: 'This company is already registered; its certificate is kept for the record.' }, { status: 409 });
  }
  return NextResponse.json({ registration });
}
