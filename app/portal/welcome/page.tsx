import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Briefcase,
  Inbox,
  Upload,
  ArrowRight,
} from 'lucide-react';
import { getPortalSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import PortalHeader from '../PortalHeader';
import { portalSubjects } from '@/lib/portal/companies';

export const metadata: Metadata = { title: 'Welcome' };

export const dynamic = 'force-dynamic';

export default async function PortalWelcomePage() {
  const session = await getPortalSession();
  if (!session) redirect('/portal/login');

  // A client's JWT reads no firm table; every read scopes to the session's client.
  const db = getServiceDbForFirm(session.firmId);
  const { data: matterRows } = await db
    .from('matters')
    .select('notion_id')
    .eq('client_id', session.user.clientId);
  const matterIds = (matterRows ?? []).map((m) => m.notion_id as string);
  const [requestsResult, clientResult, subjects] = await Promise.all([
    matterIds.length > 0
      ? db
          .from('file_requests')
          .select('id', { count: 'exact', head: true })
          .in('matter_id', matterIds)
          .is('fulfilled_at', null)
          .is('canceled_at', null)
      : Promise.resolve({ count: 0 }),
    db
      .from('clients')
      .select('full_company_name, name')
      .eq('notion_id', session.user.clientId)
      .single(),
    portalSubjects(db, session.user.clientId),
  ]);

  const mattersCount = matterIds.length;
  const requestsCount = requestsResult.count ?? 0;
  const clientName =
    clientResult.data?.full_company_name
    || clientResult.data?.name
    || session.user.clientId;

  const firstName = (session.user.name || '').split(' ')[0] || 'there';

  return (
    <>
      <PortalHeader clientName={clientName} subjects={subjects} />
      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="mb-10">
          <p className="text-[11px] font-medium uppercase tracking-wider text-gold-600 dark:text-gold-400 mb-2">
            Welcome
          </p>
          <h1 className="text-3xl font-semibold text-foreground">
            Hi {firstName}, you&apos;re all set.
          </h1>
          <p className="text-base text-[var(--text-secondary)] mt-2 leading-relaxed">
            This portal is where your matters live. You&apos;ll see filed documents, hearing
            schedules, and any document requests from your legal team — and you can send
            files back without leaving the page.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
          <Link
            href="/portal"
            className="group flex items-start gap-3 border border-[var(--border-color)] rounded-2xl bg-card hover:bg-subtle hover:border-[var(--border-hover)] transition-all p-5"
          >
            <div className="w-10 h-10 rounded-xl bg-navy-50 dark:bg-navy-400/10 flex items-center justify-center shrink-0">
              <Briefcase className="w-5 h-5 text-navy-600 dark:text-navy-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Your matters</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {mattersCount} on file
              </p>
            </div>
            <ArrowRight className="w-4 h-4 text-[var(--text-muted)] mt-1 group-hover:text-foreground transition-colors" />
          </Link>

          {requestsCount > 0 && (
            <div className="flex items-start gap-3 border border-gold-200 dark:border-gold-400/30 bg-gold-50/40 dark:bg-gold-400/5 rounded-2xl p-5">
              <div className="w-10 h-10 rounded-xl bg-gold-100 dark:bg-gold-400/10 flex items-center justify-center shrink-0">
                <Inbox className="w-5 h-5 text-gold-700 dark:text-gold-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  Pending requests
                </p>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {requestsCount} document{requestsCount === 1 ? '' : 's'} your team is
                  waiting on
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="border border-[var(--border-color)] rounded-2xl bg-card p-6 mb-10">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-4">
            How to use this portal
          </h2>
          <ul className="space-y-3">
            <li className="flex items-start gap-3">
              <Briefcase className="w-4 h-4 text-[var(--text-muted)] mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">Open a matter</p>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  See filed documents, hearings, and a plain-English status summary.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <Inbox className="w-4 h-4 text-[var(--text-muted)] mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">Check the Requests tab</p>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Your team can ask for specific documents — IDs, certificates, statements
                  — and you can fulfill them in one click.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <Upload className="w-4 h-4 text-[var(--text-muted)] mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">Send files anytime</p>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Use the <span className="font-medium">Send files</span> button on any
                  matter. Your assigned lawyers are notified the moment it arrives.
                </p>
              </div>
            </li>
          </ul>
        </div>

        <div className="flex justify-center">
          <Link
            href="/portal"
            className="inline-flex items-center gap-2 text-sm font-medium text-white bg-navy-600 hover:bg-navy-700 rounded-lg px-5 py-2.5 transition-colors"
          >
            Go to your matters
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </main>
    </>
  );
}
