'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Send, Sparkles } from 'lucide-react';
import ChatMarkdown from '@/components/ChatMarkdown';

export interface PortalChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  matterId: string;
  initialMessages: PortalChatMessage[];
  /** Read-only partner/admin preview — disables asking. */
  preview?: boolean;
}

const SUGGESTIONS = [
  'What is the latest update on my case?',
  'When is my next hearing?',
  'What documents has the firm filed recently?',
  'Is the firm waiting for anything from me?',
];

export default function PortalMatterChat({ matterId, initialMessages, preview = false }: Props) {
  const [messages, setMessages] = useState<PortalChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || streaming || preview) return;

    setError(null);
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: question }, { role: 'assistant', content: '' }]);
    setStreaming(true);

    try {
      const res = await fetch(`/api/portal/matters/${encodeURIComponent(matterId)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'The assistant is unavailable right now.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith('data:')) continue;
          let payload: { type: string; text?: string; error?: string };
          try {
            payload = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (payload.type === 'token' && payload.text) {
            setMessages((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, content: last.content + payload.text };
              return next;
            });
          } else if (payload.type === 'error') {
            throw new Error(payload.error ?? 'Something went wrong.');
          }
        }
      }
    } catch (err) {
      setMessages((m) => {
        // Drop the empty assistant placeholder when the stream never produced text.
        const next = [...m];
        if (next[next.length - 1]?.role === 'assistant' && next[next.length - 1].content === '') next.pop();
        return next;
      });
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setStreaming(false);
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="border border-[var(--border-color)] rounded-2xl bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-gold-600 dark:text-gold-400" />
        <div>
          <p className="text-sm font-medium text-foreground">Ask about your case</p>
          <p className="text-[11px] text-[var(--text-muted)]">
            Answers come from your case record. For legal advice, please reach your engagement team.
          </p>
        </div>
      </div>

      <div ref={scrollRef} className="h-[420px] overflow-y-auto px-5 py-4 space-y-4">
        {empty ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Ask anything about this matter — recent developments, schedules, or documents.
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-md">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={preview}
                  className="text-xs px-3 py-1.5 rounded-full border border-gold-300/50 dark:border-gold-400/30 text-gold-700 dark:text-gold-400 hover:bg-gold-50 dark:hover:bg-gold-400/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={
                  m.role === 'user'
                    ? 'max-w-[80%] rounded-2xl rounded-br-sm bg-navy-700 dark:bg-gold-400/15 text-white dark:text-gold-100 px-4 py-2.5 text-sm whitespace-pre-wrap'
                    : 'max-w-[85%] rounded-2xl rounded-bl-sm bg-subtle px-4 py-2.5 text-sm text-foreground'
                }
              >
                {m.content ? (
                  m.role === 'assistant' ? <ChatMarkdown content={m.content} /> : m.content
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> thinking…
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {error && (
        <p className="px-5 pb-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="border-t border-[var(--border-color)] p-3 flex items-center gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={preview ? 'Preview — asking is disabled' : 'Ask a question about this matter…'}
          maxLength={2000}
          disabled={streaming || preview}
          className="flex-1 bg-transparent px-3 py-2 text-sm focus:outline-none placeholder:text-[var(--text-muted)] disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={streaming || preview || input.trim().length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-navy-700 hover:bg-navy-800 dark:bg-gold-500 dark:hover:bg-gold-600 text-white disabled:opacity-50 transition-colors"
        >
          {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Ask
        </button>
      </form>
    </div>
  );
}
