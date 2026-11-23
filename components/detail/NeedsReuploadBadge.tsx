import { AlertTriangle } from 'lucide-react';

/**
 * Shown in place of the Preview/Download actions on a deliverable file whose
 * storage object is missing (a dangling two-phase upload — the file would
 * 404). Marks it clearly as needing re-upload instead of silently failing.
 */
export default function NeedsReuploadBadge() {
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300/60 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30"
      title="The stored file is missing — it needs to be re-uploaded before it can be previewed or downloaded."
    >
      <AlertTriangle className="w-3 h-3" />
      Needs re-upload
    </span>
  );
}
