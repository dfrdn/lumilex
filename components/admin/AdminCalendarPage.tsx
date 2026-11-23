'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminTabs } from '@/components/admin/AdminTabsContext';
import FirmCalendarView from '@/components/calendar/FirmCalendarView';

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

export default function AdminCalendarPage() {
  const router = useRouter();
  const { openTab, setActiveTab } = useAdminTabs();

  const handleOpenEntity = useCallback((entity: string, id: string, name: string) => {
    const detailEntity = entity === 'filings' ? 'deliverables' : entity;
    openTab({
      id,
      entity: detailEntity,
      label: name,
      entityLabel: ENTITY_LABELS[entity] ?? entity,
    });
    setActiveTab(id);
    router.push(`/admin/${entity}`);
  }, [openTab, setActiveTab, router]);

  return <FirmCalendarView onOpenEntity={handleOpenEntity} />;
}
