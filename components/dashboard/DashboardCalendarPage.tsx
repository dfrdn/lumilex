'use client';

import { useCallback } from 'react';
import { useDetailPane } from '@/components/DetailPaneContext';
import FirmCalendarView from '@/components/calendar/FirmCalendarView';

export default function DashboardCalendarPage({ tabs }: { tabs?: React.ReactNode }) {
  const { openPane } = useDetailPane();

  const handleOpenEntity = useCallback((entity: string, id: string, _name: string) => {
    const detailEntity = entity === 'filings' ? 'deliverables' : entity;
    openPane(detailEntity, id);
  }, [openPane]);

  return <FirmCalendarView onOpenEntity={handleOpenEntity} tabs={tabs} />;
}
