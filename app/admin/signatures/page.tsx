import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import SignatureManagement from '@/components/admin/SignatureManagement';

export const metadata: Metadata = { title: 'Signatures' };

export const revalidate = 30;

export default async function AdminSignaturesPage() {
  await requireRouteAccess('/admin/signatures');

  return (
    <>
      <div className="mb-8">
        <h1 className="font-serif text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          E-Signatures
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Upload and manage signature images for document finalization
        </p>
      </div>

      <SignatureManagement />
    </>
  );
}
