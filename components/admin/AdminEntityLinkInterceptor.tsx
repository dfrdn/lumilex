'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAdminTabs } from '@/components/admin/AdminTabsContext';

const ENTITY_PATTERN =
  /^\/dashboard\/(clients|matters|deliverables|tasks|meetings|hearings|filings|files)\/([^/?#]+)$/;

const ENTITY_LABELS: Record<string, string> = {
  clients: 'Client',
  matters: 'Matter',
  deliverables: 'Deliverable',
  tasks: 'Task',
  meetings: 'Meeting',
  hearings: 'Hearing',
  filings: 'Filing',
  files: 'File',
};

/**
 * Intercepts clicks on `/dashboard/{entity}/{id}` links within the wrapped subtree
 * and routes them through the admin tabs system instead of navigating away.
 * Must be rendered under an AdminTabsProvider.
 */
export default function AdminEntityLinkInterceptor({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { openTab, setActiveTab } = useAdminTabs();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      // Let buttons inside row items (e.g. "Mark done") handle their own clicks
      if (target?.closest('button')) return;
      const anchor = target?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;

      const match = href.match(ENTITY_PATTERN);
      if (!match) return;

      e.preventDefault();
      e.stopPropagation();

      const [, entity, id] = match;
      const detailEntity = entity === 'filings' ? 'deliverables' : entity;
      const label = anchor.textContent?.trim() || id.slice(0, 8);

      openTab({
        id,
        entity: detailEntity,
        label,
        entityLabel: ENTITY_LABELS[entity] ?? entity,
      });
      setActiveTab(id);

      const targetPath = `/admin/${detailEntity}`;
      if (!pathname.startsWith(targetPath)) router.push(targetPath);
    }

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [openTab, setActiveTab, router, pathname]);

  return <>{children}</>;
}
