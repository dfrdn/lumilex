'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export interface DetailTab {
  id: string;       // notion_id or row id
  entity: string;   // e.g. 'matters', 'clients'
  label: string;    // display name for the tab
  entityLabel: string; // e.g. 'Matter', 'Client'
}

/** Map entity names to singular labels for tab display */
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

interface AdminTabsState {
  allTabs: DetailTab[];
  activeTabId: string | null;
  loadingTabs: Set<string>;
  getTabsForEntity: (entity: string) => DetailTab[];
  openTab: (tab: DetailTab) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string | null) => void;
  markTabLoaded: (tabId: string) => void;
}

const AdminTabsContext = createContext<AdminTabsState | null>(null);

export function AdminTabsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [allTabs, setAllTabs] = useState<DetailTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [loadingTabs, setLoadingTabs] = useState<Set<string>>(new Set());

  const getTabsForEntity = useCallback((entity: string) => {
    return allTabs.filter((t) => t.entity === entity);
  }, [allTabs]);

  const openTab = useCallback((tab: DetailTab) => {
    setAllTabs((prev) => {
      if (prev.some((t) => t.id === tab.id)) return prev;
      return [...prev, tab];
    });
    setActiveTabId(tab.id);
    setLoadingTabs((prev) => new Set(prev).add(tab.id));
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setAllTabs((prev) => prev.filter((t) => t.id !== tabId));
    setLoadingTabs((prev) => {
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
    setActiveTabId((current) => (current === tabId ? null : current));
  }, []);

  const setActive = useCallback((tabId: string | null) => {
    setActiveTabId(tabId);
  }, []);

  const markTabLoaded = useCallback((tabId: string) => {
    setLoadingTabs((prev) => {
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
  }, []);

  // Listen for postMessage from detail iframes requesting cross-entity navigation
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== 'admin-open-detail') return;

      const { entity, id, label } = e.data as { entity: string; id: string; label: string };
      if (!entity || !id) return;

      const tab: DetailTab = {
        id,
        entity,
        label,
        entityLabel: ENTITY_LABELS[entity] || entity,
      };

      // Add the tab
      setAllTabs((prev) => {
        if (prev.some((t) => t.id === id)) return prev;
        return [...prev, tab];
      });
      setActiveTabId(id);
      setLoadingTabs((prev) => new Set(prev).add(id));

      // Navigate to the entity page if not already there
      const targetPath = `/admin/${entity}`;
      if (!pathname.startsWith(targetPath)) {
        router.push(targetPath);
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [pathname, router]);

  return (
    <AdminTabsContext.Provider
      value={{ allTabs, activeTabId, loadingTabs, getTabsForEntity, openTab, closeTab, setActiveTab: setActive, markTabLoaded }}
    >
      {children}
    </AdminTabsContext.Provider>
  );
}

export function useAdminTabs() {
  const ctx = useContext(AdminTabsContext);
  if (!ctx) throw new Error('useAdminTabs must be used within AdminTabsProvider');
  return ctx;
}
