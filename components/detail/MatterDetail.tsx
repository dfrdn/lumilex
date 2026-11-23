import { notFound } from 'next/navigation';
import { getSession } from '@/lib/session';
import Link from 'next/link';
import {
  FolderOpen, FolderKanban, CheckSquare, FileText, Handshake, Scale, Paperclip,
  Briefcase, Hash, Building2, Award, Link2, Tag,
  ChevronRight, AlertTriangle, XCircle, MinusCircle,
} from 'lucide-react';
import {
  getCaseById, getMattersByIds, getMattersByClientId,
  getTasksByMatterId, getMeetingsByMatterId,
  getHearingsByMatterId, getDeliverablesByMatterId,
  getFilesByMatterId, getFilingsByMatterId,
  getFiledCopiesByMatterId,
  type MatterFiledCopy,
} from '@/lib/queries/detail';
import { getMatterGroupMemberIds } from '@/lib/queries/matter-groups';
import DetailShell from './DetailShell';
import CaseTimeline from './CaseTimeline';
import MatterSections from './MatterSections';
import MatterSummary from './MatterSummary';
import MatterHealth from './MatterHealth';
import MatterChat from './MatterChat';
import MatterKnowledgeSearch from './MatterKnowledgeSearch';
import MatterRelevantFromCorpus from '../MatterRelevantFromCorpus';
// import PartiesSection from './PartiesSection'; // hidden for now
import CourtRulesWrapper from './CourtRulesWrapper';
import MatterCases from '@/components/cases/MatterCases';
import { getCasesForMatter } from '@/lib/queries/cases';
import { CASE_EDITORS } from '@/lib/cases/api';
import MatterFiles from './MatterFiles';
import MatterFileRequests from './MatterFileRequests';
import MatterExhibits from './MatterExhibits';
import MatterBillingCard from './MatterBillingCard';
import { MatterStatusProvider, MatterStatusPill } from './MatterStatus';
// Matter expenses moved to /finance/expenses
import { resolvePersonIds } from '@/lib/queries/people';
import type { NotionHearingDetail, NotionFileDetail, NotionDeliverableDetail, NotionTaskDetail, NotionFilingDetail } from '@/types/notion';
import { toManilaDay } from '@/lib/dates';

// ── Helpers ──────────────────────────────────────────────────────────

function formatDate(d: string | null): string {
  if (!d) return '\u2014';
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function isOverdue(date: string | null): boolean {
  if (!date) return false;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  return date < today;
}

function getMatterTypeStyle(type: string) {
  const t = type.toLowerCase();
  if (t.includes('litigation') || t.includes('court')) return 'bg-red-50 text-red-700 ring-red-200/60 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20';
  if (t.includes('corporate') || t.includes('company')) return 'bg-blue-50 text-blue-700 ring-blue-200/60 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20';
  if (t.includes('labor') || t.includes('employment')) return 'bg-amber-50 text-amber-700 ring-amber-200/60 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20';
  if (t.includes('tax')) return 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20';
  if (t.includes('criminal')) return 'bg-rose-50 text-rose-700 ring-rose-200/60 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20';
  if (t.includes('admin')) return 'bg-violet-50 text-violet-700 ring-violet-200/60 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/20';
  return 'bg-stone-50 text-stone-600 ring-stone-200/60 dark:bg-stone-500/10 dark:text-stone-400 dark:ring-stone-500/20';
}

function getOutcomeStyle(outcome: string) {
  const o = outcome.toLowerCase();
  if (o === 'loss' || o === 'denied' || o === 'dismissed with prejudice' || o === 'unfavorable')
    return 'bg-rose-50 text-rose-700 ring-rose-200/60 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20';
  if (o === 'win' || o === 'won' || o === 'favorable' || o === 'settled' || o === 'dismissed' || o === 'granted')
    return 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20';
  return 'bg-stone-100 text-stone-500 ring-stone-200/60 dark:bg-stone-500/10 dark:text-stone-400 dark:ring-stone-500/20';
}

function getOutcomeTextColor(outcome: string) {
  const o = outcome.toLowerCase();
  if (o === 'loss' || o === 'denied' || o === 'dismissed with prejudice' || o === 'unfavorable')
    return 'text-rose-600 dark:text-rose-400';
  if (o === 'win' || o === 'won' || o === 'favorable' || o === 'settled' || o === 'dismissed' || o === 'granted')
    return 'text-emerald-600 dark:text-emerald-400';
  return 'text-stone-500 dark:text-stone-400';
}

function getOutcomeIcon(outcome: string) {
  const o = outcome.toLowerCase();
  if (o === 'loss' || o === 'denied' || o === 'dismissed with prejudice' || o === 'unfavorable')
    return XCircle;
  if (o === 'win' || o === 'won' || o === 'favorable' || o === 'settled' || o === 'dismissed' || o === 'granted')
    return Award;
  return MinusCircle;
}

// ── Component ────────────────────────────────────────────────────────

export default async function MatterDetail({ id }: { id: string }) {
  const session = await getSession();
  if (!session) notFound();

  const matter = await getCaseById(id, session.firmId);
  if (!matter) notFound();

  const userRole = session?.user?.role;
  const isAdmin = userRole === 'admin' || userRole === 'super_user';
  const isAdminOrPartner = isAdmin || userRole === 'partner';
  const canViewBilling = userRole === 'partner' || userRole === 'finance' || userRole === 'super_user';

  const currentPersonId = session?.user?.notionUserId ?? '';
  const onMatterTeam = !!currentPersonId && matter.teamPersonIds.includes(currentPersonId);
  const canEditExhibits = isAdmin || ((userRole === 'lawyer' || userRole === 'partner') && onMatterTeam);

  const [[tasks, meetings, hearings, deliverables, files, filings, filedCopies, relatedMatters, siblingMatters, groupMemberIds], teamPeople, cases] =
    await Promise.all([
      Promise.allSettled([
        getTasksByMatterId(id, session.firmId),
        getMeetingsByMatterId(id, session.firmId),
        getHearingsByMatterId(id, session.firmId),
        getDeliverablesByMatterId(id, session.firmId),
        getFilesByMatterId(id, session.firmId),
        getFilingsByMatterId(id, session.firmId),
        getFiledCopiesByMatterId(id, session.firmId),
        matter.relatedMatterIds.length > 0
          ? getMattersByIds(matter.relatedMatterIds, session.firmId)
          : Promise.resolve([]),
        matter.clientId
          ? getMattersByClientId(matter.clientId, session.firmId)
          : Promise.resolve([]),
        matter.relatedMatterIds.length > 0
          ? getMatterGroupMemberIds(session.firmId, id)
          : Promise.resolve([] as string[]),
      ]).then((results) =>
        results.map((r) => (r.status === 'fulfilled' ? r.value : [])),
      ),
      matter.teamPersonIds.length > 0
        ? resolvePersonIds(session.firmId, matter.teamPersonIds)
        : new Map<string, { personId: string; initials: string; position: string; avatarUrl: string | null; active: boolean }>(),
      getCasesForMatter(id),
    ]);

  const taskList = tasks as NotionTaskDetail[];
  const deliverableList = deliverables as NotionDeliverableDetail[];
  const hearingList = hearings as NotionHearingDetail[];
  const meetingList = meetings as any[];
  const fileList = files as NotionFileDetail[];
  const filingList = filings as NotionFilingDetail[];
  const filedCopyList = filedCopies as MatterFiledCopy[];
  const relatedList = relatedMatters as any[];
  const allSiblingMatters = (siblingMatters as any[]).filter((m: any) => m.id !== id);
  const memberIds = (groupMemberIds as string[]) ?? [];
  const groupRootId = memberIds.length > 1 ? memberIds.slice().sort()[0] : null;

  const isCase = !!(matter.caseTitle || matter.caseNumber || matter.court);
  const isDisputeMatter = matter.type === 'Litigation' || matter.type === 'Labor';

  // Filter filing-type entries out of hearings
  const pureHearings = hearingList.filter((h) => {
    const t = (h.type || '').toLowerCase();
    return t !== 'filing' && !t.includes('filing');
  });

  // Compute stats
  const openTasks = taskList.filter((t) => !t.done).length;
  const overdueTasks = taskList.filter((t) => !t.done && isOverdue(t.dueDate)).length;
  const activeDeliverables = deliverableList.filter((d) => {
    const s = d.status.toLowerCase();
    return !s.includes('filed') && !s.includes('sent out') && !s.includes('archived');
  }).length;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const upcomingHearings = pureHearings.filter((h) => {
    if (!h.date) return false;
    return toManilaDay(h.date) >= today;
  }).length;
  const upcomingFilings = filingList.filter((f) => {
    const s = (f.status || '').toLowerCase();
    return !s.includes('filed') && !s.includes('sent out') && !s.includes('done') && !s.includes('completed') && !s.includes('archived');
  }).length;
  const upcomingMeetings = meetingList.filter((m) => {
    if (!m.date) return false;
    return toManilaDay(m.date) >= today;
  }).length;

  return (
    <>
    <DetailShell
      title={matter.matterCode ? `${matter.name} (${matter.matterCode})` : matter.name}
      icon={<FolderOpen className="w-5 h-5" />}
      entityType="Matter"
      breadcrumbs={matter.clientId ? [{ label: matter.clientName, href: `/dashboard/clients/${matter.clientId}` }] : undefined}
    >
      {/* ── Matter Group Banner ─────────────────────────────────── */}
      {groupRootId && (
        <Link
          href={`/dashboard/matter-groups/${groupRootId}`}
          className="group flex items-center gap-3 mb-5 px-4 py-3 rounded-xl bg-gradient-to-r from-navy-50 to-navy-50/40 dark:from-navy-500/10 dark:to-navy-500/5 border border-navy-200/60 dark:border-navy-500/20 hover:border-navy-300 dark:hover:border-navy-500/40 hover:shadow-sm transition-all duration-150 banner-attention-in"
        >
          <div className="w-9 h-9 rounded-lg bg-navy-100 dark:bg-navy-500/20 flex items-center justify-center shrink-0">
            <FolderKanban className="w-4.5 h-4.5 text-navy-600 dark:text-navy-300" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-600/80 dark:text-navy-300/80">
              Part of a Matter Group
            </p>
            <p className="text-sm text-[var(--text-primary)] mt-0.5">
              This matter is one of <span className="font-semibold">{memberIds.length}</span> related matters. View the full group for a consolidated timeline, parties, and deliverables.
            </p>
          </div>
          <div className="inline-flex items-center gap-1 text-xs font-medium text-navy-600 dark:text-navy-300 shrink-0 group-hover:translate-x-0.5 transition-transform duration-150">
            View Group
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </Link>
      )}

      {/* ── Matter Info Header ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5 mb-6 animate-fade-up">
        <MatterStatusProvider
          matterId={id}
          matterName={matter.name}
          initialStatus={matter.status ?? ''}
          canEdit={userRole === 'partner' || userRole === 'super_user'}
        >
          <MatterStatusPill />
        </MatterStatusProvider>
        {matter.type && (
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full ring-1 ring-inset ${getMatterTypeStyle(matter.type)}`}>
            <Tag className="w-3 h-3" />
            {matter.type}
          </span>
        )}
        {matter.clientName && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full ring-1 ring-inset bg-navy-50 text-navy-700 ring-navy-200/60 dark:bg-navy-500/10 dark:text-navy-400 dark:ring-navy-500/20">
            <Briefcase className="w-3 h-3" />
            {matter.clientId ? (
              <Link href={`/dashboard/clients/${matter.clientId}`} className="hover:underline">
                {matter.clientName}
              </Link>
            ) : matter.clientName}
          </span>
        )}
        {matter.matterCode && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
            <Hash className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            {matter.matterCode}
          </span>
        )}
        {isCase && matter.court && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
            <Building2 className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            {matter.court}
          </span>
        )}
        {isCase && matter.outcome && (() => {
          const OutcomeIcon = getOutcomeIcon(matter.outcome);
          return (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full ring-1 ring-inset ${getOutcomeStyle(matter.outcome)}`}>
              <OutcomeIcon className="w-3 h-3" />
              {matter.outcome}
            </span>
          );
        })()}
      </div>
      {matter.teamPersonIds.length > 0 && (() => {
        const positionOrder: Record<string, number> = {
          'Founding Partner': 0, 'Managing Partner': 1, 'Monitoring Partner': 2,
          'Partner': 3, 'Of Counsel': 4, 'Senior Associate': 5,
          'Junior Associate': 6, 'Office Manager': 7, 'Head Secretary': 8,
          'Paralegal': 8, 'Secretary': 9,
        };
        const sorted = matter.teamPersonIds
          .map((pid) => ({ pid, person: teamPeople.get(pid) }))
          .filter((e) => e.person && e.person.active)
          .sort((a, b) => (positionOrder[a.person!.position] ?? 99) - (positionOrder[b.person!.position] ?? 99));
        return (
          <div className="flex flex-wrap items-center gap-2 mb-6 animate-fade-up">
            {sorted.map(({ pid, person }) => (
              <span
                key={pid}
                title={person!.position ? `${person!.initials} — ${person!.position}` : person!.initials}
                className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-navy-100 dark:bg-navy-500/15 text-navy-700 dark:text-navy-300 text-[10px] font-bold"
              >
                {person!.initials}
              </span>
            ))}
          </div>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start stagger-children">
        {/* ── Left column ─────────────────────────────────────────── */}
        <div className="lg:col-span-2">

          {/* Matter Risk */}
          <MatterHealth matterId={id} />

          {/* AI Summary */}
          <MatterSummary matterId={id} />

          {(cases.length > 0 || isDisputeMatter) && (
            <MatterCases
              cases={cases}
              canStart={isDisputeMatter && CASE_EDITORS.includes(userRole ?? '')}
              matter={{ id, name: matter.name, code: matter.matterCode ?? '', clientName: matter.clientName ?? '', nature: matter.caseTitle ?? '' }}
            />
          )}

          {/* Case Details Card (only if it's a court case) */}
          {isCase && (matter.caseTitle || matter.caseNumber) && (
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up mb-6">
              <div className="px-6 py-4 border-b border-[var(--border-color)]">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Case Information</h2>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {matter.caseNumber && (
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Hash className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                        <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Case Number</p>
                      </div>
                      <p className="text-sm font-semibold text-[var(--text-primary)] font-mono">{matter.caseNumber}</p>
                    </div>
                  )}
                  {matter.caseTitle && (
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <FileText className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                        <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Case Title</p>
                      </div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{matter.caseTitle}</p>
                    </div>
                  )}
                  {matter.court && (
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Building2 className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                        <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Court / Agency</p>
                      </div>
                      <p className="text-sm text-[var(--text-primary)]">{matter.court}</p>
                    </div>
                  )}
                  {matter.outcome && (
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Award className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                        <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Outcome</p>
                      </div>
                      <p className={`text-sm font-medium ${getOutcomeTextColor(matter.outcome)}`}>{matter.outcome}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SOL Banner + Court Rules Deadlines */}
          <CourtRulesWrapper matterId={id} matterType={matter.type ?? ''} canEdit={isAdminOrPartner} />

          {/* Parties — hidden for now */}
          {/* <PartiesSection matterId={id} isAdmin={isAdmin} /> */}

          {/* Related Matters Card */}
          {relatedList.length > 0 && (
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up mb-6">
              <div className="px-6 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Related Matters</h2>
                {groupRootId && (
                  <Link
                    href={`/dashboard/matter-groups/${groupRootId}`}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-navy-600 dark:text-navy-400 hover:text-navy-700 dark:hover:text-navy-300"
                  >
                    <FolderKanban className="w-3 h-3" />
                    View in Matter Group
                    <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
              <div className="p-4">
                <div className="flex flex-wrap gap-2">
                  {relatedList.map((rm: any) => (
                    <Link
                      key={rm.id}
                      href={`/dashboard/matters/${rm.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-navy-600 dark:text-navy-400 bg-navy-50/50 dark:bg-navy-500/5 hover:bg-navy-100 dark:hover:bg-navy-500/10 rounded-lg border border-navy-200/50 dark:border-navy-500/15 transition-all duration-150 hover:translate-x-0.5 group"
                    >
                      <Link2 className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 transition-opacity" />
                      {rm.matterCode ? `${rm.name} (${rm.matterCode})` : rm.name}
                      <ChevronRight className="w-3 h-3 opacity-0 -ml-1 group-hover:opacity-50 group-hover:ml-0 transition-all duration-150" />
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Filterable Sections (client component) ──────────── */}
          <MatterSections
            tasks={taskList}
            deliverables={deliverableList}
            hearings={pureHearings}
            filings={filingList}
            meetings={meetingList}
          />

          {/* ── Client file requests ─────────────────────────────── */}
          <MatterFileRequests matterId={id} />

          {/* ── Files ─────────────────────────────────────────────── */}
          <MatterFiles files={fileList} filedCopies={filedCopyList} />

          {/* ── Exhibits (case matters only) ──────────────────────── */}
          {isCase && (
            <MatterExhibits
              matterId={id}
              matterFiles={fileList.map((f) => ({ id: f.id, name: f.name }))}
              canEdit={canEditExhibits}
            />
          )}

          {/* ── Case Timeline ──────────────────────────────────────── */}
          {isCase && (
            <div className="mt-6">
              <CaseTimeline
                hearings={hearingList}
                files={fileList}
                // Only true external deliverables belong on a case timeline.
                // Status Reports, For Client, Internal, and government-form
                // filings (BIR/SEC) are tracked elsewhere and would clutter
                // the chronological view of what was filed with the court.
                filings={filingList.filter((f) => f.type === 'External')}
                filedCopies={filedCopyList}
                caseTitle={matter.caseTitle}
                caseNumber={matter.caseNumber}
                court={matter.court}
                outcome={matter.outcome}
              />
            </div>
          )}
        </div>

        {/* ── Right column: Overview Sidebar ───────────────────────── */}
        <div className="space-y-6 sticky top-20">

          {/* Billing + Engagement Agreement (partners, admins, finance) */}
          {canViewBilling && <MatterBillingCard matterId={id} />}

          {/* Quick Stats Card */}
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
            <div className="px-5 py-4 border-b border-[var(--border-color)]">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Overview</h2>
            </div>
            <div className="divide-y divide-[var(--border-color)]">
              <a href="#section-tasks" className="px-5 py-4 flex items-center justify-between hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] transition-colors duration-150 cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
                    <CheckSquare className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                  </div>
                  <div>
                    <span className="text-sm text-[var(--text-secondary)]">Open Tasks</span>
                    {overdueTasks > 0 && (
                      <p className="text-[10px] text-red-500 dark:text-red-400 font-medium">{overdueTasks} overdue</p>
                    )}
                  </div>
                </div>
                <span className="text-lg font-semibold text-[var(--text-primary)] tabular-nums">{openTasks}</span>
              </a>
              <a href="#section-deliverables" className="px-5 py-4 flex items-center justify-between hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] transition-colors duration-150 cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center">
                    <FileText className="w-4 h-4 text-violet-500 dark:text-violet-400" />
                  </div>
                  <span className="text-sm text-[var(--text-secondary)]">Active Deliverables</span>
                </div>
                <span className="text-lg font-semibold text-[var(--text-primary)] tabular-nums">{activeDeliverables}</span>
              </a>
              <a href="#section-hearings" className="px-5 py-4 flex items-center justify-between hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] transition-colors duration-150 cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                    <Scale className="w-4 h-4 text-red-500 dark:text-red-400" />
                  </div>
                  <span className="text-sm text-[var(--text-secondary)]">Upcoming Hearings</span>
                </div>
                <span className="text-lg font-semibold text-[var(--text-primary)] tabular-nums">{upcomingHearings}</span>
              </a>
              <a href="#section-filings" className="px-5 py-4 flex items-center justify-between hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] transition-colors duration-150 cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
                    <FolderOpen className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                  </div>
                  <span className="text-sm text-[var(--text-secondary)]">Upcoming Filings</span>
                </div>
                <span className="text-lg font-semibold text-[var(--text-primary)] tabular-nums">{upcomingFilings}</span>
              </a>
              <a href="#section-meetings" className="px-5 py-4 flex items-center justify-between hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] transition-colors duration-150 cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-gold-50 dark:bg-gold-400/10 flex items-center justify-center">
                    <Handshake className="w-4 h-4 text-gold-500 dark:text-gold-400" />
                  </div>
                  <span className="text-sm text-[var(--text-secondary)]">Upcoming Meetings</span>
                </div>
                <span className="text-lg font-semibold text-[var(--text-primary)] tabular-nums">{upcomingMeetings}</span>
              </a>
              <a href="#section-files" className="px-5 py-4 flex items-center justify-between hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] transition-colors duration-150 cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                    <Paperclip className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                  </div>
                  <span className="text-sm text-[var(--text-secondary)]">Files</span>
                </div>
                <span className="text-lg font-semibold text-[var(--text-primary)] tabular-nums">{fileList.length}</span>
              </a>
            </div>
          </div>

          {/* Upcoming Deadlines Card */}
          {(() => {
            const upcomingDeadlines = [
              ...taskList
                .filter((t) => !t.done && t.dueDate)
                .map((t) => ({ label: t.name, date: t.dueDate!, type: 'task' as const, href: `/dashboard/tasks/${t.id}` })),
              ...deliverableList
                .filter((d) => d.externalDueDate && !d.status.toLowerCase().includes('filed') && !d.status.toLowerCase().includes('sent out') && !d.status.toLowerCase().includes('archived'))
                .map((d) => ({ label: d.name, date: d.externalDueDate!, type: 'deliverable' as const, href: `/dashboard/deliverables/${d.id}` })),
              ...pureHearings
                .filter((h) => h.date && toManilaDay(h.date) >= today)
                .map((h) => ({ label: h.name, date: toManilaDay(h.date!), type: 'hearing' as const, href: `/dashboard/hearings/${h.id}` })),
            ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);

            if (upcomingDeadlines.length === 0) return null;

            return (
              <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
                <div className="px-5 py-4 border-b border-[var(--border-color)]">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Upcoming Deadlines</h2>
                </div>
                <div className="divide-y divide-[var(--border-color)]">
                  {upcomingDeadlines.map((dl, i) => {
                    const overdue = isOverdue(dl.date);
                    return (
                      <Link key={i} href={dl.href} className="block px-5 py-3.5 hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] transition-all duration-150 group">
                        <div className="flex items-start gap-2.5">
                          <div className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                            overdue ? 'bg-red-500' :
                            dl.type === 'hearing' ? 'bg-red-400' :
                            dl.type === 'deliverable' ? 'bg-violet-400' :
                            'bg-blue-400'
                          }`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-foreground group-hover:text-gold-600 dark:group-hover:text-gold-400 truncate transition-colors duration-150">
                              {dl.label || '(Untitled)'}
                            </p>
                            <p className={`text-[11px] font-mono mt-0.5 ${
                              overdue ? 'text-red-500 dark:text-red-400 font-medium' : 'text-[var(--text-muted)]'
                            }`}>
                              {overdue && 'Overdue \u2022 '}{formatDate(dl.date)}
                            </p>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Other Matters (same client) */}
          {allSiblingMatters.length > 0 && (
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
              <div className="px-5 py-4 border-b border-[var(--border-color)]">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Other Matters
                  {matter.clientName && (
                    <span className="normal-case tracking-normal font-normal ml-1 text-[var(--text-muted)]">
                      &middot; {matter.clientName}
                    </span>
                  )}
                </h2>
              </div>
              <div className="divide-y divide-[var(--border-color)] max-h-[320px] overflow-y-auto">
                {allSiblingMatters.map((sm: any) => (
                  <Link
                    key={sm.id}
                    href={`/dashboard/matters/${sm.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] transition-all duration-150 group"
                  >
                    <div className="w-7 h-7 rounded-lg bg-navy-50/60 dark:bg-navy-500/10 flex items-center justify-center shrink-0">
                      <FolderOpen className="w-3.5 h-3.5 text-navy-400 dark:text-navy-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground group-hover:text-gold-600 dark:group-hover:text-gold-400 truncate transition-colors duration-150">
                        {sm.name}
                      </p>
                      {sm.matterCode && (
                        <p className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">{sm.matterCode}</p>
                      )}
                    </div>
                    <ChevronRight className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Search within this matter (human-driven, matter-scoped) */}
      <div className="mt-6">
        <MatterKnowledgeSearch matterId={id} />
      </div>

      {/* Cross-matter semantic search — relevant pleadings/memos/briefs from other matters */}
      <div className="mt-6">
        <MatterRelevantFromCorpus matterId={id} matterName={matter.name} />
      </div>
    </DetailShell>

    {/* Matter Q&A Chat */}
    <MatterChat matterId={id} matterName={matter.name} />
    </>
  );
}
