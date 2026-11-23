'use client';

import { Pencil, Loader2, Check, X } from 'lucide-react';

/**
 * Shared hover-edit wrapper. Mirrors the pattern in DeliverableDetailClient:
 * on hover of an editable field, a subtle blue highlight + a pencil icon
 * appear. Clicking anywhere inside the wrapper calls `onEdit(field, el)` so
 * the parent can open a popover (CellDropdown / CellDatePicker / inline input)
 * anchored to this element.
 *
 * The component also renders small status glyphs in the top-right corner
 * while saving / just-saved / failed, matching the deliverable flow.
 */
export default function EditableField({
  field,
  editable,
  saving,
  savedField,
  errorField,
  onEdit,
  fieldRef,
  children,
  className,
}: {
  field: string;
  editable: boolean;
  saving: string | null;
  savedField: string | null;
  errorField: string | null;
  onEdit: (field: string, el: HTMLDivElement) => void;
  fieldRef?: (el: HTMLDivElement | null) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const isSaving = saving === field;
  const isSaved = savedField === field;
  const isError = errorField === field;

  return (
    <div
      ref={fieldRef}
      onClick={(e) => {
        if (!editable || isSaving) return;
        onEdit(field, e.currentTarget);
      }}
      className={`relative group/field rounded-lg transition-all duration-200 ${
        editable
          ? 'cursor-pointer hover:bg-stone-100/70 dark:hover:bg-white/[0.04] hover:ring-1 hover:ring-stone-200 dark:hover:ring-white/10'
          : ''
      } ${isSaved ? 'animate-field-save' : ''} ${isError ? 'animate-field-error' : ''} ${className ?? ''}`}
    >
      {children}
      {editable && !isSaving && (
        <span className="absolute top-1.5 right-1.5 opacity-0 group-hover/field:opacity-100 transition-opacity">
          <Pencil className="w-3 h-3 text-stone-400" />
        </span>
      )}
      {isSaving && (
        <span className="absolute top-1.5 right-1.5">
          <Loader2 className="w-3 h-3 text-stone-400 animate-spin" />
        </span>
      )}
      {isSaved && (
        <span className="absolute top-1.5 right-1.5">
          <Check className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
        </span>
      )}
      {isError && (
        <span className="absolute top-1.5 right-1.5">
          <X className="w-3 h-3 text-red-500 dark:text-red-400" />
        </span>
      )}
    </div>
  );
}
