'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  AlertTriangle, Building2, Check, Inbox, Loader2, Mail, Phone,
  Scale, ShieldQuestion, Stamp, UserPlus, X,
} from 'lucide-react';

export interface SubmissionRow {
  id: number;
  kind: 'general' | 'trademark' | 'incorporation';
  full_name: string;
  email: string;
  phone: string;
  company: string;
  message: string;
  details: Record<string, unknown>;
  status: string;
  created_at: string;
}

interface ConflictHit {
  severity: string;
  description: string;
  relatedMatterName?: string;
  relatedPartyName?: string;
  relatedClientName?: string;
}

interface Props {
  initialSubmissions: SubmissionRow[];
}

const tsFmt = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function kindMeta(kind: SubmissionRow['kind']) {
  switch (kind) {
    case 'trademark':
      return { label: 'Trademark', icon: <Stamp className="w-3 h-3" /> };
    case 'incorporation':
      return { label: 'Incorporation', icon: <Building2 className="w-3 h-3" /> };
    default:
      return { label: 'General', icon: <Scale className="w-3 h-3" /> };
  }
}

function DetailRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <p className="text-xs">
      <span className="text-stone-400 dark:text-stone-500">{label}: </span>
      <span className="text-stone-700 dark:text-stone-200">{value}</span>
    </p>
  );
}

export default function SubmissionsClient({ initialSubmissions }: Props) {
  const [rows, setRows] = useState<SubmissionRow[]>(initialSubmissions);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [conflicts, setConflicts] = useState<Record<number, { checked: boolean; hits: ConflictHit[] }>>({});

  async function runConflictCheck(s: SubmissionRow) {
    setBusyId(s.id);
    try {
      const names = [s.full_name];
      if (s.company) names.push(s.company);
      const d = s.details as { markNames?: string[]; proposedNames?: string[] };
      for (const extra of [...(d.markNames ?? []), ...(d.proposedNames ?? [])]) if (extra) names.push(extra);

      const res = await fetch('/api/conflicts/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      });
      if (!res.ok) throw new Error('Conflict check failed');
      const body = await res.json();
      const hits = (body.conflicts ?? []) as ConflictHit[];
      setConflicts((c) => ({ ...c, [s.id]: { checked: true, hits } }));
      toast.success(hits.length === 0 ? 'No conflicts found' : `${hits.length} potential conflict${hits.length === 1 ? '' : 's'} found`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Conflict check failed');
    } finally {
      setBusyId(null);
    }
  }

  async function act(s: SubmissionRow, action: 'convert' | 'dismiss') {
    setBusyId(s.id);
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== s.id));
    try {
      const res = await fetch(`/api/intakes/submissions/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Action failed');

      if (action === 'convert') {
        toast.success(`${s.full_name} added to the prospects pipeline`);
      } else {
        toast.success('Submission dismissed');
      }
    } catch (err) {
      setRows(prev);
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="mt-10 flex flex-col items-center justify-center text-center py-16 rounded-xl border border-dashed border-stone-200 dark:border-[rgba(255,255,255,0.08)]">
        <Inbox className="w-10 h-10 text-stone-300 dark:text-stone-600 mb-3" />
        <p className="text-sm font-medium text-stone-600 dark:text-stone-300">No pending submissions</p>
        <p className="text-xs text-stone-400 dark:text-stone-500 mt-1 max-w-md">
          Inquiries submitted through the public intake form (<span className="font-mono">/intake</span>) appear here for review.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {rows.map((s) => {
        const busy = busyId === s.id;
        const meta = kindMeta(s.kind);
        const check = conflicts[s.id];
        const d = s.details as Record<string, string | string[] | undefined>;
        return (
          <div key={s.id} className="rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.08)] bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{s.full_name}</span>
                  {s.company && <span className="text-xs text-stone-500 dark:text-stone-400">· {s.company}</span>}
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-stone-100 text-stone-600 dark:bg-white/5 dark:text-stone-300">
                    {meta.icon}
                    {meta.label}
                  </span>
                  {s.status === 'in_review' && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-gold-50 text-gold-700 dark:bg-gold-400/10 dark:text-gold-300">
                      In review
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-stone-500 dark:text-stone-400">
                  <a href={`mailto:${s.email}`} className="inline-flex items-center gap-1 hover:underline">
                    <Mail className="w-3 h-3" /> {s.email}
                  </a>
                  {s.phone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {s.phone}
                    </span>
                  )}
                </div>
              </div>
              <span className="text-[11px] text-stone-400 dark:text-stone-500 shrink-0">
                {tsFmt.format(new Date(s.created_at))}
              </span>
            </div>

            {/* Kind-specific details */}
            <div className="mt-3 space-y-1">
              {s.kind === 'trademark' && (
                <>
                  <DetailRow label="Marks" value={((d.markNames as string[]) ?? []).join(' · ')} />
                  <DetailRow label="Goods/services" value={(d.goodsServices as string) ?? ''} />
                  <DetailRow label="In use" value={d.inUse === 'yes' ? `Yes${d.inUseSince ? ` (since ${d.inUseSince})` : ''}` : 'Not yet'} />
                  <DetailRow label="Owner" value={(d.ownerType as string) ?? ''} />
                </>
              )}
              {s.kind === 'incorporation' && (
                <>
                  <DetailRow label="Proposed names" value={((d.proposedNames as string[]) ?? []).join(' · ')} />
                  <DetailRow label="Purpose" value={(d.businessPurpose as string) ?? ''} />
                  <DetailRow label="Capital" value={(d.authorizedCapital as string) ?? ''} />
                  <DetailRow label="Incorporators" value={(d.incorporators as string) ?? ''} />
                  <DetailRow label="Timeline" value={(d.timeline as string) ?? ''} />
                </>
              )}
              {s.message && (
                <p className="text-sm text-stone-600 dark:text-stone-300 whitespace-pre-wrap mt-2">{s.message}</p>
              )}
            </div>

            {/* Conflict check results */}
            {check?.checked && (
              <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                check.hits.length === 0
                  ? 'border-emerald-200 dark:border-emerald-400/20 bg-emerald-50/50 dark:bg-emerald-400/5 text-emerald-700 dark:text-emerald-300'
                  : 'border-amber-200 dark:border-amber-400/20 bg-amber-50/50 dark:bg-amber-400/5 text-amber-700 dark:text-amber-300'
              }`}>
                {check.hits.length === 0 ? (
                  <span className="inline-flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> No conflicts found against existing parties and clients.</span>
                ) : (
                  <div className="space-y-1">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <AlertTriangle className="w-3.5 h-3.5" /> {check.hits.length} potential conflict{check.hits.length === 1 ? '' : 's'}:
                    </span>
                    {check.hits.slice(0, 5).map((h, i) => (
                      <p key={i}>
                        [{h.severity}] {h.description}
                        {h.relatedMatterName ? ` — ${h.relatedMatterName}` : ''}
                      </p>
                    ))}
                    {check.hits.length > 5 && <p>…and {check.hits.length - 5} more.</p>}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={() => runConflictCheck(s)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-stone-200 dark:border-[rgba(255,255,255,0.1)] hover:bg-stone-50 dark:hover:bg-white/5 disabled:opacity-50 transition-colors"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldQuestion className="w-4 h-4" />}
                Run conflict check
              </button>
              <button
                onClick={() => act(s, 'convert')}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gold-500 hover:bg-gold-600 text-white disabled:opacity-50 transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                Convert to prospect
              </button>
              <button
                onClick={() => act(s, 'dismiss')}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-stone-200 dark:border-[rgba(255,255,255,0.1)] hover:bg-stone-50 dark:hover:bg-white/5 disabled:opacity-50 transition-colors"
              >
                <X className="w-4 h-4" />
                Dismiss
              </button>
              <Link
                href="/dashboard/prospects"
                className="ml-auto text-xs text-stone-400 dark:text-stone-500 hover:underline"
              >
                Prospects board →
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
