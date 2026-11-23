'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Wallet } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import { BrandWordmark } from '@/components/BrandMark';
import SearchBar from '@/components/SearchCommand';
import NotificationBell from '@/components/NotificationBell';
import ChatButton from '@/components/nav/ChatButton';
import SidebarNav, { useNavIndicators, MenuWaitingDot } from '@/components/nav/SidebarNav';
import SidebarChoicesProvider from '@/components/nav/SidebarChoicesProvider';
import type { SavedSidebar } from '@/lib/nav/custom-sidebar';
import AvatarMenu from '@/components/nav/AvatarMenu';
import type { UserRole } from '@/lib/queries/team';
import { formatDateCompact, formatWeekdayDate } from '@/lib/format-date';

interface Props {
  role: UserRole;
  /** What the person pinned and hid; the area's layout reads it so the first paint is already theirs. */
  savedSidebar?: SavedSidebar;
  children: React.ReactNode;
}

function FinanceShellFrame({ role, children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const indicators = useNavIndicators('finance');

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- matchMedia is only readable after mount
    setSidebarOpen(mq.matches);
    const handler = (e: MediaQueryListEvent) => setSidebarOpen(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const [today, setToday] = useState('');
  const [todayShort, setTodayShort] = useState('');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the date is set after mount so server and client markup match
    setToday(formatWeekdayDate(new Date()));
    setTodayShort(formatDateCompact(new Date()));
  }, []);

  function closeMobile() {
    if (window.innerWidth < 1024) setSidebarOpen(false);
  }

  return (
    <div className="min-h-screen bg-background relative z-[1]">
      {/* Header */}
      <header className="bg-navy-900 dark:bg-[#141414] sticky top-0 z-30 border-b border-navy-800 dark:border-[rgba(255,255,255,0.06)]">
        <div className="h-14 flex items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen((o) => !o)}
              className="relative p-1.5 rounded-lg text-navy-400 dark:text-[#9B978F] hover:text-white hover:bg-navy-800 dark:hover:bg-[#232326] transition-colors duration-150"
              aria-label="Toggle sidebar"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              <MenuWaitingDot show={!sidebarOpen && indicators.anythingWaiting} />
            </button>
            <Link href="/finance" className="shrink-0 flex items-center gap-2.5">
              <BrandWordmark />
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] rounded-md bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/25">
                <Wallet className="w-3 h-3" />
                <span className="sr-only sm:not-sr-only">Finance</span>
              </span>
            </Link>
            <div className="hidden sm:block h-5 w-px bg-navy-700 dark:bg-[rgba(255,255,255,0.06)]" />
            <span className="hidden min-[440px]:inline sm:hidden text-xs text-navy-500 font-mono">{todayShort}</span>
            <span className="text-sm text-navy-400 dark:text-[#9B978F] hidden sm:block">{today}</span>
          </div>

          <SearchBar />

          <div className="flex items-center gap-1.5">
            <ChatButton />
            <NotificationBell />
            <ThemeToggle />
            <AvatarMenu area="finance" />
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
          <SidebarNav area="finance" role={role} indicators={indicators} onNavigate={closeMobile} more />
        </nav>

      </aside>

      {/* Main content */}
      <main className={`transition-all duration-200 relative z-[1] ${sidebarOpen ? 'lg:ml-56' : 'lg:ml-0'}`}>
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}

// The printable statement has no app chrome; /finance/generate only redirects.
const BARE_PATHS = [/^\/finance\/clients\/[^/]+\/statement$/];

/** Rendered once by the segment layout, so it stays mounted across navigations. */
export default function FinanceShell(props: Props) {
  const pathname = usePathname();
  if (BARE_PATHS.some((re) => re.test(pathname))) return <>{props.children}</>;
  return (
    <SidebarChoicesProvider initial={props.savedSidebar}>
      <FinanceShellFrame {...props} />
    </SidebarChoicesProvider>
  );
}
