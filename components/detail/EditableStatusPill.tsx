'use client';

import { useState, useRef } from 'react';
import { Pencil, Check } from 'lucide-react';
import CellDropdown, { type DropdownOption } from '@/components/admin/CellDropdown';
import { useDeliverable } from './DeliverableShellProvider';
import { pickableStatusesForType } from '@/lib/deliverable-status';
import { PILL_TONE } from '@/components/ui/tone';
import { statusTone } from '@/lib/status-tone';

function statusOptions(type: string | null | undefined): DropdownOption[] {
  return pickableStatusesForType(type).map((s) => ({ id: s, label: s }));
}

function getStatusStyle(status: string): string {
  return PILL_TONE[statusTone(status)];
}

interface Props {
  canEdit: boolean;
}

export default function EditableStatusPill({ canEdit }: Props) {
  const { item, updateField, savedField } = useDeliverable();
  const [open, setOpen] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);

  const status = item.status;
  const saved = savedField === 'status';

  const handleSelect = async (id: string | null) => {
    setOpen(false);
    if (!id || id === status) return;
    await updateField('status', id);
  };

  if (!canEdit) {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border ${getStatusStyle(status)}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
        {status || 'Unknown'}
      </span>
    );
  }

  return (
    <>
      <button
        ref={pillRef}
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border transition-all hover:brightness-95 dark:hover:brightness-125 cursor-pointer group/status ${getStatusStyle(status)} ${saved ? 'animate-field-save' : ''}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
        {status || 'Unknown'}
        {saved ? (
          <Check className="w-3 h-3 ml-0.5" />
        ) : (
          <Pencil className="w-3 h-3 ml-0.5 opacity-0 group-hover/status:opacity-60 transition-opacity" />
        )}
      </button>
      {open && pillRef.current && (
        <CellDropdown
          mode="single"
          options={statusOptions(item.type)}
          value={status}
          onSelect={handleSelect}
          onClose={() => setOpen(false)}
          anchorRef={pillRef as React.RefObject<HTMLElement | null>}
        />
      )}
    </>
  );
}
