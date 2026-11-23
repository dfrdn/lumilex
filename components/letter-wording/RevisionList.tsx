import { formatDate } from '@/lib/format-date';
import { toManilaDay } from '@/lib/dates';

/** A saved wording's earlier versions, from content_revisions, newest first. */
export interface Revision { id: number; snapshot: { body?: string; label?: string }; editor_name?: string | null; created_at: string }

const plainText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** The earlier versions of one piece of wording, each restorable by an editor. */
export function RevisionList({ revisions, busy, onRestore }: { revisions: Revision[]; busy: boolean; onRestore?: (r: Revision) => void }) {
  return (
    <div className="rounded-lg border border-stone-200 dark:border-[rgba(255,255,255,0.1)] divide-y divide-stone-200 dark:divide-white/10">
      <p className="px-3 py-2 text-xs font-medium text-[var(--text-secondary)]">Earlier versions</p>
      {revisions.length === 0 && <p className="px-3 py-2 text-xs text-[var(--text-secondary)]">No earlier versions yet.</p>}
      {revisions.map((r) => (
        <div key={r.id} className="px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">Replaced {formatDate(toManilaDay(r.created_at))}{r.editor_name ? ` by ${r.editor_name}` : ''}</span>
            {onRestore && (
              <button type="button" onClick={() => onRestore(r)} disabled={busy} className="text-gold-700 dark:text-gold-400 hover:underline cursor-pointer disabled:opacity-50">
                Restore
              </button>
            )}
          </div>
          <p className="mt-1 text-foreground">
            {r.snapshot.label ? <span className="font-medium">{r.snapshot.label}: </span> : null}
            {plainText(r.snapshot.body ?? '') || <span className="text-[var(--text-muted)]">(worded by the app)</span>}
          </p>
        </div>
      ))}
    </div>
  );
}

