import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { isFeatureAvailable } from '@/lib/firm/features';
import {
  Users, FolderOpen, FileText, CheckSquare, Gavel, Handshake, Paperclip,
  ChevronRight, Scale, UserPlus, Eye, Info, Receipt,
} from 'lucide-react';
import { getClientById } from '@/lib/queries/detail';
import { getClientMattersWithCounts, type ClientMatterDetail } from '@/lib/queries/detail';
import SubjectCrumbs from './SubjectCrumbs';
import SubjectHeader from '@/components/ui/SubjectHeader';
import { CopyText, Fact, MetaChip, StatusPill, SubjectCard } from '@/components/ui/primitives';
import { BTN_OUTLINE, type PillTone } from '@/components/ui/tone';
import SectionCard from '@/components/ui/SectionCard';
import ClientSubjects, { type ClientSubjectRow } from './ClientSubjects';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

// ── Helpers ──────────────────────────────────────────────────────────

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === 0) return '—';
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

function clientStatusTone(status: string): PillTone {
  const s = status.toLowerCase();
  if (s === 'active' || s === 'ongoing') return 'emerald';
  if (s === 'prospective') return 'blue';
  return 'neutral';
}

function matterStatusTone(status: string): PillTone {
  const s = status.toLowerCase();
  if (s === 'ongoing') return 'blue';
  if (s === 'done') return 'emerald';
  if (s === 'archived') return 'muted';
  return 'neutral';
}

const ADVERSE_OUTCOMES = ['loss', 'denied', 'dismissed with prejudice', 'unfavorable'];
const FAVORABLE_OUTCOMES = ['win', 'won', 'favorable', 'settled', 'dismissed', 'granted'];

function outcomeTone(outcome: string): PillTone {
  const o = outcome.toLowerCase();
  if (ADVERSE_OUTCOMES.includes(o)) return 'rose';
  if (FAVORABLE_OUTCOMES.includes(o)) return 'emerald';
  return 'neutral';
}

const ACTION = `${BTN_OUTLINE} px-3 py-1.5`;

// ── Component ────────────────────────────────────────────────────────

const PRIVILEGED_ROLES = ['partner', 'super_user', 'admin', 'finance'];

export default async function ClientDetail({ id }: { id: string }) {
  const session = await getSession();
  if (!session) notFound();

  const client = await getClientById(id, session.firmId);
  if (!client) notFound();

  const userRole = session?.user?.role ?? 'lawyer';
  const isPrivileged = PRIVILEGED_ROLES.includes(userRole);
  // Priority is an internal, partner-only attribute — not visible to finance/admin.
  const canSeePriority = userRole === 'partner' || userRole === 'super_user';
  const canManagePortalUsers =
    (userRole === 'partner' || userRole === 'admin' || userRole === 'super_user') &&
    (await isFeatureAvailable(session.firmId, 'portal'));

  const authed = await getSupabaseServerAuthClient();
  const [matters, { data: subjectRows }] = await Promise.all([
    getClientMattersWithCounts(id, session.firmId),
    authed
      .from('subject_status')
      .select('subject_id, type, name, lifecycle_status, company_type, identifier, health, overdue, next_label, next_due')
      .eq('client_id', id)
      .order('overdue', { ascending: false })
      .order('next_due', { ascending: true, nullsFirst: false })
      .order('name'),
  ]);

  const subjects: ClientSubjectRow[] = (subjectRows ?? []).map((r) => ({
    id: r.subject_id as string,
    type: r.type as ClientSubjectRow['type'],
    name: (r.name as string) ?? '',
    status: (r.lifecycle_status as string | null) ?? null,
    kind: (r.company_type as string | null) ?? null,
    identifier: (r.identifier as string | null) ?? null,
    health: (r.health as ClientSubjectRow['health']) ?? null,
    overdue: (r.overdue as number) ?? 0,
    next: r.next_label ? { label: r.next_label as string, due: (r.next_due as string | null) ?? null } : null,
  }));

  const ongoingMatters = matters.filter((m) => m.status.toLowerCase() === 'ongoing');
  const otherMatters = matters.filter((m) => m.status.toLowerCase() !== 'ongoing');
  const totalDeliverables = matters.reduce((s, m) => s + m.deliverableCount, 0);
  const totalOpenTasks = matters.reduce((s, m) => s + m.openTaskCount, 0);
  const totalHearings = matters.reduce((s, m) => s + m.hearingCount, 0);
  const totalFiles = matters.reduce((s, m) => s + m.fileCount, 0);

  const hasFinancialInfo = isPrivileged && !!(client.receivables || client.discount || client.tin);

  return (
    <div className="space-y-4">
      <SubjectCrumbs
        list={{ label: 'Clients', href: '/dashboard/clients', icon: <Users className="w-3.5 h-3.5" /> }}
        current={client.name}
      />

      <SubjectHeader
        monogramOf={client.name}
        title={client.name}
        statusPill={client.status ? <StatusPill label={client.status} tone={clientStatusTone(client.status)} /> : null}
        meta={
          <>
            {client.clientCode && (
              <MetaChip mono>
                <CopyText text={client.clientCode} />
              </MetaChip>
            )}
            {client.fullCompanyName && client.fullCompanyName !== client.name && (
              <MetaChip>{client.fullCompanyName}</MetaChip>
            )}
            {canSeePriority && client.priority && <StatusPill label="Priority client" tone="amber" />}
          </>
        }
        team={[]}
        actions={
          canManagePortalUsers && (
            <div className="flex items-center gap-2">
              <Link
                href={`/client-portal-preview/${client.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={ACTION}
              >
                <Eye className="w-3.5 h-3.5" />
                Preview portal
              </Link>
              <Link href={`/dashboard/clients/${client.id}/users`} className={ACTION}>
                <UserPlus className="w-3.5 h-3.5" />
                Portal users
              </Link>
            </div>
          )
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-4 min-w-0">
          {ongoingMatters.length > 0 && (
            <SubjectCard
              title={
                <>
                  Ongoing matters
                  <span className="inline-flex items-center px-1.5 py-px rounded-full bg-stone-100 dark:bg-white/[0.08] text-[11px] font-medium text-stone-600 dark:text-stone-300 tabular-nums">
                    {ongoingMatters.length}
                  </span>
                </>
              }
              icon={<FolderOpen className="w-4 h-4" />}
              bodyClassName="pb-2"
            >
              <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
                {ongoingMatters.map((m) => (
                  <MatterRow key={m.id} matter={m} />
                ))}
              </ul>
            </SubjectCard>
          )}

          <ClientSubjects rows={subjects} />

          {otherMatters.length > 0 && (
            <SectionCard
              title="Other matters"
              icon={<Scale className="w-4 h-4" />}
              count={otherMatters.length}
              collapsible
              defaultOpen={false}
            >
              <ul className="divide-y divide-stone-100 dark:divide-white/[0.06] -mx-5 -mb-4">
                {otherMatters.map((m) => (
                  <MatterRow key={m.id} matter={m} />
                ))}
              </ul>
            </SectionCard>
          )}

          {matters.length === 0 && (
            <SubjectCard title="Matters" icon={<FolderOpen className="w-4 h-4" />}>
              <p className="py-2 text-sm text-stone-500 dark:text-stone-400">No matters for this client.</p>
            </SubjectCard>
          )}

        </div>

        <div className="space-y-4 lg:sticky lg:top-20">
          <SubjectCard title="At a glance" icon={<Info className="w-4 h-4" />}>
            <dl>
              {client.clientCode && <Fact label="Code" value={<CopyText text={client.clientCode} />} mono />}
              {client.contactEmail && (
                <Fact
                  label="Email"
                  value={
                    <a
                      href={`mailto:${client.contactEmail}`}
                      className="break-all text-navy-700 dark:text-navy-300 hover:underline"
                    >
                      {client.contactEmail}
                    </a>
                  }
                />
              )}
              {client.phoneNumber && <Fact label="Phone" value={client.phoneNumber} />}
              {client.pointPersons && <Fact label="Point person(s)" value={client.pointPersons} />}
              <Fact label="Matters" value={<span className="tabular-nums">{matters.length}</span>} />
              <Fact label="Ongoing" value={<span className="tabular-nums">{ongoingMatters.length}</span>} />
              <Fact label="Deliverables" value={<span className="tabular-nums">{totalDeliverables}</span>} />
              <Fact label="Open tasks" value={<span className="tabular-nums">{totalOpenTasks}</span>} />
              <Fact label="Hearings" value={<span className="tabular-nums">{totalHearings}</span>} />
              <Fact label="Files" value={<span className="tabular-nums">{totalFiles}</span>} />
              {client.createdTime && <Fact label="Client since" value={formatDate(client.createdTime)} />}
            </dl>
          </SubjectCard>

          {hasFinancialInfo && (
            <SubjectCard title="Billing" icon={<Receipt className="w-4 h-4" />}>
              <dl>
                {client.receivables !== null && client.receivables > 0 && (
                  <Fact label="Receivables" value={formatCurrency(client.receivables)} mono />
                )}
                {client.discount !== null && client.discount > 0 && (
                  <Fact label="Discount" value={`${client.discount}%`} />
                )}
                {client.tin && <Fact label="TIN" value={<CopyText text={client.tin} />} mono />}
              </dl>
            </SubjectCard>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Matter Row ────────────────────────────────────────────────────────

function MatterRow({ matter: m }: { matter: ClientMatterDetail }) {
  const isCase = !!(m.caseTitle || m.caseNumber || m.court);
  const totalActivity = m.activeDeliverableCount + m.openTaskCount;

  return (
    <li>
      <Link
        href={`/dashboard/matters/${m.id}`}
        className="group flex items-start gap-4 px-5 py-3.5 hover:bg-stone-50 dark:hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-semibold text-stone-800 dark:text-stone-100 group-hover:text-navy-700 dark:group-hover:text-navy-300 truncate transition-colors">
              {m.name}
            </p>
            {m.matterCode && (
              <span className="text-[10px] font-mono text-stone-400 dark:text-stone-500 shrink-0">{m.matterCode}</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            {m.type && <MetaChip>{m.type}</MetaChip>}
            {m.status && <StatusPill size="sm" label={m.status} tone={matterStatusTone(m.status)} />}
            {m.outcome && <StatusPill size="sm" label={m.outcome} tone={outcomeTone(m.outcome)} />}
          </div>

          {isCase && (m.caseTitle || m.court) && (
            <p className="text-xs text-stone-500 dark:text-stone-400 truncate mb-2">
              {m.caseTitle && <span>{m.caseTitle}</span>}
              {m.caseTitle && m.court && <span className="mx-1.5 text-stone-300 dark:text-stone-600">&middot;</span>}
              {m.court && <span>{m.court}</span>}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-stone-400 dark:text-stone-500">
            {m.deliverableCount > 0 && (
              <span className="flex items-center gap-1">
                <FileText className="w-3 h-3" />
                {m.activeDeliverableCount > 0 ? `${m.activeDeliverableCount} active` : `${m.deliverableCount} total`}
              </span>
            )}
            {m.openTaskCount > 0 && (
              <span className="flex items-center gap-1">
                <CheckSquare className="w-3 h-3" />
                {m.openTaskCount} open
              </span>
            )}
            {m.hearingCount > 0 && (
              <span className="flex items-center gap-1">
                <Gavel className="w-3 h-3" />
                {m.hearingCount}
              </span>
            )}
            {m.meetingCount > 0 && (
              <span className="flex items-center gap-1">
                <Handshake className="w-3 h-3" />
                {m.meetingCount}
              </span>
            )}
            {m.fileCount > 0 && (
              <span className="flex items-center gap-1">
                <Paperclip className="w-3 h-3" />
                {m.fileCount}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          {totalActivity > 0 && <StatusPill size="sm" label={`${totalActivity} active`} tone="navy" />}
          <ChevronRight className="w-4 h-4 text-stone-400 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </Link>
    </li>
  );
}
