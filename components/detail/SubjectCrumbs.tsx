import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

/**
 * Where something sits: its list, its client or the record it hangs off (a
 * hearing's matter), then itself — so the page is never a dead end.
 */
export default function SubjectCrumbs({
  list,
  client,
  parent,
  current,
}: {
  list: { label: string; href: string; icon?: React.ReactNode };
  client?: { id: string; name: string } | null;
  parent?: { label: string; href: string } | null;
  current: string;
}) {
  const link =
    'inline-flex items-center gap-1.5 px-1.5 py-1 -mx-0.5 rounded-md text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-white/[0.06] transition-colors truncate';
  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 text-[12.5px] min-w-0">
      <Link href={list.href} className={`${link} shrink-0 font-medium`}>
        {list.icon}
        {list.label}
      </Link>
      {client && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-stone-300 dark:text-stone-600 shrink-0" />
          <Link href={`/dashboard/clients/${client.id}`} className={`${link} max-w-[14rem]`} title={client.name}>
            {client.name}
          </Link>
        </>
      )}
      {parent && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-stone-300 dark:text-stone-600 shrink-0" />
          <Link href={parent.href} className={`${link} max-w-[16rem]`} title={parent.label}>
            {parent.label}
          </Link>
        </>
      )}
      <ChevronRight className="w-3.5 h-3.5 text-stone-300 dark:text-stone-600 shrink-0" />
      <span className="px-1.5 py-1 text-stone-800 dark:text-stone-200 font-medium truncate" aria-current="page" title={current}>
        {current}
      </span>
    </nav>
  );
}
