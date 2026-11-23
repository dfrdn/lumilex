import { notFound } from 'next/navigation';
import Link from 'next/link';
import { FileText, Paperclip, Mail, Scale, History } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getDeliverableById, getDeliverableVersions, getDeliverableActions, getDeliverableComments, getDeliverableVersionReactions } from '@/lib/queries/detail';
import { getAllTeamMembersAsMap, getActiveTeamMembers, LAWYER_ROLES } from '@/lib/queries/people';
import SubjectCrumbs from './SubjectCrumbs';
import { SubjectCard } from '@/components/ui/primitives';
import DeliverableShellProvider from '@/components/detail/DeliverableShellProvider';
import DeliverableHeaderBar, { DeliverableAtAGlance } from '@/components/detail/DeliverableHeaderBar';
import DeliverableActionRow from '@/components/detail/DeliverableActionRow';
import DeliverableVersionHistory from '@/components/detail/DeliverableVersionHistory';
import DeliverableDetailClient from '@/components/detail/DeliverableDetailClient';
import LatestSubmissionCard from '@/components/detail/LatestSubmissionCard';
import FiledVersionCard from '@/components/detail/FiledVersionCard';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { deliverablesHref } from '@/lib/deliverables/views';

const LINK = 'inline-flex items-center gap-1.5 text-[12px] text-navy-700 dark:text-navy-300 hover:underline';

export default async function DeliverableDetail({ id }: { id: string }) {
  const session = await getSession();
  if (!session) notFound();
  const currentUserId = session?.user?.notionUserId ?? '';

  const item = await getDeliverableById(id, session.firmId);
  if (!item) notFound();

  const userRole = session?.user?.role ?? 'lawyer';

  // Load every team member up front. Anyone who has touched this deliverable
  // (drafter, reviewer, actor, commenter, reactor, mentionee) resolves from
  // the same map without us having to enumerate IDs.
  const [versions, actions, delComments, versionReactions, allPeople, teamMembers] = await Promise.all([
    getDeliverableVersions(id, session.firmId).catch(() => []),
    getDeliverableActions(id, session.firmId).catch(() => []),
    getDeliverableComments(id, session.firmId).catch(() => []),
    getDeliverableVersionReactions(id, session.firmId).catch(() => ({} as Record<number, import('@/types/notion').CommentReaction[]>)),
    getAllTeamMembersAsMap(session.firmId),
    getActiveTeamMembers(session.firmId).catch(() => []),
  ]);

  // Drafter/reviewer/currently-with pickers are lawyer-only; @mentions (below)
  // still resolve against the full team.
  const lawyerMembers = teamMembers.filter((m) => LAWYER_ROLES.includes(m.role as (typeof LAWYER_ROLES)[number]));
  const people = Object.fromEntries(allPeople);
  const names = Object.fromEntries(teamMembers.map((m) => [m.personId, m.name]));

  const initialMutable = {
    id: item.id,
    name: item.name,
    matter: item.matter,
    matterId: item.matterId,
    client: item.client,
    type: item.type ?? '',
    subtype: item.subtype ?? '',
    priority: item.priority ?? '',
    status: item.status,
    drafter: item.drafter,
    reviewerIds: item.reviewerIds,
    currentlyWith: item.currentlyWith,
    externalDueDate: item.externalDueDate,
    dateDone: item.dateDone ?? null,
    reviewDates: item.reviewDates,
  };

  const parent = item.parentLink
    ? {
        href:
          item.parentLink.kind === 'hearing'
            ? `/dashboard/hearings/${item.parentLink.id}`
            : item.parentLink.kind === 'file'
              ? `/dashboard/documents/${item.parentLink.id}`
              : `/dashboard/deliverables/${item.parentLink.id}`,
        icon:
          item.parentLink.kind === 'hearing' ? (
            <Scale className="h-3.5 w-3.5" />
          ) : item.parentLink.kind === 'file' ? (
            <Paperclip className="h-3.5 w-3.5" />
          ) : (
            <FileText className="h-3.5 w-3.5" />
          ),
        label: item.parentLink.kind === 'hearing' ? 'Re hearing' : item.parentLink.kind === 'file' ? 'Re file' : 'Re filing',
        name: item.parentLink.name,
      }
    : null;

  const linked = (parent || item.statusReport) && (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {parent && (
        <Link href={parent.href} className={LINK}>
          {parent.icon}
          {parent.label} · <span className="truncate max-w-[24rem]">{parent.name}</span>
        </Link>
      )}
      {item.statusReport && (
        <Link href={`/dashboard/deliverables/${item.statusReport.id}`} className={LINK}>
          <Mail className="h-3.5 w-3.5" />
          Status report · <span className="truncate max-w-[24rem]">{item.statusReport.name}</span>
          <span className="text-stone-500 dark:text-stone-400">({item.statusReport.status})</span>
        </Link>
      )}
    </div>
  );

  return (
    <DeliverableShellProvider initial={initialMutable}>
      <div className="space-y-4">
        <SubjectCrumbs
          list={{
            label: 'All deliverables',
            href: deliverablesHref('all'),
            icon: <FileText className="w-3.5 h-3.5" />,
          }}
          parent={
            item.matterId
              ? {
                  label: item.matter,
                  href: `/dashboard/matters/${item.matterId}`,
                }
              : null
          }
          current={item.name}
        />

        <DeliverableHeaderBar
          canEditStatus={userRole === 'partner' || userRole === 'super_user' || userRole === 'lawyer'}
          canEditSubtype={userRole === 'partner' || userRole === 'super_user' || userRole === 'admin'}
          people={people}
          names={names}
          client={item.clientId ? { id: item.clientId, name: item.client } : null}
          below={linked}
        />

        {/* Workflow actions (only when the user has it), the signature banner and review tools. */}
        <DeliverableActionRow currentUserId={currentUserId} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <div className="lg:col-span-2 space-y-4 min-w-0">
            <DeliverableDetailClient people={people} teamMembers={lawyerMembers} userRole={userRole} />

            {/* Latest Submission — exclude filed-version uploads so the
                "latest" card always reflects the most recent draft, even
                once the authoritative filed copy has been added on top. */}
            {(() => {
              const isFiledVersionRow = (v: (typeof versions)[number]) => !!v.action && v.action.toLowerCase().startsWith('filed version');
              const submissionVersions = versions.filter((v) => !isFiledVersionRow(v));
              if (submissionVersions.length === 0) return null;
              // Group files by version number
              const versionMap = new Map<number, (typeof versions)[number][]>();
              for (const v of submissionVersions) {
                const existing = versionMap.get(v.version);
                if (existing) existing.push(v);
                else versionMap.set(v.version, [v]);
              }
              // Find the latest version number
              const latestVersionNum = Math.max(...versionMap.keys());
              const latestFiles = versionMap.get(latestVersionNum) ?? [];
              const first = latestFiles[0];

              // Compute carried-over files from previous versions
              // Sort version numbers ascending to walk forward
              const sortedVersionNums = [...versionMap.keys()].sort((a, b) => a - b);
              const carriedOver = new Map<number, (typeof versions)[number][]>();
              for (let i = 1; i < sortedVersionNums.length; i++) {
                const currNum = sortedVersionNums[i];
                const prevNum = sortedVersionNums[i - 1];
                const currFiles = versionMap.get(currNum) ?? [];
                const prevFiles = versionMap.get(prevNum) ?? [];
                const prevCarried = carriedOver.get(prevNum) ?? [];
                const prevComplete = [...prevFiles, ...prevCarried];
                if (prevComplete.length > currFiles.length) {
                  const prevSorted = [...prevComplete].sort((a, b) => (b.fileSize ?? 0) - (a.fileSize ?? 0));
                  carriedOver.set(currNum, prevSorted.slice(currFiles.length));
                }
              }
              const latestCarriedOver = carriedOver.get(latestVersionNum) ?? [];

              // Find the initial submission action for the latest version: the
              // oldest non-edit action whose label references this version (or
              // whose timestamp is closest to the version's createdAt). We mirror
              // the heuristic used in DeliverableVersionHistory to keep them
              // consistent — the OLDEST non-edit action wins.
              const isEditAct = (a: string) => {
                const s = a.toLowerCase();
                return s.startsWith('edited ') || s.startsWith('added files to ');
              };
              const versionStart = new Date(first.createdAt).getTime();
              const latestVersionActions = actions
                .filter((a) => !isEditAct(a.action))
                .filter((a) => {
                  const m = a.action.match(/\bv(\d+)\b/i);
                  if (m) return Number(m[1]) === latestVersionNum;
                  // Fall back to timestamp proximity (within 30 minutes)
                  return Math.abs(new Date(a.createdAt).getTime() - versionStart) < 30 * 60 * 1000;
                })
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
              const initialActionForLatest = latestVersionActions[0] ?? null;
              const initialComment = initialActionForLatest?.comment ?? null;

              return (
                <LatestSubmissionCard
                  files={latestFiles}
                  carriedOverFiles={latestCarriedOver}
                  version={latestVersionNum}
                  uploaderInitials={allPeople.get(first.uploadedBy)?.initials ?? 'Unknown'}
                  uploadedBy={first.uploadedBy}
                  currentUserId={currentUserId}
                  createdAt={first.createdAt}
                  action={first.action}
                  initialComment={initialComment}
                  deliverableId={item.id}
                  status={item.status}
                />
              );
            })()}
            {/* Filed Version (view-only for everyone; only admins can upload) */}
            {item.status === DELIVERABLE_STATUS.FILED_OR_SENT_OUT && (
              <FiledVersionCard deliverableId={item.id} versions={versions} status={item.status} canUpload={userRole === 'admin'} />
            )}

          </div>

          <div className="space-y-4 min-w-0">
            <DeliverableAtAGlance
              versions={new Set(versions.map((v) => v.version)).size}
              files={versions.length}
              actions={actions.length}
              createdTime={item.createdTime ?? null}
            />

            {actions.length > 0 && (
              <SubjectCard title="Recent actions" icon={<History className="w-4 h-4" />} bodyClassName="px-5 pb-3">
                <ol className="divide-y divide-stone-100 dark:divide-white/[0.06]">
                  {actions.slice(0, 5).map((action) => {
                    const person = allPeople.get(action.performedBy);
                    return (
                      <li key={action.id} className="py-2.5 flex items-start gap-2.5">
                        <span className="mt-0.5 w-5 h-5 rounded-full bg-navy-50 dark:bg-navy-500/15 text-navy-700 dark:text-navy-200 flex items-center justify-center text-[9px] font-semibold shrink-0">
                          {person?.initials?.charAt(0) ?? '?'}
                        </span>
                        <div className="min-w-0">
                          <p className="text-[13px] text-stone-800 dark:text-stone-100 truncate">{action.action}</p>
                          <p className="text-[11px] text-stone-500 dark:text-stone-400">
                            {person?.initials ?? 'Unknown'} &middot;{' '}
                            {new Date(action.createdAt).toLocaleDateString('en-PH', {
                              month: 'short',
                              day: 'numeric',
                              timeZone: 'Asia/Manila',
                            })}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </SubjectCard>
            )}
          </div>
        </div>

        {/* Versions and comments close the page, under both columns at any width. */}
        <DeliverableVersionHistory
          versions={versions}
          actions={actions}
          comments={delComments}
          versionReactions={versionReactions}
          people={people}
          teamMembers={teamMembers}
          currentUserId={currentUserId}
          deliverableId={id}
        />
      </div>
    </DeliverableShellProvider>
  );
}
