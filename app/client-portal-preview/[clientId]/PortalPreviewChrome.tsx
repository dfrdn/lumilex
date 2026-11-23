'use client';

import Link from 'next/link';
import { Eye, ArrowLeft } from 'lucide-react';
import PortalHeader from '@/app/portal/PortalHeader';
import PortalFooter from '@/app/portal/PortalFooter';

interface Props {
  clientId: string;
  clientName: string;
  subjects: { companies: boolean; trademarks: boolean };
  children: React.ReactNode;
}

export default function PortalPreviewChrome({ clientId, clientName, subjects, children }: Props) {
  const basePath = `/client-portal-preview/${clientId}`;

  return (
    <>
      {/* Banner + header stick together as one block — no magic pixel offset. */}
      <div className="sticky top-0 z-20">
        <div className="bg-amber-500 dark:bg-amber-600 text-white">
          <div className="max-w-5xl mx-auto px-6 py-2 flex items-center justify-between gap-3">
            <p className="text-xs font-medium flex items-center gap-2 min-w-0">
              <Eye className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                Preview — viewing <span className="font-semibold">{clientName}</span>&apos;s portal as
                they see it. Read-only.
              </span>
            </p>
            <Link
              href={`/dashboard/clients/${clientId}`}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium bg-white/15 hover:bg-white/25 rounded-lg px-3 py-1.5 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Exit preview
            </Link>
          </div>
        </div>
        <PortalHeader clientName={clientName} basePath={basePath} showSignOut={false} sticky={false} subjects={subjects} />
      </div>

      {children}
      <PortalFooter />
    </>
  );
}
