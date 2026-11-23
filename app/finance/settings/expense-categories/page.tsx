import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import EnumOptionsEditor from '@/components/admin/EnumOptionsEditor';
import { ENUM_GROUPS, isFinanceEditable } from '@/lib/enum-options';

export const metadata: Metadata = { title: 'Expense Categories' };

export default async function FinanceExpenseCategoriesPage() {
  await requireRouteAccess('/finance/settings/expense-categories');

  const groups = ENUM_GROUPS.filter((g) => isFinanceEditable(g));

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      <header className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Expense Categories</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
          Reimbursement categories (staff expense filings) and firm operating-expense categories.
        </p>
      </header>
      <div className="flex-1 overflow-hidden">
        {groups.length > 0 && <EnumOptionsEditor groups={groups} showMatterCode={false} />}
      </div>
    </div>
  );
}
