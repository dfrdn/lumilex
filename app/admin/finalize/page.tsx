import type { Metadata } from 'next';
import FinalizeDeliverables from '@/components/admin/FinalizeDeliverables';
import { requireRouteAccess } from '@/lib/nav/guard';

export const metadata: Metadata = { title: 'Finalize' };

export const revalidate = 30;

export default async function AdminFinalizePage() {
  await requireRouteAccess('/admin/finalize');

  return (
    <>
      <div className="mb-8">
        <h1 className="font-serif text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          Finalize Deliverables
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Accept tracked changes, proofread, insert e-signatures, and generate final PDF
        </p>
      </div>

      <FinalizeDeliverables />
    </>
  );
}
