import type { Metadata } from 'next';
import { LayoutGrid } from 'lucide-react';
import { requireRouteAccess } from '@/lib/nav/guard';
import PageHeader from '@/components/ui/PageHeader';
import AllTools from '@/components/nav/AllTools';

export const metadata: Metadata = { title: 'More' };

export default async function LiaisonMorePage() {
  const session = await requireRouteAccess('/liaison/more');

  return (
    <>
      <PageHeader
        icon={<LayoutGrid className="w-5 h-5" />}
        title="More"
        subtitle="Every page you can open, with what each one is for."
      />
      <AllTools role={session.user.role} area="liaison" />
    </>
  );
}
