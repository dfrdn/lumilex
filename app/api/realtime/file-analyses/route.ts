import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/realtime/file-analyses?ids=id1,id2,id3
 * Server-Sent Events endpoint for real-time file analysis status updates.
 * Subscribes to Supabase Realtime for status changes on specified file analyses.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const fileIds = searchParams.get('ids')?.split(',').filter(Boolean) ?? [];

  if (fileIds.length === 0) {
    return new Response('Missing ids parameter', { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(': heartbeat\n\n'));

      // Clear any stale channel from a previous request (singleton client retains them).
      const topic = `realtime:file-analyses:${session.user.notionUserId}`;
      const stale = supabase.getChannels().find((c) => c.topic === topic);
      if (stale) supabase.removeChannel(stale);

      // Subscribe to file_analyses changes for the specified file IDs. Realtime
      // has no IN filter, so we filter by firm server-side and match the
      // requested file ids in-process.
      const channel = supabase
        .channel(`file-analyses:${session.user.notionUserId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'file_analyses',
            filter: `firm_id=eq.${session.firmId}`,
          },
          (payload) => {
            const row = payload.new as Record<string, unknown>;
            // Only forward updates for file IDs the client cares about
            if (fileIds.includes(row.file_id as string)) {
              try {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({
                    type: 'update',
                    fileId: row.file_id,
                    analysis: {
                      id: row.id,
                      status: row.status,
                      shortSummary: row.short_summary ?? null,
                      summary: row.summary ?? null,
                      entities: row.entities ?? null,
                      errorMessage: row.error_message ?? null,
                      completedAt: row.completed_at ?? null,
                    },
                  })}\n\n`),
                );
              } catch {
                // Stream closed
              }
            }
          },
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'file_analyses',
            filter: `firm_id=eq.${session.firmId}`,
          },
          (payload) => {
            const row = payload.new as Record<string, unknown>;
            if (fileIds.includes(row.file_id as string)) {
              try {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({
                    type: 'new',
                    fileId: row.file_id,
                    analysis: {
                      id: row.id,
                      status: row.status,
                      attachmentName: row.attachment_name,
                    },
                  })}\n\n`),
                );
              } catch {
                // Stream closed
              }
            }
          },
        )
        .subscribe();

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        supabase.removeChannel(channel);
      };

      (controller as unknown as Record<string, unknown>).__cleanup = cleanup;
    },
    cancel(controller) {
      const cleanup = (controller as unknown as Record<string, unknown>).__cleanup as (() => void) | undefined;
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
