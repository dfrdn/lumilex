'use client';

import { useState, useRef } from 'react';
import { Pencil, Check, Tag } from 'lucide-react';
import CellDropdown, { type DropdownOption } from '@/components/admin/CellDropdown';
import { useEnumValues } from '@/hooks/use-enum-options';
import { useDeliverable } from './DeliverableShellProvider';

interface Props {
  canEdit: boolean;
}

// Pleading-type (subtype) pill. Options come from the admin-managed
// enum_options group `deliverables.subtype` so they stay in sync with
// /admin/settings/enums. Mirrors EditableStatusPill's edit pattern.
export default function EditableSubtypePill({ canEdit }: Props) {
  const { item, updateField, savedField } = useDeliverable();
  const options = useEnumValues('deliverables', 'subtype');
  const [open, setOpen] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);

  const subtype = item.subtype ?? '';
  const saved = savedField === 'subtype';

  const handleSelect = async (id: string | null) => {
    setOpen(false);
    if (!id || id === subtype) return;
    await updateField('subtype', id);
  };

  // Nothing to show for viewers when no subtype is set.
  if (!subtype && !canEdit) return null;

  const pillClass =
    'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] bg-[var(--bg-secondary)] rounded-full ring-1 ring-inset ring-[var(--border-light)]';

  if (!canEdit) {
    return (
      <span className={pillClass}>
        <Tag className="w-3 h-3 opacity-60" />
        {subtype}
      </span>
    );
  }

  const dropdownOptions: DropdownOption[] = options.map((o) => ({ id: o, label: o }));

  return (
    <>
      <button
        ref={pillRef}
        onClick={() => setOpen(true)}
        className={`${pillClass} transition-all hover:ring-2 hover:shadow-sm cursor-pointer group/subtype ${saved ? 'animate-field-save' : ''}`}
      >
        <Tag className="w-3 h-3 opacity-60" />
        {subtype || 'Set type'}
        {saved ? (
          <Check className="w-3 h-3 ml-0.5" />
        ) : (
          <Pencil className="w-3 h-3 ml-0.5 opacity-0 group-hover/subtype:opacity-60 transition-opacity" />
        )}
      </button>
      {open && pillRef.current && (
        <CellDropdown
          mode="single"
          options={dropdownOptions}
          value={subtype}
          onSelect={handleSelect}
          onClose={() => setOpen(false)}
          anchorRef={pillRef as React.RefObject<HTMLElement | null>}
        />
      )}
    </>
  );
}
