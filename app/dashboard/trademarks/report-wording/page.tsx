import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft, FileText } from 'lucide-react';
import { getSession } from '@/lib/session';
import PageHeader from '@/components/ui/PageHeader';
import ReportWordingEditor from '@/components/trademarks/ReportWordingEditor';

export const metadata: Metadata = { title: 'Report Wording' };

export default async function TrademarkReportWordingPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  return (
    <>
      <Link href="/dashboard/trademarks" className="inline-flex items-center gap-1 text-[12.5px] text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 mb-3">
        <ChevronLeft className="w-3.5 h-3.5" /> Trademarks
      </Link>
      <PageHeader
        icon={<FileText className="w-5 h-5" />}
        title="Report Wording"
        subtitle="The wording of the trademark client reports and the emails they are sent with. Pick a report or a shared paragraph, edit it beside the report it makes, and every change is kept in its history."
      />
      <ReportWordingEditor />
    </>
  );
}
