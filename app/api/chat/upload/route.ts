import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { randomUUID } from 'crypto';
import { chatAttachmentPrefix, isAttachmentOfChannel } from '@/lib/chat/attachment-path';

function sanitizeName(name: string) {
  return name
    .replace(/[\[\](){}]/g, '')
    .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * POST /api/chat/upload
 * Two-phase upload for chat attachments using signed URLs.
 *
 * Phase 1 — get signed URL:
 *   Body JSON: { channelId, file: { name, type, size } }
 *   Returns: { signedUrl, token, attachment: { name, path, size, mime_type } }
 *
 * Phase 2 — confirm upload:
 *   Body JSON: { channelId, confirm: true, attachment: { name, path, size, mime_type } }
 *   Returns: { attachment }
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;
  const supabase = getServiceDbForFirm(session.firmId);

  try {
    const body = await req.json();
    const { channelId } = body;

    if (!channelId) {
      return NextResponse.json({ error: 'channelId required' }, { status: 400 });
    }

    // Verify membership
    const { data: channel } = await supabase
      .from('chat_channels')
      .select('member_ids')
      .eq('id', channelId)
      .single();

    if (!channel || !channel.member_ids.includes(personId)) {
      return NextResponse.json({ error: 'Not a member' }, { status: 403 });
    }

    // Phase 2: Confirm — just return the attachment (file is already in storage)
    if (body.confirm) {
      const attachment = body.attachment;
      if (!attachment) {
        return NextResponse.json({ error: 'Missing attachment' }, { status: 400 });
      }
      if (!isAttachmentOfChannel(session.firmId, channelId, attachment.path)) {
        return NextResponse.json({ error: 'Invalid attachment path' }, { status: 400 });
      }
      return NextResponse.json({ attachment });
    }

    // Phase 1: Generate signed upload URL
    const file = body.file;
    if (!file || !file.name) {
      return NextResponse.json({ error: 'file required' }, { status: 400 });
    }

    const fileId = randomUUID();
    const sanitizedName = sanitizeName(file.name);
    const storagePath = `${chatAttachmentPrefix(session.firmId, channelId)}/${fileId}/${sanitizedName}`;

    const { data, error } = await supabase.storage
      .from('chat-attachments')
      .createSignedUploadUrl(storagePath);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      signedUrl: data.signedUrl,
      token: data.token,
      attachment: {
        name: file.name,
        path: storagePath,
        size: file.size,
        mime_type: file.type,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[chat/upload] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
