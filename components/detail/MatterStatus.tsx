'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import CellDropdown from '@/components/admin/CellDropdown';
import { StatusPill } from '@/components/ui/primitives';
import { statusTone } from '@/lib/status-tone';
import { MATTER_STATUSES } from '@/lib/matter-status';

/*
 * A matter's status on its own page. Partners change it from the pill;
 * everyone else sees the pill. One state, so any pill under the provider
 * shows the same value.
 */

interface MatterStatusState {
  status: string;
  canEdit: boolean;
  setStatus: (next: string) => Promise<void>;
}

const MatterStatusContext = createContext<MatterStatusState | null>(null);

export function MatterStatusProvider({
  matterId,
  matterName,
  initialStatus,
  canEdit,
  children,
}: {
  matterId: string;
  matterName: string;
  initialStatus: string;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const [status, setLocal] = useState(initialStatus);

  const setStatus = useCallback(
    async (next: string) => {
      const previous = status;
      if (next === previous) return;
      setLocal(next);
      try {
        const res = await fetch(`/api/partner/matters/${encodeURIComponent(matterId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast.success(`${matterName || 'Matter'} marked ${next}`);
      } catch (err) {
        setLocal(previous);
        toast.error(`Couldn't change the status of ${matterName || 'this matter'}`);
        console.error('[matter-status] Failed to change status:', err);
      }
    },
    [status, matterId, matterName],
  );

  return (
    <MatterStatusContext.Provider value={{ status, canEdit, setStatus }}>{children}</MatterStatusContext.Provider>
  );
}

const OPTIONS = MATTER_STATUSES.map((s) => ({ id: s, label: s }));

export function MatterStatusPill({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const ctx = useContext(MatterStatusContext);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  if (!ctx) return null;
  const { status, canEdit, setStatus } = ctx;

  if (!canEdit) {
    return status ? <StatusPill label={status} tone={statusTone(status)} size={size} /> : null;
  }

  return (
    <>
      <StatusPill
        label={status || 'No status'}
        tone={statusTone(status)}
        size={size}
        hint="Change status"
        buttonRef={ref}
        onClick={() => setOpen((v) => !v)}
        trailing={<ChevronDown className="w-3 h-3 opacity-60" />}
      />
      {open && (
        <CellDropdown
          mode="single"
          options={OPTIONS}
          value={status || null}
          allowClear={false}
          onSelect={(id) => {
            setOpen(false);
            if (id) void setStatus(id);
          }}
          onClose={() => setOpen(false)}
          anchorRef={ref as React.RefObject<HTMLElement | null>}
        />
      )}
    </>
  );
}
