import { getSession } from '@/lib/session';
import { NextRequest, NextResponse } from 'next/server';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

async function assertAdmin() {
  const session = await getSession();
  const role = session?.user?.role;
  if (!role || !['admin', 'super_user', 'finance'].includes(role)) return null;
  return session;
}

// ---------------------------------------------------------------------------
// GET /api/admin/signatures — List team members with signature status
// ---------------------------------------------------------------------------
export async function GET() {
  const session = await assertAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const { data, error } = await supabase
    .from('team')
    .select('person_id, name, position, active, signature_url')
    .eq('active', true)
    .order('name', { ascending: true });

  if (error) {
    console.error('[admin-signatures]', error.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ data });
}

// ---------------------------------------------------------------------------
// POST /api/admin/signatures — Upload signature PNG for a team member
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const session = await assertAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await req.formData();
  const personId = formData.get('personId') as string;
  const file = formData.get('file') as File | null;

  if (!personId || !file) {
    return NextResponse.json(
      { error: 'personId and file are required' },
      { status: 400 },
    );
  }

  // Validate file type
  if (!file.type.startsWith('image/')) {
    return NextResponse.json(
      { error: 'File must be an image (PNG recommended)' },
      { status: 400 },
    );
  }

  const supabase = getServiceDbForFirm(session.firmId);

  // The person must be on this firm's team before anything is written: the
  // key below is built from personId, so an unchecked id would let one firm
  // overwrite another firm's signature image.
  const { data: member } = await supabase
    .from('team')
    .select('person_id')
    .eq('person_id', personId)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
  }

  const rawExt = (file.name.split('.').pop() || '').toLowerCase();
  const ext = IMAGE_EXTENSIONS.has(rawExt) ? rawExt : 'png';
  const storagePath = firmStoragePath(session.firmId, `signatures/${member.person_id}.${ext}`);

  // Upload to Supabase Storage (upsert)
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from('files')
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadError) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadError.message}` },
      { status: 500 },
    );
  }

  // Update team.signature_url
  const { error: updateError } = await supabase
    .from('team')
    .update({ signature_url: storagePath })
    .eq('person_id', personId);

  if (updateError) {
    return NextResponse.json(
      { error: `DB update failed: ${updateError.message}` },
      { status: 500 },
    );
  }

  // Return signed URL for preview
  const { data: signed } = await supabase.storage
    .from('files')
    .createSignedUrl(storagePath, 3600);

  return NextResponse.json({
    ok: true,
    signatureUrl: storagePath,
    signedUrl: signed?.signedUrl ?? null,
  });
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/signatures — Remove signature for a team member
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  const session = await assertAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { personId } = await req.json();
  if (!personId) {
    return NextResponse.json(
      { error: 'personId is required' },
      { status: 400 },
    );
  }

  const supabase = getServiceDbForFirm(session.firmId);

  // Get current signature path. The row is read through the firm-scoped client,
  // so a personId from another firm finds nothing and nothing is removed.
  const { data: team } = await supabase
    .from('team')
    .select('signature_url')
    .eq('person_id', personId)
    .maybeSingle();
  if (!team) {
    return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
  }

  if (team.signature_url) {
    await supabase.storage.from('files').remove([team.signature_url]);
  }

  // Clear signature_url
  await supabase
    .from('team')
    .update({ signature_url: '' })
    .eq('person_id', personId);

  return NextResponse.json({ ok: true });
}
