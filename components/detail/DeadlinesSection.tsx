'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Scale, Trash2, ExternalLink, AlertTriangle, BookOpen,
  ChevronDown, ChevronRight, Plus,
} from 'lucide-react';
import Link from 'next/link';
import { parseRuleCitations, sectionHref } from '@/lib/rules/model';
import { confirmAction } from '@/components/ui/confirm';
import { toast } from 'sonner';

interface ChainItem {
  id: number;
  rule_deadline_id: string;
  entity_type: 'deliverable' | 'hearing';
  entity_id: string;
  label: string;
  legal_basis: string;
  due_date: string;
  is_reglementary: boolean;
  notes: string;
}

interface Chain {
  id: number;
  matter_id: string;
  rule_set_id: string;
  trigger_date: string;
  created_by: string;
  created_at: string;
  deadline_chain_items: ChainItem[];
}

interface Props {
  matterId: string;
  matterType: string;
  canEdit: boolean;
  onApplyRules?: () => void;
}

function formatDate(d: string): string {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

function isOverdue(date: string): boolean {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  return date < today;
}

// Map rule_set_id to display name
const RULE_SET_NAMES: Record<string, string> = {
  litigation_service_regular: 'Service of Summons (Regular)',
  litigation_service_summary: 'Service of Summons (Summary)',
  litigation_adverse_judgment: 'Receipt of Adverse Judgment',
  litigation_mr: 'Receipt of Resolution/Order',
  litigation_certiorari: 'Petition for Certiorari',
  labor_summons: 'Receipt of Summons (NLRC)',
  labor_decision: 'Receipt of LA Decision',
  labor_nlrc_resolution: 'Receipt of NLRC Resolution',
  tax_assessment: 'Receipt of Final Assessment Notice',
  tax_adverse_decision: 'Receipt of Adverse CIR Decision',
  tax_cta_petition: 'Filing of CTA Petition',
};

export default function DeadlinesSection({ matterId, matterType, canEdit, onApplyRules }: Props) {
  const [chains, setChains] = useState<Chain[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedChains, setExpandedChains] = useState<Set<number>>(new Set());

  const fetchChains = useCallback(async () => {
    const res = await fetch(`/api/deadlines?matterId=${matterId}`);
    if (res.ok) {
      const { data } = await res.json();
      setChains(data ?? []);
      // Auto-expand all chains
      setExpandedChains(new Set((data ?? []).map((c: Chain) => c.id)));
    }
    setLoading(false);
  }, [matterId]);

  useEffect(() => { fetchChains(); }, [fetchChains]);

  const toggleChain = (chainId: number) => {
    setExpandedChains((prev) => {
      const next = new Set(prev);
      if (next.has(chainId)) next.delete(chainId);
      else next.add(chainId);
      return next;
    });
  };

  const handleDeleteChain = async (chainId: number) => {
    if (!(await confirmAction({ title: 'Delete this deadline chain?', message: 'All associated deliverables and hearings are deleted with it.', confirmLabel: 'Delete', danger: true }))) return;
    const index = chains.findIndex((c) => c.id === chainId);
    const removed = chains[index];
    setChains((prev) => prev.filter((c) => c.id !== chainId));
    const res = await fetch('/api/deadlines', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chainId }),
    }).catch(() => null);
    if (!res?.ok && removed) {
      setChains((prev) => [...prev.slice(0, index), removed, ...prev.slice(index)]);
      toast.error('Failed to delete deadline chain');
    }
  };

  // Only show for applicable matter types
  const applicableTypes = ['Litigation', 'Labor', 'Tax'];
  const isApplicable = applicableTypes.some((t) =>
    matterType.toLowerCase().includes(t.toLowerCase()),
  );

  if (!isApplicable) return null;
  if (loading) return null;

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up mb-6">
      <div className="px-6 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-[var(--text-muted)]" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Court Rules / Deadline Chains
          </h2>
        </div>
        {canEdit && (
          <button
            onClick={onApplyRules}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-navy-600 dark:text-navy-400 hover:bg-navy-50 dark:hover:bg-navy-500/10 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Apply Court Rules
          </button>
        )}
      </div>

      {chains.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <Scale className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-3 opacity-30" />
          <p className="text-sm text-[var(--text-muted)]">No deadline chains applied</p>
          {canEdit && (
            <button
              onClick={onApplyRules}
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-navy-600 dark:text-navy-400 bg-navy-50 dark:bg-navy-500/10 hover:bg-navy-100 dark:hover:bg-navy-500/15 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Apply Court Rules
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-[var(--border-color)]">
          {chains.map((chain) => {
            const isExpanded = expandedChains.has(chain.id);
            const items = chain.deadline_chain_items ?? [];
            const overdueCount = items.filter((i) => isOverdue(i.due_date)).length;

            return (
              <div key={chain.id}>
                {/* Chain header */}
                <div
                  className="px-5 py-3 flex items-center gap-3 cursor-pointer hover:bg-gold-50/30 dark:hover:bg-[rgba(185, 143, 69,0.04)] transition-colors"
                  onClick={() => toggleChain(chain.id)}
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {RULE_SET_NAMES[chain.rule_set_id] ?? chain.rule_set_id}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Trigger: {formatDate(chain.trigger_date)} &middot; {items.length} deadline{items.length !== 1 ? 's' : ''}
                      {overdueCount > 0 && (
                        <span className="text-red-500 dark:text-red-400 ml-2">
                          {overdueCount} overdue
                        </span>
                      )}
                    </p>
                  </div>
                  {canEdit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteChain(chain.id); }}
                      className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
                      title="Delete chain"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Chain items */}
                {isExpanded && items.length > 0 && (
                  <div className="px-5 pb-3">
                    <div className="ml-4 border-l-2 border-[var(--border-color)] pl-4 space-y-2">
                      {items
                        .sort((a, b) => a.due_date.localeCompare(b.due_date))
                        .map((item) => {
                          const overdue = isOverdue(item.due_date);
                          const href = item.entity_type === 'deliverable'
                            ? `/dashboard/deliverables/${item.entity_id}`
                            : `/dashboard/hearings/${item.entity_id}`;

                          return (
                            <div
                              key={item.id}
                              className="flex items-start gap-3 py-2"
                            >
                              {/* Timeline dot */}
                              <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 -ml-[21px] ${
                                overdue ? 'bg-red-500' :
                                item.entity_type === 'hearing' ? 'bg-red-400' : 'bg-violet-400'
                              }`} />

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <Link
                                    href={href}
                                    className="text-xs font-medium text-[var(--text-primary)] hover:text-gold-600 dark:hover:text-gold-400 transition-colors"
                                  >
                                    {item.label}
                                  </Link>
                                  {item.is_reglementary && (
                                    <span
                                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400"
                                      title="Reglementary period — jurisdictional, non-extendable"
                                    >
                                      <AlertTriangle className="w-2.5 h-2.5" />
                                      Reglementary
                                    </span>
                                  )}
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                    item.entity_type === 'hearing'
                                      ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400'
                                      : 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400'
                                  }`}>
                                    {item.entity_type === 'hearing' ? 'Hearing' : 'Filing'}
                                  </span>
                                </div>

                                <div className="flex items-center gap-3 mt-0.5">
                                  <span className={`text-[11px] font-mono ${
                                    overdue ? 'text-red-500 dark:text-red-400 font-medium' : 'text-[var(--text-muted)]'
                                  }`}>
                                    {overdue && 'Overdue \u2022 '}{formatDate(item.due_date)}
                                  </span>
                                  {item.legal_basis && (
                                    <LegalBasis text={item.legal_basis} />
                                  )}
                                </div>

                                {item.notes && (
                                  <p className="text-[10px] text-[var(--text-muted)] mt-1 leading-relaxed">
                                    {item.notes}
                                  </p>
                                )}
                              </div>

                              <Link
                                href={href}
                                className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0"
                                title={`View ${item.entity_type}`}
                              >
                                <ExternalLink className="w-3 h-3" />
                              </Link>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The legal basis, linked to the rule text in the Library when it names a Rules of Court provision. */
function LegalBasis({ text }: { text: string }) {
  const cite = parseRuleCitations(text)[0];
  const body = (
    <>
      <BookOpen className="w-3 h-3" />
      {text}
    </>
  );
  if (!cite) return <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]">{body}</span>;
  return (
    <Link
      href={sectionHref(cite.source, cite.rule, cite.section)}
      title="Read the rule in the Library"
      className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-gold-600 dark:hover:text-gold-400 underline-offset-2 hover:underline"
    >
      {body}
    </Link>
  );
}
