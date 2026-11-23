'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Circle, AlertTriangle, Upload, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { buildFilingHistory, isFiled, type FilingDeliverable, type FilingRow } from '@/lib/corporations/filing-history';
import { uploadCorporationFile } from '@/lib/corporations/upload-file';
import { useFileDrop } from '@/hooks/use-file-drop';
import type { Corporation, CorporationFile } from '@/types/corporations';

interface Props {
  corporation: Corporation;
  deliverables: Array<Record<string, unknown>>;
  files: CorporationFile[];
  onFilesChange: React.Dispatch<React.SetStateAction<CorporationFile[]>>;
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/**
 * What was due, what was filed, and where the copy is — one row per year.
 *
 * The obligation lives in `deliverables` and the filed copy in
 * `corporation_files`; before this they were two tabs with nothing joining
 * them, so "what did we file in 2024 and where is it?" meant cross-referencing
 * by eye. Attaching a copy here tags it with the year, which is what makes the
 * join possible at all.
 */
export default function FilingHistory({ corporation, deliverables, files, onFilesChange }: Props) {
  const rows = useMemo(() => {
    const mapped: FilingDeliverable[] = deliverables.map((d) => ({
      notionId: String(d.notion_id ?? d.notionId ?? ''),
      name: String(d.name ?? ''),
      type: String(d.type ?? ''),
      externalDueDate: (d.external_due_date ?? d.externalDueDate ?? null) as string | null,
      status: String(d.status ?? ''),
    }));
    return buildFilingHistory(mapped, files);
  }, [deliverables, files]);

  if (rows.length === 0) return null;

  const missing = rows.filter((r) => r.filedWithoutDocument).length;

  return (
    <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Filing history</h3>
        {missing > 0 && (
          <span className="text-[11px] text-amber-700 dark:text-amber-300">
            {missing} filed without a copy on file
          </span>
        )}
      </div>
      <p className="text-[11px] text-stone-500 dark:text-stone-400 mb-3">
        Reportorial filings by year. Attach the filed copy to keep the record complete.
      </p>

      <ul className="divide-y divide-stone-100 dark:divide-white/10">
        {rows.map((row) => (
          <FilingRowItem
            key={`${row.kind}-${row.year}`}
            row={row}
            corporation={corporation}
            onFilesChange={onFilesChange}
          />
        ))}
      </ul>
    </section>
  );
}

function FilingRowItem({
  row,
  corporation,
  onFilesChange,
}: {
  row: FilingRow;
  corporation: Corporation;
  onFilesChange: React.Dispatch<React.SetStateAction<CorporationFile[]>>;
}) {
  const [busy, setBusy] = useState(false);

  async function attach(list: File[]) {
    setBusy(true);
    try {
      for (const f of list) {
        const data = await uploadCorporationFile(corporation.id, row.kind, f, null, row.year);
        onFilesChange((prev) => [data.file, ...prev]);
      }
      toast.success(`${row.kind} ${row.year} copy attached.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  const { isOver, dropProps } = useFileDrop(attach, { disabled: busy });
  const filed = isFiled(row.status);

  return (
    <li
      {...dropProps}
      className={`py-2.5 px-2 -mx-2 flex items-start gap-3 rounded-lg transition-colors ${
        isOver ? 'bg-navy-50 dark:bg-navy-500/10 ring-1 ring-navy-300 dark:ring-navy-500/40 ring-dashed' : ''
      }`}
    >
      {filed ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
      ) : (
        <Circle className="w-4 h-4 text-stone-300 shrink-0 mt-0.5" />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-stone-800 dark:text-stone-100">
            {row.kind} {row.year}
          </span>
          <span className="text-xs text-stone-500 dark:text-stone-400">
            {row.status ?? 'No deadline tracked'}
            {row.dueDate && ` · due ${fmt(row.dueDate)}`}
          </span>
          {isOver && <span className="text-[11px] text-navy-700 dark:text-navy-300">Drop to attach</span>}
        </div>

        {row.filedWithoutDocument && (
          <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Marked filed, but no copy is attached.
          </p>
        )}
        {row.documentWithoutObligation && (
          <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
            Filed copy on record with no tracked deadline for that year.
          </p>
        )}

        {row.documents.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {row.documents.map((f) => (
              <li key={f.id} className="flex items-center gap-1.5 text-[11px] text-stone-600 dark:text-stone-300">
                <Paperclip className="w-3 h-3 text-stone-400 dark:text-stone-500 shrink-0" />
                <span className="truncate">{f.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label
        className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-stone-300 dark:border-white/15 text-stone-700 dark:text-stone-200 cursor-pointer hover:bg-stone-50 dark:hover:bg-white/5 ${
          busy ? 'opacity-50 pointer-events-none' : ''
        }`}
      >
        <Upload className="w-3 h-3" />
        {busy ? 'Uploading…' : row.documents.length ? 'Add copy' : 'Attach copy'}
        <input
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void attach([f]);
          }}
        />
      </label>
    </li>
  );
}
