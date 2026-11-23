import { firmStoragePath } from '@/lib/tenancy/service-db';
import { checkPathUnder } from '@/lib/storage/upload-path';

/**
 * Where a chat attachment lives in the `chat-attachments` bucket:
 * `<firmId>/chat/<channelId>/<fileId>/<name>`. The stored message carries this
 * object key as-is, so the upload, the message and the sign route agree on one
 * string — the old key carried the bucket name as a prefix that the sign route
 * then stripped, and the two never matched.
 */
export function chatAttachmentPrefix(firmId: string, channelId: string): string {
  return firmStoragePath(firmId, `chat/${channelId}`);
}

const CHANNEL_SEGMENT = /^[0-9a-f-]{36}$/i;

/**
 * The channel an attachment key belongs to, or null when the key is not a
 * well-formed chat attachment under this firm's prefix. The caller still has
 * to check membership of that channel before signing anything.
 */
export function channelOfAttachment(firmId: string, path: string | null | undefined): string | null {
  const root = firmStoragePath(firmId, 'chat');
  const checked = checkPathUnder(path, root);
  if (!checked.ok) return null;
  const channelId = checked.path.slice(root.length).replace(/^\//, '').split('/')[0];
  return CHANNEL_SEGMENT.test(channelId) ? channelId : null;
}

/** Whether a client-supplied attachment key sits inside this channel's folder. */
export function isAttachmentOfChannel(firmId: string, channelId: string, path: unknown): boolean {
  return typeof path === 'string' && checkPathUnder(path, chatAttachmentPrefix(firmId, channelId)).ok;
}
