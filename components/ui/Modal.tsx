'use client';

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconChip } from './primitives';
import type { Accent } from './tone';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const WIDTH: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

/**
 * The one dialog frame: backdrop, card, title row, scrolling body, footer.
 * Escape and a backdrop click close it unless `dismissible` is false (while
 * a save is in flight). Clicks don't leak to the row or card that opened it.
 */
export default function Modal({
  open,
  onClose,
  title,
  description,
  icon,
  accent = 'navy',
  size = 'md',
  dismissible = true,
  showClose = true,
  initialFocusRef,
  footer,
  divider = true,
  bodyClassName = 'px-6 pb-5',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  /** The tint of the icon's tile. */
  accent?: Accent;
  size?: ModalSize;
  dismissible?: boolean;
  showClose?: boolean;
  /** Focused when the dialog opens; the dialog itself otherwise. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Right-aligned actions under the body. */
  footer?: React.ReactNode;
  /** A rule above the footer; off for a short question whose footer follows its text. */
  divider?: boolean;
  bodyClassName?: string;
  children?: React.ReactNode;
}) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    (initialFocusRef?.current ?? cardRef.current)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open || !dismissible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // A dialog opened from inside this one closes first, on its own.
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] === cardRef.current) closeRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissible]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-overlay" onClick={dismissible ? onClose : undefined} />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative w-full ${WIDTH[size]} max-h-[92vh] sm:max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card shadow-[var(--shadow-elevated)] animate-dialog outline-none`}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-3">
          <div className="flex items-start gap-2.5 min-w-0">
            {icon && (
              <span className="mt-0.5">
                <IconChip accent={accent}>{icon}</IconChip>
              </span>
            )}
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold text-stone-900 dark:text-stone-50">
                {title}
              </h2>
              {description && <p className="mt-2 text-sm text-stone-500 dark:text-stone-400 leading-relaxed">{description}</p>}
            </div>
          </div>
          {showClose && (
            <button
              type="button"
              onClick={onClose}
              disabled={!dismissible}
              aria-label="Close"
              className="-mr-1 p-1 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:hover:text-stone-200 dark:hover:bg-white/10 transition-colors disabled:opacity-40"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {children && <div className={`flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>}
        {footer && (
          <div
            className={`flex items-center justify-end gap-3 px-6 ${divider ? 'py-4 border-t border-stone-100 dark:border-white/[0.06]' : 'pt-4 pb-6'}`}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
