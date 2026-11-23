'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { signOut } from '@/lib/supabase-browser';

const NAV = [
  { href: '/platform', label: 'Firms' },
  { href: '/platform/operators', label: 'Operators' },
];

/**
 * Chrome for the operator surface.
 *
 * Deliberately not one of the role shells: those are firm-scoped, mount
 * `FeatureProvider` and `BrandProvider` state that belongs to one tenant, and
 * paint that tenant's monogram and palette. An operator has no firm, so there
 * is no firm whose branding would be correct here — showing any would be
 * showing the wrong one. The mark is the platform's own name, in plain type.
 */
export default function PlatformHeader({ operatorLabel }: { operatorLabel: string }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b border-[var(--border-color)] bg-background/85 backdrop-blur">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6 min-w-0">
          <Link href="/platform" className="leading-tight shrink-0">
            <p className="font-serif text-base text-foreground tracking-tight">Lumilex</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-secondary)] mt-0.5">
              Platform operator
            </p>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => {
              const active =
                item.href === '/platform'
                  ? pathname === '/platform' || pathname.startsWith('/platform/firms')
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    active
                      ? 'bg-subtle text-foreground'
                      : 'text-[var(--text-secondary)] hover:text-foreground hover:bg-subtle'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-1">
          <span className="hidden sm:inline text-xs text-[var(--text-secondary)] mr-2">
            {operatorLabel}
          </span>
          <button
            onClick={() => signOut('/login')}
            className="flex items-center gap-2 text-xs text-[var(--text-secondary)] hover:text-foreground transition-colors px-3 py-2 rounded-lg hover:bg-subtle"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
