'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { CARD } from '@/components/ui/tone';

interface Props {
  id?: string;
  title: string;
  icon: React.ReactNode;
  count?: number;
  /** Controls on the right of the header, such as a view switch. Clicking them doesn't fold the card. */
  actions?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}

export default function SectionCard({
  id,
  title,
  icon,
  count,
  actions,
  collapsible = false,
  defaultOpen = true,
  className = '',
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  // Auto-open when the URL hash matches this section's id, and bring it into
  // view: the browser's own jump to the anchor lands short while it unfolds.
  const checkHash = useCallback(() => {
    if (!id || !collapsible) return;
    const hash = window.location.hash.replace('#', '');
    if (hash !== id) return;
    setOpen(true);
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
  }, [id, collapsible]);

  useEffect(() => {
    checkHash();
    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  }, [checkHash]);

  return (
    <section id={id} className={`${CARD} overflow-hidden scroll-mt-[72px] animate-fade-up ${className}`}>
      <div
        className={`flex items-center justify-between gap-3 max-sm:flex-wrap max-sm:gap-y-2 px-5 py-3.5 ${collapsible ? 'cursor-pointer select-none' : ''}`}
        onClick={collapsible ? () => setOpen((o) => !o) : undefined}
      >
        <h2 className="inline-flex items-center gap-2.5 text-[15px] font-semibold text-stone-800 dark:text-stone-100">
          <span className="text-stone-400 dark:text-stone-500 [&_svg]:w-[18px] [&_svg]:h-[18px]">{icon}</span>
          {title}
          {count !== undefined && (
            <span className="inline-flex items-center px-1.5 py-px rounded-full bg-stone-100 dark:bg-white/[0.08] text-[11px] font-medium text-stone-600 dark:text-stone-300 tabular-nums">
              {count}
            </span>
          )}
        </h2>
        {actions && (
          <div className="ml-auto flex items-center gap-2 max-sm:flex-wrap max-sm:justify-end max-w-full" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
        {collapsible && (
          <ChevronDown
            className={`w-4 h-4 text-stone-400 dark:text-stone-500 transition-transform duration-250 ease-out ${open ? 'rotate-0' : '-rotate-90'}`}
          />
        )}
      </div>

      {/* Smooth collapse with CSS grid trick */}
      {collapsible ? (
        <div className="collapse-grid" data-open={open}>
          <div className="collapse-inner">
            <div className="px-5 pb-4">{children}</div>
          </div>
        </div>
      ) : (
        <div className="px-5 pb-4">{children}</div>
      )}
    </section>
  );
}
