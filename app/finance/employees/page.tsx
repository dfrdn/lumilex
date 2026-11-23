import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import EmployeeCompensation from '@/components/finance/EmployeeCompensation';

export const metadata: Metadata = { title: 'Employees' };

export const revalidate = 0;

export default async function FinanceEmployeesPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  return (
    <>
      <div className="mb-8">
        <h1 className="font-serif text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          Employee Compensation
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Manage monthly salary, start date, and end date for each team member.
        </p>
      </div>

      <EmployeeCompensation />
    </>
  );
}
