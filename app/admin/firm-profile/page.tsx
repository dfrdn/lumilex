import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import FirmProfileEditor from '@/components/admin/FirmProfileEditor';

export const metadata: Metadata = { title: 'Firm Profile' };

export default async function AdminFirmProfilePage() {
  await requireRouteAccess('/admin/firm-profile');

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      <header className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Firm Profile</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
          Edit the firm profile content like a CMS and export a branded PDF that matches the 2026 design.
        </p>
      </header>
      <div className="flex-1 overflow-hidden">
        <FirmProfileEditor />
      </div>
    </div>
  );
}
