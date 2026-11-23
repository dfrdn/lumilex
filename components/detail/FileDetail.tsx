import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import {
  Paperclip, Calendar, Building2, FileText, ArrowRight,
  Send, Download, Clock, Tag, Scale,
} from 'lucide-react';
import { getFileById } from '@/lib/queries/detail';
import {
  resolvePersonIds, getActiveTeamMembers, getAllTeamMembersAsMap,
} from '@/lib/queries/people';
import { getEntityComments } from '@/lib/queries/entity-comments';
import DetailShell from './DetailShell';
import PersonBadge from './PersonBadge';
import DocumentAnalysis from './DocumentAnalysis';
import FileAttachments from './FileAttachments';
import EntityCommentsSection from './EntityCommentsSection';

function formatDate(d: string | null): string {
  if (!d) return '\u2014';
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

function formatDateShort(d: string | null): string {
  if (!d) return '\u2014';
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function getOriginStyle(origin: string) {
  const o = origin.toLowerCase();
  if (o.includes('client')) return 'bg-gold-50 text-gold-700 ring-gold-200/60 dark:bg-gold-500/10 dark:text-gold-400 dark:ring-gold-500/20';
  if (o.includes('court') || o.includes('tribunal')) return 'bg-red-50 text-red-700 ring-red-200/60 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20';
  if (o.includes('respondent') || o.includes('opposing')) return 'bg-amber-50 text-amber-700 ring-amber-200/60 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20';
  if (o.includes('internal') || o.includes('firm')) return 'bg-blue-50 text-blue-700 ring-blue-200/60 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20';
  return 'bg-stone-50 text-stone-600 ring-stone-200/60 dark:bg-stone-500/10 dark:text-stone-400 dark:ring-stone-500/20';
}

export default async function FileDetail({ id }: { id: string }) {
  const session = await getSession();
  if (!session) notFound();
  const currentUserId = session?.user?.notionUserId ?? '';

  const item = await getFileById(id, session.firmId);
  if (!item) notFound();

  const [people, teamMembers, comments, allPeopleMap] = await Promise.all([
    resolvePersonIds(session.firmId, item.personsReadIds ?? []),
    getActiveTeamMembers(session.firmId).catch(() => []),
    getEntityComments(session.firmId, 'file', item.id).catch(() => []),
    getAllTeamMembersAsMap(session.firmId).catch(() => new Map()),
  ]);
  const peopleForComments = Object.fromEntries(allPeopleMap);

  const hasTimeline = item.documentDate || item.dateReceived || item.dateSentFiled;

  return (
    <DetailShell
      title={item.name}
      icon={<Paperclip className="w-5 h-5" />}
      entityType="File"
      breadcrumbs={item.matterId ? [{ label: item.matter, href: `/dashboard/matters/${item.matterId}` }] : undefined}
    >
      {/* ── Badges Row ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5 mb-6 animate-fade-up">
        {item.origin && (
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full ring-1 ring-inset ${getOriginStyle(item.origin)}`}>
            <Tag className="w-3 h-3" />
            {item.origin}
          </span>
        )}
        {item.actionTaken && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full ring-1 ring-inset bg-violet-50 text-violet-700 ring-violet-200/60 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/20">
            <Send className="w-3 h-3" />
            {item.actionTaken}
          </span>
        )}
        {item.isCourtRecord && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full ring-1 ring-inset bg-red-50 text-red-700 ring-red-200/60 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20">
            <Scale className="w-3 h-3" />
            Court Record
          </span>
        )}
        {item.createdTime && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
            <Clock className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            Created {formatDateShort(item.createdTime?.split('T')[0] ?? null)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 stagger-children">
        {/* ── Left Column ───────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Date Timeline Card */}
          {hasTimeline && (
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
              <div className="px-6 py-4 border-b border-[var(--border-color)]">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Date Timeline</h2>
              </div>
              <div className="p-6">
                <div className="relative">
                  {/* Timeline connector line */}
                  <div className="absolute left-[15px] top-3 bottom-3 w-px bg-gradient-to-b from-[var(--border-color)] via-gold-300/40 to-[var(--border-color)] dark:via-gold-500/20" />

                  <div className="space-y-6">
                    {item.documentDate && (
                      <div className="relative flex items-start gap-4 pl-1">
                        <div className="relative z-10 w-[30px] h-[30px] rounded-full bg-blue-50 dark:bg-blue-500/10 border-2 border-blue-300 dark:border-blue-500/40 flex items-center justify-center shrink-0">
                          <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="pt-1">
                          <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Document Date</p>
                          <p className="text-sm font-semibold text-[var(--text-primary)] mt-0.5">{formatDate(item.documentDate)}</p>
                        </div>
                      </div>
                    )}

                    {item.dateReceived && (
                      <div className="relative flex items-start gap-4 pl-1">
                        <div className="relative z-10 w-[30px] h-[30px] rounded-full bg-emerald-50 dark:bg-emerald-500/10 border-2 border-emerald-300 dark:border-emerald-500/40 flex items-center justify-center shrink-0">
                          <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="pt-1">
                          <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Date Received</p>
                          <p className="text-sm font-semibold text-[var(--text-primary)] mt-0.5">{formatDate(item.dateReceived)}</p>
                        </div>
                      </div>
                    )}

                    {item.dateSentFiled && (
                      <div className="relative flex items-start gap-4 pl-1">
                        <div className="relative z-10 w-[30px] h-[30px] rounded-full bg-gold-50 dark:bg-gold-500/10 border-2 border-gold-300 dark:border-gold-500/40 flex items-center justify-center shrink-0">
                          <Send className="w-3.5 h-3.5 text-gold-600 dark:text-gold-400" />
                        </div>
                        <div className="pt-1">
                          <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Date Sent / Filed</p>
                          <p className="text-sm font-semibold text-[var(--text-primary)] mt-0.5">{formatDate(item.dateSentFiled)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Attachments Card */}
          <FileAttachments files={item.fileUrls ?? []} />

          {/* AI Document Analysis */}
          <DocumentAnalysis fileId={item.id} fileUrls={item.fileUrls} matterName={item.matter} />

          <EntityCommentsSection
            entityType="file"
            entityId={item.id}
            initialComments={comments}
            people={peopleForComments}
            teamMembers={teamMembers}
            currentUserId={currentUserId}
          />
        </div>

        {/* ── Right Sidebar ─────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Linked Matter Card */}
          {item.matterId && (
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
              <div className="px-6 py-4 border-b border-[var(--border-color)]">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Linked Matter</h2>
              </div>
              <div className="p-4">
                <Link
                  href={`/dashboard/matters/${item.matterId}`}
                  className="flex items-start gap-3 px-3 py-3 rounded-lg hover:bg-[var(--subtle-bg)] transition-all duration-200 group -m-1"
                >
                  <div className="w-9 h-9 rounded-lg bg-navy-50 dark:bg-navy-500/10 flex items-center justify-center shrink-0 group-hover:bg-navy-100 dark:group-hover:bg-navy-500/20 transition-colors">
                    <Building2 className="w-4 h-4 text-navy-600 dark:text-navy-400" />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-sm font-semibold text-[var(--text-primary)] group-hover:text-navy-700 dark:group-hover:text-navy-300 transition-colors leading-snug">{item.matter}</p>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">View matter details</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-navy-500 transition-colors shrink-0 mt-1" />
                </Link>
              </div>
            </div>
          )}

          {/* Related Deliverable */}
          {item.deliverableId && (
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
              <div className="px-6 py-4 border-b border-[var(--border-color)]">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Related Deliverable</h2>
              </div>
              <div className="p-4">
                <Link
                  href={`/dashboard/deliverables/${item.deliverableId}`}
                  className="flex items-start gap-3 px-3 py-3 rounded-lg hover:bg-[var(--subtle-bg)] transition-all duration-200 group -m-1"
                >
                  <div className="w-9 h-9 rounded-lg bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center shrink-0 group-hover:bg-violet-100 dark:group-hover:bg-violet-500/20 transition-colors">
                    <FileText className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-sm font-semibold text-[var(--text-primary)] group-hover:text-violet-700 dark:group-hover:text-violet-300 transition-colors leading-snug">{item.deliverableName || 'View Deliverable'}</p>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">View deliverable details</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-violet-500 transition-colors shrink-0 mt-1" />
                </Link>
              </div>
            </div>
          )}

          {/* Persons Read */}
          {item.personsReadIds && item.personsReadIds.length > 0 && (
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
              <div className="px-6 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Read By</h2>
                <span className="text-[11px] font-semibold text-[var(--text-muted)] bg-[var(--subtle-bg)] rounded-full px-2 py-0.5">
                  {item.personsReadIds.length}
                </span>
              </div>
              <div className="p-5">
                <div className="flex flex-wrap gap-2">
                  {item.personsReadIds.map((pid) => {
                    const person = people.get(pid);
                    return person ? (
                      <PersonBadge key={pid} initials={person.initials} position={person.position} avatarUrl={person.avatarUrl} />
                    ) : null;
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Details Card (fallback when no sidebar links) */}
          {!item.matterId && !item.deliverableId && (
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
              <div className="px-6 py-4 border-b border-[var(--border-color)]">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Details</h2>
              </div>
              <div className="p-6 space-y-4">
                {item.origin && (
                  <div>
                    <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1">Origin</p>
                    <p className="text-sm font-medium text-[var(--text-primary)]">{item.origin}</p>
                  </div>
                )}
                {item.actionTaken && (
                  <div>
                    <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1">Action Taken</p>
                    <p className="text-sm font-medium text-[var(--text-primary)]">{item.actionTaken}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

    </DetailShell>
  );
}
