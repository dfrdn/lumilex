'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, FileDown, Sparkles } from 'lucide-react';
import ChatMarkdown from '@/components/ChatMarkdown';

interface AssistantFile {
  name: string;
  url: string;
}
interface Msg {
  role: 'user' | 'assistant';
  content: string;
  files?: AssistantFile[];
}

const SUGGESTIONS = [
  'How does my week look?',
  "What deliverables are due today?",
  'Status of the … matter',
];

export default function AssistantPanel({ variant = 'panel' }: { variant?: 'panel' | 'page' }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  // Load the persisted thread (shared between the panel and the full page).
  useEffect(() => {
    let active = true;
    fetch('/api/assistant')
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => {
        if (active && Array.isArray(d.messages)) setMessages(d.messages);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;
      // Append the user turn + an empty assistant placeholder to stream into.
      setMessages((prev) => [...prev, { role: 'user', content: trimmed }, { role: 'assistant', content: '' }]);
      setInput('');
      setLoading(true);
      setStatus('Thinking…');

      const patchLastAssistant = (patch: (m: Msg) => Msg) =>
        setMessages((prev) => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === 'assistant') {
              copy[i] = patch(copy[i]);
              break;
            }
          }
          return copy;
        });

      try {
        const res = await fetch('/api/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed }),
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Request failed');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamErr: string | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let evt: { type?: string; text?: string; name?: string; url?: string; error?: string };
            try {
              evt = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            if (evt.type === 'token') {
              setStatus(null);
              patchLastAssistant((m) => ({ ...m, content: m.content + (evt.text ?? '') }));
            } else if (evt.type === 'status') {
              setStatus(evt.text ?? null);
            } else if (evt.type === 'file' && evt.name && evt.url) {
              patchLastAssistant((m) => ({
                ...m,
                files: [...(m.files ?? []), { name: evt.name!, url: evt.url! }],
              }));
            } else if (evt.type === 'error') {
              streamErr = evt.error ?? 'Something went wrong';
            }
          }
        }

        patchLastAssistant((m) => ({
          ...m,
          content: m.content || (streamErr ? `⚠️ ${streamErr}` : 'Done.'),
        }));
      } catch (e) {
        patchLastAssistant((m) => ({
          ...m,
          content: m.content || `⚠️ ${e instanceof Error ? e.message : 'Something went wrong'}`,
        }));
      } finally {
        setLoading(false);
        setStatus(null);
      }
    },
    [loading],
  );

  return (
    <div className={`flex flex-col ${variant === 'page' ? 'h-[calc(100vh-13rem)]' : 'h-full'} min-h-0`}>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-sm text-[var(--text-secondary)] space-y-3 pt-2">
            <div className="flex items-center gap-2 text-foreground font-medium">
              <Sparkles className="w-4 h-4 text-gold-500" />
              How can I help?
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Ask about a matter, the firm&apos;s schedule, or deadlines — or tell me to create a
              deliverable, task, meeting, or hearing, or fetch a document.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-foreground hover:bg-[var(--background)] transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          // Skip the empty assistant placeholder until tokens (or a file) arrive.
          if (m.role === 'assistant' && !m.content && !(m.files && m.files.length > 0)) return null;
          return (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={
                  m.role === 'user'
                    ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-navy-900 dark:bg-gold-400 text-white dark:text-navy-950 px-3.5 py-2 text-sm'
                    : 'max-w-[90%] rounded-2xl rounded-bl-sm bg-[var(--background)] border border-[var(--border-color)] px-3.5 py-2 text-sm text-foreground'
                }
              >
                {m.role === 'assistant' ? (
                  <ChatMarkdown content={m.content} />
                ) : (
                  <span className="whitespace-pre-wrap">{m.content}</span>
                )}
                {m.files && m.files.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {m.files.map((f, idx) => (
                      <a
                        key={idx}
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-foreground transition-colors"
                      >
                        <FileDown className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{f.name}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {loading && status && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {status}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border-color)] p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask or tell me to do something…"
            rows={1}
            disabled={loading}
            className="flex-1 resize-none max-h-32 px-3 py-2 text-sm rounded-xl border border-[var(--border-color)] bg-[var(--background)] placeholder:text-[var(--text-muted)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20 transition-all disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="shrink-0 w-9 h-9 rounded-xl bg-navy-900 dark:bg-gold-400 text-white dark:text-navy-950 flex items-center justify-center hover:bg-navy-800 dark:hover:bg-gold-300 disabled:opacity-40 transition-colors"
            aria-label="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
