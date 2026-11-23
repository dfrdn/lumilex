import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { rowToCorporationFile } from '@/lib/corporation-row';
import { isExtractable } from '@/lib/ai/corporation-doc-extract';
import { readDocument } from '@/lib/corporations/read-document';
import { logAudit, getClientIP } from '@/lib/audit';

const VALID_CATEGORIES = new Set([
  'AOI', 'By-Laws', 'Treasurer Affidavit',
  'Name Verification Slip', 'Inward Remittance Cert', 'SEC Filing Receipt',
  'SEC COR',
  'BIR COR', 'BIR Books', 'Authority to Print',
  'Business Permit', 'Barangay Clearance', 'Sanitary Permit', 'Fire Safety Inspection',
  'SSS R-1', 'PhilHealth ER1', 'Pag-IBIG EFR',
  'Stock Certificate', 'Deed of Assignment',
  'GIS', 'AFS',
  'Beneficial Ownership Declaration',
  'ID Copy',
  'Other',
]);

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const supabase = getServiceDbForFirm(session.firmId);
  const { data } = await supabase
    .from('corporation_files')
    .select('*')
    .eq('corporation_id', id)
    .order('uploaded_at', { ascending: false });
  return NextResponse.json({
    files: (data ?? []).map((r) => rowToCorporationFile(r as Record<string, unknown>)),
  });
}

/**
 * Two-phase, direct-to-storage upload.
 *
 * Phase 1 (`{ name, category }`) mints a signed upload URL; the browser PUTs
 * the file straight to Supabase Storage. Phase 2 (`{ commit: true, … }`)
 * records the row and reads the document.
 *
 * The file never passes through this function, which is the point: Vercel caps
 * a serverless request body at 4.5MB, and scanned CORs, business permits and
 * BIR certificates routinely exceed that. The old `req.formData()` version was
 * rejected at the platform edge before the handler ran, so it failed with no
 * server-side trace — see the `corporation_files` size distribution, which
 * stopped dead at 4.13MB.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const category = (body.category as string | null) ?? 'Other';
  if (!VALID_CATEGORIES.has(category)) {
    return NextResponse.json({ error: 'invalid category' }, { status: 400 });
  }
  const personIdRaw = body.personId == null ? null : Number(body.personId);
  if (personIdRaw !== null && (!Number.isFinite(personIdRaw) || personIdRaw <= 0)) {
    return NextResponse.json({ error: 'invalid personId' }, { status: 400 });
  }
  const personId = personIdRaw;

  const supabase = getServiceDbForFirm(session.firmId);

  if (body.commit === true) {
    return commitUpload(req, {
      firmId: session.firmId,
      corporationId: id,
      category,
      personId,
      storagePath: String(body.storagePath ?? ''),
      name: String(body.name ?? ''),
      sizeBytes: Number(body.sizeBytes) || null,
      mimeType: (body.mimeType as string | null) || null,
      filingYear: Number.isInteger(Number(body.filingYear)) ? Number(body.filingYear) : null,
      userId: session.user.notionUserId,
    });
  }

  // ── Phase 1: mint a signed upload URL ──────────────────────────────────
  const name = String(body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const safeName = name.replace(/[^a-zA-Z0-9 ._-]/g, '_');
  const folder = personId ? `corporations/${id}/persons/${personId}` : `corporations/${id}`;
  const storagePath = firmStoragePath(session.firmId, `${folder}/${Date.now()}-${safeName}`);

  const { data, error } = await supabase.storage.from('files').createSignedUploadUrl(storagePath);
  if (error || !data) {
    console.error('[corporation files] createSignedUploadUrl failed', error);
    return NextResponse.json({ error: `Failed to prepare upload for ${name}` }, { status: 500 });
  }

  return NextResponse.json({ storagePath, signedUrl: data.signedUrl, token: data.token });
}

interface CommitInput {
  firmId: string;
  corporationId: string;
  category: string;
  personId: number | null;
  storagePath: string;
  name: string;
  sizeBytes: number | null;
  mimeType: string | null;
  /** Only meaningful for GIS/AFS — which year the document covers. */
  filingYear: number | null;
  userId: string;
}

/**
 * Phase 2: confirm the object landed, record the row, then read the document.
 *
 * Verifying before inserting mirrors the deliverable-files fix — recording a
 * row whose storage object never arrived produces a file that lists with a size
 * and 404s on download.
 */
async function commitUpload(req: Request, input: CommitInput) {
  const supabase = getServiceDbForFirm(input.firmId);
  const { corporationId, category, personId, storagePath, name } = input;

  if (!storagePath || !name) {
    return NextResponse.json({ error: 'storagePath and name are required' }, { status: 400 });
  }
  if (!storagePath.startsWith(firmStoragePath(input.firmId, `corporations/${corporationId}/`))) {
    return NextResponse.json({ error: 'storagePath does not belong to this corporation' }, { status: 400 });
  }

  const folder = storagePath.slice(0, storagePath.lastIndexOf('/'));
  const objectName = storagePath.slice(storagePath.lastIndexOf('/') + 1);
  const { data: listed } = await supabase.storage.from('files').list(folder, { search: objectName });
  if (!listed?.some((o) => o.name === objectName)) {
    return NextResponse.json(
      { error: 'The upload did not complete — the file was not found in storage.' },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from('corporation_files')
    .insert({
      corporation_id: corporationId,
      person_id: personId,
      category,
      name,
      storage_path: storagePath,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      filing_year: input.filingYear,
      uploaded_by: input.userId,
    })
    .select('*')
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Record failed' }, { status: 500 });

  logAudit({
    firmId: input.firmId,
    entityType: 'Corporation',
    entityId: corporationId,
    action: 'file_uploaded',
    fieldChanged: category,
    newValue: name,
    performedBy: input.userId,
    ipAddress: getClientIP(req),
  });

  const registration = isExtractable(category)
    ? await readDocument(input.firmId, corporationId, category, storagePath, name, input.userId, { autoApply: true })
    : null;

  return NextResponse.json({
    ok: true,
    file: rowToCorporationFile(data as Record<string, unknown>),
    ...(registration ? { registration } : {}),
  });
}
