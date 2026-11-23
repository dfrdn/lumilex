import { NextResponse, after } from 'next/server';
import { getSession } from '@/lib/session';
import { isFeatureAvailable } from '@/lib/firm/features';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { logAudit, getClientIP } from '@/lib/audit';
import { isSupportedFileType } from '@/lib/ai/document-parser';
import { redTeamPleading } from '@/lib/ai/red-team';
import { canAccessMatter, canAccessRun } from '@/lib/legal/red-team-access';

// Everything the client actually renders. Deliberately not `select('*')`:
// `extracted_text` holds the whole pleading and must not ride along on a poll.
const RUN_COLUMNS =
  'id, matter_id, deliverable_id, source, mode, file_name, status, document_type, ' +
  'overall_risk, weakest_link, opposing_theory, findings, severity_breakdown, finding_count, ' +
  'adverse_authorities, citation_checks, concessions, adverse_search_available, ' +
  'cite_check_available, target_file_name, target_document_type, response_coverage, ' +
  'error_message, reviewed_by, created_at, completed_at';

// The review runs in after(); the three passes plus the juris.ph legs need room.
export const maxDuration = 300;

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'pleading';
}

/** Normalize a stored file_url (which may be a full signed URL) to a bucket path. */
function toStoragePath(fileUrl: string): string {
  const m = fileUrl.match(/\/storage\/v1\/object\/(?:sign|public)\/files\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : fileUrl;
}

// ── GET: poll a single run (?id=) or list recent (?matterId=) ────────
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await isFeatureAvailable(session.firmId, 'red_team'))) {
    return NextResponse.json({ error: 'Red Team is not enabled for this firm.' }, { status: 403 });
  }
  const personId = session.user.notionUserId;
  const role = session.user.role ?? 'lawyer';
  const isPrivileged = role === 'partner' || role === 'admin' || role === 'super_user';

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const matterId = searchParams.get('matterId');
  const supabase = getServiceDbForFirm(session.firmId);

  if (id) {
    const access = await canAccessRun(session.firmId, id, personId, role);
    if (!access.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data, error } = await supabase
      .from('pleading_red_teams').select(RUN_COLUMNS).eq('id', id).maybeSingle();
    if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ run: data });
  }

  let query = supabase
    .from('pleading_red_teams')
    .select('id, matter_id, deliverable_id, file_name, mode, status, document_type, overall_risk, finding_count, created_at, completed_at')
    .order('created_at', { ascending: false })
    .limit(50);

  // Filtering by matter must never widen what the caller can see: a matter
  // filter is only honoured once RLS confirms access to that matter, and the
  // own-runs restriction still applies on top for unprivileged callers.
  if (matterId) {
    if (!isPrivileged && !(await canAccessMatter(matterId))) {
      return NextResponse.json({ runs: [] });
    }
    query = query.eq('matter_id', matterId);
  } else if (!isPrivileged) {
    query = query.eq('reviewed_by', personId);
  }

  const { data } = await query;
  return NextResponse.json({ runs: data ?? [] });
}

/** A document the run will read, resolved from either input path. */
interface ResolvedDocument {
  source: 'upload' | 'deliverable';
  fileName: string;
  storagePath: string;
  deliverableId: string | null;
  deliverableFileId: number | null;
  /** Only set for a deliverable — the matter it belongs to, per RLS. */
  matterId: string | null;
}

class InputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

async function uploadPleading(file: File, label: string): Promise<ResolvedDocument> {
  if (!isSupportedFileType(file.name)) {
    throw new InputError(`Unsupported file type for ${label}. Upload a PDF or Word document.`);
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = `documents/red-team/${Date.now()}_${sanitizeName(file.name)}`;
  // storage-only: raw client for the handle
  const { error } = await getSupabase().storage
    .from('files')
    .upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (error) throw new InputError(`Upload failed: ${error.message}`, 500);
  return {
    source: 'upload',
    fileName: file.name,
    storagePath,
    deliverableId: null,
    deliverableFileId: null,
    matterId: null,
  };
}

/**
 * Resolve a deliverable's latest (or requested) file version. The deliverable
 * is read with the AUTHED client so RLS decides access — this is the gate for
 * both documents, and it is what stops a caller naming a deliverable from
 * another matter as the pleading being answered and reading it back through the
 * report. The file row itself is then a service-role read.
 */
async function resolveDeliverable(
  deliverableId: string,
  deliverableFileId: number | null,
  label: string,
  firmId: string,
): Promise<ResolvedDocument> {
  const authed = await getSupabaseServerAuthClient();
  const { data: deliv } = await authed
    .from('deliverables').select('notion_id, matter_id').eq('notion_id', deliverableId).maybeSingle();
  if (!deliv) throw new InputError(`${label} not found`, 404);

  let fq = getServiceDbForFirm(firmId).from('deliverable_files')
    .select('id, file_name, file_url, version')
    .eq('deliverable_id', deliverableId);
  if (deliverableFileId) fq = fq.eq('id', deliverableFileId);
  const { data: files } = await fq.order('version', { ascending: false }).limit(1);
  const fileRow = files?.[0];
  if (!fileRow?.file_url) throw new InputError(`No file found on ${label.toLowerCase()}`);
  if (!isSupportedFileType(fileRow.file_name || fileRow.file_url)) {
    throw new InputError(`${label} is not a PDF or Word document.`);
  }

  return {
    source: 'deliverable',
    fileName: fileRow.file_name || 'pleading',
    storagePath: toStoragePath(fileRow.file_url),
    deliverableId,
    deliverableFileId: fileRow.id,
    // Take the matter from the authorized deliverable, never from the body — a
    // caller-supplied id would otherwise steer the grounding read at an
    // arbitrary matter while passing the deliverable's RLS check.
    matterId: deliv.matter_id ?? null,
  };
}

// ── POST: start a run. The pleading under review comes from an upload or a
// deliverable; a responsive draft may carry the pleading it answers from either
// source too, which is why an upload and a deliverable id can arrive together.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await isFeatureAvailable(session.firmId, 'red_team'))) {
    return NextResponse.json({ error: 'Red Team is not enabled for this firm.' }, { status: 403 });
  }
  const personId = session.user.notionUserId;
  const firmId = session.firmId;
  const service = getServiceDbForFirm(firmId);
  const contentType = req.headers.get('content-type') || '';

  try {
    let mode: 'self' | 'opposing' = 'self';
    let matterId: string | null = null;
    let deliverableId: string | null = null;
    let deliverableFileId: number | null = null;
    let targetDeliverableId: string | null = null;
    let file: File | null = null;
    let targetFile: File | null = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      mode = form.get('mode') === 'opposing' ? 'opposing' : 'self';
      matterId = (form.get('matterId') as string) || null;
      deliverableId = (form.get('deliverableId') as string) || null;
      targetDeliverableId = (form.get('targetDeliverableId') as string) || null;
      const f = form.get('file');
      const tf = form.get('targetFile');
      file = f instanceof File ? f : null;
      targetFile = tf instanceof File ? tf : null;
    } else {
      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      mode = body.mode === 'opposing' ? 'opposing' : 'self';
      deliverableId = (body.deliverableId as string) ?? null;
      deliverableFileId = (body.deliverableFileId as number) ?? null;
      targetDeliverableId = (body.targetDeliverableId as string) ?? null;
      matterId = (body.matterId as string) ?? null;
    }

    if (!file && !deliverableId) {
      return NextResponse.json({ error: 'deliverableId or a file upload is required' }, { status: 400 });
    }
    if (targetDeliverableId && targetDeliverableId === deliverableId) {
      return NextResponse.json({ error: 'A pleading cannot be a response to itself.' }, { status: 400 });
    }
    // The matter id is not a label here — the engine feeds it to
    // assembleDraftGrounding, which reads the matter brief and the matter's own
    // documents with the service-role client. An unauthorized id would put
    // another matter's privileged record into this report. Settled before the
    // upload so a rejected run costs nothing.
    if (file && matterId && !(await canAccessMatter(matterId))) {
      return NextResponse.json({ error: 'Matter not found' }, { status: 404 });
    }

    const main = file
      ? await uploadPleading(file, 'the pleading')
      : await resolveDeliverable(deliverableId!, deliverableFileId, 'Deliverable', firmId);
    // A deliverable carries its own matter, and RLS has just vouched for it.
    if (main.source === 'deliverable') matterId = main.matterId;

    const target = targetFile
      ? await uploadPleading(targetFile, 'the pleading being answered')
      : targetDeliverableId
        ? await resolveDeliverable(targetDeliverableId, null, 'The pleading being answered', firmId)
        : null;

    const { data: row, error: insErr } = await service
      .from('pleading_red_teams')
      .insert({
        matter_id: matterId,
        deliverable_id: main.deliverableId,
        deliverable_file_id: main.deliverableFileId,
        source: main.source,
        mode,
        file_name: main.fileName,
        storage_path: main.storagePath,
        target_source: target?.source ?? null,
        target_deliverable_id: target?.deliverableId ?? null,
        target_deliverable_file_id: target?.deliverableFileId ?? null,
        target_file_name: target?.fileName ?? null,
        target_storage_path: target?.storagePath ?? null,
        status: 'pending',
        reviewed_by: personId,
      })
      .select('id')
      .single();
    if (insErr || !row) {
      return NextResponse.json({ error: insErr?.message ?? 'Could not start the review' }, { status: 500 });
    }

    logAudit({
      firmId: session.firmId,
      entityType: 'PleadingRedTeam',
      entityId: String(row.id),
      action: 'created',
      performedBy: personId,
      ipAddress: getClientIP(req),
    });

    after(async () => {
      try {
        await redTeamPleading(row.id, firmId);
      } catch (err) {
        console.error('[red-team] background processing failed:', err);
      }
    });

    return NextResponse.json({ id: row.id });
  } catch (err) {
    if (err instanceof InputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[red-team] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
