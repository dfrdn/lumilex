'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import { useDetailPane } from './DetailPaneContext';
import { PILL_TONE } from '@/components/ui/tone';
import { statusTone } from '@/lib/status-tone';

interface Props {
  /** Destination URL — used when no `openPane` is provided, or as the fallback for external URLs. */
  href: string;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  /** Always-visible metadata (dates, file preview icons) */
  meta?: ReactNode;
  /** Always-visible action element (typically a kebab menu) */
  right?: ReactNode;
  /** Element rendered before the title (e.g. a checkbox). Clicks inside it should manage their own stop-propagation. */
  leading?: ReactNode;
  /** When provided, clicking the row opens the detail pane instead of navigating. */
  openPane?: { entity: string; id: string };
  /** Let a long title run to two lines instead of cutting it off. */
  wrapTitle?: boolean;
}


export default function ItemRow({ href, title, subtitle, badge, meta, right, leading, openPane, wrapTitle = false }: Props) {
  const badgeClass = badge ? PILL_TONE[statusTone(badge)] : '';
  const isInternal = href.startsWith('/');
  const { openPane: openPaneFn } = useDetailPane();

  const content = (
    <>
      {leading && (
        <div className="mr-3 shrink-0 self-center max-sm:self-start max-sm:mt-0.5 flex items-center" onClick={(e) => e.stopPropagation()}>
          {leading}
        </div>
      )}
      <div className="flex-1 min-w-0 text-left max-sm:basis-[calc(100%-2rem)]">
        <p className={`text-sm font-medium text-foreground group-hover:text-navy-800 dark:group-hover:text-navy-200 ${wrapTitle ? 'sm:line-clamp-2' : 'sm:truncate'} max-sm:break-words transition-colors duration-150`}>
          {title || '(Untitled)'}
        </p>
        {subtitle && (
          <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">{subtitle}</p>
        )}
      </div>
      <div className={`flex items-center gap-2.5 ml-4 shrink-0 max-sm:ml-0 max-sm:mt-1.5 max-sm:basis-full max-sm:flex-wrap max-sm:gap-y-1.5 max-sm:empty:hidden ${leading ? 'max-sm:pl-7' : ''}`}>
        {badge && (
          <span className={`text-[11px] rounded-full px-2 py-0.5 font-medium whitespace-nowrap border ${badgeClass}`}>
            {badge}
          </span>
        )}
        {meta}
        {right && (
          <div className="max-sm:ml-auto" onClick={(e) => e.stopPropagation()}>
            {right}
          </div>
        )}
      </div>
    </>
  );

  const cls = "relative flex items-start justify-between max-sm:flex-wrap py-2.5 px-2.5 hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] rounded-lg transition-all duration-150 group hover:translate-x-0.5";

  // When openPane is provided, render a clickable div so nested action buttons
  // stay valid HTML. role="button" + keyboard handlers preserve accessibility.
  if (openPane) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => openPaneFn(openPane.entity, openPane.id)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          if (e.currentTarget !== e.target) return;
          e.preventDefault();
          openPaneFn(openPane.entity, openPane.id);
        }}
        className={`${cls} w-full text-left cursor-pointer`}
      >
        {content}
      </div>
    );
  }

  if (isInternal) {
    return (
      <Link href={href} className={cls}>
        {content}
      </Link>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cls}
    >
      {content}
    </a>
  );
}
