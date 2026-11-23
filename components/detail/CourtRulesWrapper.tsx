'use client';

import { useState, useCallback } from 'react';
import SOLBanner from './SOLBanner';
import DeadlinesSection from './DeadlinesSection';
import DeadlineCalculatorModal from '@/components/legal/DeadlineCalculatorModal';
import SOLSetupModal from '@/components/legal/SOLSetupModal';

interface Props {
  matterId: string;
  matterType: string;
  canEdit: boolean;
}

export default function CourtRulesWrapper({ matterId, matterType, canEdit }: Props) {
  const [deadlineModalOpen, setDeadlineModalOpen] = useState(false);
  const [solModalOpen, setSOLModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <>
      <SOLBanner
        key={`sol-${refreshKey}`}
        matterId={matterId}
        canEdit={canEdit}
        onSetup={() => setSOLModalOpen(true)}
      />

      <DeadlinesSection
        key={`deadlines-${refreshKey}`}
        matterId={matterId}
        matterType={matterType}
        canEdit={canEdit}
        onApplyRules={() => setDeadlineModalOpen(true)}
      />

      <DeadlineCalculatorModal
        open={deadlineModalOpen}
        onClose={() => setDeadlineModalOpen(false)}
        matterId={matterId}
        matterType={matterType}
        onSuccess={handleRefresh}
      />

      <SOLSetupModal
        open={solModalOpen}
        onClose={() => setSOLModalOpen(false)}
        matterId={matterId}
        onSuccess={handleRefresh}
      />
    </>
  );
}
