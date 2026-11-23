'use client';

import { useState, useRef } from 'react';
import CellDropdown, { CellDropdownTrigger } from '@/components/admin/CellDropdown';

interface Option { id: string; label: string }

/**
 * Thin single-select built on the CellDropdown primitive: a trigger button that
 * opens the anchored dropdown. The codebase's standard form select — use this
 * instead of re-implementing the open-state + anchorRef + label-lookup wiring.
 */
export default function SingleSelect({
  value, options, placeholder, onChange,
}: {
  value: string | null;
  options: Option[];
  placeholder: string;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const label = options.find((o) => o.id === value)?.label ?? value ?? placeholder;
  return (
    <>
      <div ref={ref}>
        <CellDropdownTrigger label={label} hasValue={!!value} onClick={() => setOpen(true)} />
      </div>
      {open && (
        <CellDropdown
          mode="single"
          value={value}
          options={options}
          anchorRef={ref}
          placeholder={placeholder}
          onSelect={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
