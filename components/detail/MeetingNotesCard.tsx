'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, NotebookPen } from 'lucide-react';
import { toast } from 'sonner';
import { SubjectCard } from '@/components/ui/primitives';
import { getSupabaseBrowserAuthClient } from '@/lib/supabase-browser';
import { mergeNotes } from '@/lib/meeting-notes-merge';
import { FORMER_MEMBER } from '@/lib/former-member';

const MUTED = 'text-stone-500 dark:text-stone-400';
const SAVE_AFTER_MS = 1200;

interface Synced {
  body: string;
  version: number;
  at: string | null;
  by: string | null;
}

interface NotesRow {
  body: string;
  version: number;
  updated_at: string | null;
  updated_by: string | null;
}

/** Where the caret belongs once `before` has become `after` around it. */
function mapCaret(before: string, after: string, caret: number): number {
  let pre = 0;
  while (pre < before.length && pre < after.length && before[pre] === after[pre]) pre++;
  if (caret <= pre) return caret;
  let suf = 0;
  while (suf < before.length - pre && suf < after.length - pre && before[before.length - 1 - suf] === after[after.length - 1 - suf]) suf++;
  if (caret >= before.length - suf) return caret + after.length - before.length;
  return after.length - suf;
}

function editedLabel(at: string | null, who: string | null): string | null {
  if (!at) return null;
  const when = new Date(at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
  return who ? `Edited ${when} by ${who}` : `Edited ${when}`;
}

/**
 * What was discussed and agreed. Several attendees can keep it at once: it
 * saves a moment after typing stops, each save names the version it was
 * written over, and another attendee's save arrives live and is merged into
 * what you are typing — only lines both of you changed are marked as a clash.
 */
export default function MeetingNotesCard({
  meetingId,
  notes,
  version,
  updatedAt,
  updatedBy,
  names,
  currentUserId,
  canEdit,
}: {
  meetingId: string;
  notes: string;
  version: number;
  updatedAt: string | null;
  /** person_id of whoever saved last. */
  updatedBy: string | null;
  names: Record<string, string>;
  currentUserId: string;
  canEdit: boolean;
}) {
  const [draft, setDraft] = useState(notes);
  const [synced, setSyncedState] = useState<Synced>({ body: notes, version, at: updatedAt, by: updatedBy });
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [clashes, setClashes] = useState(0);

  // Refs mirror the state so the save loop and the realtime handler, which
  // outlive renders, always work from the latest text and version.
  const draftRef = useRef(notes);
  const syncedRef = useRef(synced);
  const inFlight = useRef(false);
  /** The text of the save on its way, so its own realtime echo isn't merged as someone else's. */
  const sending = useRef<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<[number, number] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nameOf = useCallback((pid: string | null) => (pid ? (names[pid] ?? FORMER_MEMBER) : null), [names]);

  const setSynced = (s: Synced) => {
    syncedRef.current = s;
    setSyncedState(s);
  };
  const setText = (t: string) => {
    draftRef.current = t;
    setDraft(t);
  };

  /** Folds a save someone else made into what is on screen. */
  const absorb = useCallback(
    (row: NotesRow) => {
      if (row.version <= syncedRef.current.version) return;
      if (row.body === sending.current) {
        setSynced({ body: row.body, version: row.version, at: row.updated_at, by: row.updated_by });
        return;
      }
      const merged = mergeNotes(syncedRef.current.body, draftRef.current, row.body, nameOf(row.updated_by) ?? 'Their');
      setSynced({ body: row.body, version: row.version, at: row.updated_at, by: row.updated_by });
      const el = area.current;
      if (el && document.activeElement === el) {
        caret.current = [mapCaret(draftRef.current, merged.text, el.selectionStart), mapCaret(draftRef.current, merged.text, el.selectionEnd)];
      }
      setText(merged.text);
      if (merged.clashes > 0) setClashes((c) => c + merged.clashes);
    },
    [nameOf],
  );

  const save = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (inFlight.current) return;
    const body = draftRef.current;
    const base = syncedRef.current;
    if (body === base.body) return;

    inFlight.current = true;
    sending.current = body;
    setState('saving');
    try {
      const res = await fetch('/api/meeting', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: meetingId, notes: body, notesVersion: base.version }),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 409 && json?.latest) {
        absorb(json.latest as NotesRow);
      } else if (!res.ok) {
        throw new Error(json?.error ?? 'Failed');
      } else if (json.notesVersion > syncedRef.current.version) {
        setSynced({ body, version: json.notesVersion, at: new Date().toISOString(), by: currentUserId });
      }
      setState('saved');
      setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 1500);
    } catch (err) {
      setState('idle');
      toast.error(`Couldn't save the notes: ${(err as Error).message}`);
      return;
    } finally {
      inFlight.current = false;
      sending.current = null;
    }
    // Typing during the save, or a merge after a refused one, leaves more to send.
    if (draftRef.current !== syncedRef.current.body) timer.current = setTimeout(save, SAVE_AFTER_MS);
  }, [meetingId, currentUserId, absorb]);

  useEffect(() => {
    const supabase = getSupabaseBrowserAuthClient();
    const channel = supabase
      .channel(`meeting-notes:${meetingId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'meeting_notes', filter: `meeting_id=eq.${meetingId}` },
        (payload) => {
          if (payload.new && 'version' in payload.new) absorb(payload.new as NotesRow);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [meetingId, absorb]);

  useLayoutEffect(() => {
    if (!caret.current || !area.current) return;
    area.current.setSelectionRange(...caret.current);
    caret.current = null;
  }, [draft]);

  // Don't let a closing tab drop the last few words.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (draftRef.current !== syncedRef.current.body) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const label = editedLabel(synced.at, nameOf(synced.by));
  const unsaved = draft !== synced.body;

  return (
    <SubjectCard
      title="Meeting notes"
      icon={<NotebookPen className="w-4 h-4" />}
      action={
        state === 'saving' ? (
          <span className={`inline-flex items-center gap-1 text-[11px] ${MUTED}`}>
            <Loader2 className="w-3.5 h-3.5 animate-spin text-navy-500" /> Saving
          </span>
        ) : state === 'saved' && !unsaved ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-300">
            <Check className="w-3.5 h-3.5" /> Saved
          </span>
        ) : (
          label && <span className={`text-[11px] ${MUTED}`}>{label}</span>
        )
      }
    >
      {clashes > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 w-3.5 h-3.5 shrink-0" />
          <p className="flex-1">
            You and another attendee changed the same lines. Both versions are kept between the bracketed markers — keep what you want and delete the
            rest.
          </p>
          <button type="button" onClick={() => setClashes(0)} className="font-medium hover:underline">
            Got it
          </button>
        </div>
      )}
      {canEdit ? (
        <textarea
          ref={area}
          value={draft}
          onChange={(e) => {
            setText(e.target.value);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(save, SAVE_AFTER_MS);
          }}
          onBlur={save}
          rows={9}
          placeholder="What was discussed, what was agreed, and who does what next."
          aria-label="Meeting notes"
          className="w-full px-3 py-2 text-[13px] leading-relaxed text-stone-800 dark:text-stone-100 bg-stone-50 dark:bg-white/[0.03] border border-stone-200 dark:border-white/10 rounded-xl placeholder:text-stone-400 dark:placeholder:text-stone-500 resize-y transition-colors focus:outline-none focus:border-navy-300 focus:ring-2 focus:ring-navy-500/15 dark:focus:border-navy-400/40"
        />
      ) : synced.body ? (
        <p className="text-[13px] leading-relaxed text-stone-800 dark:text-stone-100 whitespace-pre-wrap">{synced.body}</p>
      ) : (
        <p className={`text-[13px] ${MUTED}`}>No notes yet.</p>
      )}
    </SubjectCard>
  );
}
