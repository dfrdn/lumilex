import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarDays } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import PageHeader from '@/components/ui/PageHeader';
import FilingCalendarEditor from '@/components/corporations/FilingCalendarEditor';
import { CALENDAR_EDITOR_ROLES, rowToFilingCalendarEntry } from '@/lib/corporations/filing-calendar';
import { manilaToday } from '@/lib/corporations/status';

export const metadata: Metadata = { title: 'Filing calendar' };
export const dynamic = 'force-dynamic';

export default async function FilingCalendarPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');
  const role = session.user.role ?? 'lawyer';

  const supabase = await getSupabaseServerAuthClient();
  const { data } = await supabase.from('compliance_calendar').select('*').order('filing_year', { ascending: false });
  const entries = (data ?? []).map((r) => rowToFilingCalendarEntry(r as Record<string, unknown>));

  return (
    <>
      <PageHeader
        icon={<CalendarDays className="w-5 h-5" />}
        title="Filing calendar"
        subtitle="The AFS and income-tax deadlines the SEC and BIR set each year — every company's due dates follow these"
        action={
          <Link href="/dashboard/corporations" className="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200">
            ← Corporations
          </Link>
        }
      />
      <FilingCalendarEditor
        initial={entries}
        canEdit={CALENDAR_EDITOR_ROLES.includes(role)}
        thisYear={Number(manilaToday().slice(0, 4))}
      />
    </>
  );
}
