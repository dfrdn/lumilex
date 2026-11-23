import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

const ADMIN_ROLES = new Set(['admin', 'super_user', 'finance']);
const MAX_BYTES = 2 * 1024 * 1024; // 2 MiB (avatars bucket limit)
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// Uploads a team headshot for the firm profile to the public avatars bucket
// under a firm-profile/ prefix and returns its public URL.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId || !ADMIN_ROLES.has(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  const ext = MIME_EXT[file.type];
  if (!ext) {
    return NextResponse.json({ error: 'Photo must be PNG, JPEG, WebP, or GIF' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Photo must be 2 MB or smaller' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const slugRaw = form?.get('slug');
  const safe = (typeof slugRaw === 'string' ? slugRaw : '').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'member';
  const path = `firm-profile/${safe}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await supabase.storage.from('avatars').upload(path, buffer, {
    contentType: file.type,
    upsert: true,
    cacheControl: '3600',
  });
  if (error) {
    return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 500 });
  }

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  return NextResponse.json({ url: pub.publicUrl });
}
