'use client';

import { useState, useEffect } from 'react';
import { MessageSquare, Send, Clock, CheckCircle, EyeOff, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useSWRConfig } from 'swr';

interface Feedback {
  notion_id: string;
  subject: string;
  type: string;
  feedback_date: string | null;
  message: string;
  response: string;
  dismissed_at: string | null;
}

const isPending = (f: Feedback) => !f.response && !f.dismissed_at;

function formatDate(d: string | null): string {
  if (!d) return '\u2014';
  return new Date(d).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    'Suggestion': 'bg-blue-50 text-blue-700 ring-blue-200/60 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20',
    'Bug Report': 'bg-red-50 text-red-700 ring-red-200/60 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20',
    'Feature Request': 'bg-violet-50 text-violet-700 ring-violet-200/60 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/20',
    'General': 'bg-stone-50 text-stone-600 ring-stone-200/60 dark:bg-stone-500/10 dark:text-stone-400 dark:ring-stone-500/20',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-full ring-1 ring-inset ${colors[type] ?? colors['General']}`}>
      {type || 'General'}
    </span>
  );
}

export default function FeedbackReviewClient() {
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'responded' | 'dismissed'>('all');
  // The sidebar badge counts pending feedback; re-read it after a change here.
  // Through the hook: the app's SWR cache is a custom provider.
  const { mutate } = useSWRConfig();
  const refreshNavCounts = () =>
    mutate((key) => typeof key === 'string' && key.startsWith('/api/me/nav-counts'));

  useEffect(() => {
    fetch('/api/partner/feedbacks')
      .then((res) => res.json())
      .then((data) => setFeedbacks(data.feedbacks ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleReply = async (notionId: string) => {
    const text = replyText;
    if (!text.trim()) return;
    const previous = feedbacks.find((f) => f.notion_id === notionId)?.response ?? '';
    const setResponse = (response: string) =>
      setFeedbacks((prev) => prev.map((f) => (f.notion_id === notionId ? { ...f, response } : f)));
    setResponse(text);
    setReplyingId(null);
    setReplyText('');
    try {
      const res = await fetch('/api/partner/feedbacks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notionId, response: text }),
      });
      if (!res.ok) throw new Error('Failed');
      refreshNavCounts();
    } catch {
      setResponse(previous);
      setReplyingId(notionId);
      setReplyText(text);
      toast.error('Could not send the reply');
    }
  };

  const handleDismiss = async (notionId: string, dismissed: boolean) => {
    const previous = feedbacks.find((f) => f.notion_id === notionId)?.dismissed_at ?? null;
    const setDismissed = (dismissed_at: string | null) =>
      setFeedbacks((prev) => prev.map((f) => (f.notion_id === notionId ? { ...f, dismissed_at } : f)));
    setDismissed(dismissed ? new Date().toISOString() : null);
    try {
      const res = await fetch('/api/partner/feedbacks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notionId, dismissed }),
      });
      if (!res.ok) throw new Error('Failed');
      refreshNavCounts();
    } catch {
      setDismissed(previous);
      toast.error(dismissed ? 'Could not dismiss the feedback' : 'Could not restore the feedback');
    }
  };

  const filtered = filter === 'all'
    ? feedbacks
    : filter === 'pending'
      ? feedbacks.filter(isPending)
      : filter === 'responded'
        ? feedbacks.filter((f) => !!f.response)
        : feedbacks.filter((f) => !f.response && !!f.dismissed_at);

  const pendingCount = feedbacks.filter(isPending).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-[var(--text-muted)]">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading feedbacks...
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-6 bg-[var(--subtle-bg)] rounded-lg p-1 w-fit">
        {(['all', 'pending', 'responded', 'dismissed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer capitalize ${
              filter === f
                ? 'bg-[var(--card-bg)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {f}
            {f === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400 rounded-full">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-[var(--text-muted)]">
          <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">No {filter === 'all' ? '' : filter} feedbacks</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((fb) => {
            const hasResponse = !!fb.response;
            const isDismissed = !hasResponse && !!fb.dismissed_at;
            const isReplying = replyingId === fb.notion_id;
            return (
              <div
                key={fb.notion_id}
                className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden transition-all duration-200 hover:shadow-[var(--shadow-card-hover)]"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{fb.subject}</h3>
                      <TypeBadge type={fb.type} />
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {hasResponse ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                          <CheckCircle className="w-3 h-3" /> Responded
                        </span>
                      ) : isDismissed ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]">
                          <EyeOff className="w-3 h-3" /> Dismissed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                          <Clock className="w-3 h-3" /> Awaiting
                        </span>
                      )}
                      <span className="text-[11px] text-[var(--text-muted)]">{formatDate(fb.feedback_date)}</span>
                    </div>
                  </div>

                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-3">{fb.message}</p>

                  {/* Existing response */}
                  {hasResponse && !isReplying && (
                    <div className="mt-3 px-4 py-3 bg-emerald-50/50 dark:bg-emerald-500/5 rounded-lg border border-emerald-200/40 dark:border-emerald-500/10">
                      <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-1">Response</p>
                      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{fb.response}</p>
                    </div>
                  )}

                  {/* Reply form */}
                  {isReplying && (
                    <div className="mt-3 space-y-2">
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        rows={3}
                        autoFocus
                        className="w-full px-3 py-2 text-sm text-[var(--text-primary)] bg-[var(--subtle-bg)] border border-[var(--border-color)] rounded-lg placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-violet-400/20 focus:border-violet-400 transition-all duration-150 resize-none"
                        placeholder="Write your response..."
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setReplyingId(null); setReplyText(''); }}
                          className="px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleReply(fb.notion_id)}
                          disabled={!replyText.trim()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-lg shadow-sm transition-all duration-150 cursor-pointer disabled:opacity-50"
                        >
                          <Send className="w-3 h-3" />
                          Send Response
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Reply / dismiss buttons */}
                  {!isReplying && (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => {
                          setReplyingId(fb.notion_id);
                          setReplyText(fb.response || '');
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10 hover:bg-violet-100 dark:hover:bg-violet-500/20 ring-1 ring-inset ring-violet-200/60 dark:ring-violet-500/20 rounded-lg transition-all duration-150 cursor-pointer"
                      >
                        <MessageSquare className="w-3 h-3" />
                        {hasResponse ? 'Edit Response' : 'Respond'}
                      </button>
                      {!hasResponse && (
                        <button
                          onClick={() => handleDismiss(fb.notion_id, !isDismissed)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--subtle-bg)] rounded-lg transition-colors duration-150 cursor-pointer"
                        >
                          {isDismissed ? <RotateCcw className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                          {isDismissed ? 'Restore' : 'Dismiss'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
