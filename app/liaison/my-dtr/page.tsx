import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

import { getLawyerNameByPersonId, getMyDTR } from '@/lib/queries/my-dtr';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import MyDTRDashboard from '@/app/dashboard/my-dtr/MyDTRDashboard';
import { manilaMonth } from '@/lib/dates';

export const metadata: Metadata = { title: 'My DTR' };

export const revalidate = 30;

interface Props {
  searchParams: Promise<{ month?: string }>;
}

export default async function LiaisonMyDTRPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const params = await searchParams;

  // Default to current month in Asia/Manila timezone
  const defaultMonth = manilaMonth();

  const monthParam = params.month ?? '';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) ? monthParam : defaultMonth;

  const db = await getSupabaseServerAuthClient();
  const lawyerName = await getLawyerNameByPersonId(session.firmId, session.user.notionUserId, db);
  if (!lawyerName) {
    return (
      <div className="text-center py-20 text-stone-500 dark:text-stone-400">
        Could not find your profile in the team directory.
      </div>
    );
  }

  const entries = await getMyDTR(session.firmId, lawyerName, session.user.notionUserId, month, db);

  return (
    <MyDTRDashboard
      entries={entries}
      month={month}
      currentMonth={defaultMonth}
      lawyerName={lawyerName}
    />
  );
}
