import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { channelOfAttachment } from '@/lib/chat/attachment-path';
import { signStoragePaths } from '@/lib/storage-sign';

/**
 * POST /api/chat/sign-attachment
 * Body: { paths: string[] }
 * Returns: { urls: Record<path, signedUrl> }
 *
 * Verifies the caller is a member of every channel the requested paths belong to,
 * then signs each path with an inline (download=false) Content-Disposition so the
 * browser/SFSafari renders the file rather than downloading it.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const paths: string[] = Array.isArray(body?.paths) ? body.paths.filter((p: unknown) => typeof p === 'string') : [];
  if (!paths.length) return NextResponse.json({ urls: {} });

  const supabase = getServiceDbForFirm(session.firmId);
  const personId = session.user.notionUserId;

  // Each path is an object key "<firmId>/chat/<channelId>/<fileId>/<name>".
  // Re-derive the channel from it (a key outside this firm's prefix yields
  // none), then sign only where the caller is a member of that channel.
  const channelIdsByPath: Record<string, string> = {};
  for (const p of paths) {
    const channelId = channelOfAttachment(session.firmId, p);
    if (channelId) channelIdsByPath[p] = channelId;
  }

  const channelIds = [...new Set(Object.values(channelIdsByPath))];
  const { data: channels } = await supabase
    .from('chat_channels')
    .select('id, member_ids')
    .in('id', channelIds.length ? channelIds : ['__none__']);

  const memberOfChannel = new Set(
    (channels ?? []).filter((c) => c.member_ids.includes(personId)).map((c) => c.id),
  );

  const signed = await signStoragePaths(
    supabase,
    'chat-attachments',
    paths.filter((path) => {
      const cid = channelIdsByPath[path];
      return !!cid && memberOfChannel.has(cid);
    }),
    60 * 60,
  );

  return NextResponse.json({ urls: Object.fromEntries(signed) });
}
