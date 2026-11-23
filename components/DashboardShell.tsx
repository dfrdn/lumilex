'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import { BrandWordmark } from '@/components/BrandMark';
import SearchBar from '@/components/SearchCommand';
import NotificationBell from '@/components/NotificationBell';
import ChatButton from '@/components/nav/ChatButton';
import AssistantLauncher from '@/components/assistant/AssistantLauncher';
import SidebarNav, { useNavIndicators, MenuWaitingDot } from '@/components/nav/SidebarNav';
import SidebarChoicesProvider from '@/components/nav/SidebarChoicesProvider';
import type { SavedSidebar } from '@/lib/nav/custom-sidebar';
import AvatarMenu from '@/components/nav/AvatarMenu';
import { useFeatures } from '@/components/FeatureProvider';

import type { UserRole } from '@/lib/queries/team';
import { formatDateCompact, formatWeekdayDate } from '@/lib/format-date';

interface Props {
  role?: UserRole;
  /** What the person pinned and hid; the area's layout reads it so the first paint is already theirs. */
  savedSidebar?: SavedSidebar;
  children: React.ReactNode;
}

function DashboardShellFrame({ role = 'lawyer', children }: Props) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const features = useFeatures();
  const indicators = useNavIndicators('dashboard');


  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    setSidebarOpen(mq.matches);
    const handler = (e: MediaQueryListEvent) => setSidebarOpen(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const [today, setToday] = useState('');
  const [todayShort, setTodayShort] = useState('');
  useEffect(() => {
    setToday(formatWeekdayDate(new Date()));
    setTodayShort(formatDateCompact(new Date()));
  }, []);


  function closeMobile() {
    if (window.innerWidth < 1024) setSidebarOpen(false);
  }

  return (
    <div className="min-h-screen bg-background relative z-[1]">
      {/* ── Header ─────────────────────────────────────────── */}
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
            <Link href="/dashboard" className="shrink-0">
              <BrandWordmark />
            </Link>
            <div className="hidden sm:block h-5 w-px bg-navy-700 dark:bg-[rgba(255,255,255,0.06)]" />
            <span className="hidden min-[400px]:inline sm:hidden text-xs text-navy-500 dark:text-[#9B978F] font-mono">{todayShort}</span>
            <span className="text-sm text-navy-400 dark:text-[#9B978F] hidden sm:block">
              {today}
            </span>
          </div>

          <SearchBar />

          <div className="flex items-center gap-1.5">
            <ChatButton />
            <NotificationBell />
            <ThemeToggle />
            <AvatarMenu area="dashboard" />
          </div>
        </div>
      </header>

      {/* ── Mobile backdrop ────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ────────────────────────────────────────── */}
      <aside
        className={`fixed top-14 left-0 bottom-0 z-20 bg-navy-900 dark:bg-[#141414] border-r border-navy-800 dark:border-[rgba(255,255,255,0.06)] flex flex-col transition-all duration-200 overflow-hidden ${
          sidebarOpen ? 'w-56' : 'w-0'
        }`}
      >
        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          <SidebarNav
            area="dashboard"
            role={role}
            indicators={indicators}
            onNavigate={closeMobile}
            more
          />
        </nav>
      </aside>

      {/* ── Main content ───────────────────────────────────── */}
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

      {/* Suppressed rather than disabled, like every other ungated surface: a
          firm without the assistant gets no launcher and no upsell. */}
      {features.ai_assistant && <AssistantLauncher />}
    </div>
  );
}

// Pages with their own standalone header.
const BARE_PATHS = [/^\/dashboard\/matters\/[^/]+\/exec-summary$/, /^\/dashboard\/deliverables\/by-status$/];

/** Rendered once by the segment layout, so it stays mounted across navigations. */
export default function DashboardShell(props: Props) {
  const pathname = usePathname();
  if (BARE_PATHS.some((re) => re.test(pathname))) return <>{props.children}</>;
  return (
    <SidebarChoicesProvider initial={props.savedSidebar}>
      <DashboardShellFrame {...props} />
    </SidebarChoicesProvider>
  );
}
