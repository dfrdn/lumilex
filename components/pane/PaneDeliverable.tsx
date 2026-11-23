'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle, Calendar, Users, FileText, Clock, Eye, Download,
  History, Upload,
} from 'lucide-react';
import PersonBadge from '@/components/detail/PersonBadge';
import DeliverableActionButtons, { type DeliverableActionPatch } from '@/components/DeliverableActionButtons';
import { usePublishDeliverableUpdate, useDeliverableUpdates } from '@/components/DeliverableUpdatesContext';
import FilePreviewModal from '@/components/FilePreviewModal';
import NeedsReuploadBadge from '@/components/detail/NeedsReuploadBadge';
import PaneCard from '@/components/pane/PaneCard';
import PaneLink from '@/components/pane/PaneLink';
import { downloadFile } from '@/lib/download-file';
import type { DeliverableFileVersion, DeliverableComment } from '@/types/notion';
import { FORMER_MEMBER } from '@/lib/former-member';

interface Person { id: string; name: string; initials: string; position: string; avatarUrl?: string | null; }

interface Props {
  data: any;
  people: Person[];
  versions?: DeliverableFileVersion[];
  comments?: DeliverableComment[];
}

function getStatusStyle(status: string) {
  const s = status.toLowerCase();
  if (s.includes('filed') || s.includes('sent out')) return 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20';
  if (s.includes('finaliz')) return 'bg-blue-50 text-blue-700 ring-blue-200/60 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20';
  if (s.includes('review')) return 'bg-violet-50 text-violet-700 ring-violet-200/60 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/20';
  if (s.includes('revis')) return 'bg-amber-50 text-amber-700 ring-amber-200/60 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20';
  if (s.includes('draft')) return 'bg-sky-50 text-sky-700 ring-sky-200/60 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-sky-500/20';
  if (s.includes('await')) return 'bg-orange-50 text-orange-700 ring-orange-200/60 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-orange-500/20';
  return 'bg-gray-50 text-gray-600 ring-gray-200/60 dark:bg-gray-500/10 dark:text-gray-400 dark:ring-gray-500/20';
}

function formatDate(d: string | null): string {
  if (!d) return '\u2014';
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

function formatDateTime(d: string): string {
  return new Date(d).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isOverdue(date: string | null): boolean {
  if (!date) return false;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  return date < today;
}

function renderPeople(ids: string[], people: Person[]) {
  if (!ids || ids.length === 0) return <span className="text-sm text-[var(--text-muted)]">{'\u2014'}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {ids.map((id) => {
        const p = people.find((pr) => pr.id === id);
        return <PersonBadge key={id} initials={p?.initials ?? FORMER_MEMBER} position={p?.position} avatarUrl={p?.avatarUrl} name={p?.name} />;
      })}
    </div>
  );
}

/** Group version rows (from `deliverable_files`) by version number. */
function groupFilesByVersion(
  files: DeliverableFileVersion[],
): { version: number; files: DeliverableFileVersion[]; createdAt: string; uploadedBy: string; action: string | null }[] {
  const map = new Map<number, DeliverableFileVersion[]>();
  for (const f of files) {
    const arr = map.get(f.version) ?? [];
    arr.push(f);
    map.set(f.version, arr);
  }
  return [...map.entries()]
    .map(([version, vfiles]) => {
      // Representative row for the version header (newest within version)
      const rep = [...vfiles].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return { version, files: vfiles, createdAt: rep.createdAt, uploadedBy: rep.uploadedBy, action: rep.action };
    })
    .sort((a, b) => b.version - a.version);
}

export default function PaneDeliverable({ data, people, versions = [], comments = [] }: Props) {
  const [previewFile, setPreviewFile] = useState<{ name: string; url: string } | null>(null);

  // Lift the fields a workflow action mutates into local state so the pane's
  // status pill and "currently with" reflect immediately, without a refresh.
  const [status, setStatus] = useState<string>(data.status);
  const [currentlyWith, setCurrentlyWith] = useState<string[]>(data.currentlyWith ?? []);
  useEffect(() => { setStatus(data.status); }, [data.status]);
  useEffect(() => { setCurrentlyWith(data.currentlyWith ?? []); }, [data.currentlyWith]);

  const publishDeliverableUpdate = usePublishDeliverableUpdate();

  const handleActionComplete = useCallback((patch: DeliverableActionPatch) => {
    if (patch.status !== undefined) setStatus(patch.status);
    if (patch.currentlyWithIds !== undefined) setCurrentlyWith(patch.currentlyWithIds);
    // Broadcast so the dashboard lists reflect the action without a refresh.
    publishDeliverableUpdate(data.id, patch);
  }, [publishDeliverableUpdate, data.id]);

  // Reflect actions taken from other surfaces (e.g. a dashboard row) on this
  // same deliverable while the pane is open.
  useDeliverableUpdates(useCallback((id: string, patch: DeliverableActionPatch) => {
    if (id !== data.id) return;
    if (patch.status !== undefined) setStatus(patch.status);
    if (patch.currentlyWithIds !== undefined) setCurrentlyWith(patch.currentlyWithIds);
  }, [data.id]));

  const grouped = useMemo(() => groupFilesByVersion(versions), [versions]);
  const latest = grouped[0] ?? null;

  // Find the initial submission comment for the latest version (if any):
  // the earliest comment anchored to that version (parentType === 'version').
  const latestInitialComment = useMemo(() => {
    if (!latest) return null;
    const tied = comments
      .filter((c) => c.parentType === 'version' && c.parentId === latest.version)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return tied[0] ?? null;
  }, [comments, latest]);

  const personInitials = (id: string | null | undefined) => {
    if (!id) return '??';
    return people.find((p) => p.id === id)?.initials ?? FORMER_MEMBER;
  };

  return (
    <div className="space-y-4 pb-4">
      {/* ── Header row: status + priority + deadline ─────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {status && (
          <span className={`text-xs rounded-full px-2.5 py-1 font-medium ring-1 ring-inset ${getStatusStyle(status)}`}>
            {status}
          </span>
        )}
        {data.priority && (
          <span className={`text-xs rounded-full px-2.5 py-1 font-medium ring-1 ring-inset ${
            data.priority.toLowerCase().includes('high') || data.priority.toLowerCase().includes('urgent')
              ? 'bg-red-50 text-red-600 ring-red-200/60 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20'
              : 'bg-gray-50 text-gray-600 ring-gray-200/60 dark:bg-gray-500/10 dark:text-gray-400 dark:ring-gray-500/20'
          }`}>
            {data.priority}
          </span>
        )}
        {data.externalDueDate && (
          <span className={`inline-flex items-center gap-1 text-xs rounded-full px-2.5 py-1 font-medium ring-1 ring-inset ${
            isOverdue(data.externalDueDate)
              ? 'bg-red-50 text-red-600 ring-red-200/60 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20'
              : 'bg-gray-50 text-gray-600 ring-gray-200/60 dark:bg-gray-500/10 dark:text-gray-400 dark:ring-gray-500/20'
          }`}>
            {isOverdue(data.externalDueDate) ? <AlertTriangle className="w-3 h-3" /> : <Calendar className="w-3 h-3" />}
            {formatDate(data.externalDueDate)}
          </span>
        )}
      </div>

      {/* ── Action Buttons ──────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <DeliverableActionButtons
          deliverableId={data.id}
          deliverableName={data.name}
          status={status}
          type={data.type}
          matterId={data.matterId}
          matterName={data.matter}
          drafterIds={data.drafter}
          reviewerIds={data.reviewerIds}
          currentlyWithIds={currentlyWith}
          variant="compact"
          onActionComplete={handleActionComplete}
        />
      </div>

      {/* ── Case & Assignment card ──────────────────────────────── */}
      <PaneCard title="Case & Assignment" icon={<Users className="w-3.5 h-3.5" />}>
        <div className="space-y-3">
          {data.matter && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Matter</p>
              <PaneLink
                href={data.matterId ? `/dashboard/matters/${data.matterId}` : null}
                label={data.matter}
              />
            </div>
          )}
          {data.client && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Client</p>
              <PaneLink
                href={data.clientId ? `/dashboard/clients/${encodeURIComponent(data.clientId)}` : null}
                label={data.client}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Drafter</p>
              {renderPeople(data.drafter, people)}
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Currently With</p>
              {renderPeople(currentlyWith, people)}
            </div>
            <div className="col-span-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                {data.reviewerIds?.length === 1 ? 'Reviewer' : 'Reviewers'}
              </p>
              {renderPeople(data.reviewerIds, people)}
            </div>
          </div>
        </div>
      </PaneCard>

      {/* ── Latest Submission card ──────────────────────────────── */}
      {latest && (
        <PaneCard title="Latest Submission" icon={<Upload className="w-3.5 h-3.5" />}>
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-gold-100 text-gold-800 dark:bg-gold-500/15 dark:text-gold-300 rounded-md">
                v{latest.version}
              </span>
              <span className="text-xs font-medium text-[var(--text-primary)]">
                {latest.files.length} file{latest.files.length !== 1 ? 's' : ''}
              </span>
            </div>

            {latestInitialComment && (
              <div className="pl-3 ml-1 border-l-2 border-[var(--border-color)] py-1">
                <p className="text-[12.5px] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">
                  {latestInitialComment.comment}
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] flex-wrap">
              <span className="inline-flex items-center gap-1">
                <PersonBadge
                  initials={personInitials(latest.uploadedBy)}
                  position={people.find((p) => p.id === latest.uploadedBy)?.position}
                  avatarUrl={people.find((p) => p.id === latest.uploadedBy)?.avatarUrl}
                  name={people.find((p) => p.id === latest.uploadedBy)?.name}
                />
              </span>
              <span>&middot;</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDateTime(latest.createdAt)}
              </span>
              {latest.action && (
                <>
                  <span>&middot;</span>
                  <span className="italic">{latest.action}</span>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              {latest.files.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-2.5 px-3 py-2 bg-[var(--subtle-bg)] rounded-lg border border-[var(--border-color)]"
                >
                  <FileText className="w-3.5 h-3.5 text-gold-600 dark:text-gold-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[var(--text-primary)] truncate">{f.fileName}</p>
                    {f.fileSize ? <p className="text-[10px] text-[var(--text-muted)]">{formatFileSize(f.fileSize)}</p> : null}
                  </div>
                  {f.needsReupload ? (
                    <NeedsReuploadBadge />
                  ) : (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setPreviewFile({ name: f.fileName, url: f.fileUrl })}
                      className="inline-flex items-center justify-center w-7 h-7 text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg transition-all cursor-pointer"
                      title="Preview"
                    >
                      <Eye className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void downloadFile({ name: f.fileName, url: f.fileUrl })}
                      className="inline-flex items-center justify-center w-7 h-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg transition-all cursor-pointer"
                      title="Download"
                    >
                      <Download className="w-3 h-3" />
                    </button>
                  </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </PaneCard>
      )}

      {/* ── Version History card — full, with files & comments per version ── */}
      {grouped.length > 0 && (
        <PaneCard title="Version History" icon={<History className="w-3.5 h-3.5" />} count={grouped.length}>
          <ol className="space-y-5">
            {grouped.map((g) => {
              const versionComments = comments
                .filter((c) => c.parentType === 'version' && c.parentId === g.version)
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
              return (
                <li key={g.version} className="relative pl-10">
                  {/* Version badge (timeline dot) */}
                  <span className="absolute left-0 top-0 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gold-50 text-gold-700 dark:bg-gold-400/10 dark:text-gold-400 text-[11px] font-bold font-mono">
                    v{g.version}
                  </span>

                  {/* Meta row */}
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] flex-wrap">
                    <PersonBadge
                      initials={personInitials(g.uploadedBy)}
                      position={people.find((p) => p.id === g.uploadedBy)?.position}
                      avatarUrl={people.find((p) => p.id === g.uploadedBy)?.avatarUrl}
                      name={people.find((p) => p.id === g.uploadedBy)?.name}
                    />
                    <span>&middot;</span>
                    <span>{formatDateTime(g.createdAt)}</span>
                    {g.action && (
                      <>
                        <span>&middot;</span>
                        <span className="italic text-[var(--text-secondary)]">{g.action}</span>
                      </>
                    )}
                  </div>

                  {/* Files */}
                  <div className="mt-2 space-y-1.5">
                    {g.files.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center gap-2.5 px-3 py-2 bg-[var(--subtle-bg)] rounded-lg border border-[var(--border-color)]"
                      >
                        <FileText className="w-3.5 h-3.5 text-gold-600 dark:text-gold-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[var(--text-primary)] truncate">{f.fileName}</p>
                          {f.fileSize ? <p className="text-[10px] text-[var(--text-muted)]">{formatFileSize(f.fileSize)}</p> : null}
                        </div>
                        {f.needsReupload ? (
                          <NeedsReuploadBadge />
                        ) : (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => setPreviewFile({ name: f.fileName, url: f.fileUrl })}
                            className="inline-flex items-center justify-center w-7 h-7 text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg transition-all cursor-pointer"
                            title="Preview"
                          >
                            <Eye className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void downloadFile({ name: f.fileName, url: f.fileUrl })}
                            className="inline-flex items-center justify-center w-7 h-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg transition-all cursor-pointer"
                            title="Download"
                          >
                            <Download className="w-3 h-3" />
                          </button>
                        </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Comments tied to this version */}
                  {versionComments.length > 0 && (
                    <ul className="mt-3 space-y-2 border-l-2 border-[var(--border-color)] pl-3">
                      {versionComments.map((c) => (
                        <li key={c.id} className="flex items-start gap-2">
                          <PersonBadge
                            initials={personInitials(c.personId)}
                            position={people.find((p) => p.id === c.personId)?.position}
                            avatarUrl={people.find((p) => p.id === c.personId)?.avatarUrl}
                            name={people.find((p) => p.id === c.personId)?.name}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-[var(--text-muted)]">{formatDateTime(c.createdAt)}</p>
                            <p className="text-[12.5px] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap mt-0.5">
                              {c.comment}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </PaneCard>
      )}

      <FilePreviewModal
        open={!!previewFile}
        onClose={() => setPreviewFile(null)}
        file={previewFile}
      />
    </div>
  );
}
