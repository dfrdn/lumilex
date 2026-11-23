'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** Tooltip body. */
  content: ReactNode;
  /** The element that triggers the tooltip on hover/focus. */
  children: ReactNode;
  /** Hover delay before showing (ms). Default 150. */
  delay?: number;
  /** Where the bubble sits. Default below the trigger. */
  side?: 'bottom' | 'right';
  /** Classes for the trigger wrapper, replacing the inline `cursor-help` default. */
  className?: string;
}

/**
 * Hover tooltip that escapes clipping ancestors by portaling its bubble into
 * document.body and positioning it relative to the trigger's bounding rect.
 *
 * Use this instead of a CSS-only `group-hover` tooltip whenever the trigger
 * lives inside a scrollable / `overflow-hidden` container (tables, popovers,
 * modals) where the bubble would otherwise be clipped.
 */
export default function HoverTooltip({ content, children, delay = 150, side = 'bottom', className }: Props) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bubble centered below the trigger, or vertically centered to its right.
  const updateCoords = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCoords(
      side === 'right'
        ? { left: rect.right + 8, top: rect.top + rect.height / 2 }
        : { left: rect.left + rect.width / 2, top: rect.bottom + 6 },
    );
  };

  const show = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => {
      updateCoords();
      setVisible(true);
    }, delay);
  };

  const hide = () => {
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    setVisible(false);
  };

  useEffect(() => {
    if (!visible) return;
    const onScroll = () => updateCoords();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [visible]);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={className ?? 'inline-flex items-center cursor-help'}
      >
        {children}
      </span>
      {visible && coords && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="tooltip"
              style={{
                position: 'fixed',
                left: coords.left,
                top: coords.top,
                transform: side === 'right' ? 'translateY(-50%)' : 'translateX(-50%)',
                pointerEvents: 'none',
                zIndex: 9999,
              }}
              className="px-2.5 py-1.5 max-w-xs text-[11px] leading-snug font-normal normal-case tracking-normal text-white bg-navy-800 dark:bg-stone-900 rounded-md shadow-lg animate-fade-in"
            >
              {content}
              {side === 'right' ? (
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 -translate-y-1/2 right-full w-0 h-0 border-t-4 border-b-4 border-r-4 border-t-transparent border-b-transparent border-r-navy-800 dark:border-r-stone-900"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 -translate-x-1/2 bottom-full w-0 h-0 border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-navy-800 dark:border-b-stone-900"
                />
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
