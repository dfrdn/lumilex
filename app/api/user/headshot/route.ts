import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { refuseInDemo } from '@/lib/demo/guard';

// Corporate headshot shown to clients in the portal — managed separately from
// the internal avatar (/api/user/avatar) so the casual photo never leaks to
// the client-facing surface.

const MAX_BYTES = 4 * 1024 * 1024; // 4 MiB — headshots are print-quality
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

function headshotPath(personId: string, ext: string) {
  return `headshots/${personId}.${ext}`;
}

function pathFromUrl(url: string): string | null {
  if (!url) return null;
  const m = url.match(/\/avatars\/(.+?)(\?|$)/);
  return m ? m[1] : null;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const personId = session?.user?.notionUserId;
  if (!personId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const demoRefusal = await refuseInDemo(session!.firmId, 'Changing headshots');
  if (demoRefusal) return demoRefusal;

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: 'Headshot must be PNG, JPEG, or WebP' },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'Headshot must be 4 MB or smaller' },
      { status: 400 },
    );
  }

  const supabase = getServiceDbForFirm(session!.firmId);

  const ext = MIME_EXT[file.type];
  const newPath = headshotPath(personId, ext);

  const { data: existing } = await supabase
    .from('team')
    .select('headshot_url')
    .eq('person_id', personId)
    .single();
  const prevPath = pathFromUrl(existing?.headshot_url || '');
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
    .update({ headshot_url: url })
    .eq('person_id', personId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, headshot: url });
}

export async function DELETE() {
  const session = await getSession();
  const personId = session?.user?.notionUserId;
  if (!personId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const demoRefusal = await refuseInDemo(session!.firmId, 'Changing headshots');
  if (demoRefusal) return demoRefusal;

  const supabase = getServiceDbForFirm(session!.firmId);

  const { data: existing } = await supabase
    .from('team')
    .select('headshot_url')
    .eq('person_id', personId)
    .single();
  const prevPath = pathFromUrl(existing?.headshot_url || '');
  if (prevPath) {
    await supabase.storage.from('avatars').remove([prevPath]).catch(() => {});
  }

  const { error } = await supabase
    .from('team')
    .update({ headshot_url: '' })
    .eq('person_id', personId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
