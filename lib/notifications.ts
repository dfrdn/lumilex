import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import {
  sendDeliverableTransferEmail,
  sendDeliverableFinalizedEmail,
  sendLeaveNotificationEmail,
  sendFeedbackNotificationEmail,
  sendAttendeeInviteEmail,
} from '@/lib/email';
import { sendPushToEmails } from '@/lib/push';
import { formatManilaSchedule } from '@/lib/dates';
import { isClosed, DELIVERABLE_STATUS } from '@/lib/deliverable-status';

interface NotificationRow {
  person_id: string;
  type:
    | 'assignment'
    | 'status_change'
    | 'finalized'
    | 'deadline'
    | 'hearing'
    | 'mention'
    | 'meeting'
    | 'email'
    | 'leave_request'
    | 'leave_action'
    | 'feedback'
    | 'feedback_response'
    | 'client_upload'
    | 'sla_breach'
    | 'deadline_proposal'
    | 'intake'
    | 'engagement_signed'
    | 'billing_clearance';
  title: string;
  body?: string;
  href?: string;
  entity_id?: string;
}

/**
 * Returns true when the insert succeeded (or every row was mute-filtered),
 * false on insert failure — callers that clean up superseded rows must only
 * do so after a successful insert.
 */
export async function createNotificationsBatch(
  rows: NotificationRow[],
  firmId: string,
): Promise<boolean> {
  if (rows.length === 0) return true;
  const supabase = getServiceDbForFirm(firmId);

  // Drop rows for (person, entity) pairs the recipient has muted. This is the
  // single choke point every producer funnels through, so filtering here
  // suppresses both the in-app row and the web push for a muted entity.
  const scoped = rows.filter((r) => r.entity_id);
  if (scoped.length > 0) {
    const { data: mutes } = await supabase
      .from('notification_mutes')
      .select('person_id, entity_id')
      .in('person_id', [...new Set(scoped.map((r) => r.person_id))])
      .in('entity_id', [...new Set(scoped.map((r) => r.entity_id as string))]);
    if (mutes && mutes.length > 0) {
      const muted = new Set(mutes.map((m) => `${m.person_id}:${m.entity_id}`));
      rows = rows.filter(
        (r) => !r.entity_id || !muted.has(`${r.person_id}:${r.entity_id}`),
      );
      if (rows.length === 0) return true;
    }
  }

  const { error } = await supabase.from('notifications').insert(rows);
  if (error) {
    console.error('[notifications] Batch insert failed:', error.message);
    return false;
  }

  // Fire-and-forget web push for every row we just inserted. Look up the
  // recipients' emails, then let sendPushToEmails honor the per-user
  // notify_push_enabled preference.
  try {
    const personIds = [...new Set(rows.map((r) => r.person_id))];
    const { data: members } = await supabase
      .from('team')
      .select('person_id, email')
      .in('person_id', personIds);
    const byPerson = new Map<string, string>();
    for (const m of members ?? []) {
      if (m.email) byPerson.set(m.person_id, m.email);
    }
    await Promise.allSettled(
      rows.map((r) => {
        const email = byPerson.get(r.person_id);
        if (!email) return undefined;
        return sendPushToEmails(
          [email],
          {
            title: r.title,
            body: r.body,
            href: r.href,
            tag: r.entity_id,
            entityId: r.entity_id,
          },
          firmId,
        );
      }),
    );
  } catch (err) {
    console.error('[notifications] push fan-out failed:', (err as Error).message);
  }
  return true;
}

/**
 * Generate notifications when a deliverable action occurs (status change / reassignment).
 * Called fire-and-forget from the deliverable-action API route.
 */
export async function generateActionNotifications({
  notionId,
  action,
  oldStatus,
  newStatus,
  currentlyWithIds,
  previousCurrentlyWithIds,
  performedBy,
  comment,
  mentions,
  firmId,
}: {
  notionId: string;
  action: string;
  oldStatus: string;
  newStatus?: string;
  currentlyWithIds?: string[];
  previousCurrentlyWithIds?: string[];
  performedBy: string;
  comment?: string;
  mentions?: { id: string; name: string }[];
  firmId: string;
}) {
  const supabase = getServiceDbForFirm(firmId);

  // Fetch deliverable name + matter info for notification title / email
  const { data: deliverable } = await supabase
    .from('deliverables')
    .select('name, status, currently_with_ids, drafter_ids, reviewer_ids, matter_id, matter_name')
    .eq('notion_id', notionId)
    .single();

  if (!deliverable) return;

  // Suppress notifications for archived deliverables — both already-archived
  // rows and rows being archived right now. Mentions still notify (handled
  // in generateMentionNotifications).
  if (deliverable.status === DELIVERABLE_STATUS.ARCHIVED || newStatus === DELIVERABLE_STATUS.ARCHIVED || oldStatus === DELIVERABLE_STATUS.ARCHIVED) {
    return;
  }

  // Same for Filed or Sent out — once a deliverable is closed out, don't page
  // people about follow-up activity on it.
  if (
    deliverable.status === DELIVERABLE_STATUS.FILED_OR_SENT_OUT
    || newStatus === DELIVERABLE_STATUS.FILED_OR_SENT_OUT
    || oldStatus === DELIVERABLE_STATUS.FILED_OR_SENT_OUT
  ) {
    return;
  }

  const deliverableName = deliverable.name || 'Untitled deliverable';
  const href = `/dashboard/deliverables/${notionId}`;

  const isStatusChange = !!(newStatus && newStatus !== oldStatus);

  // Recipients split:
  //   - "baton" = people newly added to currently_with_ids at this action.
  //     They always get pinged (subject to notify_new_deliverables opt-out).
  //   - "watching" = drafters/reviewers/existing currently_with who weren't
  //     newly added. For status changes they only get pinged if opted in via
  //     notify_status_changes_watching; for non-status actions they're not
  //     pinged at all (the baton didn't pass to them).
  const currentWith: string[] = currentlyWithIds ?? deliverable.currently_with_ids ?? [];
  const drafters: string[] = deliverable.drafter_ids ?? [];
  const reviewers: string[] = deliverable.reviewer_ids ?? [];

  const prevSet = new Set(previousCurrentlyWithIds ?? []);
  const batonSet = new Set<string>();
  for (const id of currentWith) {
    if (!prevSet.has(id)) batonSet.add(id);
  }

  const watchingSet = new Set<string>();
  for (const id of currentWith) watchingSet.add(id);
  for (const id of drafters) watchingSet.add(id);
  for (const id of reviewers) watchingSet.add(id);
  for (const id of batonSet) watchingSet.delete(id);

  batonSet.delete(performedBy);
  watchingSet.delete(performedBy);

  const recipientIds = [...new Set([...batonSet, ...watchingSet])];
  if (recipientIds.length === 0) return;

  // Check user preferences — map person_ids to emails via team table
  const { data: teamMembers } = await supabase
    .from('team')
    .select('person_id, email, name, nickname')
    .in('person_id', recipientIds)
    .eq('active', true);

  if (!teamMembers || teamMembers.length === 0) return;

  const emails = teamMembers.map((m) => m.email).filter(Boolean);
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select(
      'email, notify_new_deliverables, notify_deliverable_transfer_email, notify_status_changes_watching',
    )
    .in('email', emails);

  // Opted out of in-app new-deliverable / baton notifications
  const optedOut = new Set(
    (prefs ?? []).filter((p) => p.notify_new_deliverables === false).map((p) => p.email),
  );
  // Opted out of external transfer emails
  const optedOutOfTransferEmail = new Set(
    (prefs ?? [])
      .filter((p) => p.notify_deliverable_transfer_email === false)
      .map((p) => p.email),
  );
  // Opted IN to status-change pings when watching (default false)
  const watchingOptedIn = new Set(
    (prefs ?? [])
      .filter((p) => p.notify_status_changes_watching === true)
      .map((p) => p.email),
  );

  // Build notification rows
  const type: 'status_change' | 'assignment' = isStatusChange ? 'status_change' : 'assignment';
  const title = isStatusChange
    ? `${deliverableName} → ${newStatus}`
    : `You've been assigned to ${deliverableName}`;
  const body = isStatusChange
    ? `Status changed from ${oldStatus} to ${newStatus}`
    : `Action: ${action}`;

  const rows: NotificationRow[] = [];
  for (const m of teamMembers) {
    if (!m.email) continue;
    const isBaton = batonSet.has(m.person_id);
    const isWatching = watchingSet.has(m.person_id);
    if (isBaton) {
      if (optedOut.has(m.email)) continue;
    } else if (isWatching && isStatusChange) {
      if (!watchingOptedIn.has(m.email)) continue;
    } else {
      continue;
    }
    rows.push({
      person_id: m.person_id,
      type,
      title,
      body,
      href,
      entity_id: notionId,
    });
  }

  // Dedupe "redo" notifications: if the same person already has a
  // notification of the same type for this entity within the last 30 minutes,
  // delete the stale one so the bell shows exactly one entry for the latest
  // attempt. This collapses "For Review → rollback → For Review again"
  // double-notifications.
  if (rows.length > 0) {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await supabase
      .from('notifications')
      .delete()
      .eq('entity_id', notionId)
      .eq('type', type)
      .in(
        'person_id',
        rows.map((r) => r.person_id),
      )
      .gte('created_at', thirtyMinAgo);
  }

  await createNotificationsBatch(rows, firmId);

  // ── External email: only for newly-added assignees (actual transfers) ──
  if (currentlyWithIds !== undefined && previousCurrentlyWithIds !== undefined) {
    const prevSet = new Set(previousCurrentlyWithIds);
    const newlyAdded = currentlyWithIds.filter(
      (id) => !prevSet.has(id) && id !== performedBy,
    );

    if (newlyAdded.length > 0) {
      const transferRecipients = teamMembers.filter(
        (m) =>
          m.email &&
          newlyAdded.includes(m.person_id) &&
          !optedOutOfTransferEmail.has(m.email),
      );

      if (transferRecipients.length > 0) {
        // Fetch performer name for the email body
        const { data: performer } = await supabase
          .from('team')
          .select('name')
          .eq('person_id', performedBy)
          .single();
        const performerName = performer?.name || 'A teammate';

        // Look up matter code (not denormalized on deliverable)
        let matterCode: string | undefined;
        const matterName = (deliverable.matter_name as string | null) || undefined;
        if (deliverable.matter_id) {
          const { data: matter } = await supabase
            .from('matters')
            .select('matter_code')
            .eq('notion_id', deliverable.matter_id)
            .single();
          matterCode = matter?.matter_code || undefined;
        }

        // Fetch the latest-version files from deliverable_files and resolve
        // storage paths to signed URLs so the email sender can download them.
        let latestFiles: { url: string; name: string; size?: number }[] = [];
        const { data: allFiles } = await supabase
          .from('deliverable_files')
          .select('version, file_url, file_name, file_size')
          .eq('deliverable_id', notionId)
          .order('version', { ascending: false });

        if (allFiles && allFiles.length > 0) {
          const latestVersion = allFiles[0].version;
          const latest = allFiles.filter(
            (f) => f.version === latestVersion && f.file_url,
          );

          // Resolve any storage paths to signed URLs in one batch
          const storagePaths = latest
            .map((f) => f.file_url as string)
            .filter((u) => !u.startsWith('http'));
          const signedMap = new Map<string, string>();
          if (storagePaths.length > 0) {
            const { data: signed } = await supabase.storage
              .from('files')
              .createSignedUrls(storagePaths, 60 * 60);
            for (const s of signed ?? []) {
              if (s.path && s.signedUrl) signedMap.set(s.path, s.signedUrl);
            }
          }

          latestFiles = latest.map((f) => ({
            url: (f.file_url as string).startsWith('http')
              ? (f.file_url as string)
              : signedMap.get(f.file_url as string) ?? (f.file_url as string),
            name: (f.file_name as string | null) || 'file',
            size: (f.file_size as number | null) ?? undefined,
          }));
        }

        // Build the cc list from users tagged in the comment. Exclude the
        // performer and anyone already receiving a primary copy of the email
        // (transfer recipients), then dedupe. We only attach cc to the first
        // recipient's email so cc'd people get exactly one notification even
        // when there are multiple transfer recipients.
        const transferEmailSet = new Set(
          transferRecipients.map((m) => m.email.toLowerCase()),
        );
        const ccEmails: string[] = [];
        const mentionIds = (mentions ?? [])
          .map((m) => m.id)
          .filter((id) => id && id !== performedBy);
        if (mentionIds.length > 0) {
          const { data: mentionedMembers } = await supabase
            .from('team')
            .select('person_id, email')
            .in('person_id', mentionIds)
            .eq('active', true);

          const seen = new Set<string>();
          for (const mm of mentionedMembers ?? []) {
            const email = mm.email;
            if (!email) continue;
            const key = email.toLowerCase();
            if (seen.has(key)) continue;
            if (transferEmailSet.has(key)) continue; // already a `to` recipient
            if (optedOutOfTransferEmail.has(email)) continue;
            seen.add(key);
            ccEmails.push(email);
          }
        }

        await Promise.allSettled(
          transferRecipients.map((m, idx) =>
            sendDeliverableTransferEmail({
              to: m.email,
              cc: idx === 0 && ccEmails.length > 0 ? ccEmails : undefined,
              firstName: (m.nickname?.trim() || (m.name || m.email).split(' ')[0]),
              deliverableName,
              matterCode,
              matterName,
              performerName,
              status: newStatus || oldStatus,
              comment,
              files: latestFiles,
              href,
              firmId,
            }),
          ),
        );
      }
    }
  }
}

/**
 * Generate notifications when a deliverable is finalized (Pre-finalized →
 * Outbox). The drafters and reviewers who worked on it are told the document
 * is finalized and ready to be sent out — in-app plus an external email.
 *
 * Unlike generateActionNotifications, this is a deliberate milestone ping that
 * ignores the "watching" status-change opt-in: everyone who drafted or reviewed
 * the deliverable hears about the finalization. The `finalized` type maps to the
 * `action` tier (see notification_priority) so it surfaces in the bell badge
 * rather than the quiet FYI tab.
 */
export async function generateFinalizedNotifications({
  notionId,
  performedBy,
  firmId,
}: {
  notionId: string;
  performedBy: string;
  firmId: string;
}) {
  const supabase = getServiceDbForFirm(firmId);

  const { data: deliverable } = await supabase
    .from('deliverables')
    .select('name, drafter_ids, reviewer_ids, matter_id, matter_name')
    .eq('notion_id', notionId)
    .single();

  if (!deliverable) return;

  const deliverableName = deliverable.name || 'Untitled deliverable';
  const href = `/dashboard/deliverables/${notionId}`;

  // Recipients = everyone who drafted or reviewed it, minus whoever finalized.
  const recipientIds = [
    ...new Set([
      ...((deliverable.drafter_ids as string[] | null) ?? []),
      ...((deliverable.reviewer_ids as string[] | null) ?? []),
    ]),
  ].filter((id) => id && id !== performedBy);
  if (recipientIds.length === 0) return;

  const { data: teamMembers } = await supabase
    .from('team')
    .select('person_id, email, name, nickname')
    .in('person_id', recipientIds)
    .eq('active', true);

  if (!teamMembers || teamMembers.length === 0) return;

  const matterName = (deliverable.matter_name as string | null) || undefined;

  // In-app rows for everyone — createNotificationsBatch applies the per-entity
  // mute filter and web push fan-out. No status-change opt-in gate here: a
  // finalization is a direct milestone for the people who built the document.
  await createNotificationsBatch(
    teamMembers
      .filter((m) => !!m.person_id)
      .map((m) => ({
        person_id: m.person_id,
        type: 'finalized' as const,
        title: `${deliverableName} finalized — ready to send out`,
        body: matterName,
        href,
        entity_id: notionId,
      })),
    firmId,
  );

  // Resolve matter code (not denormalized on the deliverable) + performer name
  // for the email body.
  let matterCode: string | undefined;
  if (deliverable.matter_id) {
    const { data: matter } = await supabase
      .from('matters')
      .select('matter_code')
      .eq('notion_id', deliverable.matter_id)
      .single();
    matterCode = matter?.matter_code || undefined;
  }

  const { data: performer } = await supabase
    .from('team')
    .select('name')
    .eq('person_id', performedBy)
    .single();
  const performerName = performer?.name || 'A teammate';

  // External email — gated by the same deliverable-email opt-out used for
  // transfers, so a user who silenced deliverable emails stays silent here too.
  const emails = teamMembers.map((m) => m.email).filter(Boolean);
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select('email, notify_deliverable_transfer_email')
    .in('email', emails);
  const optedOutOfEmail = new Set(
    (prefs ?? [])
      .filter((p) => p.notify_deliverable_transfer_email === false)
      .map((p) => p.email),
  );

  await Promise.allSettled(
    teamMembers
      .filter((m) => m.email && !optedOutOfEmail.has(m.email))
      .map((m) =>
        sendDeliverableFinalizedEmail({
          to: m.email,
          firstName: m.nickname?.trim() || (m.name || m.email).split(' ')[0],
          deliverableName,
          matterCode,
          matterName,
          performerName,
          href,
          firmId,
        }),
      ),
  );
}

/**
 * Generate notifications when someone is mentioned in a deliverable comment.
 * Mentions always notify — not gated by preferences.
 */
export async function generateMentionNotifications({
  notionId,
  mentions,
  comment,
  performedBy,
  replyToAuthorIds,
  firmId,
}: {
  notionId: string;
  mentions: { id: string; name: string }[];
  comment: string;
  performedBy: string;
  replyToAuthorIds?: string[];
  firmId: string;
}) {
  const hasMentions = mentions && mentions.length > 0;
  const hasReplies = (replyToAuthorIds?.length ?? 0) > 0;
  if (!hasMentions && !hasReplies) return;

  const supabase = getServiceDbForFirm(firmId);

  const { data: deliverable } = await supabase
    .from('deliverables')
    .select('name, status')
    .eq('notion_id', notionId)
    .single();

  // Suppress mention notifications on closed deliverables so stale rows
  // can't page people.
  if (isClosed(deliverable?.status)) return;

  const deliverableName = deliverable?.name || 'Untitled deliverable';
  const href = `/dashboard/deliverables/${notionId}`;

  // Get performer name
  const { data: performer } = await supabase
    .from('team')
    .select('name')
    .eq('person_id', performedBy)
    .single();

  const performerName = performer?.name || 'Someone';

  // Truncate comment for body
  const truncated = comment.length > 100 ? comment.slice(0, 100) + '...' : comment;

  const mentionedIds = new Set(
    (mentions ?? []).map((m) => m.id).filter((id) => id !== performedBy),
  );

  const rows: NotificationRow[] = Array.from(mentionedIds).map((id) => ({
    person_id: id,
    type: 'mention' as const,
    title: `${performerName} mentioned you on ${deliverableName}`,
    body: truncated,
    href,
    entity_id: notionId,
  }));

  const replyTargets = new Set<string>();
  for (const id of replyToAuthorIds ?? []) {
    if (id && id !== performedBy && !mentionedIds.has(id)) replyTargets.add(id);
  }
  for (const id of replyTargets) {
    rows.push({
      person_id: id,
      type: 'mention' as const,
      title: `${performerName} replied to your comment on ${deliverableName}`,
      body: truncated,
      href,
      entity_id: notionId,
    });
  }

  // Same redo-dedup as generateActionNotifications: collapse repeat mentions
  // for the same entity+recipient within 30 min.
  if (rows.length > 0) {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await supabase
      .from('notifications')
      .delete()
      .eq('entity_id', notionId)
      .eq('type', 'mention')
      .in(
        'person_id',
        rows.map((r) => r.person_id),
      )
      .gte('created_at', thirtyMinAgo);
  }

  await createNotificationsBatch(rows, firmId);
}

// ── Entity Comment Notifications ──────────────────────────────────────────
// Polymorphic mention/reply notifications for the unified entity_comments
// table. Mirrors generateMentionNotifications but anchors on
// (entity_type, entity_id) so the deep link and title resolve correctly
// for hearings, meetings, tasks, and files.

type EntityCommentKind = 'hearing' | 'meeting' | 'task' | 'file';

const ENTITY_TABLES: Record<EntityCommentKind, string> = {
  hearing: 'hearings',
  meeting: 'meetings',
  task: 'tasks',
  file: 'files',
};

/** Where each kind's own page lives, as a prefix for its id. */
const ENTITY_ROUTES: Record<EntityCommentKind, string> = {
  hearing: '/dashboard/hearings',
  meeting: '/dashboard/meetings',
  task: '/dashboard/tasks',
  file: '/dashboard/files',
};

/** Strip HTML tags + collapse whitespace so a rich-text body can fit in a
 *  notification preview / push payload. */
function htmlToPreview(html: string, max = 100): string {
  const text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export async function generateEntityCommentNotifications({
  entityType,
  entityId,
  mentions,
  bodyHtml,
  performedBy,
  replyToAuthorIds,
  firmId,
}: {
  entityType: EntityCommentKind;
  entityId: string;
  mentions: string[];
  bodyHtml: string;
  performedBy: string;
  replyToAuthorIds?: string[];
  firmId: string;
}) {
  const hasMentions = mentions.length > 0;
  const hasReplies = (replyToAuthorIds?.length ?? 0) > 0;
  if (!hasMentions && !hasReplies) return;

  const supabase = getServiceDbForFirm(firmId);

  const { data: entity } = await supabase
    .from(ENTITY_TABLES[entityType])
    .select('name')
    .eq('notion_id', entityId)
    .single();

  const entityName = (entity?.name as string | null) || `Untitled ${entityType}`;
  const href = `${ENTITY_ROUTES[entityType]}${entityId}`;

  const { data: performer } = await supabase
    .from('team')
    .select('name')
    .eq('person_id', performedBy)
    .single();
  const performerName = performer?.name || 'Someone';

  const preview = htmlToPreview(bodyHtml);

  const mentionedIds = new Set(mentions.filter((id) => id && id !== performedBy));

  const rows: NotificationRow[] = Array.from(mentionedIds).map((id) => ({
    person_id: id,
    type: 'mention' as const,
    title: `${performerName} mentioned you on ${entityName}`,
    body: preview,
    href,
    entity_id: entityId,
  }));

  const replyTargets = new Set<string>();
  for (const id of replyToAuthorIds ?? []) {
    if (id && id !== performedBy && !mentionedIds.has(id)) replyTargets.add(id);
  }
  for (const id of replyTargets) {
    rows.push({
      person_id: id,
      type: 'mention' as const,
      title: `${performerName} replied to your comment on ${entityName}`,
      body: preview,
      href,
      entity_id: entityId,
    });
  }

  if (rows.length === 0) return;

  // Collapse repeat mentions for the same entity+recipient within 30 min,
  // matching the deliverable pattern.
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await supabase
    .from('notifications')
    .delete()
    .eq('entity_id', entityId)
    .eq('type', 'mention')
    .in('person_id', rows.map((r) => r.person_id))
    .gte('created_at', thirtyMinAgo);

  await createNotificationsBatch(rows, firmId);
}

// ── Leave & Feedback Notifications ─────────────────────────────────────────
// Always send in-app + email to all active partners + super_users on submit,
// and to the applicant on action. No preference gates: these are low-volume.

async function fetchPartnerInbox(firmId: string) {
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('team')
    .select('person_id, email, name')
    .in('role', ['partner', 'super_user'])
    .eq('active', true);
  return (data ?? []).filter((m) => !!m.person_id);
}

async function fetchTeamMember(personId: string, firmId: string) {
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('team')
    .select('person_id, email, name')
    .or(`person_id.eq.${personId},notion_id.eq.${personId}`)
    .limit(1)
    .single();
  return data ?? null;
}

export async function notifyPartnersOfLeaveRequest({
  notionId,
  applicantId,
  applicantName,
  leaveType,
  periodStart,
  periodEnd,
  reason,
  firmId,
}: {
  notionId: string;
  applicantId: string;
  applicantName: string;
  leaveType: string;
  periodStart: string | null;
  periodEnd?: string | null;
  reason?: string;
  firmId: string;
}) {
  const partners = (await fetchPartnerInbox(firmId)).filter((p) => p.person_id !== applicantId);
  if (partners.length === 0) return;

  const href = '/dashboard/partner/leaves';
  const safeName = applicantName || 'A teammate';
  const dateBit = periodStart ? ` on ${periodStart}` : '';

  await createNotificationsBatch(
    partners.map((p) => ({
      person_id: p.person_id,
      type: 'leave_request' as const,
      title: `${safeName} requested ${leaveType.toLowerCase()}${dateBit}`,
      body: reason || undefined,
      href,
      entity_id: notionId,
    })),
    firmId,
  );

  await Promise.allSettled(
    partners
      .filter((p) => p.email)
      .map((p) =>
        sendLeaveNotificationEmail({
          to: p.email,
          recipientName: p.name || p.email,
          mode: 'request',
          applicantName: safeName,
          leaveType,
          periodStart,
          periodEnd,
          reason,
          href,
          firmId,
        }),
      ),
  );
}

export async function notifyApplicantOfLeaveAction({
  notionId,
  applicantId,
  reviewerId,
  leaveType,
  periodStart,
  periodEnd,
  status,
  firmId,
}: {
  notionId: string;
  applicantId: string;
  reviewerId: string;
  leaveType: string;
  periodStart: string | null;
  periodEnd?: string | null;
  status: 'Approved' | 'Rejected';
  firmId: string;
}) {
  if (!applicantId || applicantId === reviewerId) return;

  const [applicant, reviewer] = await Promise.all([
    fetchTeamMember(applicantId, firmId),
    fetchTeamMember(reviewerId, firmId),
  ]);
  if (!applicant) return;

  const reviewerName = reviewer?.name || 'A partner';
  const href = '/dashboard/my-submissions';
  const verb = status === 'Approved' ? 'approved' : 'declined';

  await createNotificationsBatch([
    {
      person_id: applicant.person_id,
      type: 'leave_action',
      title: `Your ${leaveType.toLowerCase()} request was ${verb}`,
      body: `${reviewerName} ${verb} your leave.`,
      href,
      entity_id: notionId,
    },
  ], firmId);

  if (applicant.email) {
    await sendLeaveNotificationEmail({
      to: applicant.email,
      recipientName: applicant.name || applicant.email,
      mode: 'action',
      applicantName: applicant.name || '',
      leaveType,
      periodStart,
      periodEnd,
      reviewerName,
      status,
      href,
      firmId,
    });
  }
}

export async function notifyPartnersOfFeedback({
  notionId,
  submitterId,
  subject,
  feedbackType,
  message,
  firmId,
}: {
  notionId: string;
  submitterId: string;
  subject: string;
  feedbackType: string;
  message?: string;
  firmId: string;
}) {
  // Feedback is anonymous to partners — do not include the submitter's name
  // or any identifying detail in the notification title, body, or email.
  const partners = (await fetchPartnerInbox(firmId)).filter((p) => p.person_id !== submitterId);
  if (partners.length === 0) return;

  const href = '/dashboard/partner/feedbacks';

  await createNotificationsBatch(
    partners.map((p) => ({
      person_id: p.person_id,
      type: 'feedback' as const,
      title: `New ${feedbackType.toLowerCase()}: ${subject}`,
      body: message || undefined,
      href,
      entity_id: notionId,
    })),
    firmId,
  );

  await Promise.allSettled(
    partners
      .filter((p) => p.email)
      .map((p) =>
        sendFeedbackNotificationEmail({
          to: p.email,
          recipientName: p.name || p.email,
          mode: 'submit',
          subject,
          feedbackType,
          message,
          href,
          firmId,
        }),
      ),
  );
}

export async function notifyApplicantOfFeedbackResponse({
  notionId,
  submitterId,
  reviewerId,
  subject,
  feedbackType,
  response,
  firmId,
}: {
  notionId: string;
  submitterId: string;
  reviewerId: string;
  subject: string;
  feedbackType: string;
  response: string;
  firmId: string;
}) {
  if (!submitterId || submitterId === reviewerId) return;

  const [submitter, reviewer] = await Promise.all([
    fetchTeamMember(submitterId, firmId),
    fetchTeamMember(reviewerId, firmId),
  ]);
  if (!submitter) return;

  const reviewerName = reviewer?.name || 'A partner';
  const href = '/dashboard/my-submissions';

  await createNotificationsBatch([
    {
      person_id: submitter.person_id,
      type: 'feedback_response',
      title: `${reviewerName} responded to your feedback: ${subject}`,
      body: response.length > 100 ? response.slice(0, 100) + '...' : response,
      href,
      entity_id: notionId,
    },
  ], firmId);

  if (submitter.email) {
    await sendFeedbackNotificationEmail({
      to: submitter.email,
      recipientName: submitter.name || submitter.email,
      mode: 'response',
      subject,
      feedbackType,
      response,
      reviewerName,
      href,
      firmId,
    });
  }
}

// ── Meeting / Hearing Attendee Notifications ──────────────────────────────
// Fired when a user is newly added as an attendee on a meeting or hearing —
// at creation, on PATCH, or via the admin entity editor. Mirrors the
// deliverable baton-pass pattern: in-app row + external email, each gated by
// its own user_preferences flag. The performer is never notified of their
// own action. Removed attendees are not notified.

export async function notifyAttendeesAddedToMeeting({
  meetingId,
  newAttendeeIds,
  previousAttendeeIds,
  performedBy,
  firmId,
}: {
  meetingId: string;
  newAttendeeIds: string[];
  previousAttendeeIds?: string[];
  performedBy: string;
  firmId: string;
}) {
  await notifyAttendeesAdded({
    kind: 'meeting',
    entityId: meetingId,
    newAttendeeIds,
    previousAttendeeIds,
    performedBy,
    firmId,
  });
}

export async function notifyAttendeesAddedToHearing({
  hearingId,
  newAttendeeIds,
  previousAttendeeIds,
  performedBy,
  firmId,
}: {
  hearingId: string;
  newAttendeeIds: string[];
  previousAttendeeIds?: string[];
  performedBy: string;
  firmId: string;
}) {
  await notifyAttendeesAdded({
    kind: 'hearing',
    entityId: hearingId,
    newAttendeeIds,
    previousAttendeeIds,
    performedBy,
    firmId,
  });
}

async function notifyAttendeesAdded({
  kind,
  entityId,
  newAttendeeIds,
  previousAttendeeIds,
  performedBy,
  firmId,
}: {
  kind: 'meeting' | 'hearing';
  entityId: string;
  newAttendeeIds: string[];
  previousAttendeeIds?: string[];
  performedBy: string;
  firmId: string;
}) {
  const prevSet = new Set(previousAttendeeIds ?? []);
  const addedIds = newAttendeeIds.filter(
    (id) => id && id !== performedBy && !prevSet.has(id),
  );
  if (addedIds.length === 0) return;

  const supabase = getServiceDbForFirm(firmId);

  // Fetch entity details for email + notification body
  const table = kind === 'meeting' ? 'meetings' : 'hearings';
  const dateCol = kind === 'meeting' ? 'date_start' : 'date';
  const endCol = kind === 'meeting' ? 'date_end' : null;
  const cols = ['notion_id', 'name', dateCol, 'matter_id', 'matter_name', 'type'];
  if (endCol) cols.push(endCol);

  const { data: entity } = await supabase
    .from(table)
    .select(cols.join(','))
    .eq('notion_id', entityId)
    .single<Record<string, unknown>>();

  if (!entity) return;

  const entityName = (entity.name as string | null) || `Untitled ${kind}`;
  const startIso = (entity[dateCol] as string | null) ?? null;
  const endIso = endCol ? ((entity[endCol] as string | null) ?? null) : null;
  const type = (entity.type as string | null) ?? null;
  const matterName = (entity.matter_name as string | null) || undefined;
  const matterId = (entity.matter_id as string | null) || null;
  const href = `/dashboard/${kind === 'meeting' ? 'meetings' : 'hearings'}/${entityId}`;

  // Resolve matter code if matter is linked
  let matterCode: string | undefined;
  if (matterId) {
    const { data: matter } = await supabase
      .from('matters')
      .select('matter_code')
      .eq('notion_id', matterId)
      .single();
    matterCode = matter?.matter_code || undefined;
  }

  // Look up team members for added attendees
  const { data: teamMembers } = await supabase
    .from('team')
    .select('person_id, email, name, nickname')
    .in('person_id', addedIds)
    .eq('active', true);

  if (!teamMembers || teamMembers.length === 0) return;

  // Performer's display name for the email body
  const { data: performer } = await supabase
    .from('team')
    .select('name')
    .eq('person_id', performedBy)
    .single();
  const performerName = performer?.name || 'A teammate';

  // Look up email opt-outs
  const emailPrefCol =
    kind === 'meeting' ? 'notify_meeting_attendee_email' : 'notify_hearing_attendee_email';
  const emails = teamMembers.map((m) => m.email).filter(Boolean);
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select(`email, ${emailPrefCol}`)
    .in('email', emails);

  const optedOutOfEmail = new Set(
    (prefs ?? [])
      .filter((p) => (p as Record<string, unknown>)[emailPrefCol] === false)
      .map((p) => (p as Record<string, unknown>).email as string),
  );

  // In-app notifications for everyone added (no per-user gate — being added
  // as an attendee is a direct action and matches the deliverable assignment
  // baseline). Email is gated by the dedicated preference.
  const kindLabel = kind === 'meeting' ? 'meeting' : 'hearing';
  const title = `You were added to a ${kindLabel}: ${entityName}`;
  // Schedule first: the bell truncates the body to one line, and the time is
  // what the attendee needs.
  const body =
    [formatManilaSchedule(startIso, endIso), matterName].filter(Boolean).join(' — ') || undefined;

  const rows: NotificationRow[] = teamMembers
    .filter((m) => !!m.person_id)
    .map((m) => ({
      person_id: m.person_id,
      type: kind === 'meeting' ? ('meeting' as const) : ('hearing' as const),
      title,
      body,
      href,
      entity_id: entityId,
    }));

  if (rows.length > 0) {
    // Dedupe rapid-fire "added → removed → re-added" within 30 min so the bell
    // shows one entry for the latest attempt. Mirrors the deliverable pattern.
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await supabase
      .from('notifications')
      .delete()
      .eq('entity_id', entityId)
      .eq('type', kind === 'meeting' ? 'meeting' : 'hearing')
      .in(
        'person_id',
        rows.map((r) => r.person_id),
      )
      .gte('created_at', thirtyMinAgo);

    await createNotificationsBatch(rows, firmId);
  }

  // External emails — gated per-user
  const emailRecipients = teamMembers.filter(
    (m) => m.email && !optedOutOfEmail.has(m.email),
  );

  await Promise.allSettled(
    emailRecipients.map((m) =>
      sendAttendeeInviteEmail({
        to: m.email,
        firstName: (m.nickname?.trim() || (m.name || m.email).split(' ')[0]),
        kind,
        title: entityName,
        startIso,
        endIso,
        type,
        matterCode,
        matterName,
        performerName,
        href,
        firmId,
      }),
    ),
  );
}

// ── Client Portal Upload Notifications ────────────────────────────────────
// Fired when a client_user uploads a file through the portal — either
// fulfilling a file_request or as a free-form upload. Fans out an in-app
// notification + web push to every active team member assigned to the matter.

export async function generateClientUploadNotifications({
  matterId,
  fileNotionId,
  fileName,
  uploaderName,
  requestDescription,
  firmId,
}: {
  matterId: string;
  fileNotionId: string;
  fileName: string;
  uploaderName: string;
  requestDescription?: string;
  firmId: string;
}) {
  const supabase = getServiceDbForFirm(firmId);

  const { data: matter } = await supabase
    .from('matters')
    .select('name, case_title, matter_code, team_person_ids')
    .eq('notion_id', matterId)
    .single();
  if (!matter) return;

  const personIds = (matter.team_person_ids as string[] | null) ?? [];
  if (personIds.length === 0) return;

  const { data: members } = await supabase
    .from('team')
    .select('person_id')
    .in('person_id', personIds)
    .eq('active', true);
  if (!members || members.length === 0) return;

  const matterLabel = matter.matter_code
    ? `${matter.matter_code} · ${matter.case_title || matter.name}`
    : matter.case_title || matter.name;

  const title = `${uploaderName || 'A client'} uploaded ${fileName}`;
  const body = requestDescription
    ? `Re: ${requestDescription} — ${matterLabel}`
    : matterLabel;
  const href = `/dashboard/matters/${matterId}`;

  await createNotificationsBatch(
    members.map((m) => ({
      person_id: m.person_id,
      type: 'client_upload' as const,
      title,
      body,
      href,
      entity_id: fileNotionId,
    })),
    firmId,
  );
}
