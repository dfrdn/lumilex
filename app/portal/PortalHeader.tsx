'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { signOut } from '@/lib/supabase-browser';
import PortalThemeToggle from './PortalThemeToggle';
import { BrandMonogram } from '@/components/BrandMark';
import { useBrand } from '@/components/BrandProvider';

interface Props {
  clientName: string;
  /** Link prefix for the logo + nav — `/portal` live, the preview root in preview. */
  basePath?: string;
  /** Live shows a sign-out button; the preview hides it (it has its own "Exit preview"). */
  showSignOut?: boolean;
  /** Live header sticks itself; the preview wraps it in a sticky banner+header stack. */
  sticky?: boolean;
  /** Which kinds of subject the client has shown in the portal — each gets a nav link. */
  subjects?: { companies: boolean; trademarks: boolean };
}

export default function PortalHeader({
  clientName,
  basePath = '/portal',
  showSignOut = true,
  sticky = true,
  subjects = { companies: false, trademarks: false },
}: Props) {
  const pathname = usePathname();
  const brand = useBrand();
  const firmName = brand.fullName || brand.shortName;

  // A section shows only when the client has something in it.
  const nav = [
    { label: 'Matters', href: basePath, exact: false },
    ...(subjects.companies ? [{ label: 'Companies', href: `${basePath}/companies`, exact: false }] : []),
    ...(subjects.trademarks ? [{ label: 'Trademarks', href: `${basePath}/trademarks`, exact: false }] : []),
    { label: 'Billing', href: `${basePath}/billing`, exact: true },
  ];

  function isActive(item: (typeof nav)[number]): boolean {
    if (item.exact) return pathname === item.href;
    if (item.href === basePath) {
      // Matters covers the landing page and matter detail pages.
      return pathname === basePath || pathname.startsWith(`${basePath}/matters`);
    }
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  return (
    <header
      className={`${sticky ? 'sticky top-0' : ''} z-10 border-b border-gold-200/40 dark:border-gold-400/15 bg-background/85 backdrop-blur`}
    >
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href={basePath} className="flex items-center gap-3 group">
          <BrandMonogram className="w-10 h-10 rounded-lg ring-1 ring-gold-200/40 dark:ring-gold-400/20 group-hover:ring-gold-400/60 transition-all" />
          <div className="leading-tight">
            <p className="font-serif text-base text-foreground tracking-tight">{firmName}</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-gold-700 dark:text-gold-400 mt-0.5">
              Client Portal · <span className="text-[var(--text-secondary)] font-normal tracking-wider normal-case">{clientName}</span>
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-1">
          <nav className="flex items-center gap-1 mr-2">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive(item)
                    ? 'text-gold-700 dark:text-gold-400 bg-gold-50 dark:bg-gold-400/10'
                    : 'text-[var(--text-secondary)] hover:text-foreground hover:bg-subtle'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <PortalThemeToggle />
          {showSignOut && (
            <button
              onClick={() => signOut('/portal/login')}
              className="flex items-center gap-2 text-xs text-[var(--text-secondary)] hover:text-foreground transition-colors px-3 py-2 rounded-lg hover:bg-subtle"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
