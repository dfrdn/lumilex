import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';

import { Bike, CheckCircle2, Clock, AlertTriangle, MapPin, TrendingUp, XCircle } from 'lucide-react';
import { getLiaisonTasksForPerson } from '@/lib/queries/liaison';
import LiaisonTasksTable from '@/components/liaison/LiaisonTasksTable';
import QuickActions from '@/components/QuickActions';
import { computeErrandStats } from '@/lib/liaison-stats';

export const metadata: Metadata = { title: 'My Errands' };

export const revalidate = 0;

function pad(n: number) { return n.toString().padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(s: string, n: number) {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDay(s: string) {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-PH', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Asia/Manila',
  });
}
function fmtMonth(key: string) {
  return new Date(key + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'short' });
}

export default async function MyErrandsPage() {
  const session = await requireRouteAccess('/liaison/my-errands');

  const me = session.user.notionUserId;
  const firstName = (session.user.name ?? '').split(' ')[0] || 'there';
  const tasks = await getLiaisonTasksForPerson(session.firmId, me);

  const today = todayStr();
  const weekEnd = addDays(today, 6);

  const open = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
  const todays = open.filter((t) => t.scheduled_for === today);
  const overdue = open.filter((t) => t.scheduled_for && t.scheduled_for < today);
  const thisWeek = open.filter(
    (t) => t.scheduled_for && t.scheduled_for > today && t.scheduled_for <= weekEnd,
  );
  const completedThisWeek = tasks.filter(
    (t) =>
      t.status === 'completed' &&
      t.completed_at &&
      t.completed_at.slice(0, 10) >= addDays(today, -6),
  );

  const stats = computeErrandStats(tasks, new Date());

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-fuchsia-50 to-fuchsia-100 dark:from-fuchsia-900/30 dark:to-fuchsia-800/20 flex items-center justify-center shadow-sm ring-1 ring-fuchsia-200/40 dark:ring-fuchsia-700/30">
            <Bike className="w-5 h-5 text-fuchsia-600 dark:text-fuchsia-400" />
          </div>
          <div>
            <h1 className="font-serif text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
              Good day, {firstName}
            </h1>
            <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5 tracking-wide">
              {todays.length > 0
                ? `${todays.length} errand${todays.length === 1 ? '' : 's'} on today's list`
                : open.length > 0
                ? `${open.length} open errand${open.length === 1 ? '' : 's'} this week`
                : 'No open errands right now'}
            </p>
          </div>
        </div>
        <QuickActions />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatCard icon={<Clock className="w-4 h-4" />} label="Today" value={todays.length} tone="gold" />
        <StatCard icon={<AlertTriangle className="w-4 h-4" />} label="Overdue" value={overdue.length} tone={overdue.length > 0 ? 'rose' : 'neutral'} />
        <StatCard icon={<MapPin className="w-4 h-4" />} label="Rest of this week" value={thisWeek.length} tone="neutral" />
        <StatCard icon={<CheckCircle2 className="w-4 h-4" />} label="Completed last 7 days" value={completedThisWeek.length} tone="emerald" />
      </div>

      {todays.length > 0 && (
        <Section title={`Today · ${fmtDay(today)}`}>
          <LiaisonTasksTable tasks={todays} mode="owner" meId={me} />
        </Section>
      )}

      {overdue.length > 0 && (
        <Section title="Overdue" tone="rose">
          <LiaisonTasksTable tasks={overdue} mode="owner" meId={me} />
        </Section>
      )}

      <Section title="All Errands">
        <LiaisonTasksTable tasks={tasks} mode="owner" meId={me} />
      </Section>

      {tasks.length > 0 && (
        <Section title="Your Record">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <StatCard icon={<Bike className="w-4 h-4" />} label="Assigned all time" value={stats.totalAssigned} tone="neutral" />
            <StatCard icon={<CheckCircle2 className="w-4 h-4" />} label="Completed" value={stats.completed} tone="emerald" />
            <StatCard icon={<TrendingUp className="w-4 h-4" />} label="Completion rate" value={`${stats.completionRate}%`} tone="gold" />
            <StatCard icon={<CheckCircle2 className="w-4 h-4" />} label="Completed this month" value={stats.completedThisMonth} tone="neutral" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <BarPanel
              title="Completed by month"
              icon={<TrendingUp className="w-3.5 h-3.5" />}
              rows={stats.monthKeys.map((k) => ({ label: fmtMonth(k), value: stats.completedByMonth.get(k) ?? 0 }))}
              barClass="bg-emerald-500"
              emptyLabel="No completed errands yet"
            />
            <BarPanel
              title="Most-visited destinations"
              icon={<MapPin className="w-3.5 h-3.5" />}
              rows={stats.topZones}
              barClass="bg-fuchsia-500"
              emptyLabel="No zones recorded yet"
            />
          </div>

          {stats.cancelled > 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-stone-400 dark:text-stone-500">
              <XCircle className="w-3.5 h-3.5 shrink-0" />
              {stats.cancelled} cancelled errand{stats.cancelled === 1 ? '' : 's'} — not counted against your completion rate.
            </p>
          )}
        </Section>
      )}
    </>
  );
}

function StatCard({ icon, label, value, tone }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: 'gold' | 'rose' | 'emerald' | 'neutral';
}) {
  const TONES: Record<typeof tone, string> = {
    gold: 'text-gold-600 dark:text-gold-400',
    rose: 'text-rose-600 dark:text-rose-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    neutral: 'text-stone-500 dark:text-stone-400',
  };
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-card px-4 py-3 shadow-[var(--shadow-card)]">
      <div className={`flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider ${TONES[tone]}`}>
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

function BarPanel({ title, icon, rows, barClass, emptyLabel }: {
  title: string;
  icon: React.ReactNode;
  rows: { label: string; value: number }[];
  barClass: string;
  emptyLabel: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const hasData = rows.some((r) => r.value > 0);
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-card px-4 py-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-3">
        {icon}
        {title}
      </div>
      {hasData ? (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-stone-700 dark:text-stone-300 truncate pr-2">{r.label}</span>
                <span className="text-stone-400 dark:text-stone-500 font-mono text-xs shrink-0">{r.value}</span>
              </div>
              <div className="h-1.5 rounded-full bg-stone-100 dark:bg-[#2A2A2D] overflow-hidden">
                <div className={`h-full rounded-full ${barClass}`} style={{ width: `${(r.value / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-stone-400 dark:text-stone-500 py-2">{emptyLabel}</p>
      )}
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone?: 'rose'; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className={`text-sm font-semibold uppercase tracking-wider mb-3 ${
        tone === 'rose'
          ? 'text-rose-600 dark:text-rose-400'
          : 'text-stone-600 dark:text-stone-300'
      }`}>
        {title}
      </h2>
      {children}
    </div>
  );
}
