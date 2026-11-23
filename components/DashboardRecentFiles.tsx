import { FolderOpen } from 'lucide-react';
import { getNewInboxFiles, getReadInboxFiles } from '@/lib/queries/files';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import RecentFilesSection from '@/components/RecentFilesSection';
import SectionCard from '@/components/ui/SectionCard';
import LoadError from '@/components/ui/LoadError';

/**
 * The dashboard's Recent Files, loaded on its own so the page can stream around it:
 * it is the slowest section, since every attachment link is signed.
 */
export default async function DashboardRecentFiles({ firmId, userId }: { firmId: string; userId: string }) {
  // One client for both tabs, so their shared matter lookup is cached once.
  const db = await getSupabaseServerAuthClient();
  const [newFiles, readFiles] = await Promise.allSettled([
    getNewInboxFiles(firmId, userId, db),
    getReadInboxFiles(firmId, userId, db),
  ]);
  if (newFiles.status === 'fulfilled' && readFiles.status === 'fulfilled') {
    return <RecentFilesSection newFiles={newFiles.value} readFiles={readFiles.value} userId={userId} />;
  }

  for (const [label, r] of [['new recent files', newFiles], ['read recent files', readFiles]] as const) {
    if (r.status === 'rejected') console.error(`[dashboard] ${label} failed for ${userId}:`, r.reason);
  }
  return (
    <SectionCard id="inbox" title="Recent Files" icon={<FolderOpen className="w-5 h-5" />}>
      <LoadError />
    </SectionCard>
  );
}

/** Holds Recent Files' place while it loads. */
export function DashboardRecentFilesSkeleton() {
  return (
    <SectionCard id="inbox" title="Recent Files" icon={<FolderOpen className="w-5 h-5" />}>
      <div className="space-y-2 px-1 pb-2" aria-busy="true" aria-label="Loading recent files">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-10 rounded-lg skeleton-shimmer" />
        ))}
      </div>
    </SectionCard>
  );
}
