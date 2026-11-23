'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import { BrandWordmark } from '@/components/BrandMark';
import NotificationBell from '@/components/NotificationBell';
import { DetailPaneProvider } from '@/components/DetailPaneContext';
import DetailPane from '@/components/DetailPane';
import ChatProvider from './ChatProvider';
import ChatPanel from './ChatPanel';

export default function ChatLayoutShell({
  children,
  backHref,
}: {
  children: React.ReactNode;
  backHref: string;
}) {
  return (
    <DetailPaneProvider>
      <ChatProvider>
        <div className="min-h-screen bg-background flex flex-col">
          {/* Header */}
          <header className="bg-navy-900 dark:bg-[#141414] sticky top-0 z-30 border-b border-navy-800 dark:border-[rgba(255,255,255,0.06)]">
            <div className="h-14 flex items-center justify-between px-4 sm:px-6">
              <div className="flex items-center gap-3">
                <Link
                  href={backHref}
                  className="p-1.5 rounded-lg text-navy-400 dark:text-[#9B978F] hover:text-white hover:bg-navy-800 dark:hover:bg-[#232326] transition-colors duration-150"
                  aria-label="Go back"
                >
                  <ArrowLeft className="w-5 h-5" />
                </Link>
                <Link href={backHref} className="shrink-0">
                  <BrandWordmark />
                </Link>
                <span className="text-sm font-semibold text-white">Chat</span>
              </div>
              <div className="flex items-center gap-1.5">
                <NotificationBell />
                <ThemeToggle />
              </div>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 max-w-screen-2xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {children}
          </main>
        </div>
        <DetailPane />
        <ChatPanel chatBasePath="/chat" />
      </ChatProvider>
    </DetailPaneProvider>
  );
}
