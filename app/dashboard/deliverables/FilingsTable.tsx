'use client';

import { useState } from 'react';
import { Eye, Download, FileCheck } from 'lucide-react';
import DataTable, { type ColumnDef } from '@/components/DataTable';
import DateChip from '@/components/DateChip';
import FilePreviewModal from '@/components/FilePreviewModal';
import { downloadFile } from '@/lib/download-file';
import type { FilingListing, FileAttachment } from '@/types/notion';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';

const statusColors: Record<string, string> = {
  'Filed': 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  'Cancelled': 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

interface Props {
  data: FilingListing[];
  userId: string;
  role: string;
}

const INACTIVE_FILING_STATUSES: readonly string[] = [DELIVERABLE_STATUS.FILED_OR_SENT_OUT, DELIVERABLE_STATUS.ARCHIVED, DELIVERABLE_STATUS.AWAITING_CLIENT];

export default function FilingsTable({ data, userId, role }: Props) {
  const [previewFiles, setPreviewFiles] = useState<FileAttachment[]>([]);

  const columns: ColumnDef<FilingListing>[] = [
    {
      key: 'name',
      label: 'Name',
      getValue: (f) => f.name,
      render: (f) => f.name || '(Untitled)',
    },
    {
      key: 'matter',
      label: 'Matter',
      getValue: (f) => f.matter,
      render: (f) => <span className="text-sm text-stone-600 dark:text-stone-300">{f.matter || '—'}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      getValue: (f) => f.status,
      render: (f) => {
        if (!f.status) return <span className="text-stone-400 dark:text-stone-500">—</span>;
        const cls = statusColors[f.status] ?? 'bg-gray-100 text-gray-600 dark:bg-stone-500/15 dark:text-stone-300';
        return (
          <span className={`text-[11px] rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ring-current/10 ${cls}`}>
            {f.status}
          </span>
        );
      },
    },
    {
      key: 'date',
      label: 'Date',
      getValue: (f) => f.date,
      render: (f) => <DateChip date={f.date ? f.date.slice(0, 10) : null} />,
    },
    {
      key: 'filedCopy',
      label: 'Filed Copy',
      sortable: false,
      getValue: (f) => f.filedCopies.length,
      render: (f) => {
        if (f.filedCopies.length === 0) {
          return <span className="text-stone-300 dark:text-stone-600">—</span>;
        }
        const attachments: FileAttachment[] = f.filedCopies.map((v) => ({
          name: v.fileName,
          url: v.fileUrl,
        }));
        const stop = (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
        };
        return (
          <div className="flex items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-inset ring-emerald-200/60 dark:ring-emerald-500/20 rounded-md"
              title={`${f.filedCopies.length} filed file${f.filedCopies.length > 1 ? 's' : ''}`}
            >
              <FileCheck className="w-2.5 h-2.5" />
              {f.filedCopies.length > 1 && <span className="tabular-nums">{f.filedCopies.length}</span>}
            </span>
            <button
              type="button"
              onClick={(e) => { stop(e); setPreviewFiles(attachments); }}
              className="inline-flex items-center justify-center w-6 h-6 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 ring-1 ring-emerald-200/60 dark:ring-emerald-500/20 rounded-md transition-colors cursor-pointer"
              title="Preview filed copy"
            >
              <Eye className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={(e) => { stop(e); for (const att of attachments) void downloadFile(att); }}
              className="inline-flex items-center justify-center w-6 h-6 text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--card-bg)] hover:bg-[var(--card-bg-hover)] border border-[var(--border-color)] rounded-md transition-colors cursor-pointer"
              title={f.filedCopies.length > 1 ? `Download ${f.filedCopies.length} files` : 'Download filed copy'}
            >
              <Download className="w-3 h-3" />
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        data={data}
        columns={columns}
        getRowHref={(f) => `/dashboard/deliverables/${f.id}`}
        getRowId={(f) => f.id}
        entityLabel="Filing"
        defaultSortKey="date"
        defaultSortDir="desc"
        userId={userId}
        isMyItem={(f, uid) => f.attendeeIds.includes(uid)}
        role={role}
        isActiveItem={(f) => !INACTIVE_FILING_STATUSES.includes(f.status)}
      />
      <FilePreviewModal
        open={previewFiles.length > 0}
        onClose={() => setPreviewFiles([])}
        files={previewFiles}
      />
    </>
  );
}
