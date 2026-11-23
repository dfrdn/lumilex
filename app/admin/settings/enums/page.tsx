import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import EnumOptionsEditor from '@/components/admin/EnumOptionsEditor';
import { ENUM_GROUPS } from '@/lib/enum-options';

export const metadata: Metadata = { title: 'Dropdown Options' };

export default async function AdminEnumsPage() {
  await requireRouteAccess('/admin/settings/enums');

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      <header className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Dropdown Options</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
          Edit the values that appear in dropdowns across the app — matter types, hearing types, file origins, etc.
        </p>
      </header>
      <div className="flex-1 overflow-hidden">
        <EnumOptionsEditor groups={ENUM_GROUPS} />
      </div>
    </div>
  );
}
