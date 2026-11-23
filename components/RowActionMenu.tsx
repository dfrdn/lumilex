'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, MoreHorizontal, type LucideIcon } from 'lucide-react';

export interface ActionMenuItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'warning' | 'danger';
  disabled?: boolean;
  /** Top border above this item to visually separate groups */
  divider?: boolean;
  /** Small pill rendered to the right of the label (e.g. "alpha", "new") */
  badge?: string;
}

interface Props {
  items: ActionMenuItem[];
  /** aria-label for the trigger button */
  label?: string;
  /** Trigger size — default is the row-row scale */
  compact?: boolean;
  /** A text trigger ("Requests") in place of the ⋯ icon, for a toolbar. */
  triggerLabel?: string;
  triggerIcon?: LucideIcon;
}

const VARIANT_TEXT: Record<NonNullable<ActionMenuItem['variant']>, string> = {
  default: 'text-foreground',
  primary: 'text-emerald-700 dark:text-emerald-400',
  warning: 'text-gold-700 dark:text-gold-400',
  danger: 'text-red-600 dark:text-red-400',
};

const VARIANT_HOVER: Record<NonNullable<ActionMenuItem['variant']>, string> = {
  default: 'hover:bg-[var(--subtle-bg)]',
  primary: 'hover:bg-emerald-50 dark:hover:bg-emerald-500/10',
  warning: 'hover:bg-gold-50 dark:hover:bg-gold-500/10',
  danger: 'hover:bg-red-50 dark:hover:bg-red-950/20',
};

export default function RowActionMenu({ items, label = 'Actions', compact = true, triggerLabel, triggerIcon: TriggerIcon }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewH = window.innerHeight;
    const spaceBelow = viewH - rect.bottom;
    // Phone rows are taller: see the item padding below.
    const estHeight = Math.min(items.length * (window.innerWidth < 640 ? 38 : 34) + 16, 320);
    const top = spaceBelow > estHeight + 8
      ? rect.bottom + 4
      : Math.max(8, rect.top - estHeight - 4);
    const right = Math.max(8, window.innerWidth - rect.right);
    setPosition({ top, right });
  }, [items.length]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onReposition = () => updatePosition();
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  const triggerSize = compact ? 'w-6 h-6 max-sm:w-9 max-sm:h-9' : 'w-7 h-7 max-sm:w-9 max-sm:h-9';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className={`action-lift inline-flex items-center justify-center ${
          triggerLabel ? 'gap-1.5 px-3.5 py-1.5 max-sm:px-2.5 max-sm:min-h-9 whitespace-nowrap text-xs font-semibold rounded-lg text-[var(--text-secondary)] bg-[var(--card-bg)]' : `${triggerSize} rounded-md text-[var(--text-muted)]`
        } border cursor-pointer transition-colors ${open
          ? 'bg-gold-50 dark:bg-gold-500/10 border-gold-300 dark:border-gold-500/30 text-foreground'
          : 'border-[var(--border-color)] hover:text-foreground hover:bg-gold-50/50 dark:hover:bg-gold-500/5 hover:border-gold-300 dark:hover:border-gold-500/30'}`}
      >
        {triggerLabel ? (
          <>
            {TriggerIcon && <TriggerIcon className="w-3.5 h-3.5" />}
            {triggerLabel}
            <ChevronDown className="w-3 h-3" />
          </>
        ) : (
          <MoreHorizontal className="w-3.5 h-3.5" />
        )}
      </button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="fixed z-[9999] min-w-[180px] bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden py-1 animate-in fade-in slide-in-from-top-1 duration-150"
          style={{
            top: position.top,
            right: position.right,
            boxShadow: '0 8px 30px -4px rgba(120,100,70,0.15), 0 4px 10px -4px rgba(120,100,70,0.08)',
          }}
        >
          {items.map((item) => {
            const v = item.variant ?? 'default';
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (item.disabled) return;
                  setOpen(false);
                  item.onClick();
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 max-sm:py-2 text-left text-sm transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_TEXT[v]} ${item.disabled ? '' : VARIANT_HOVER[v]} ${item.divider ? 'border-t border-[var(--border-color)] mt-1 pt-2' : ''}`}
              >
                {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge && (
                  <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wider bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300 shrink-0">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
