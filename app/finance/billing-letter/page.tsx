import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft, FileText } from 'lucide-react';
import { requireRouteAccess } from '@/lib/nav/guard';
import PageHeader from '@/components/ui/PageHeader';
import BillingLetterEditor from '@/components/finance/BillingLetterEditor';
import { loadEmailBrand } from '@/lib/email';

export const metadata: Metadata = { title: 'Billing Letter' };

export default async function Page() {
  const session = await requireRouteAccess('/finance/billing-letter');
  const role = session.user.role ?? 'lawyer';

  return (
    <>
      <Link href="/finance/templates" className="inline-flex items-center gap-1 text-[12.5px] text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 mb-3">
        <ChevronLeft className="w-3.5 h-3.5" /> Billing wording
      </Link>
      <PageHeader
        icon={<FileText className="w-5 h-5" />}
        title="Billing Letter"
        subtitle="The wording of the billing letter and the email it is sent with. Each paragraph says when it appears; add, rename, reorder or delete them, and every change is kept in its history."
      />
      <BillingLetterEditor emailBrand={await loadEmailBrand(session.firmId)} />
    </>
  );
}
