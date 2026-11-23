'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileSignature, Loader2, Download, AlertTriangle, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { failureMessage } from '@/lib/api-error';
import type { EngagementProposalRow } from '@/lib/engagement-proposal/types';
import type { QuoteIssue } from '@/lib/engagement-proposal/quote';

type ProposalWithIssues = EngagementProposalRow & { issues?: QuoteIssue[] };

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone-100 text-stone-700 dark:bg-stone-500/15 dark:text-stone-300',
  sent: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  declined: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  superseded: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-500/15 dark:text-zinc-400',
};

function formatDateTime(d: string): string {
  return new Date(d).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila',
  });
}

export default function ProposalPanel({ intakeId, canEdit }: { intakeId: number; canEdit: boolean }) {
  const [proposals, setProposals] = useState<ProposalWithIssues[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/proposals?intakeId=${intakeId}`)
      .then((r) => (r.ok ? r.json() : { proposals: [] }))
      .then((j) => { if (alive) setProposals(j.proposals ?? []); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [intakeId]);

  const download = async (proposal: ProposalWithIssues) => {
    setDownloading(proposal.id);
    try {
      const r = await fetch(`/api/proposals/${proposal.id}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persist: true }),
      });
      if (!r.ok) throw new Error(await failureMessage(r, 'Could not build the proposal package.'));
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${proposal.content.client.name} Engagement Proposal with Annexes v${proposal.version}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--border-color)] flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Engagement Proposal
          </h2>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
            The signed proposal is the engagement agreement. Annexes are attached from the current fee schedules and firm profile.
          </p>
        </div>
        {canEdit && (
          <Link
            href={`/dashboard/prospects/${intakeId}/proposal`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-navy-900 text-white hover:bg-navy-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white shrink-0"
          >
            {proposals.length ? <FileText className="w-3.5 h-3.5" /> : <FileSignature className="w-3.5 h-3.5" />}
            {/* The editor is where a further version is drafted; this only opens it. */}
            {proposals.length ? 'Open proposal' : 'Draft proposal'}
          </Link>
        )}
      </div>

      {loading ? (
        <div className="px-6 py-6 flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading proposals…
        </div>
      ) : proposals.length === 0 ? (
        <p className="px-6 py-6 text-sm text-[var(--text-muted)]">
          No proposal drafted yet.
        </p>
      ) : (
        <div className="divide-y divide-[var(--border-color)]">
          {proposals.map((p) => {
            const errors = (p.issues ?? []).filter((i) => i.severity === 'error');
            const warnings = (p.issues ?? []).filter((i) => i.severity === 'warning');
            return (
              <div key={p.id} className="px-6 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/dashboard/prospects/proposals/${p.id}`}
                      className="text-sm font-medium text-[var(--text-primary)] hover:underline"
                    >
                      Version {p.version}
                    </Link>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLES[p.status] ?? STATUS_STYLES.draft}`}>
                      {p.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">{p.content.subject}</p>
                  {(errors.length > 0 || warnings.length > 0) && (
                    <p className={`text-[11px] mt-1 flex items-center gap-1 ${errors.length ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-500'}`}>
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      {errors.length
                        ? `${errors.length} figure${errors.length > 1 ? 's' : ''} contradict the fee schedule`
                        : `${warnings.length} figure${warnings.length > 1 ? 's depart' : ' departs'} from the fee schedule`}
                    </p>
                  )}
                  <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{formatDateTime(p.created_at)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => download(p)}
                  disabled={downloading === p.id}
                  title="Download the full package with annexes"
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 shrink-0"
                >
                  {downloading === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
