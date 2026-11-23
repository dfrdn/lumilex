import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, Check, ChevronRight, Plus } from 'lucide-react';
import { getOperatorSession } from '@/lib/platform/auth';
import { listFirmsForOperator, type OperatorFirmRow } from '@/lib/platform/firms';

export const metadata: Metadata = { title: 'Firms' };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function StatusPill({ status }: { status: string }) {
  const ok = status === 'active';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        ok
          ? 'bg-subtle text-[var(--text-secondary)]'
          : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
      }`}
    >
      {status}
    </span>
  );
}

function FirmCard({ firm }: { firm: OperatorFirmRow }) {
  const flagged = firm.issues.length > 0;

  return (
    <article
      className={`rounded-xl border bg-card p-5 shadow-[var(--shadow-card)] transition-colors hover:border-[var(--text-muted)] ${
        flagged
          ? 'border-amber-500/40'
          : 'border-[var(--border-color)]'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/platform/firms/${firm.id}`}
            className="group inline-flex items-center gap-1.5"
          >
            <h2 className="font-serif text-lg text-foreground tracking-tight truncate group-hover:underline underline-offset-4">
              {firm.name}
            </h2>
            <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
          </Link>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-mono">{firm.slug}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusPill status={firm.status} />
          {firm.isDemo && (
            <span
              title="The public demo: anyone can sign in to it, and it resets nightly"
              className="inline-flex items-center rounded-full bg-gold-400/15 px-2 py-0.5 text-[11px] font-medium text-gold-700 dark:text-gold-400"
            >
              public demo
            </span>
          )}
          {flagged ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-3 h-3" />
              {firm.issues.length} issue{firm.issues.length === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              <Check className="w-3 h-3" />
              configured
            </span>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Domain</dt>
          <dd className="text-foreground truncate">
            {firm.primaryDomain ?? <span className="text-amber-700 dark:text-amber-400">none</span>}
            {firm.domainCount > 1 && (
              <span className="text-[var(--text-secondary)]"> +{firm.domainCount - 1}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Features</dt>
          <dd className="text-foreground">
            {firm.featuresEnabled}
            <span className="text-[var(--text-secondary)]"> / {firm.featuresTotal}</span>
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Invoicing</dt>
          <dd
            className={
              firm.invoiceSettingsPresent && firm.invoiceSettingsMissing.length === 0
                ? 'text-foreground'
                : 'text-amber-700 dark:text-amber-400'
            }
          >
            {!firm.invoiceSettingsPresent
              ? 'not set up'
              : firm.invoiceSettingsMissing.length === 0
                ? 'complete'
                : `${firm.invoiceSettingsMissing.length} missing`}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Team</dt>
          <dd className={firm.activeTeamCount === 0 ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'}>
            {firm.activeTeamCount} active
          </dd>
        </div>
      </dl>

      {flagged && (
        <ul className="mt-4 space-y-1 border-t border-[var(--border-color)] pt-3">
          {firm.issues.map((issue) => (
            <li
              key={issue}
              className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{issue}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-[11px] text-[var(--text-muted)]">
        Created {formatDate(firm.createdAt)} · {firm.id}
      </p>
    </article>
  );
}

export default async function PlatformFirmsPage() {
  // The layout has already refused a non-operator.
  const operator = await getOperatorSession();
  if (!operator) return null;

  const firms = await listFirmsForOperator();

  // Deliberately NOT audited, unlike the detail page.
  //
  // The rule is that an operator looking *into* a tenant belongs in that
  // tenant's own log. This page does not look into one: it reads the roster
  // and a handful of per-firm health counters, which is a platform-level fact
  // about which tenants exist. Opening a firm is the act that reads its
  // configuration, and /platform/firms/[id] audits exactly that.
  //
  // A row per firm here was also self-defeating. This is a server component
  // with no dedup, so every visit and every RSC re-render fanned N inserts
  // across N tenants; a few minutes of ordinary navigation buried the
  // mutations that a tenant's admin actually needs to see in their audit log.
  // Recording less, in the one place it means something, is what keeps that
  // trail readable.

  const flagged = firms.filter((f) => f.issues.length > 0).length;

  return (
    <>
      <div className="flex items-baseline justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-2xl text-foreground tracking-tight">Firms</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            {firms.length} tenant{firms.length === 1 ? '' : 's'}
            {flagged > 0 && (
              <span className="text-amber-700 dark:text-amber-400">
                {' '}
                · {flagged} needing attention
              </span>
            )}
          </p>
        </div>
        <Link
          href="/platform/firms/new"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-navy-800 text-white hover:bg-navy-700 transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          New firm
        </Link>
      </div>

      {firms.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">
          No firms yet. Create one above, or run{' '}
          <code className="font-mono">scripts/provision-firm.ts</code> with a config file — both
          run the same provisioning path.
        </p>
      ) : (
        <div className="grid gap-4">
          {firms.map((firm) => (
            <FirmCard key={firm.id} firm={firm} />
          ))}
        </div>
      )}
    </>
  );
}
