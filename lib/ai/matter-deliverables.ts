// Live, structured deliverable status for a matter — the source of truth for
// "what's the status / deadline" questions. The maintained matter brief
// (matter_summaries) is a periodic narrative synthesis and can lag reality, so
// any assistant answering about current workflow state must read this instead.
//
// Shared by the assistant's get_deliverables tool and (intended) the in-app
// matter-intelligence chat, so both reason about the same live data + the same
// lifecycle semantics.

import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { HANDED_OFF_STATUSES } from '@/lib/deliverable-status';

/** Statuses that mean the deliverable has LEFT the firm (no longer pending internal work). */
export const OUT_STATUSES = new Set<string>(HANDED_OFF_STATUSES);

/**
 * Plain-language explanation of the deliverable workflow. Inject into an
 * assistant's system prompt so it interprets the structured fields correctly —
 * the #1 source of wrong answers was confusing internal review with client
 * submission.
 */
export const DELIVERABLE_LIFECYCLE_NOTE = `Deliverable workflow (read carefully — this is how to interpret the fields):
- Stages progress: Not started → Drafting → Under Review → Revising → Finalizing → Pre-finalized → Awaiting Client → Outbox → "Filed or Sent out" → Acknowledged → Archived.
- review_dates are INTERNAL review milestones — a senior reviews the draft BEFORE it leaves the firm. They are NOT client review or client feedback.
- external_due_date is the target date to send/file the deliverable OUT (to a court, agency, or the client). date_done is when it actually went out.
- type is the destination: "External" = filed with a court/agency; "For Client" = sent to the client; "Internal"/memo = stays in-house.
- A status of "Filed or Sent out", "Submitted", "Acknowledged", or "Archived" means the deliverable is DONE and has left the firm — do NOT describe it as pending, awaiting, overdue, or stalled.
- Only call something pending/overdue if its status is a pre-send stage (Drafting…Outbox) AND, for overdue, its external_due_date has passed.
- currently_with is who holds it now.
- Write for a person: do NOT expose raw field names, flags, codes, or ids (e.g. "isOut: true", "type: External", currently_with_ids, notion_id). Say "already filed" or "this is a court filing", not the underlying data.`;

export interface DeliverableLive {
  name: string;
  type: string | null;
  subtype: string | null;
  status: string;
  isOut: boolean; // status indicates it has left the firm
  priority: string | null;
  drafters: string[];
  reviewers: string[];
  currentlyWith: string[];
  reviewDates: (string | null)[];
  externalDueDate: string | null;
  dateDone: string | null;
  revisionCount: number;
}

/**
 * Fetch a matter's deliverables with person ids resolved to names. Service-role
 * (callers gate access themselves), scoped to `firmId`; newest first.
 */
export async function getMatterDeliverables(matterId: string, firmId: string): Promise<DeliverableLive[]> {
  const svc = getServiceDbForFirm(firmId);
  const { data: rows } = await svc
    .from('deliverables')
    .select(
      'name, type, subtype, status, priority, drafter_ids, reviewer_ids, currently_with_ids, review_dates, external_due_date, date_done, revision_count, created_time',
    )
    .eq('matter_id', matterId)
    .order('created_time', { ascending: false });

  if (!rows || rows.length === 0) return [];

  const ids = new Set<string>();
  for (const r of rows) {
    for (const arr of [r.drafter_ids, r.reviewer_ids, r.currently_with_ids]) {
      if (Array.isArray(arr)) arr.forEach((id: string) => id && ids.add(id));
    }
  }
  const nameOf = new Map<string, string>();
  if (ids.size > 0) {
    const { data: people } = await svc.from('team').select('person_id, name').in('person_id', [...ids]);
    for (const p of people ?? []) nameOf.set(p.person_id, p.name);
  }
  const names = (arr: unknown): string[] =>
    Array.isArray(arr) ? arr.map((id: string) => nameOf.get(id) ?? id) : [];

  return rows.map((r) => ({
    name: r.name,
    type: r.type ?? null,
    subtype: r.subtype ?? null,
    status: r.status,
    isOut: OUT_STATUSES.has(r.status),
    priority: r.priority || null,
    drafters: names(r.drafter_ids),
    reviewers: names(r.reviewer_ids),
    currentlyWith: names(r.currently_with_ids),
    reviewDates: Array.isArray(r.review_dates) ? r.review_dates : [],
    externalDueDate: r.external_due_date ?? null,
    dateDone: r.date_done ?? null,
    revisionCount: r.revision_count ?? 0,
  }));
}

/** Render live deliverables as a compact text block for prompt injection. */
export function formatDeliverablesForPrompt(rows: DeliverableLive[]): string {
  if (rows.length === 0) return 'No deliverables on record for this matter.';
  return rows
    .map((d) => {
      const bits = [`- ${d.name} [${d.type ?? 'n/a'}] — status: ${d.status}`];
      if (d.isOut && d.dateDone) bits.push(`went out: ${d.dateDone}`);
      else if (d.externalDueDate) bits.push(`due out: ${d.externalDueDate}`);
      if (d.currentlyWith.length) bits.push(`with: ${d.currentlyWith.join(', ')}`);
      const reviews = d.reviewDates.filter(Boolean) as string[];
      if (reviews.length) bits.push(`internal review: ${reviews.join(', ')}`);
      if (d.drafters.length) bits.push(`drafter: ${d.drafters.join(', ')}`);
      return bits.join(' · ');
    })
    .join('\n');
}
