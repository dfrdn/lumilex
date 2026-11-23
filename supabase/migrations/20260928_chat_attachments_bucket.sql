-- The chat-attachments bucket. The chat upload and sign routes have always
-- written to and signed from it, but it was never created, so every
-- attachment failed at upload and chat had no attachments at all.
--
-- Private, with no storage.objects policy: like every other private bucket
-- here, uploads go through a server-minted signed upload URL and reads
-- through a server-minted signed URL, both issued only after the route has
-- checked channel membership on the firm-scoped client. Keys are
-- <firmId>/chat/<channelId>/<fileId>/<name> (lib/chat/attachment-path.ts).
-- Idempotent.

insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;
