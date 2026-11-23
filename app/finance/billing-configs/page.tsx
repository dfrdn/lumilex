import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Settings } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import PageHeader from '@/components/ui/PageHeader';
import BillingConfigList from '@/components/finance/BillingConfigList';
import ClientBillingList from '@/components/finance/ClientBillingList';
import { loadClientBillingRows } from '@/lib/billing/client-billing-rows';

export const metadata: Metadata = { title: 'Billing Configs' };

const SUBTITLE = {
  matter: "Each matter's fee terms: how it is billed, its rates, caps and bank details.",
  client: "Each client's billing profile: who the letter goes to, VAT, the paragraphs it carries and the early-payment discount. It applies to every matter billed to the client.",
};

export default async function BillingConfigsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const userName = session.user.name ?? '';
  const role = session.user.role ?? 'finance';
  const userImage = session.user.image ?? null;

  const view = (await searchParams).view === 'client' ? 'client' : 'matter';
  const byClient = view === 'client' ? await loadClientBillingRows(await getSupabaseServerAuthClient()) : null;

  const tab = (v: 'matter' | 'client', label: string) => (
    <Link
      href={v === 'client' ? '/finance/billing-configs?view=client' : '/finance/billing-configs'}
      aria-current={view === v ? 'page' : undefined}
      className={`px-4 py-1.5 transition-colors ${view === v ? 'bg-navy-100 text-navy-800 dark:bg-gold-400/15 dark:text-gold-300 font-medium' : 'text-[var(--text-secondary)] hover:bg-stone-50 dark:hover:bg-white/5'}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        icon={<Settings className="w-5 h-5" />}
        title="Billing Configs"
        subtitle={SUBTITLE[view]}
        action={
          <nav aria-label="Billing configs view" className="inline-flex rounded-lg border border-stone-200 dark:border-[rgba(255,255,255,0.1)] overflow-hidden text-sm">
            {tab('matter', 'By matter')}
            {tab('client', 'By client')}
          </nav>
        }
      />
      {byClient ? <ClientBillingList rows={byClient.rows} paragraphLabels={byClient.paragraphLabels} /> : <BillingConfigList />}
    </>
  );
}
