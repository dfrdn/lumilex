import { NextResponse, after } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { generateActionNotifications, generateMentionNotifications } from '@/lib/notifications';
import { logAudit, getClientIP } from '@/lib/audit';
import { ensureStatusReportForFiledDeliverable } from '@/lib/status-report-auto';
import { DELIVERABLE_STATUS, filedOnDay } from '@/lib/deliverable-status';
import { currentTeamIds, currentOnly } from '@/lib/queries/people';

// Filing a deliverable also awaits status-report creation (a short chain of
// Supabase round-trips) so the client can toast it. Give the response timeout
// headroom — a 504 here would make the client revert an action that persisted.
export const maxDuration = 30;

// ── Helpers ──

const MIME_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
};

function inferMimeType(fileName: string, providedType?: string): string {
  if (providedType && providedType !== 'application/octet-stream') return providedType;
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

// ── PATCH: Edit an action's comment and/or attach/replace a file ──

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;

  try {
    const formData = await req.formData();
    const actionId = formData.get('id') as string | null;
    const newComment = formData.get('comment') as string | null;
    const newFile = formData.get('file') as File | null;
    const mentionsRaw = formData.get('mentions') as string | null;
    const mentionsParsed: { id: string; name: string }[] = mentionsRaw ? JSON.parse(mentionsRaw) : [];

    if (!actionId) {
      return NextResponse.json({ error: 'Missing action id' }, { status: 400 });
    }

    const supabase = getServiceDbForFirm(session.firmId);

    // Fetch existing action and verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from('deliverable_actions')
      .select('*')
      .eq('id', Number(actionId))
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    if (existing.performed_by !== personId) {
      return NextResponse.json({ error: 'You can only edit your own actions' }, { status: 403 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {};
    const changes: string[] = [];

    // Update comment if provided
    if (newComment !== null) {
      updates.comment = newComment || null;
      updates.mentions = mentionsParsed.map((m) => m.id);
      changes.push('Updated comment');
    }

    // Attach or replace file
    if (newFile) {
      // Remove old file from storage if one exists
      if (existing.file_url) {
        await supabase.storage.from('files').remove([existing.file_url]);
      }

      // Upload new file (sanitize filename for storage)
      const safeName = newFile.name
        .replace(/[\[\](){}]/g, '')
        .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
      const storagePath = firmStoragePath(session.firmId, `${existing.deliverable_id}/actions/${existing.id}/${safeName}`);
      const buffer = Buffer.from(await newFile.arrayBuffer());
      const { error: uploadError } = await supabase.storage
        .from('files')
        .upload(storagePath, buffer, {
          contentType: inferMimeType(newFile.name, newFile.type),
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Storage upload failed: ${uploadError.message}`);
      }

      // Generate signed URL for the response
      const { data: urlData } = await supabase.storage
        .from('files')
        .createSignedUrl(storagePath, 60 * 60);

      updates.file_url = storagePath;
      updates.file_name = newFile.name;
      changes.push(existing.file_url ? `Replaced file with "${newFile.name}"` : `Added file "${newFile.name}"`);

      // Record as a deliverable_files submission
      // Try to find an existing record to update (if replacing a previously tracked file)
      let didUpdate = false;
      if (existing.file_url) {
        const { data: existingSubmission } = await supabase
          .from('deliverable_files')
          .select('id')
          .eq('file_url', existing.file_url)
          .limit(1);

        if (existingSubmission?.[0]) {
          await supabase.from('deliverable_files')
            .update({ file_name: newFile.name, file_url: storagePath, file_size: newFile.size })
            .eq('id', existingSubmission[0].id);
          didUpdate = true;
        }
      }

      // No existing record found — create a new submission
      if (!didUpdate) {
        const { data: latestFiles } = await supabase
          .from('deliverable_files')
          .select('version')
          .eq('deliverable_id', existing.deliverable_id)
          .order('version', { ascending: false })
          .limit(1);

        const nextVersion = (latestFiles?.[0]?.version ?? 0) + 1;

        await supabase.from('deliverable_files').insert({
          deliverable_id: existing.deliverable_id,
          version: nextVersion,
          file_name: newFile.name,
          file_url: storagePath,
          file_size: newFile.size,
          uploaded_by: personId,
          action: existing.action || null,
        });
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
    }

    // Apply updates
    const { error: updateError } = await supabase
      .from('deliverable_actions')
      .update(updates)
      .eq('id', Number(actionId));

    if (updateError) {
      throw new Error(`Update failed: ${updateError.message}`);
    }

    // Log the edit as a separate action entry for audit trail
    await supabase.from('deliverable_actions').insert({
      deliverable_id: existing.deliverable_id,
      action: `Edited action "${existing.action}"`,
      old_status: existing.old_status,
      new_status: existing.new_status,
      performed_by: personId,
      comment: changes.join('; '),
    });

    // Notify mentioned users after the response is sent
    if (newComment && mentionsParsed.length > 0) {
      after(() =>
        generateMentionNotifications({
          firmId: session.firmId,
          notionId: existing.deliverable_id,
          mentions: mentionsParsed,
          comment: newComment,
          performedBy: personId,
        }).catch((err) => console.error('[deliverable-action] PATCH mention notification failed:', err.message)),
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[deliverable-action] PATCH error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── POST: Execute a workflow action ──

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const {
    notionId,
    action,
    oldStatus,
    newStatus,
    comment,
    mentions,
    fileUrl,
    fileName,
    fileSize,
    currentlyWithIds: requestedCurrentlyWith,
    dateDone: requestedDateDone,
  } = await req.json();

  if (!notionId || !action || !oldStatus) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const filing = newStatus === DELIVERABLE_STATUS.FILED_OR_SENT_OUT;
  const dateDone = filing ? filedOnDay(requestedDateDone) : null;
  if (filing && !dateDone) {
    return NextResponse.json({ error: 'Pick today or an earlier date for when it was filed or sent' }, { status: 400 });
  }

  const personId = session.user.notionUserId;
  const supabase = getServiceDbForFirm(session.firmId);

  // Never hand work to a former member, whatever chain the client held.
  const currentlyWithIds: string[] | undefined = Array.isArray(requestedCurrentlyWith)
    ? currentOnly(requestedCurrentlyWith, await currentTeamIds(session.firmId))
    : undefined;

  let statusReportCreated = false;

  try {
    // 0. Fetch previous currently_with_ids so we can compute the transfer delta
    let previousCurrentlyWithIds: string[] | undefined;
    if (currentlyWithIds !== undefined) {
      const { data: prior } = await supabase
        .from('deliverables')
        .select('currently_with_ids')
        .eq('notion_id', notionId)
        .single();
      previousCurrentlyWithIds = (prior?.currently_with_ids as string[] | null) ?? [];
    }

    // 1. Update Supabase deliverables status + currently_with (source of truth)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {};
    if (newStatus && newStatus !== oldStatus) {
      updates.status = newStatus;
      if (dateDone) updates.date_done = dateDone;
    }
    if (currentlyWithIds !== undefined) {
      updates.currently_with_ids = currentlyWithIds;
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from('deliverables')
        .update(updates)
        .eq('notion_id', notionId);
      if (error) throw error;

      // Fire-and-forget audit log
      logAudit({
        firmId: session.firmId,
        entityType: 'deliverable',
        entityId: notionId,
        action: 'status_change',
        fieldChanged: 'status',
        oldValue: oldStatus,
        newValue: newStatus || oldStatus,
        performedBy: personId,
        ipAddress: getClientIP(req),
      });

      // Auto-create client Status Report when a deliverable is marked filed
      // via the workflow state machine. Helper has its own guards (External-only,
      // recursion guard, idempotency) and never throws — we read { created } so
      // the client can toast when one was made.
      if (newStatus === DELIVERABLE_STATUS.FILED_OR_SENT_OUT) {
        ({ created: statusReportCreated } = await ensureStatusReportForFiledDeliverable(notionId, {
          performedBy: personId,
          firmId: session.firmId,
        }));
      }
    }

    // 2. Log the action in deliverable_actions
    const { error: logError } = await supabase
      .from('deliverable_actions')
      .insert({
        deliverable_id: notionId,
        action,
        old_status: oldStatus,
        new_status: newStatus || oldStatus,
        performed_by: personId,
        comment: comment || null,
        mentions: mentions?.map((m: { id: string }) => m.id) ?? [],
        file_url: fileUrl || null,
        file_name: fileName || null,
      });
    if (logError) {
      console.error('[deliverable-action] Log insert error:', logError.message);
    }

    // 3. Create in-app notifications (+ external email on transfer). Deferred
    // with after() so the multi-step Supabase/Resend chain completes after the
    // response — a bare promise here gets dropped when the function suspends.
    after(() =>
      generateActionNotifications({
        firmId: session.firmId,
        notionId,
        action,
        oldStatus,
        newStatus,
        currentlyWithIds,
        previousCurrentlyWithIds,
        performedBy: personId,
        comment: comment || undefined,
        mentions,
      }).catch((err) => console.error('[deliverable-action] Notification generation failed:', err.message)),
    );

    // 4. Notify mentioned users after the response is sent
    if (comment && mentions && mentions.length > 0) {
      after(() =>
        generateMentionNotifications({
          firmId: session.firmId,
          notionId,
          mentions,
          comment,
          performedBy: personId,
        }).catch((err) => console.error('[deliverable-action] Mention notification failed:', err.message)),
      );
    }

    return NextResponse.json({ ok: true, statusReportCreated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[deliverable-action] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
