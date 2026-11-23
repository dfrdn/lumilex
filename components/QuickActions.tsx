'use client';

import { useState } from 'react';
import { Calendar, Receipt, MessageSquare, Send } from 'lucide-react';
import RowActionMenu from './RowActionMenu';
import FileLeaveModal from './FileLeaveModal';
import FileReimbursementModal from './FileReimbursementModal';
import SubmitFeedbackModal from './SubmitFeedbackModal';

/** `menu` folds the three into one Requests menu, for a toolbar where they'd crowd the work. */
export default function QuickActions({ variant = 'buttons' }: { variant?: 'buttons' | 'menu' }) {
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [reimbOpen, setReimbOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const modals = (
    <>
      <FileLeaveModal open={leaveOpen} onClose={() => setLeaveOpen(false)} />
      <FileReimbursementModal open={reimbOpen} onClose={() => setReimbOpen(false)} />
      <SubmitFeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </>
  );

  if (variant === 'menu') {
    return (
      <>
        <RowActionMenu
          label="File a request"
          triggerLabel="Requests"
          triggerIcon={Send}
          items={[
            { label: 'File leave', icon: Calendar, onClick: () => setLeaveOpen(true) },
            { label: 'File reimbursement', icon: Receipt, onClick: () => setReimbOpen(true) },
            { label: 'Submit feedback', icon: MessageSquare, onClick: () => setFeedbackOpen(true) },
          ]}
        />
        {modals}
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2.5 flex-wrap">
        <button
          onClick={() => setLeaveOpen(true)}
          className="action-lift press inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:border-emerald-300 dark:hover:border-emerald-500/30 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-500/5 cursor-pointer"
        >
          <Calendar className="w-3.5 h-3.5 text-emerald-500/60 dark:text-emerald-500/40" />
          File Leave
        </button>
        <button
          onClick={() => setReimbOpen(true)}
          className="action-lift press inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:border-gold-300 dark:hover:border-gold-500/30 hover:text-gold-700 dark:hover:text-gold-400 hover:bg-gold-50/50 dark:hover:bg-gold-500/5 cursor-pointer"
        >
          <Receipt className="w-3.5 h-3.5 text-gold-500/60 dark:text-gold-500/40" />
          File Reimbursement
        </button>
        <button
          onClick={() => setFeedbackOpen(true)}
          className="action-lift press inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:border-violet-300 dark:hover:border-violet-500/30 hover:text-violet-700 dark:hover:text-violet-400 hover:bg-violet-50/50 dark:hover:bg-violet-500/5 cursor-pointer"
        >
          <MessageSquare className="w-3.5 h-3.5 text-violet-500/60 dark:text-violet-500/40" />
          Submit Feedback
        </button>
      </div>

      {modals}
    </>
  );
}
