'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MessageSquare, X, Maximize2 } from 'lucide-react';
import AssistantPanel from './AssistantPanel';

/**
 * Global floating assistant. Mounted in DashboardShell so it's one click away on
 * every page; the expand button opens the full /dashboard/assistant page.
 * Open, the panel sits where the launcher was, above the QuickCreateFAB
 * (bottom-6 right-6), so the FAB never covers the composer's send button.
 */
export default function AssistantLauncher() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Lumilex Assistant"
        className="fixed bottom-[5.5rem] right-6 z-50 w-12 h-12 rounded-full bg-navy-900 dark:bg-gold-400 text-white dark:text-navy-950 shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
      >
        <MessageSquare className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-[5.5rem] right-6 z-50 w-[min(100vw-2rem,400px)] h-[min(100vh-7rem,640px)] rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-2xl flex flex-col overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] shrink-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <MessageSquare className="w-4 h-4 text-gold-500" />
          Lumilex Assistant
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/dashboard/assistant"
            onClick={() => setOpen(false)}
            title="Open full page"
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--background)] transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--background)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <AssistantPanel variant="panel" />
      </div>
    </div>
  );
}
