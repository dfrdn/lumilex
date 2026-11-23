'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Scale,
  Mail,
  FileText,
  BarChart3,
  X,
  Download,
  Loader2,
  CheckCircle2,
  ArrowLeft,
  Sparkles,
  FileInput,
  Clock,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────

interface PlaceholderField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date';
  required: boolean;
}

interface Template {
  id: number;
  name: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  generation_mode: 'ai' | 'placeholder';
  ai_prompt: string | null;
  placeholders: PlaceholderField[] | null;
}

interface Matter {
  id: string;
  name: string;
  code: string;
  clientId: string;
}

interface Client {
  id: string;
  name: string;
}

interface RecentDocument {
  id: number;
  template_name: string;
  matter_name: string | null;
  client_name: string | null;
  file_name: string;
  storage_path: string;
  created_at: string;
}

// ── Category config ────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { icon: typeof Scale; label: string; color: string }> = {
  legal:  { icon: Scale,    label: 'Legal',   color: 'text-purple-500 dark:text-purple-400' },
  letter: { icon: Mail,     label: 'Letters', color: 'text-blue-500 dark:text-blue-400' },
  form:   { icon: FileInput,label: 'Forms',   color: 'text-emerald-500 dark:text-emerald-400' },
  report: { icon: BarChart3, label: 'Reports', color: 'text-gold-500 dark:text-gold-400' },
};

const MODE_BADGES: Record<string, { label: string; className: string }> = {
  ai:          { label: 'AI',          className: 'bg-gold-50 text-gold-600 dark:bg-gold-500/10 dark:text-gold-400' },
  placeholder: { label: 'Placeholder', className: 'bg-stone-100 text-stone-600 dark:bg-stone-500/10 dark:text-stone-400' },
};

// ── Component ──────────────────────────────────────────────

export default function DocumentGenerator() {
  // Data
  const [templates, setTemplates] = useState<Template[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [recentDocs, setRecentDocs] = useState<RecentDocument[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [loadingRecent, setLoadingRecent] = useState(true);

  // Generation state
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [selectedMatterId, setSelectedMatterId] = useState('');
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ fileName: string; downloadUrl: string } | null>(null);
  const [error, setError] = useState('');

  const firstFieldRef = useRef<HTMLSelectElement>(null);

  // ── Fetch data ──────────────────────────────────────────

  const fetchTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const res = await fetch('/api/templates');
      const json = await res.json();
      setTemplates(json.data ?? []);
    } catch {
      console.error('Failed to fetch templates');
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  const fetchClientsMatters = useCallback(async () => {
    try {
      const res = await fetch('/api/clients-matters');
      const json = await res.json();
      setClients(json.clients ?? []);
      setMatters(json.matters ?? []);
    } catch {
      console.error('Failed to fetch clients/matters');
    }
  }, []);

  const fetchRecentDocs = useCallback(async () => {
    setLoadingRecent(true);
    try {
      const res = await fetch('/api/templates/generate?recent=1');
      const json = await res.json();
      setRecentDocs(json.data ?? []);
    } catch {
      console.error('Failed to fetch recent documents');
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
    fetchClientsMatters();
    fetchRecentDocs();
  }, [fetchTemplates, fetchClientsMatters, fetchRecentDocs]);

  // ── Group templates by category ─────────────────────────

  const grouped = templates.reduce<Record<string, Template[]>>((acc, t) => {
    const cat = t.category?.toLowerCase() ?? 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(t);
    return acc;
  }, {});

  // ── Select template ─────────────────────────────────────

  function handleSelectTemplate(t: Template) {
    setSelectedTemplate(t);
    setSelectedMatterId('');
    setAdditionalInstructions('');
    setResult(null);
    setError('');

    // Initialize placeholder values
    if (t.generation_mode === 'placeholder' && t.placeholders) {
      const init: Record<string, string> = {};
      for (const ph of t.placeholders) {
        init[ph.key] = '';
      }
      setPlaceholderValues(init);
    } else {
      setPlaceholderValues({});
    }

    // Focus first field after render
    setTimeout(() => firstFieldRef.current?.focus(), 100);
  }

  // ── Auto-fill placeholders from matter ──────────────────

  function handleMatterChange(matterId: string) {
    setSelectedMatterId(matterId);

    if (!matterId || selectedTemplate?.generation_mode !== 'placeholder') return;

    const matter = matters.find((m) => m.id === matterId);
    if (!matter) return;

    const client = clients.find((c) => c.id === matter.clientId);

    setPlaceholderValues((prev) => {
      const next = { ...prev };
      // Auto-fill known keys from matter data
      const autoMap: Record<string, string> = {
        client_name: client?.name ?? '',
        matter_name: matter.name ?? '',
        matter_code: matter.code ?? '',
      };
      for (const [key, val] of Object.entries(autoMap)) {
        if (key in next && !next[key] && val) {
          next[key] = val;
        }
      }
      return next;
    });
  }

  // ── Generate document ───────────────────────────────────

  async function handleGenerate() {
    if (!selectedTemplate) return;

    setGenerating(true);
    setError('');
    setResult(null);

    try {
      const body: Record<string, unknown> = {
        templateId: selectedTemplate.id,
      };
      if (selectedMatterId) body.matterId = selectedMatterId;

      if (selectedTemplate.generation_mode === 'ai') {
        if (additionalInstructions.trim()) {
          body.additionalInstructions = additionalInstructions.trim();
        }
      } else {
        body.placeholders = placeholderValues;
      }

      const res = await fetch('/api/templates/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error || 'Generation failed');
        return;
      }

      setResult({ fileName: json.fileName, downloadUrl: json.downloadUrl });
      fetchRecentDocs(); // Refresh recent list
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setGenerating(false);
    }
  }

  // ── Get download URL for recent doc ─────────────────────

  async function getDownloadUrl(storagePath: string) {
    try {
      const res = await fetch(`/api/templates/generate?download=${encodeURIComponent(storagePath)}`);
      const json = await res.json();
      if (json.downloadUrl) {
        window.open(json.downloadUrl, '_blank');
      }
    } catch {
      console.error('Failed to get download URL');
    }
  }

  // ── Matters grouped by client for the dropdown ──────────

  const mattersByClient = clients
    .map((c) => ({
      client: c,
      matters: matters.filter((m) => m.clientId === c.id),
    }))
    .filter((g) => g.matters.length > 0);

  // ── Render ──────────────────────────────────────────────

  return (
    <div className="space-y-8 animate-fade-up">
      {/* Page Header */}
      <div className="animate-fade-up">
        <h1 className="text-2xl font-bold text-foreground">Document Generator</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Draft with AI or structured templates — review, refine, and download.
        </p>
      </div>

      {/* ── Generation Modal / Panel ────────────────────── */}
      {selectedTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm"
            onClick={() => { if (!generating) setSelectedTemplate(null); }}
          />

          {/* Panel */}
          <div className="relative w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col bg-card border border-[var(--border-color)] rounded-xl shadow-[var(--shadow-card)] animate-fade-up">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => { if (!generating) setSelectedTemplate(null); }}
                  className="p-1.5 rounded-md hover:bg-[var(--bg-subtle)] text-[var(--text-muted)] hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{selectedTemplate.name}</h2>
                  {selectedTemplate.description && (
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{selectedTemplate.description}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${MODE_BADGES[selectedTemplate.generation_mode]?.className}`}>
                  {MODE_BADGES[selectedTemplate.generation_mode]?.label}
                </span>
                <button
                  type="button"
                  onClick={() => { if (!generating) setSelectedTemplate(null); }}
                  className="p-1.5 rounded-md hover:bg-[var(--bg-subtle)] text-[var(--text-muted)] hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {/* Success state */}
              {result ? (
                <div className="flex flex-col items-center justify-center py-8 space-y-4">
                  <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center animate-scale-in">
                    <CheckCircle2 className="w-7 h-7 text-emerald-500 dark:text-emerald-400" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-lg font-semibold text-foreground">Document Generated</h3>
                    <p className="text-sm text-[var(--text-muted)] mt-1">{result.fileName}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {result.downloadUrl && (
                      <a
                        href={result.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-gold-500 text-white hover:bg-gold-600 transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        Download
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setResult(null);
                        setError('');
                        setSelectedMatterId('');
                        setAdditionalInstructions('');
                        if (selectedTemplate.generation_mode === 'placeholder' && selectedTemplate.placeholders) {
                          const init: Record<string, string> = {};
                          for (const ph of selectedTemplate.placeholders) init[ph.key] = '';
                          setPlaceholderValues(init);
                        }
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-foreground hover:bg-[var(--bg-subtle)] transition-colors"
                    >
                      Generate Another
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Matter selector */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                      Matter <span className="text-[var(--text-muted)]">(optional)</span>
                    </label>
                    <select
                      ref={firstFieldRef}
                      value={selectedMatterId}
                      onChange={(e) => handleMatterChange(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-[var(--bg-subtle)] border border-[var(--border-color)] rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-gold-400/50"
                    >
                      <option value="">Select a matter...</option>
                      {mattersByClient.map((group) => (
                        <optgroup key={group.client.id} label={group.client.name}>
                          {group.matters.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.code ? `[${m.code}] ` : ''}{m.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  {/* AI mode: additional instructions */}
                  {selectedTemplate.generation_mode === 'ai' && (
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                        Additional Instructions <span className="text-[var(--text-muted)]">(optional)</span>
                      </label>
                      <textarea
                        value={additionalInstructions}
                        onChange={(e) => setAdditionalInstructions(e.target.value)}
                        rows={4}
                        placeholder="Provide any additional context or specific requirements for document generation..."
                        className="w-full px-3 py-2 text-sm bg-[var(--bg-subtle)] border border-[var(--border-color)] rounded-lg text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-gold-400/50 resize-none"
                      />
                    </div>
                  )}

                  {/* Placeholder mode: render fields */}
                  {selectedTemplate.generation_mode === 'placeholder' && selectedTemplate.placeholders && (
                    <div className="space-y-3">
                      <label className="block text-xs font-medium text-[var(--text-secondary)]">
                        Fill in the fields below
                      </label>
                      {selectedTemplate.placeholders.map((ph, idx) => (
                        <div key={ph.key}>
                          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                            {ph.label || ph.key}
                            {ph.required && <span className="text-red-500 ml-0.5 dark:text-red-400">*</span>}
                          </label>
                          {ph.type === 'textarea' ? (
                            <textarea
                              autoFocus={idx === 0}
                              value={placeholderValues[ph.key] ?? ''}
                              onChange={(e) => setPlaceholderValues((prev) => ({ ...prev, [ph.key]: e.target.value }))}
                              rows={3}
                              className="w-full px-3 py-2 text-sm bg-[var(--bg-subtle)] border border-[var(--border-color)] rounded-lg text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-gold-400/50 resize-none"
                            />
                          ) : (
                            <input
                              autoFocus={idx === 0}
                              type={ph.type === 'number' ? 'number' : ph.type === 'date' ? 'date' : 'text'}
                              value={placeholderValues[ph.key] ?? ''}
                              onChange={(e) => setPlaceholderValues((prev) => ({ ...prev, [ph.key]: e.target.value }))}
                              className="w-full px-3 py-2 text-sm bg-[var(--bg-subtle)] border border-[var(--border-color)] rounded-lg text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-gold-400/50"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Error */}
                  {error && (
                    <div className="p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg">
                      {error}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            {!result && (
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border-color)]">
                <button
                  type="button"
                  onClick={() => { if (!generating) setSelectedTemplate(null); }}
                  disabled={generating}
                  className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-foreground rounded-lg hover:bg-[var(--bg-subtle)] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-gold-500 text-white hover:bg-gold-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 active:scale-[0.96]"
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      {selectedTemplate.generation_mode === 'ai' ? (
                        <Sparkles className="w-4 h-4" />
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                      Generate Document
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Template Gallery ────────────────────────────── */}
      {loadingTemplates ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-card border border-[var(--border-color)] rounded-xl p-5 space-y-3">
              <div className="h-5 w-2/3 bg-[var(--bg-subtle)] rounded skeleton-shimmer" />
              <div className="h-4 w-full bg-[var(--bg-subtle)] rounded skeleton-shimmer" />
              <div className="h-4 w-1/2 bg-[var(--bg-subtle)] rounded skeleton-shimmer" />
            </div>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-20 text-[var(--text-muted)]">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No templates available yet.</p>
          <p className="text-xs mt-1">Ask an administrator to create document templates.</p>
        </div>
      ) : (
        Object.entries(CATEGORY_CONFIG).map(([catKey, catConfig]) => {
          const catTemplates = grouped[catKey];
          if (!catTemplates || catTemplates.length === 0) return null;

          const IconComponent = catConfig.icon;

          return (
            <div key={catKey} className="space-y-3">
              <div className="flex items-center gap-2">
                <IconComponent className={`w-4 h-4 ${catConfig.color}`} />
                <h2 className="text-sm font-semibold text-foreground">{catConfig.label}</h2>
                <span className="text-[10px] text-[var(--text-muted)]">({catTemplates.length})</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 stagger-children">
                {catTemplates.map((t) => {
                  const modeBadge = MODE_BADGES[t.generation_mode] ?? MODE_BADGES.ai;

                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleSelectTemplate(t)}
                      className="group text-left bg-card border border-[var(--border-color)] rounded-xl p-4 hover:border-gold-400/50 hover:shadow-md dark:hover:shadow-gold-500/5 transition-all duration-200 action-lift active:scale-[0.97]"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <IconComponent className={`w-5 h-5 ${catConfig.color} opacity-60 group-hover:opacity-100 transition-opacity`} />
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${modeBadge.className}`}>
                          {modeBadge.label}
                        </span>
                      </div>
                      <h3 className="text-sm font-medium text-foreground group-hover:text-gold-600 dark:group-hover:text-gold-400 transition-colors">
                        {t.name}
                      </h3>
                      {t.description && (
                        <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">
                          {t.description}
                        </p>
                      )}
                      {t.subcategory && (
                        <p className="text-[10px] text-[var(--text-muted)] mt-2">{t.subcategory}</p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      {/* ── Recent Documents ────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[var(--text-muted)]" />
          <h2 className="text-sm font-semibold text-foreground">Recent Documents</h2>
        </div>

        <div className="bg-card border border-[var(--border-color)] rounded-xl shadow-[var(--shadow-card)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-color)]">
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Date</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Template</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Matter</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Client</th>
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Download</th>
                </tr>
              </thead>
              <tbody>
                {loadingRecent ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-[var(--border-color)]">
                      {Array.from({ length: 5 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-[var(--bg-subtle)] rounded skeleton-shimmer" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : recentDocs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-[var(--text-muted)] text-xs">
                      Your generated documents will appear here.
                    </td>
                  </tr>
                ) : (
                  recentDocs.map((doc) => (
                    <tr key={doc.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-subtle)] transition-colors">
                      <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">
                        {new Date(doc.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-4 py-2.5 text-sm font-medium text-foreground">
                        {doc.template_name}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">
                        {doc.matter_name ?? '\u2014'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">
                        {doc.client_name ?? '\u2014'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => getDownloadUrl(doc.storage_path)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-gold-600 dark:text-gold-400 hover:text-gold-700 dark:hover:text-gold-300 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          {doc.file_name}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
