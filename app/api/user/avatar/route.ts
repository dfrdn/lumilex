import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { refuseInDemo } from '@/lib/demo/guard';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MiB
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function avatarPath(personId: string, ext: string) {
  return `${personId}.${ext}`;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const personId = session?.user?.notionUserId;
  if (!personId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const demoRefusal = await refuseInDemo(session!.firmId, 'Changing profile photos');
  if (demoRefusal) return demoRefusal;

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: 'Avatar must be PNG, JPEG, WebP, or GIF' },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'Avatar must be 2 MB or smaller' },
      { status: 400 },
    );
  }

  const supabase = getServiceDbForFirm(session!.firmId);

  const ext = MIME_EXT[file.type];
  const newPath = avatarPath(personId, ext);

  // Remove a prior avatar with a different extension to avoid orphans.
  const { data: existing } = await supabase
    .from('team')
    .select('avatar_url')
    .eq('person_id', personId)
    .single();
  const prev = existing?.avatar_url || '';
  const prevPath = prev ? prev.split('/').pop()?.split('?')[0] : null;
  if (prevPath && prevPath !== newPath) {
    await supabase.storage.from('avatars').remove([prevPath]).catch(() => {});
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(newPath, buffer, {
      contentType: file.type,
      upsert: true,
      cacheControl: '3600',
    });
  if (uploadError) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadError.message}` },
      { status: 500 },
    );
  }

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(newPath);
  const url = `${pub.publicUrl}?v=${Date.now()}`;
  const { error: updateError } = await supabase
    .from('team')
    .update({ avatar_url: url })
    .eq('person_id', personId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, avatar: url });
}

export async function DELETE() {
  const session = await getSession();
  const personId = session?.user?.notionUserId;
  if (!personId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const demoRefusal = await refuseInDemo(session!.firmId, 'Changing profile photos');
  if (demoRefusal) return demoRefusal;

  const supabase = getServiceDbForFirm(session!.firmId);

  const { data: existing } = await supabase
    .from('team')
    .select('avatar_url')
    .eq('person_id', personId)
    .single();
  const prev = existing?.avatar_url || '';
  const prevPath = prev ? prev.split('/').pop()?.split('?')[0] : null;
  if (prevPath) {
    await supabase.storage.from('avatars').remove([prevPath]).catch(() => {});
  }

  const { error } = await supabase
    .from('team')
    .update({ avatar_url: '' })
    .eq('person_id', personId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
