'use client';

import { AlertTriangle, Shield, ShieldAlert, ShieldCheck, ExternalLink } from 'lucide-react';
import type { ConflictResult, ConflictCheckResponse } from '@/types/conflicts';

const SEVERITY_CONFIG = {
  high: {
    icon: ShieldAlert,
    bg: 'bg-red-50 dark:bg-red-500/10',
    border: 'border-red-200 dark:border-red-500/20',
    text: 'text-red-700 dark:text-red-400',
    badge: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
    label: 'High',
  },
  medium: {
    icon: AlertTriangle,
    bg: 'bg-amber-50 dark:bg-amber-500/10',
    border: 'border-amber-200 dark:border-amber-500/20',
    text: 'text-amber-700 dark:text-amber-400',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
    label: 'Medium',
  },
  low: {
    icon: Shield,
    bg: 'bg-blue-50 dark:bg-blue-500/10',
    border: 'border-blue-200 dark:border-blue-500/20',
    text: 'text-blue-700 dark:text-blue-400',
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
    label: 'Low',
  },
};

function ConflictItem({ conflict }: { conflict: ConflictResult }) {
  const config = SEVERITY_CONFIG[conflict.severity];
  const Icon = config.icon;

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${config.bg} ${config.border}`}>
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${config.text}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold uppercase rounded ${config.badge}`}>
            {config.label}
          </span>
          <span className="text-[10px] text-[var(--text-muted)] font-mono">
            {Math.round(conflict.confidence * 100)}% match
          </span>
        </div>
        <p className="text-xs text-[var(--text-primary)] leading-relaxed">{conflict.description}</p>
        {conflict.relatedMatterId && (
          <a
            href={`/dashboard/matters/${conflict.relatedMatterId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1.5 text-[11px] font-medium text-navy-600 dark:text-navy-400 hover:underline"
          >
            View matter <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

interface Props {
  result: ConflictCheckResponse | null;
  loading?: boolean;
  compact?: boolean;
}

export default function ConflictCheckResults({ result, loading, compact }: Props) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 bg-[var(--card-bg)] rounded-lg border border-[var(--border-color)]">
        <div className="w-4 h-4 border-2 border-navy-300 border-t-navy-600 dark:border-navy-500/40 dark:border-t-navy-300 rounded-full animate-spin" />
        <span className="text-xs text-[var(--text-muted)]">Checking for conflicts...</span>
      </div>
    );
  }

  if (!result) return null;

  const { conflicts } = result;
  const highCount = conflicts.filter((c) => c.severity === 'high').length;
  const mediumCount = conflicts.filter((c) => c.severity === 'medium').length;

  if (conflicts.length === 0) {
    return (
      <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg border border-emerald-200 dark:border-emerald-500/20">
        <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">No conflicts found</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-3 p-3 bg-[var(--card-bg)] rounded-lg border border-[var(--border-color)]">
        <ShieldAlert className="w-4 h-4 text-amber-500" />
        <span className="text-xs font-medium text-[var(--text-primary)]">
          {conflicts.length} potential conflict{conflicts.length > 1 ? 's' : ''} found
        </span>
        {highCount > 0 && (
          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300 rounded">
            {highCount} high
          </span>
        )}
        {mediumCount > 0 && (
          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 rounded">
            {mediumCount} medium
          </span>
        )}
      </div>

      {/* Conflict details */}
      {!compact && (
        <div className="space-y-2">
          {conflicts.map((c, i) => (
            <ConflictItem key={i} conflict={c} />
          ))}
        </div>
      )}

      {compact && conflicts.length > 0 && (
        <div className="space-y-2">
          {conflicts.slice(0, 3).map((c, i) => (
            <ConflictItem key={i} conflict={c} />
          ))}
          {conflicts.length > 3 && (
            <p className="text-[11px] text-[var(--text-muted)] text-center">
              +{conflicts.length - 3} more conflict{conflicts.length - 3 > 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
