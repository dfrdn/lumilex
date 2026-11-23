import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, FileText } from 'lucide-react';
import { getSession } from '@/lib/session';
import EmailTemplateList from '@/components/finance/EmailTemplateList';
import { loadOutboundIdentity } from '@/lib/firm/outbound-identity';

export const metadata: Metadata = { title: 'Templates' };

export default async function EmailTemplatesPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  // The page is ungated: the billing letter and the follow-up emails are
  // manageable by every firm, because client mail goes out through Resend — a
  // platform service, not a per-firm integration.
  const userName = session.user.name ?? '';
  const role = session.user.role ?? 'finance';
  const userImage = session.user.image ?? null;
  const { financeAddress } = await loadOutboundIdentity(session.firmId);

  return (
    <>
      <div className="space-y-6">
        <Link
          href="/finance/billing-letter"
          className="flex items-center gap-3 rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.08)] bg-card p-5 hover:bg-stone-50 dark:hover:bg-white/5 transition-colors"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
            <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">Billing Letter and Email</p>
            <p className="text-xs text-[var(--text-secondary)]">The one letter and the one email every invoice goes out with — edit their wording paragraph by paragraph.</p>
          </div>
          <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
        </Link>
        <EmailTemplateList financeAddress={financeAddress} />
      </div>
    </>
  );
}
