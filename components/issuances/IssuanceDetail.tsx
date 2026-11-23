'use client';

import { useState } from 'react';
import {
  ArrowLeft, ExternalLink, FileText, Pencil, Trash2, Archive,
  ArchiveRestore, CheckCircle2, Pin,
} from 'lucide-react';
import { SOURCES } from '@/lib/issuances/sources';
import type { Issuance } from '@/hooks/use-issuances';
import { ConfidenceChip, SourceBadge } from './chips';
import { confirmAction } from '@/components/ui/confirm';

interface Props {
  issuance: Issuance;
  canEdit: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  onMutate: () => void;
}

export default function IssuanceDetail({
  issuance,
  canEdit,
  onBack,
  onEdit,
  onDeleted,
  onMutate,
}: Props) {
  const [busy, setBusy] = useState(false);
  const source = SOURCES[issuance.source];

  async function patch(updates: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch('/api/issuances', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: issuance.id, ...updates }),
      });
      onMutate();
    } finally {
      setBusy(false);
    }
  }

  async function softDelete() {
    if (!(await confirmAction({ title: 'Reject this issuance?', message: 'It will be hidden from everyone.', confirmLabel: 'Reject', danger: true }))) return;
    setBusy(true);
    try {
      await fetch(`/api/issuances?id=${issuance.id}`, { method: 'DELETE' });
      onDeleted();
    } finally {
      setBusy(false);
    }
  }

  const dateIssued = issuance.date_issued
    ? new Date(`${issuance.date_issued}T00:00:00`).toLocaleDateString('en-PH', {
        month: 'long', day: 'numeric', year: 'numeric',
      })
    : null;
  const dateEffective = issuance.date_effective
    ? new Date(`${issuance.date_effective}T00:00:00`).toLocaleDateString('en-PH', {
        month: 'long', day: 'numeric', year: 'numeric',
      })
    : null;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        {canEdit && (
          <div className="flex items-center gap-2">
            {issuance.ai_confidence === 'low' && !issuance.reviewed_by && (
              <button
                type="button"
                disabled={busy}
                onClick={() => patch({ mark_reviewed: true, ai_confidence: 'medium' })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Confirm reviewed
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => patch({ pinned: !issuance.pinned })}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                issuance.pinned
                  ? 'border-gold-300 text-gold-700 dark:border-gold-700 dark:text-gold-300'
                  : 'border-stone-200 text-stone-600 hover:border-gold-300 dark:hover:border-gold-500/50 dark:border-stone-700 dark:text-stone-400'
              }`}
            >
              <Pin className="w-3.5 h-3.5" /> {issuance.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                patch({ status: issuance.status === 'archived' ? 'published' : 'archived' })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-stone-200 text-stone-600 hover:border-stone-300 dark:hover:border-stone-500 transition-colors cursor-pointer dark:border-stone-700 dark:text-stone-400"
            >
              {issuance.status === 'archived' ? (
                <>
                  <ArchiveRestore className="w-3.5 h-3.5" /> Unarchive
                </>
              ) : (
                <>
                  <Archive className="w-3.5 h-3.5" /> Archive
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-stone-200 text-stone-600 hover:border-gold-300 dark:hover:border-gold-500/50 hover:text-gold-600 transition-colors cursor-pointer dark:border-stone-700 dark:text-stone-400 dark:hover:text-gold-400"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={softDelete}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-rose-200 text-rose-500 hover:bg-rose-50 transition-colors cursor-pointer dark:border-rose-800/40 dark:text-rose-400 dark:hover:bg-rose-900/10"
            >
              <Trash2 className="w-3.5 h-3.5" /> Reject
            </button>
          </div>
        )}
      </div>

      {/* Header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge source={issuance.source} />
          <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase tracking-wide bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400">
            {issuance.type}
          </span>
          {issuance.ai_confidence && <ConfidenceChip confidence={issuance.ai_confidence} />}
          {issuance.pinned && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gold-600 dark:text-gold-400 uppercase tracking-wide">
              <Pin className="w-3 h-3" /> Pinned
            </span>
          )}
          {issuance.status !== 'published' && (
            <span className="px-2 py-0.5 text-[10px] font-semibold rounded uppercase tracking-wide bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300">
              {issuance.status}
            </span>
          )}
        </div>
        <h1 className="font-serif text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          {issuance.title}
        </h1>
        {issuance.number && (
          <p className="text-sm font-mono text-stone-500 dark:text-stone-400">
            {issuance.number}
          </p>
        )}
      </div>

      {/* Body */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {issuance.summary && (
            <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-5">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2">
                Summary
              </h2>
              <p className="text-sm text-stone-700 dark:text-stone-300 leading-relaxed whitespace-pre-wrap">
                {issuance.summary}
              </p>
            </div>
          )}

          {issuance.full_text && (
            <details className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-5">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Full extracted text
              </summary>
              <pre className="mt-3 text-xs text-stone-600 dark:text-stone-400 whitespace-pre-wrap font-sans leading-relaxed max-h-96 overflow-y-auto">
                {issuance.full_text}
              </pre>
            </details>
          )}
        </div>

        <aside className="space-y-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-4 text-sm space-y-3">
            <MetaRow label="Issuing body" value={source?.label ?? issuance.source} />
            {issuance.subject && <MetaRow label="Subject" value={issuance.subject} />}
            {dateIssued && <MetaRow label="Date issued" value={dateIssued} />}
            {dateEffective && <MetaRow label="Date effective" value={dateEffective} />}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-1">
                Source
              </p>
              <a
                href={issuance.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-gold-600 dark:text-gold-400 hover:underline break-all"
              >
                <ExternalLink className="w-3 h-3 shrink-0" />
                <span className="truncate">{issuance.source_url}</span>
              </a>
            </div>
            {issuance.pdf_path && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-1">
                  PDF snapshot
                </p>
                <a
                  href={issuance.pdf_path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-gold-600 dark:text-gold-400 hover:underline"
                >
                  <FileText className="w-3 h-3" /> View PDF
                </a>
              </div>
            )}
          </div>

          {(issuance.practice_areas.length > 0 || issuance.tags.length > 0) && (
            <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-4">
              {issuance.practice_areas.length > 0 && (
                <div className="mb-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-1.5">
                    Practice areas
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {issuance.practice_areas.map((a) => (
                      <span
                        key={a}
                        className="px-2 py-0.5 text-xs rounded-full bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {issuance.tags.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-1.5">
                    Tags
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {issuance.tags.map((t) => (
                      <span
                        key={t}
                        className="px-2 py-0.5 text-xs rounded-full bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {issuance.ai_flags.length > 0 && (
            <div className="bg-amber-50/60 border border-amber-200/60 rounded-xl p-4 dark:bg-amber-900/10 dark:border-amber-800/40">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-1.5">
                AI flags
              </p>
              <div className="flex flex-wrap gap-1">
                {issuance.ai_flags.map((f) => (
                  <span
                    key={f}
                    className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="text-[11px] text-stone-400 dark:text-stone-500 space-y-1 px-1">
            <p>Added by {issuance.added_by ?? 'unknown'}</p>
            <p>Created {new Date(issuance.created_at).toLocaleString('en-PH')}</p>
            {issuance.reviewed_at && (
              <p>
                Reviewed by {issuance.reviewed_by} on{' '}
                {new Date(issuance.reviewed_at).toLocaleString('en-PH')}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-0.5">
        {label}
      </p>
      <p className="text-sm text-stone-700 dark:text-stone-300">{value}</p>
    </div>
  );
}
