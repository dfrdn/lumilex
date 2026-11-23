import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import UserManagement from '@/components/admin/UserManagement';

export const metadata: Metadata = { title: 'User Management' };

export const revalidate = 30;

export default async function AdminUsersPage() {
  await requireRouteAccess('/admin/users');

  return (
    <>
      <div className="mb-8">
        <h1 className="font-serif text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          User Management
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Manage team member accounts, roles, and passwords
        </p>
      </div>

      <UserManagement />
    </>
  );
}
