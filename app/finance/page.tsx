import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { invoiceOpenBalance } from '@/lib/finance/invoice-amounts';
import FinanceOverview from '@/components/finance/FinanceOverview';
import { manilaMonth } from '@/lib/dates';

export const metadata: Metadata = { title: 'Overview' };

export const revalidate = 30;

export default async function FinancePage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const userName = session.user.name ?? '';

  const supabase = getServiceDbForFirm(session.firmId);
  const currentMonth = manilaMonth();

  // Get summary stats
  const [{ count: unbilledCount }, { data: monthInvoices }, { data: pendingInvoices }, { data: sentInvoices }] = await Promise.all([
    supabase.from('dtr').select('*', { count: 'exact', head: true }).eq('billed', false),
    supabase.from('invoices').select('total_amount, total_expenses').eq('billing_month', currentMonth),
    supabase.from('invoices').select('id', { count: 'exact', head: true }).in('status', ['draft', 'sent']),
    supabase.from('invoices').select('total_amount, total_expenses, paid_amount, billing_settings').eq('status', 'sent'),
  ]);

  const totalBilledThisMonth = (monthInvoices ?? []).reduce(
    (s: number, i: any) => s + Number(i.total_amount) + Number(i.total_expenses), 0,
  );

  // VAT-inclusive open balance — A/R reflects what clients actually owe.
  const totalOutstandingAR = (sentInvoices ?? []).reduce(
    (s: number, i: any) => s + invoiceOpenBalance(i), 0,
  );

  return (
    <>
      <FinanceOverview
        unbilledEntries={unbilledCount ?? 0}
        totalBilledThisMonth={totalBilledThisMonth}
        outstandingInvoices={(pendingInvoices as any)?.length ?? 0}
        totalOutstandingAR={totalOutstandingAR}
        currentMonth={currentMonth}
        userName={userName}
      />
    </>
  );
}
