'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, Send, X, ChevronDown, Sparkles, FileText, Loader2 } from 'lucide-react';
import ChatMarkdown from '@/components/ChatMarkdown';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceInfo[];
  user_name?: string;
  created_at?: string;
}

interface SourceInfo {
  index: number;
  sourceType: string;
  sourceId: string;
  chunkText: string;
  similarity: number;
  metadata: Record<string, string>;
}

interface Props {
  matterId: string;
  matterName: string;
}

export default function MatterChat({ matterId, matterName }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyLoaded = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight stream on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Load chat history on first open
  useEffect(() => {
    if (!open || historyLoaded.current) return;
    historyLoaded.current = true;
    setLoadingHistory(true);

    fetch(`/api/matter-chat/history?matterId=${matterId}&limit=50`)
      .then((r) => r.json())
      .then((data) => {
        if (data.messages) {
          setMessages(data.messages);
        }
      })
      .catch(console.error)
      .finally(() => setLoadingHistory(false));
  }, [open, matterId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const toggleSources = useCallback((messageId: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      user_name: 'You',
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setStreaming(true);

    // Create placeholder for assistant message
    const assistantId = `assistant-${Date.now()}`;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      sources: [],
    };
    setMessages((prev) => [...prev, assistantMsg]);

    // Abort any previous stream and create a fresh controller
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const history = messages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/matter-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matterId, message: text, history }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to send message');
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6);
          try {
            const event = JSON.parse(json);

            if (event.type === 'sources') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, sources: event.sources } : m,
                ),
              );
            } else if (event.type === 'token') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + event.text }
                    : m,
                ),
              );
            } else if (event.type === 'error') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: `Error: ${event.error}` }
                    : m,
                ),
              );
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    } catch (err) {
      // Don't update state if we aborted (component unmounting or new message)
      if (controller.signal.aborted) return;
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: `Error: ${errMsg}` } : m,
        ),
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Floating button (collapsed) ─────────────────────────────────
  // Sits to the left of the QuickCreateFAB (which is pinned at right-6,
  // w-12 = 48px wide). The 88px right offset = 24px FAB-to-edge + 48px FAB
  // width + 16px gap, so the two never overlap.
  //
  // Portal to document.body so `position: fixed` anchors to the viewport.
  // MatterDetail / DetailShell ancestors apply transforms (transition-all,
  // animate-fade-up), which would otherwise capture `fixed` and make the
  // button drift as you scroll the matter page.
  if (typeof document === 'undefined') return null;

  if (!open) {
    return createPortal(
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-[88px] z-50 flex items-center gap-2 px-4 py-3 rounded-full bg-foreground text-background shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105 group"
      >
        <Sparkles className="w-4 h-4" />
        <span className="text-sm font-medium">Ask AI</span>
        {messages.length > 0 && (
          <span className="ml-1 text-[10px] font-mono opacity-60">
            {messages.length}
          </span>
        )}
      </button>,
      document.body,
    );
  }

  // ── Chat panel (expanded) ───────────────────────────────────────
  // Expanded panel sits to the left of the FAB too so the Plus button stays
  // reachable. 88px right offset mirrors the collapsed button.
  return createPortal(
    <div className="fixed bottom-6 right-[88px] z-50 w-[420px] max-h-[600px] flex flex-col bg-card rounded-xl border border-[var(--border-color)] shadow-2xl animate-fade-up overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] bg-subtle">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-gold-500 dark:text-gold-400" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Matter Q&A</h3>
            <p className="text-[10px] text-[var(--text-muted)] truncate max-w-[280px]">
              {matterName}
            </p>
          </div>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="p-1 rounded-md hover:bg-card transition-colors"
        >
          <X className="w-4 h-4 text-[var(--text-muted)]" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px] max-h-[420px]">
        {loadingHistory ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <MessageSquare className="w-8 h-8 mx-auto text-[var(--text-muted)] opacity-40" />
            <p className="text-sm text-[var(--text-muted)]">
              Ask anything about this matter
            </p>
            <div className="flex flex-wrap justify-center gap-1.5 pt-2">
              {[
                'What are the key deadlines?',
                'Summarize the latest filing',
                'Who are the parties involved?',
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setInput(q);
                    inputRef.current?.focus();
                  }}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-subtle hover:text-foreground transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-foreground text-background'
                    : 'bg-subtle text-foreground border border-[var(--border-color)]'
                }`}
              >
                {/* Message content */}
                <div className="break-words">
                  {msg.role === 'assistant' && msg.content ? (
                    <ChatMarkdown content={msg.content} />
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                  {streaming && msg.role === 'assistant' && !msg.content && (
                    <span className="inline-flex gap-1 ml-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-pulse" />
                      <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-pulse delay-100" />
                      <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-pulse delay-200" />
                    </span>
                  )}
                </div>

                {/* Source citations */}
                {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-[var(--border-color)]">
                    <button
                      onClick={() => toggleSources(msg.id)}
                      className="flex items-center gap-1 text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                    >
                      <FileText className="w-3 h-3" />
                      {msg.sources.length} source{msg.sources.length > 1 ? 's' : ''}
                      <ChevronDown
                        className={`w-3 h-3 transition-transform ${
                          expandedSources.has(msg.id) ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {expandedSources.has(msg.id) && (
                      <div className="mt-1.5 space-y-1">
                        {msg.sources.map((src) => (
                          <div
                            key={src.index}
                            className="text-[10px] p-1.5 rounded bg-card border border-[var(--border-color)]"
                          >
                            <span className="font-semibold text-gold-600 dark:text-gold-400">
                              [{src.index}]
                            </span>{' '}
                            <span className="font-medium">
                              {formatSourceType(src.sourceType)}:{' '}
                              {(src.metadata as Record<string, string>).fileName ||
                                (src.metadata as Record<string, string>).name ||
                                'Unknown'}
                            </span>
                            <p className="mt-0.5 text-[var(--text-muted)] line-clamp-2">
                              {src.chunkText}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[var(--border-color)] p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this matter..."
            rows={1}
            disabled={streaming}
            className="flex-1 resize-none rounded-lg border border-[var(--border-color)] bg-card px-3 py-2 text-sm text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500 disabled:opacity-50 max-h-[100px]"
            style={{ minHeight: '36px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 100) + 'px';
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming}
            className="shrink-0 p-2 rounded-lg bg-foreground text-background disabled:opacity-30 hover:opacity-90 transition-opacity"
          >
            {streaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function formatSourceType(type: string): string {
  switch (type) {
    case 'file_analysis': return 'Document';
    case 'matter_summary': return 'Summary';
    case 'deliverable': return 'Deliverable';
    case 'hearing': return 'Hearing';
    case 'filing': return 'Filing';
    case 'file': return 'File';
    case 'meeting': return 'Meeting';
    case 'matter': return 'Matter';
    default: return type;
  }
}
