'use client';

import { History } from 'lucide-react';
import type { CorporationActivityEntry } from '@/lib/queries/corporations';

export const ACTION_LABELS: Record<string, string> = {
  created: 'created the corporation',
  updated: 'updated',
  sec_registered: 'recorded SEC registration',
  deleted: 'deleted the corporation',
  compliance_item_added: 'added a compliance item',
  compliance_status_changed: 'changed compliance status',
  person_added: 'added a person',
  person_updated: 'updated a person',
  person_deleted: 'removed a person',
  meeting_created: 'logged a meeting',
  meeting_updated: 'updated a meeting',
  meeting_deleted: 'deleted a meeting',
  meeting_file_uploaded: 'uploaded a meeting document',
  resolution_created: 'created a resolution',
  resolution_updated: 'updated a resolution',
  resolution_deleted: 'deleted a resolution',
  file_uploaded: 'uploaded a document',
  file_deleted: 'deleted a document',
  file_shared_with_client: 'shared a document with the client',
  file_unshared_with_client: 'stopped sharing a document with the client',
  portal_shown: 'showed this in the client portal',
  portal_hidden: 'hid this from the client portal',
  matter_linked: 'changed the covering matter',
  client_form_applied: 'applied a client form',
};

/** "businessPermitExpiryDate, tin" → "business permit expiry date, TIN". */
export function humanizeFields(fields: string): string {
  return fields
    .split(/,\s*/)
    .map((f) =>
      f
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .replace(/\b(tin|sec|bir|rdo|gis|afs|orus|esparc|lgu|sss|id)\b/g, (w) => w.toUpperCase()),
    )
    .join(', ');
}

export function formatWhen(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function CorporationActivityTab({ activity }: { activity: CorporationActivityEntry[] }) {
  if (!activity.length) {
    return (
      <div className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-8 text-center text-sm text-stone-500 dark:text-stone-400">
        No recorded activity yet. Changes made from this page are logged here from now on.
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-3 inline-flex items-center gap-1.5">
        <History className="w-4 h-4 text-stone-400 dark:text-stone-500" />
        Activity
      </h3>
      <ol className="space-y-0.5">
        {activity.map((e) => (
          <li key={e.id} className="flex items-baseline gap-3 py-1.5 border-b border-stone-100 dark:border-white/10 last:border-0 text-sm">
            <span className="text-xs text-stone-400 dark:text-stone-500 whitespace-nowrap w-40 shrink-0">{formatWhen(e.createdAt)}</span>
            <span className="text-stone-700 dark:text-stone-200 min-w-0">
              <span className="font-medium">{e.performedByName ?? 'Someone'}</span>{' '}
              {ACTION_LABELS[e.action] ?? e.action}
              {e.fieldChanged ? <span className="text-stone-500 dark:text-stone-400"> — {humanizeFields(e.fieldChanged)}</span> : null}
              {e.newValue ? <span className="text-stone-500 dark:text-stone-400"> → {e.newValue}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
