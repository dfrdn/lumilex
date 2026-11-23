'use client';

import { useState, useRef } from 'react';
import CellDatePicker, { CellDateTrigger, type DateTriggerVariant } from '@/components/admin/CellDatePicker';

interface Props {
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  /** Adds a red border to indicate a validation error */
  hasError?: boolean;
  className?: string;
  /** When true, the trigger shows date + time and the popover has hour/minute inputs */
  showTime?: boolean;
  /** Which fields it sits beside (see DateTriggerVariant); `form`, the add dialogs' stone look, by default */
  variant?: DateTriggerVariant;
}

/**
 * Form date field: CellDateTrigger in the look of the fields beside it,
 * with the calendar positioned against it. Manages its own open/close state.
 */
export default function DatePickerInput({ value, onChange, placeholder, hasError, className, showTime, variant = 'form' }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className={className}>
      <CellDateTrigger
        ref={triggerRef}
        value={value}
        placeholder={placeholder ?? 'Select date'}
        showTime={showTime}
        onClick={() => setOpen((o) => !o)}
        variant={variant}
        active={open}
        hasError={hasError}
      />
      {open && (
        <CellDatePicker
          value={value}
          onSelect={(v) => {
            onChange(v);
            if (!showTime) setOpen(false);
          }}
          onClose={() => setOpen(false)}
          anchorRef={triggerRef as React.RefObject<HTMLElement | null>}
          showTime={showTime}
        />
      )}
    </div>
  );
}
