import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  FolderKanban, Scale, ChevronRight, CornerDownRight, GitBranch, Briefcase,
} from 'lucide-react';
import { getSession } from '@/lib/session';
import {
  getMatterGroupById,
} from '@/lib/queries/matter-groups';
import DetailShell from './DetailShell';
import MatterSections from './MatterSections';
import MatterFiles from './MatterFiles';
import MatterGroupSummary from './MatterGroupSummary';
import MatterGroupLineFilter from '@/app/dashboard/matter-groups/[id]/MatterGroupLineFilter';
import { MATTER_STATUS } from '@/lib/matter-status';

function matterTypeStyle(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('litigation') || t.includes('court')) return 'bg-red-50 text-red-700 ring-red-200/60 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20';
  if (t.includes('corporate') || t.includes('company')) return 'bg-blue-50 text-blue-700 ring-blue-200/60 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20';
  if (t.includes('labor') || t.includes('employment')) return 'bg-amber-50 text-amber-700 ring-amber-200/60 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20';
  if (t.includes('tax')) return 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20';
  if (t.includes('criminal')) return 'bg-rose-50 text-rose-700 ring-rose-200/60 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20';
  if (t.includes('admin')) return 'bg-violet-50 text-violet-700 ring-violet-200/60 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/20';
  return 'bg-stone-50 text-stone-600 ring-stone-200/60 dark:bg-stone-500/10 dark:text-stone-400 dark:ring-stone-500/20';
}

function statusPillStyle(status: string): string {
  if (status === MATTER_STATUS.ONGOING) return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20';
  if (status === MATTER_STATUS.DONE) return 'bg-stone-100 text-stone-500 border-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/20';
  if (status === MATTER_STATUS.ARCHIVED) return 'bg-stone-50 text-stone-400 border-stone-150 dark:bg-stone-500/5 dark:text-stone-500 dark:border-stone-500/10';
  return 'bg-stone-50 text-stone-600 border-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/20';
}

// ── Parent-line (chain) computation ────────────────────────────────
//
// For each matter, find the id of its "line root" — walk parent_matter_id
// up until we hit a matter without a parent (or with a parent outside the
// component). All matters that share a root form a chain. Singleton
// matters (no parent, no children) get no badge.

interface MemberShape {
  id: string;
  name: string;
  matterCode: string;
  parentMatterId: string | null;
}

function computeLineRoots<M extends MemberShape>(members: M[]): Map<string, string | null> {
  const byId = new Map(members.map((m) => [m.id, m]));
  const rootOf = new Map<string, string | null>();
  for (const m of members) {
    // Walk up via parent_matter_id, bounded by component membership.
    let cursor: M | undefined = m;
    const seen = new Set<string>();
    while (cursor && cursor.parentMatterId && byId.has(cursor.parentMatterId) && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      cursor = byId.get(cursor.parentMatterId);
    }
    rootOf.set(m.id, cursor?.id ?? m.id);
  }

  // Collapse chains: root ids that contain only one member (root itself, no
  // descendants) don't form a chain and shouldn't get a badge.
  const chainSize = new Map<string, number>();
  for (const root of rootOf.values()) {
    if (!root) continue;
    chainSize.set(root, (chainSize.get(root) ?? 0) + 1);
  }
  const final = new Map<string, string | null>();
  for (const [id, root] of rootOf) {
    final.set(id, root && (chainSize.get(root) ?? 0) > 1 ? root : null);
  }
  return final;
}

export default async function MatterGroupDetail({
  rootId,
  selectedMatterIds,
}: {
  rootId: string;
  selectedMatterIds?: string[];
}) {
  const session = await getSession();
  if (!session) notFound();

  const group = await getMatterGroupById(session.firmId, rootId);
  if (!group) notFound();

  const memberIdSet = new Set(group.members.map((m) => m.id));
  const selectedSet =
    selectedMatterIds && selectedMatterIds.length > 0
      ? new Set(selectedMatterIds.filter((id) => memberIdSet.has(id)))
      : null;
  const include = (mid: string | null | undefined) => !selectedSet || (mid ? selectedSet.has(mid) : false);

  const filteredMembers = selectedSet
    ? group.members.filter((m) => selectedSet.has(m.id))
    : group.members;
  const filteredTasks = group.tasks.filter((t) => include(t.matterId));
  const filteredDeliverables = group.deliverables.filter((d) => include(d.matterId));
  const filteredHearings = group.hearings.filter((h) => {
    const t = (h.type || '').toLowerCase();
    if (t === 'filing' || t.includes('filing')) return false;
    return include(h.matterId);
  });
  const filteredFilings = group.filings.filter((f) => include(f.matterId));
  const filteredFiles = group.files.filter((f) => include(f.matterId));
  const filteredMeetings = group.meetings.filter((m) => include(m.matterId));

  const sortedMembers = orderLineage(filteredMembers);

  // Chain labels: one numeric index per chain, so a user can see "Line 1"
  // on every member of the same parent→child sequence.
  const lineRoots = computeLineRoots(filteredMembers);
  const chainIndex = new Map<string, number>();
  let nextChainId = 1;
  for (const { member } of sortedMembers) {
    const root = lineRoots.get(member.id);
    if (!root) continue;
    if (!chainIndex.has(root)) chainIndex.set(root, nextChainId++);
  }

  return (
    <DetailShell
      title={group.name}
      icon={<FolderKanban className="w-5 h-5" />}
      entityType="Matter Group"
      breadcrumbs={group.clientId ? [{ label: group.clientName, href: `/dashboard/clients/${group.clientId}` }] : undefined}
    >
      {/* Header badges */}
      <div className="flex flex-wrap items-center gap-2.5 mb-6">
        {group.clientName && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full ring-1 ring-inset bg-navy-50 text-navy-700 ring-navy-200/60 dark:bg-navy-500/10 dark:text-navy-400 dark:ring-navy-500/20">
            <Briefcase className="w-3 h-3" />
            {group.clientId ? (
              <Link href={`/dashboard/clients/${group.clientId}`} className="hover:underline">{group.clientName}</Link>
            ) : group.clientName}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full ring-1 ring-inset bg-stone-50 text-stone-600 ring-stone-200/60 dark:bg-stone-500/10 dark:text-stone-400 dark:ring-stone-500/20">
          <Scale className="w-3 h-3" />
          {group.members.length} matter{group.members.length === 1 ? '' : 's'}
          {selectedSet && <span className="ml-1 text-[10px] font-medium text-[var(--text-muted)]">· showing {filteredMembers.length}</span>}
        </span>
      </div>

      <MatterGroupLineFilter
        members={group.members.map((m) => ({ id: m.id, name: m.name, matterCode: m.matterCode }))}
        selected={selectedMatterIds ?? []}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start stagger-children">
        <div className="lg:col-span-2">
          <MatterGroupSummary rootId={group.rootId} />

          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up mb-6">
            <div className="px-6 py-4 border-b border-[var(--border-color)]">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Matters in Group</h2>
            </div>
            <ul className="divide-y divide-[var(--border-color)]">
              {sortedMembers.map(({ member, depth }) => {
                const root = lineRoots.get(member.id);
                const chain = root ? chainIndex.get(root) : undefined;
                return (
                  <li key={member.id} className="px-6 py-3 hover:bg-gold-50/40 dark:hover:bg-[rgba(185, 143, 69,0.06)] transition-colors">
                    <Link href={`/dashboard/matters/${member.id}`} className="flex items-center gap-2.5 group">
                      {depth > 0 && (
                        <span className="flex items-center" style={{ marginLeft: `${(depth - 1) * 16}px` }}>
                          <CornerDownRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                        </span>
                      )}
                      <span className="font-medium text-[var(--text-primary)] group-hover:text-navy-600 dark:group-hover:text-navy-400">
                        {member.name}
                      </span>
                      {member.matterCode && (
                        <span className="text-xs text-stone-500 font-mono dark:text-stone-400">({member.matterCode})</span>
                      )}
                      {member.type && (
                        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ring-1 ring-inset ${matterTypeStyle(member.type)}`}>
                          {member.type}
                        </span>
                      )}
                      {member.status && (
                        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full border ${statusPillStyle(member.status)}`}>
                          {member.status}
                        </span>
                      )}
                      {member.outcome && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{member.outcome}</span>
                      )}
                      {chain && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200/60 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-sky-500/20">
                          <GitBranch className="w-2.5 h-2.5" />
                          Line {chain}
                        </span>
                      )}
                      <ChevronRight className="w-3 h-3 text-[var(--text-muted)] ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Aggregated sub-entities — always show source-matter chips on a
              group page, even when the filtered set happens to land on a
              single matter, so attribution stays unambiguous. */}
          <MatterSections
            tasks={filteredTasks}
            deliverables={filteredDeliverables}
            hearings={filteredHearings}
            filings={filteredFilings}
            meetings={filteredMeetings}
            showSourceMatter
          />

          <MatterFiles files={filteredFiles} showSourceMatter />
        </div>

        {/* Right column: stats only (parties removed per request) */}
        <div className="space-y-6 sticky top-20">
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
            <div className="px-5 py-4 border-b border-[var(--border-color)]">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Overview</h2>
            </div>
            <div className="divide-y divide-[var(--border-color)]">
              <StatRow label="Open Tasks" value={filteredTasks.filter((t) => !t.done).length} />
              <StatRow label="Active Deliverables" value={filteredDeliverables.filter((d) => {
                const s = d.status.toLowerCase();
                return !s.includes('filed') && !s.includes('sent out') && !s.includes('archived');
              }).length} />
              <StatRow label="Hearings" value={filteredHearings.length} />
              <StatRow label="Files" value={filteredFiles.length} />
            </div>
          </div>
        </div>
      </div>
    </DetailShell>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-5 py-4 flex items-center justify-between">
      <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      <span className="text-lg font-semibold text-[var(--text-primary)] tabular-nums">{value}</span>
    </div>
  );
}

function orderLineage<M extends MemberShape>(members: M[]): Array<{ member: M; depth: number }> {
  if (members.length === 0) return [];
  const byId = new Map(members.map((m) => [m.id, m]));
  const childrenByParent = new Map<string | null, M[]>();
  for (const m of members) {
    const parentKey = m.parentMatterId && byId.has(m.parentMatterId) ? m.parentMatterId : null;
    if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, []);
    childrenByParent.get(parentKey)!.push(m);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => (a.matterCode || '').localeCompare(b.matterCode || '') || a.name.localeCompare(b.name));
  }
  const result: Array<{ member: M; depth: number }> = [];
  function walk(parent: string | null, depth: number) {
    for (const m of childrenByParent.get(parent) ?? []) {
      result.push({ member: m, depth });
      walk(m.id, depth + 1);
    }
  }
  walk(null, 0);
  return result;
}
