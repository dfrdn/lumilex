'use client';

import Link from 'next/link';
import { useDetailPane } from '@/components/DetailPaneContext';

const ROW = 'group flex w-full items-center gap-3 max-sm:flex-wrap max-sm:gap-y-1 py-2.5 px-1 text-left rounded-lg hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] transition-colors cursor-pointer';

/** A deadline opens in the side pane when it has a record the pane shows; otherwise it links to its case, company or mark. */
export default function DeadlineRow({
  href,
  pane,
  children,
}: {
  href: string;
  pane: { entity: string; id: string } | null;
  children: React.ReactNode;
}) {
  const { openPane } = useDetailPane();
  if (!pane) {
    return (
      <Link href={href} className={ROW}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => openPane(pane.entity, pane.id)} className={ROW}>
      {children}
    </button>
  );
}
