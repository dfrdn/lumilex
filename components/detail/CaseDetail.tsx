'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Briefcase, CalendarClock, FileText, GitBranch, Landmark, Link2, ListTree, Plus, Scale, X } from 'lucide-react';
import { toast } from 'sonner';
import HearingActionButtons from '@/components/HearingActionButtons';
import { confirmAction } from '@/components/ui/confirm';
import { InlineText } from '@/components/ui/inline-edit';
import { BTN_OUTLINE, BTN_PRIMARY } from '@/components/ui/tone';
import { CloseCaseModal, DecisionModal, FileProceedingModal, LinkMatterModal, sendCase } from '@/components/cases/forms';
import SubjectHeader from '@/components/ui/SubjectHeader';
import TrackCards, { type TrackCard } from '@/components/ui/TrackCards';
import { CopyText, DueChip, Fact, MetaChip, StatusPill, SubjectCard } from '@/components/ui/primitives';
import SubjectCrumbs from './SubjectCrumbs';
import { CaseStatusPill, filingTone, hearingWhen, manilaDay } from '@/components/cases/ui';
import StageTrack from '@/components/cases/StageTrack';
import { formatDateShort } from '@/lib/format-date';
import type { CaseDetail as CaseData } from '@/lib/queries/cases';
import {
  earlierCaptions,
  forumShort,
  hearingOutcome,
  inTreeOrder,
  isBranch,
  nextHearing,
  needsOutcome,
  RELATION_LABEL,
  titleProceeding,
  type Hearing,
  type Proceeding,
} from '@/lib/cases/view';
import { stageLabel, stageSteps, TRACK_LABEL } from '@/lib/cases/stages';

const MUTED = 'text-stone-500 dark:text-stone-400';

const OUTCOME_PILL: Record<ReturnType<typeof hearingOutcome>, { label: string; tone: 'blue' | 'emerald' | 'muted' | 'rose' }> = {
  upcoming: { label: 'Upcoming', tone: 'blue' },
  attended: { label: 'Attended', tone: 'emerald' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  unrecorded: { label: 'No outcome recorded', tone: 'rose' },
};

const CLIENT_ROLE: Record<string, string> = {
  complainant: 'Complainant',
  respondent: 'Respondent',
  plaintiff: 'Plaintiff',
  defendant: 'Defendant',
  petitioner: 'Petitioner',
  intervenor: 'Intervenor',
  other: 'Other',
};

export default function CaseDetail({ initial, canEdit }: { initial: CaseData; canEdit: boolean }) {
  const [data, setData] = useState(initial);
  const [showPast, setShowPast] = useState(false);
  const [filing, setFiling] = useState<{ parentId: string | null } | null>(null);
  const [deciding, setDeciding] = useState<Proceeding | null>(null);
  const [closing, setClosing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = useMemo(() => new Date(), []);
  const byId = useMemo(() => new Map(data.proceedings.map((p) => [p.id, p])), [data.proceedings]);
  const tree = useMemo(() => inTreeOrder(data.proceedings), [data.proceedings]);
  const earlier = useMemo(() => earlierCaptions(data.title, data.proceedings), [data.title, data.proceedings]);
  const titled = useMemo(() => titleProceeding(data.proceedings), [data.proceedings]);
  // The stepper follows one proceeding: the one the case is titled after while
  // it is open, else the first open one; its card switches to another.
  const openProceedings = data.proceedings.filter((p) => p.status === 'active');
  const [followId, setFollowId] = useState<string | null>(null);
  const followed =
    (followId ? byId.get(followId) : undefined) ?? (titled?.status === 'active' ? titled : openProceedings[0] ?? titled ?? null);

  /** Apply a change: send it, then take the case as the server now has it. */
  async function change(url: string, method: 'PATCH' | 'PUT' | 'DELETE', body: unknown, done?: string): Promise<boolean> {
    setBusy(true);
    const updated = await sendCase(url, method, body);
    setBusy(false);
    if (!updated) return false;
    setData(updated);
    if (done) toast.success(done);
    return true;
  }

  async function moveStage(p: Proceeding, key: string, label: string) {
    if (key === p.stage) return;
    if (!(await confirmAction({ title: `Move ${p.office || forumShort(p)} to ${label}?`, confirmLabel: 'Move' }))) return;
    // Show it at once; the server's answer replaces it, a failure puts it back.
    const before = data;
    setData({ ...data, proceedings: data.proceedings.map((x) => (x.id === p.id ? { ...x, stage: key } : x)) });
    if (!(await change(`/api/cases/${data.id}/proceedings/${p.id}`, 'PATCH', { stage: key }, `Now at ${label}`))) setData(before);
  }

  async function removeProceeding(p: Proceeding) {
    if (!(await confirmAction({ title: `Remove ${p.office || forumShort(p)}?`, message: 'Its hearings stay on their matter.', confirmLabel: 'Remove', danger: true }))) return;
    await change(`/api/cases/${data.id}/proceedings/${p.id}`, 'DELETE', {}, 'Proceeding removed');
  }

  async function unlinkMatter(m: CaseData['matters'][number]) {
    if (!(await confirmAction({ title: `Unlink ${m.name}?`, message: 'The matter stays; it just no longer covers this case.', confirmLabel: 'Unlink', danger: true }))) return;
    await change(`/api/cases/${data.id}/matters`, 'DELETE', { matterId: m.id }, 'Matter unlinked');
  }

  function hearingRecorded(id: string, action: 'attended' | 'cancelled') {
    setData({
      ...data,
      hearings: data.hearings.map((h) => (h.id === id ? { ...h, status: action === 'attended' ? 'Attended' : 'Cancelled', isAttended: action === 'attended' } : h)),
    });
  }
  const clients = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of data.matters) if (m.clientId && !seen.has(m.clientId)) seen.set(m.clientId, m.clientName);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [data.matters]);

  const upcoming = data.hearings.filter((h) => hearingOutcome(h, now) === 'upcoming').sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const past = data.hearings.filter((h) => hearingOutcome(h, now) !== 'upcoming');
  const unrecorded = needsOutcome(data.hearings, now);
  const firstFiled = data.proceedings.map((p) => p.filedOn).filter(Boolean).sort()[0] ?? null;
  const mrsDue = data.proceedings.filter((p) => p.status === 'resolved' && p.mrDueOn);

  const cards: TrackCard[] = data.proceedings
    .filter((p) => p.status === 'active')
    .sort((a, b) => Number(isBranch(a, byId)) - Number(isBranch(b, byId)))
    .map((p) => {
      const own = data.hearings.filter((h) => h.proceedingId === p.id);
      const next = nextHearing(own, now);
      const late = needsOutcome(own, now).length;
      const soon = next?.date ? new Date(next.date).getTime() - now.getTime() < 7 * 86_400_000 : false;
      return {
        key: p.id,
        label: isBranch(p, byId) ? `${forumShort(p)} · ${RELATION_LABEL[p.relation]}` : forumShort(p),
        icon: isBranch(p, byId) ? <GitBranch className="w-4 h-4" /> : <Scale className="w-4 h-4" />,
        health: late ? 'red' : soon ? 'amber' : 'green',
        done: 0,
        total: 0,
        summary: p.docketNo || p.office || 'No docket recorded',
        next: next?.date ? `Next: ${next.name || 'Hearing'} · ${hearingWhen(next.date)}` : late ? `${late} hearing${late === 1 ? '' : 's'} with no outcome` : 'No hearing set',
        stateLabel: late ? 'Outcome to record' : soon ? 'Hearing this week' : stageLabel(p.track, p.stage) || 'Active',
      };
    });

  return (
    <div className="space-y-4">
      <SubjectCrumbs list={{ label: 'Cases', href: '/dashboard/cases', icon: <Landmark className="w-3.5 h-3.5" /> }} client={clients[0] ?? null} current={data.title} />

      <SubjectHeader
        title={
          canEdit ? (
            <div className="min-w-0 flex-1">
              <InlineText
                value={data.title}
                ariaLabel="Case title"
                className="font-serif text-2xl text-stone-900 dark:text-stone-50 tracking-tight"
                onSave={(v) => change(`/api/cases/${data.id}`, 'PATCH', { pinnedTitle: v.trim() || null }, 'Title pinned')}
              />
            </div>
          ) : (
            data.title
          )
        }
        monogramOf={data.title}
        statusPill={<CaseStatusPill status={data.status} />}
        meta={
          <>
            {data.nature && (
              <span className="max-w-[32rem] truncate" title={data.nature}>
                <MetaChip>{data.nature}</MetaChip>
              </span>
            )}
            {titled && <MetaChip>{titled.office || forumShort(titled)}</MetaChip>}
            {data.docket && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-stone-100/80 dark:bg-white/[0.06] text-[11px] text-stone-600 dark:text-stone-300">
                <CopyText text={data.docket} />
              </span>
            )}
          </>
        }
        client={clients[0] ?? null}
        team={data.team}
        actions={
          canEdit && (
            <div className="flex items-center gap-2">
              {data.status !== 'closed' && (
                <button type="button" onClick={() => setFiling({ parentId: null })} className={`${BTN_PRIMARY} px-3 py-1.5`}>
                  <Plus className="w-3.5 h-3.5" /> {data.proceedings.length ? 'File a proceeding' : 'File the case'}
                </button>
              )}
              {data.status === 'closed' ? (
                <button type="button" disabled={busy} onClick={() => change(`/api/cases/${data.id}`, 'PATCH', { reopen: true }, 'Case reopened')} className={`${BTN_OUTLINE} px-3 py-1.5`}>
                  Reopen
                </button>
              ) : (
                <button type="button" onClick={() => setClosing(true)} className={`${BTN_OUTLINE} px-3 py-1.5`}>
                  Close case
                </button>
              )}
            </div>
          )
        }
        below={
          (earlier.length > 0 || data.titlePinned) && (
            <p className={`text-[12px] ${MUTED}`}>
              {earlier.map((e, i) => (
                <span key={e.caption}>
                  {i > 0 && ' · '}
                  At the {e.forum}: <span className="text-stone-700 dark:text-stone-200">{e.caption}</span>
                </span>
              ))}
              {data.titlePinned && (
                <span>
                  {earlier.length > 0 && ' · '}
                  Title pinned
                  {canEdit && (
                    <>
                      {' — '}
                      <button type="button" onClick={() => change(`/api/cases/${data.id}`, 'PATCH', { pinnedTitle: null }, 'Titled after its proceedings again')} className="text-navy-700 dark:text-navy-300 hover:underline">
                        title it after the proceedings
                      </button>
                    </>
                  )}
                </span>
              )}
            </p>
          )
        }
      />

      {followed?.track ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-1">
            <h2 className="text-[13px] font-semibold text-stone-800 dark:text-stone-100">{followed.office || forumShort(followed)}</h2>
            <span className={`text-[12px] ${MUTED}`}>
              {TRACK_LABEL[followed.track]}
              {followed.docketNo && ` · ${followed.docketNo}`}
            </span>
            {canEdit && (
              <span className="ml-auto flex items-center gap-2">
                {followed.status === 'active' && followed.stage !== 'reconsideration' && (
                  <button type="button" onClick={() => setDeciding(followed)} className={`${BTN_OUTLINE} px-2.5 py-1`}>
                    Record decision
                  </button>
                )}
                {followed.status === 'resolved' && (
                  <button type="button" disabled={busy} onClick={() => change(`/api/cases/${data.id}/proceedings/${followed.id}`, 'PATCH', { mrFiled: true }, 'MR filed — in the MR period')} className={`${BTN_OUTLINE} px-2.5 py-1`}>
                    MR filed
                  </button>
                )}
                {followed.stage === 'reconsideration' && followed.status === 'active' && (
                  <button type="button" onClick={() => setDeciding(followed)} className={`${BTN_OUTLINE} px-2.5 py-1`}>
                    MR resolved
                  </button>
                )}
                <button type="button" onClick={() => setFiling({ parentId: followed.id })} className={`${BTN_OUTLINE} px-2.5 py-1`}>
                  File on this
                </button>
              </span>
            )}
          </div>
          <StageTrack
            onPick={canEdit ? (key, label) => moveStage(followed, key, label) : undefined}
            steps={stageSteps(followed.track, followed.stage, followed.status === 'resolved')}
            currentNote={(() => {
              const next = nextHearing(data.hearings.filter((h) => h.proceedingId === followed.id), now);
              return next?.date ? `Next hearing ${hearingWhen(next.date)}` : null;
            })()}
          />
        </section>
      ) : (
        <p className={`px-1 text-[13px] ${MUTED}`}>Nothing filed yet — the case is in evaluation.</p>
      )}

      {cards.length > 1 && (
        <TrackCards cards={cards} activeKey={followed?.id ?? null} onOpen={(key) => setFollowId(key)} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-4 min-w-0">
          <SubjectCard
            title="To file"
            icon={<FileText className="w-4 h-4" />}
            action={<span className={`text-[11px] ${MUTED}`}>{data.toFile.length + mrsDue.length || 'Nothing'} pending</span>}
            bodyClassName="pb-2"
          >
            {data.toFile.length === 0 && mrsDue.length === 0 ? (
              <p className={`px-5 pb-3 text-[13px] ${MUTED}`}>Nothing due to be filed on this case’s matters.</p>
            ) : (
              <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
                {mrsDue.map((p) => (
                  <li key={`mr:${p.id}`} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] text-stone-800 dark:text-stone-100">Motion for reconsideration</span>
                      <span className={`block text-[11px] ${MUTED}`}>{p.office || forumShort(p)}</span>
                    </span>
                    <DueChip due={p.mrDueOn!} />
                  </li>
                ))}
                {data.toFile.map((d) => (
                  <li key={d.id}>
                    <Link href={`/dashboard/deliverables/${d.id}`} className="group flex items-center gap-3 px-5 py-2.5 hover:bg-stone-50/70 dark:hover:bg-white/[0.03] transition-colors">
                      <span className="flex-1 min-w-0 text-[13px] text-stone-800 dark:text-stone-100 truncate group-hover:text-navy-700 dark:group-hover:text-navy-300">{d.name}</span>
                      <StatusPill label={d.status} tone={filingTone(d.status)} size="sm" />
                      {d.due ? <DueChip due={d.due} /> : <span className={`text-[11px] ${MUTED}`}>No due date</span>}
                      <ArrowUpRight className="w-3.5 h-3.5 text-stone-300 dark:text-stone-600 group-hover:text-navy-600 dark:group-hover:text-navy-300 shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SubjectCard>

          <div data-field="case-hearings" className="rounded-2xl scroll-mt-4">
            <SubjectCard
              title="Hearings"
              icon={<CalendarClock className="w-4 h-4" />}
              action={<span className={`text-[11px] ${MUTED}`}>{data.hearings.length} on record</span>}
              bodyClassName="pb-2"
            >
              {unrecorded.length > 0 && (
                <p className="mx-5 mb-2 px-3 py-2 rounded-lg bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200 text-[12px]">
                  {unrecorded.length} recent hearing{unrecorded.length === 1 ? ' has' : 's have'} no outcome recorded.
                </p>
              )}
              <HearingList hearings={upcoming} byId={byId} now={now} empty="No hearing set." canEdit={canEdit} onRecorded={hearingRecorded} />
              {past.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowPast((v) => !v)}
                    className="w-full px-5 py-2 text-left text-xs font-medium text-navy-700 dark:text-navy-300 hover:bg-stone-50 dark:hover:bg-white/5 border-t border-stone-100 dark:border-white/[0.06] transition-colors"
                  >
                    {showPast ? 'Hide past hearings' : `Past hearings · ${past.length}`}
                  </button>
                  {showPast && <HearingList hearings={past} byId={byId} now={now} empty="" canEdit={canEdit} onRecorded={hearingRecorded} />}
                </>
              )}
            </SubjectCard>
          </div>

          <div data-field="case-proceedings" className="rounded-2xl scroll-mt-4">
            <SubjectCard title="Proceedings" icon={<ListTree className="w-4 h-4" />} bodyClassName="px-5 pb-4">
              {tree.length === 0 ? (
                <p className={`text-[13px] ${MUTED}`}>
                  Nothing filed yet.
                  {data.demandSentOn && ` Demand sent ${formatDateShort(data.demandSentOn)}${data.demandDueOn ? `, reply due ${formatDateShort(data.demandDueOn)}` : ''}.`}
                </p>
              ) : (
                <ol className="space-y-2">
                  {tree.map(({ proceeding: p, depth }) => (
                    <ProceedingRow
                      key={p.id}
                      p={p}
                      depth={depth}
                      branch={isBranch(p, byId)}
                      matters={data.matters.filter((m) => m.proceedingIds.includes(p.id))}
                      onFollow={p.track ? () => setFollowId(p.id) : undefined}
                      onFileOn={canEdit ? () => setFiling({ parentId: p.id }) : undefined}
                      onRemove={canEdit && !data.proceedings.some((c) => c.parentId === p.id) ? () => removeProceeding(p) : undefined}
                    />
                  ))}
                </ol>
              )}
            </SubjectCard>
          </div>
        </div>

        <div className="space-y-4 min-w-0">
          <SubjectCard title="At a glance" icon={<Scale className="w-4 h-4" />}>
            <dl>
              <Fact label="Status" value={<CaseStatusPill status={data.status} size="sm" />} />
              <Fact label="About" value={data.nature} />
              <Fact label="Client is" value={data.clientRole ? CLIENT_ROLE[data.clientRole] ?? data.clientRole : null} />
              <Fact label="Now at" value={titled ? titled.office || forumShort(titled) : null} />
              <Fact label="Docket" value={data.docket} mono />
              <Fact label="First filed" value={firstFiled ? formatDateShort(firstFiled) : null} />
              <Fact label="Proceedings" value={data.proceedings.length || null} />
              {data.status === 'closed' && <Fact label="Outcome" value={data.outcome} />}
            </dl>
          </SubjectCard>

          <SubjectCard
            title="Covered by"
            icon={<Briefcase className="w-4 h-4" />}
            action={
              canEdit && (
                <button type="button" onClick={() => setLinking(true)} className="text-[12px] font-medium text-navy-700 dark:text-navy-300 hover:underline">
                  Link a matter
                </button>
              )
            }
          >
            {data.matters.length === 0 ? (
              <p className={`text-[13px] ${MUTED}`}>No matter covers this case.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.matters.map((m) => {
                  const covers = m.proceedingIds.map((id) => byId.get(id)).filter((p): p is Proceeding => !!p);
                  return (
                    <li key={m.id} className="group/m relative">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => unlinkMatter(m)}
                          className="absolute -right-1 top-1.5 z-10 p-0.5 rounded text-stone-300 opacity-0 group-hover/m:opacity-100 hover:text-rose-600 dark:text-stone-600 dark:hover:text-rose-400 transition"
                          aria-label={`Unlink ${m.name}`}
                          title="Unlink"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <Link href={`/dashboard/matters/${m.id}`} className="group flex items-start justify-between gap-2 rounded-lg px-2 py-1.5 -mx-2 pr-5 hover:bg-stone-50 dark:hover:bg-white/5">
                        <span className="min-w-0">
                          <span className="block text-[13px] text-stone-800 dark:text-stone-100 truncate group-hover:text-navy-700 dark:group-hover:text-navy-300">{m.name}</span>
                          <span className={`block text-[11px] ${MUTED}`}>
                            <span className="font-mono">{m.code}</span> · {covers.length ? covers.map((p) => forumShort(p)).join(', ') : 'Evaluation'}
                          </span>
                        </span>
                        <StatusPill label={m.status || '—'} tone={m.status === 'Ongoing' ? 'blue' : m.status === 'Done' ? 'emerald' : 'muted'} size="sm" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </SubjectCard>

          {data.related.length > 0 && (
            <SubjectCard title="Related cases" icon={<Link2 className="w-4 h-4" />}>
              <ul className="space-y-1">
                {data.related.map((r) => (
                  <li key={r.id}>
                    <Link href={`/dashboard/cases/${r.id}`} className="group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 -mx-2 hover:bg-stone-50 dark:hover:bg-white/5">
                      <span className="text-[13px] text-stone-800 dark:text-stone-100 truncate group-hover:text-navy-700 dark:group-hover:text-navy-300">{r.title}</span>
                      <CaseStatusPill status={r.status} size="sm" />
                    </Link>
                  </li>
                ))}
              </ul>
            </SubjectCard>
          )}
        </div>
      </div>

      {filing && (
        <FileProceedingModal
          open
          data={data}
          parentId={filing.parentId}
          onClose={() => setFiling(null)}
          onSaved={(c) => {
            setData(c);
            setFiling(null);
          }}
        />
      )}
      {deciding && (
        <DecisionModal
          open
          caseId={data.id}
          proceeding={deciding}
          onClose={() => setDeciding(null)}
          onSaved={(c) => {
            setData(c);
            setDeciding(null);
          }}
        />
      )}
      <CloseCaseModal
        open={closing}
        caseId={data.id}
        onClose={() => setClosing(false)}
        onSaved={(c) => {
          setData(c);
          setClosing(false);
        }}
      />
      <LinkMatterModal
        open={linking}
        data={data}
        onClose={() => setLinking(false)}
        onSaved={(c) => {
          setData(c);
          setLinking(false);
        }}
      />
    </div>
  );
}

function HearingList({
  hearings,
  byId,
  now,
  empty,
  canEdit,
  onRecorded,
}: {
  hearings: Hearing[];
  byId: Map<string, Proceeding>;
  now: Date;
  empty: string;
  canEdit: boolean;
  onRecorded: (id: string, action: 'attended' | 'cancelled') => void;
}) {
  if (!hearings.length) return empty ? <p className={`px-5 pb-3 text-[13px] ${MUTED}`}>{empty}</p> : null;
  return (
    <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
      {hearings.map((h) => {
        const p = h.proceedingId ? byId.get(h.proceedingId) : null;
        const outcome = hearingOutcome(h, now);
        return (
          <li key={h.id}>
            <Link href={`/dashboard/hearings/${h.id}`} className="group flex items-center gap-3 px-5 py-2.5 hover:bg-stone-50/70 dark:hover:bg-white/[0.03] transition-colors">
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] text-stone-800 dark:text-stone-100 truncate group-hover:text-navy-700 dark:group-hover:text-navy-300">{h.name || 'Hearing'}</span>
                <span className={`block text-[11px] ${MUTED}`}>
                  {p ? forumShort(p) : '—'}
                  {h.date && ` · ${hearingWhen(h.date)}`}
                </span>
              </span>
              {outcome === 'upcoming' && h.date ? (
                <DueChip due={manilaDay(h.date)} showDate={false} />
              ) : (
                <StatusPill label={OUTCOME_PILL[outcome].label} tone={OUTCOME_PILL[outcome].tone} size="sm" />
              )}
              {canEdit && (outcome === 'unrecorded' || outcome === 'upcoming') && (
                <span onClick={(e) => e.preventDefault()}>
                  <HearingActionButtons
                    compact
                    hearingId={h.id}
                    hearingName={h.name}
                    hearingType={h.type}
                    hearingDate={h.date}
                    isAttended={h.isAttended}
                    status={h.status}
                    attendeeIds={h.attendeeIds}
                    matterId={h.matterId}
                    matterName={h.matterName}
                    onStatusChange={(a) => onRecorded(h.id, a)}
                  />
                </span>
              )}
              <ArrowUpRight className="w-3.5 h-3.5 text-stone-300 dark:text-stone-600 group-hover:text-navy-600 dark:group-hover:text-navy-300 shrink-0" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ProceedingRow({
  p,
  depth,
  branch,
  matters,
  onFollow,
  onFileOn,
  onRemove,
}: {
  p: Proceeding;
  depth: number;
  branch: boolean;
  matters: CaseData['matters'];
  onFollow?: () => void;
  onFileOn?: () => void;
  onRemove?: () => void;
}) {
  return (
    <li style={{ marginLeft: `${depth * 1.25}rem` }} className={depth ? 'relative before:absolute before:-left-3 before:top-0 before:bottom-1/2 before:w-2.5 before:border-l before:border-b before:border-stone-200 dark:before:border-white/10 before:rounded-bl' : ''}>
      <div className={`rounded-xl border px-3.5 py-2.5 ${branch ? 'border-dashed border-amber-300/70 dark:border-amber-500/30' : 'border-stone-200 dark:border-white/10'}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">
            {depth ? RELATION_LABEL[p.relation] : 'Filed at'}
          </span>
          <span className="text-[13px] font-medium text-stone-900 dark:text-stone-50">{p.office || forumShort(p)}</span>
          <span className="ml-auto">
            <StatusPill label={p.status === 'resolved' ? 'Resolved' : 'Active'} tone={p.status === 'resolved' ? 'neutral' : 'blue'} size="sm" />
          </span>
        </div>
        {p.caption && <p className="mt-1 text-[13px] text-stone-700 dark:text-stone-200">{p.caption}</p>}
        <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] ${MUTED}`}>
          {p.docketNo && <CopyText text={p.docketNo} className="text-[11px]" />}
          {p.track && <span>{TRACK_LABEL[p.track]}{p.status === 'active' && p.stage ? ` · ${stageLabel(p.track, p.stage)}` : ''}</span>}
          {p.filedOn && <span>Filed {formatDateShort(p.filedOn)}</span>}
          {p.resolution && <span>{p.resolution}</span>}
          {matters.map((m) => (
            <Link key={m.id} href={`/dashboard/matters/${m.id}`} className="hover:text-navy-700 dark:hover:text-navy-300">
              <span className="font-mono">{m.code}</span>
            </Link>
          ))}
        </div>
        {(onFollow || onFileOn || onRemove) && (
          <div className="mt-2 flex flex-wrap gap-3 text-[11.5px] font-medium">
            {onFollow && (
              <button type="button" onClick={onFollow} className="text-navy-700 dark:text-navy-300 hover:underline">
                Show its stages
              </button>
            )}
            {onFileOn && (
              <button type="button" onClick={onFileOn} className="text-navy-700 dark:text-navy-300 hover:underline">
                File on this
              </button>
            )}
            {onRemove && (
              <button type="button" onClick={onRemove} className="text-stone-500 hover:text-rose-600 dark:text-stone-400 dark:hover:text-rose-400">
                Remove
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
