'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Bike } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import { BrandWordmark } from '@/components/BrandMark';
import NotificationBell from '@/components/NotificationBell';
import ChatButton from '@/components/nav/ChatButton';
import SidebarNav, { useNavIndicators, MenuWaitingDot } from '@/components/nav/SidebarNav';
import AvatarMenu from '@/components/nav/AvatarMenu';
import SidebarChoicesProvider from '@/components/nav/SidebarChoicesProvider';
import type { SavedSidebar } from '@/lib/nav/custom-sidebar';
import type { UserRole } from '@/lib/queries/team';
import { homeFor } from '@/lib/nav/access';
import { formatDateCompact, formatWeekdayDate } from '@/lib/format-date';

interface Props {
  role: UserRole;
  children: React.ReactNode;
  /** What the person pinned and hid; the area's layout reads it so the first paint is already theirs. */
  savedSidebar?: SavedSidebar;
}

export default function LiaisonShell({ role, children, savedSidebar }: Props) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const indicators = useNavIndicators('liaison');

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    setSidebarOpen(mq.matches);
    const handler = (e: MediaQueryListEvent) => setSidebarOpen(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const today = formatWeekdayDate(new Date());
  const todayShort = formatDateCompact(new Date());

  function closeMobile() {
    if (window.innerWidth < 1024) setSidebarOpen(false);
  }


  return (
    <SidebarChoicesProvider initial={savedSidebar}>
    <div className="min-h-screen bg-background relative z-[1]">
      {/* Header */}
      <header className="bg-navy-900 dark:bg-[#141414] sticky top-0 z-30 border-b border-navy-800 dark:border-[rgba(255,255,255,0.06)]">
        <div className="h-14 flex items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen((o) => !o)}
              className="relative p-1.5 rounded-lg text-navy-400 dark:text-[#5E5B55] hover:text-white hover:bg-navy-800 dark:hover:bg-[#232326] transition-colors duration-150"
              aria-label="Toggle sidebar"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              <MenuWaitingDot show={!sidebarOpen && indicators.anythingWaiting} />
            </button>
            <Link href={homeFor(role)} className="shrink-0 flex items-center gap-2.5">
              <BrandWordmark />
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] rounded-md bg-fuchsia-500/15 text-fuchsia-400 ring-1 ring-inset ring-fuchsia-500/25">
                <Bike className="w-3 h-3" />
                <span className="sr-only sm:not-sr-only">Liaison</span>
              </span>
            </Link>
            <div className="hidden sm:block h-5 w-px bg-navy-700 dark:bg-[rgba(255,255,255,0.06)]" />
            <span className="hidden min-[440px]:inline sm:hidden text-xs text-navy-500 font-mono">{todayShort}</span>
            <span className="text-sm text-navy-400 dark:text-[#9B978F] hidden sm:block">{today}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <ChatButton panel={false} />
            <NotificationBell />
            <ThemeToggle />
            <AvatarMenu area="liaison" />
          </div>
        </div>
      </header>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-14 left-0 bottom-0 z-20 bg-navy-900 dark:bg-[#141414] border-r border-navy-800 dark:border-[rgba(255,255,255,0.06)] flex flex-col transition-all duration-200 overflow-hidden ${
          sidebarOpen ? 'w-56' : 'w-0'
        }`}
      >
        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          <SidebarNav area="liaison" role={role} indicators={indicators} onNavigate={closeMobile} more />
        </nav>
      </aside>

      {/* Main content */}
      <main
        key={pathname}
        className={`transition-all duration-200 relative z-[1] animate-fade-in ${
          sidebarOpen ? 'lg:ml-56' : 'lg:ml-0'
        }`}
      >
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </div>
      </main>
    </div>
    </SidebarChoicesProvider>
  );
}
