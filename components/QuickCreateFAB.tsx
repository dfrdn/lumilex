'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, Clock, CheckSquare, Handshake, Gavel, FileText } from 'lucide-react';
import { useSession } from '@/components/SessionProvider';
import dynamic from 'next/dynamic';
import type { DTRPrefill } from './AddDTRModal';
import type { MeetingPrefill } from './AddMeetingModal';

// Closed until picked from the menu, so they load after the page instead of in its first bundle.
const AddDTRModal = dynamic(() => import('./AddDTRModal'), { ssr: false });
const AddTaskModal = dynamic(() => import('./AddTaskModal'), { ssr: false });
const AddMeetingModal = dynamic(() => import('./AddMeetingModal'), { ssr: false });
const AddHearingModal = dynamic(() => import('./AddHearingModal'), { ssr: false });
const AddDeliverableModal = dynamic(() => import('./AddDeliverableModal'), { ssr: false });

const QUICK_ENTITIES = [
  { key: 'dtr',          label: 'DTR Entry',    icon: Clock,       color: 'text-gold-500 dark:text-gold-400',         bg: 'bg-gold-50 dark:bg-gold-500/10' },
  { key: 'task',         label: 'Task',         icon: CheckSquare, color: 'text-blue-500 dark:text-blue-400',         bg: 'bg-blue-50 dark:bg-blue-500/10' },
  { key: 'meeting',      label: 'Meeting',      icon: Handshake,   color: 'text-cyan-500 dark:text-cyan-400',         bg: 'bg-cyan-50 dark:bg-cyan-500/10' },
  { key: 'hearing',      label: 'Hearing',      icon: Gavel,       color: 'text-emerald-500 dark:text-emerald-400',   bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
  { key: 'deliverable',  label: 'Deliverable',  icon: FileText,    color: 'text-purple-500 dark:text-purple-400',     bg: 'bg-purple-50 dark:bg-purple-500/10' },
] as const;

export default function QuickCreateFAB() {
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const notionUserId = session?.user?.notionUserId ?? null;

  // Close popover on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [menuOpen]);

  // Close on Escape
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [menuOpen]);

  const handleSelect = (key: string) => {
    setActiveModal(key);
    setMenuOpen(false);
  };

  // Default DTR prefill
  const dtrPrefill: DTRPrefill = {
    remarks: '',
    task: 'Study',
    date: new Date().toLocaleDateString('en-CA'),
    hours: 1,
    minutes: 0,
    withIds: [],
    matterId: null,
    matterName: '',
  };

  // Default Meeting prefill
  const meetingPrefill: MeetingPrefill = {
    name: '',
    matterId: null,
    matterName: '',
    type: 'Internal Discussion',
    date: '',
    attendeeIds: [],
  };

  return (
    <>
      {/* FAB Button + Menu */}
      <div ref={popoverRef} className="fixed bottom-6 right-6 z-50">
        {/* Popover menu */}
        {menuOpen && (
          <div className="absolute bottom-full mb-3 right-0 flex flex-col items-end gap-3">
            {QUICK_ENTITIES.map(({ key, label, icon: Icon, color, bg }, i) => (
              <button
                key={key}
                onClick={() => handleSelect(key)}
                className="group flex items-center gap-3 cursor-pointer animate-fab-dial-in"
                style={{ animationDelay: `${(QUICK_ENTITIES.length - 1 - i) * 40}ms` }}
              >
                <span className="px-2.5 py-1 bg-stone-800 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap shadow-md pointer-events-none">
                  {label}
                </span>
                <span className={`w-10 h-10 rounded-full ${bg} border border-stone-200 shadow-md flex items-center justify-center shrink-0 transition-transform duration-150 group-hover:scale-110 dark:border-stone-700`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Main FAB button */}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 cursor-pointer ${
            menuOpen
              ? 'bg-stone-800 shadow-stone-900/20 rotate-45'
              : 'bg-gold-600 hover:bg-gold-700 shadow-gold-600/30 hover:shadow-gold-600/40'
          }`}
          aria-label="Quick create"
        >
          <Plus className={`w-5 h-5 transition-transform duration-200 ${menuOpen ? 'text-white' : 'text-white'}`} />
        </button>
      </div>

      {/* Modals */}
      <AddDTRModal
        open={activeModal === 'dtr'}
        onClose={() => setActiveModal(null)}
        prefill={dtrPrefill}
        excludeUserId={notionUserId}
      />
      <AddTaskModal
        open={activeModal === 'task'}
        onClose={() => setActiveModal(null)}
        defaultAssigneeId={notionUserId}
      />
      <AddMeetingModal
        open={activeModal === 'meeting'}
        onClose={() => setActiveModal(null)}
        prefill={meetingPrefill}
      />
      <AddHearingModal
        open={activeModal === 'hearing'}
        onClose={() => setActiveModal(null)}
      />
      <AddDeliverableModal
        open={activeModal === 'deliverable'}
        onClose={() => setActiveModal(null)}
        defaultDrafterId={notionUserId}
      />
    </>
  );
}
