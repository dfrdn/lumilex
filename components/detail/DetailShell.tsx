import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';

export interface Breadcrumb {
  label: string;
  href: string;
}

interface Props {
  title: string;
  icon: React.ReactNode;
  /** What the page is — "Matter", "Deliverable" — shown above the title. */
  entityType: string;
  breadcrumbs?: Breadcrumb[];
  children: React.ReactNode;
  /** Optional client-rendered title override (e.g. inline-editable title) */
  titleNode?: React.ReactNode;
}

const CRUMB =
  'inline-flex items-center gap-1.5 px-1.5 py-1 -mx-0.5 rounded-md text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-white/[0.06] transition-colors truncate';

export default function DetailShell({ title, icon, entityType, breadcrumbs, children, titleNode }: Props) {
  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 text-[12.5px] min-w-0">
        <Link href="/dashboard" className={`${CRUMB} shrink-0 font-medium`} title="Dashboard">
          <Home className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Dashboard</span>
        </Link>
        {breadcrumbs?.map((crumb) => (
          <span key={crumb.href} className="flex items-center gap-1 min-w-0">
            <ChevronRight className="w-3.5 h-3.5 text-stone-300 dark:text-stone-600 shrink-0" />
            <Link href={crumb.href} className={`${CRUMB} max-w-[14rem]`} title={crumb.label}>
              {crumb.label}
            </Link>
          </span>
        ))}
        <ChevronRight className="w-3.5 h-3.5 text-stone-300 dark:text-stone-600 shrink-0" />
        <span className="px-1.5 py-1 text-stone-800 dark:text-stone-200 font-medium truncate" aria-current="page" title={title}>
          {title}
        </span>
      </nav>

      <div className="flex items-center gap-3.5 mb-6">
        <span className="w-11 h-11 rounded-xl bg-white dark:bg-card border border-stone-200 dark:border-white/10 text-stone-500 dark:text-stone-400 flex items-center justify-center shrink-0 [&_svg]:w-5 [&_svg]:h-5">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">{entityType}</p>
          {titleNode ?? <h1 className="font-serif text-2xl text-stone-900 dark:text-stone-50 tracking-tight">{title}</h1>}
        </div>
      </div>

      {children}
    </div>
  );
}
