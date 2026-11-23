'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Loader2, Settings, Search, X, Plus, ChevronDown, ChevronRight,
  Scale, RefreshCw, FileText, Check, Layers, Flag, Lock,
} from 'lucide-react';
import BillingConfigModal from '@/components/finance/BillingConfigModal';

interface BillingConfigRow {
  id: number;
  matter_id: string;
  billing_type: string;
  acceptance_fee: number | null;
  acceptance_fee_paid: boolean;
  monthly_retainer: number | null;
  retainer_hours_cap: number | null;
  hourly_rate_override: number | null;
  fixed_fee_amount: number | null;
  success_fee_percent: number | null;
  success_fee_amount: number | null;
  engagement_date: string | null;
  engagement_file_path: string | null;
  engagement_file_name: string | null;
  billing_settings: Record<string, unknown>;
  notes: string;
  matterName: string;
  clientName: string;
  matterStatus: string;
  updated_at: string;
}

interface UnconfiguredMatter {
  matterId: string;
  name: string;
  clientName: string;
}

function fmt(n: number | null) {
  if (n == null) return '—';
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0 })}`;
}

const TYPE_BADGES: Record<string, { label: string; color: string; icon: typeof Scale }> = {
  litigation: { label: 'Litigation', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: Scale },
  retainer: { label: 'Retainer', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: RefreshCw },
  fixed_retainer: { label: 'Fixed Retainer', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400', icon: Lock },
  fixed_fee: { label: 'Fixed Fee', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: FileText },
  acceptance_per_action: { label: 'Per Action', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: Layers },
  acceptance_per_milestone: { label: 'Per Milestone', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', icon: Flag },
};

function feeSummary(c: BillingConfigRow): string {
  switch (c.billing_type) {
    case 'litigation': {
      const parts: string[] = [];
      if (c.acceptance_fee) parts.push(`Accept: ${fmt(c.acceptance_fee)}${c.acceptance_fee_paid ? ' (paid)' : ''}`);
      parts.push('Hourly');
      if (c.success_fee_percent) parts.push(`Success: ${c.success_fee_percent}%`);
      if (c.success_fee_amount) parts.push(`Success: ${fmt(c.success_fee_amount)}`);
      return parts.join(' + ');
    }
    case 'retainer': {
      const parts = [`${fmt(c.monthly_retainer)}/mo`];
      if (c.retainer_hours_cap) parts.push(`${c.retainer_hours_cap}hrs`);
      parts.push('+ Hourly excess');
      return parts.join(' ');
    }
    case 'fixed_retainer':
      return `${fmt(c.monthly_retainer)}/mo (flat)`;
    case 'fixed_fee':
      return fmt(c.fixed_fee_amount);
    case 'acceptance_per_action': {
      const parts: string[] = [];
      if (c.acceptance_fee) parts.push(`Accept: ${fmt(c.acceptance_fee)}${c.acceptance_fee_paid ? ' (paid)' : ''}`);
      parts.push('+ Per action');
      return parts.join(' ');
    }
    case 'acceptance_per_milestone': {
      const parts: string[] = [];
      if (c.acceptance_fee) parts.push(`Accept: ${fmt(c.acceptance_fee)}${c.acceptance_fee_paid ? ' (paid)' : ''}`);
      parts.push('+ Per milestone');
      return parts.join(' ');
    }
    default:
      return c.billing_type;
  }
}

export default function BillingConfigList() {
  const { data, isLoading: loading, mutate: refreshConfigs } = useSWR<{
    configs?: BillingConfigRow[]; unconfiguredMatters?: UnconfiguredMatter[];
  }>('/api/finance/billing-configs?includeUnconfigured=true');
  const configs = data?.configs ?? [];
  const unconfigured = data?.unconfiguredMatters ?? [];
  const [search, setSearch] = useState('');
  const [showUnconfigured, setShowUnconfigured] = useState(false);
  const [showConfigured, setShowConfigured] = useState(true);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editMatterId, setEditMatterId] = useState('');
  const [editExisting, setEditExisting] = useState<BillingConfigRow | null>(null);


  const filteredConfigs = configs.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.matterName.toLowerCase().includes(q) ||
      c.clientName.toLowerCase().includes(q) ||
      c.billing_type.toLowerCase().includes(q)
    );
  });

  const filteredUnconfigured = unconfigured.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.clientName.toLowerCase().includes(q);
  });

  function openEdit(config: BillingConfigRow) {
    setEditMatterId(config.matter_id);
    setEditExisting(config);
    setModalOpen(true);
  }

  function openNew(matterId: string) {
    setEditMatterId(matterId);
    setEditExisting(null);
    setModalOpen(true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div>
      {/* Search + toggle */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-4 mb-6 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search matters or clients..."
              className="w-full pl-9 pr-8 py-2 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400/20 placeholder:text-[var(--text-muted)]"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--text-muted)] hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowUnconfigured(!showUnconfigured)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              showUnconfigured
                ? 'bg-gold-500 text-white'
                : 'bg-[var(--subtle-bg)] text-[var(--text-secondary)] hover:text-foreground'
            }`}
          >
            <Plus className="w-4 h-4" />
            Unconfigured ({unconfigured.length})
          </button>
        </div>
      </div>

      {/* Configured matters */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden mb-6">
        <button
          type="button"
          onClick={() => setShowConfigured((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)] hover:bg-[var(--subtle-bg)] transition-colors cursor-pointer"
          aria-expanded={showConfigured}
        >
          <div className="flex items-center gap-2">
            {showConfigured ? (
              <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
            ) : (
              <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
            )}
            <h2 className="text-sm font-semibold text-foreground">Configured Matters</h2>
            <span className="text-xs text-[var(--text-muted)]">({filteredConfigs.length})</span>
          </div>
        </button>

        {showConfigured && (
          filteredConfigs.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-[var(--text-muted)]">
              <Settings className="w-8 h-8 mx-auto mb-2 opacity-30" />
              {search ? 'No matching configurations' : 'No billing configurations set up yet'}
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-color)]">
              {filteredConfigs.map((config) => {
                const badge = TYPE_BADGES[config.billing_type] ?? TYPE_BADGES.litigation;
                const BadgeIcon = badge.icon;

                return (
                  <button
                    key={config.id}
                    onClick={() => openEdit(config)}
                    className="w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-[var(--subtle-bg)] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm font-medium text-foreground truncate">{config.matterName}</p>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full shrink-0 ${badge.color}`}>
                          <BadgeIcon className="w-3 h-3" />
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)]">{config.clientName}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm text-[var(--text-secondary)]">{feeSummary(config)}</p>
                      {config.engagement_file_name && (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 justify-end mt-0.5">
                          <Check className="w-3 h-3" />
                          Engagement uploaded
                        </p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                  </button>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* Unconfigured matters */}
      {showUnconfigured && (
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border-color)]">
            <h2 className="text-sm font-semibold text-foreground">Unconfigured Matters</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Active matters without billing configuration</p>
          </div>

          {filteredUnconfigured.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-[var(--text-muted)]">
              {search ? 'No matching matters' : 'All active matters are configured!'}
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-color)] max-h-[400px] overflow-y-auto">
              {filteredUnconfigured.map((matter) => (
                <button
                  key={matter.matterId}
                  onClick={() => openNew(matter.matterId)}
                  className="w-full flex items-center gap-4 px-5 py-3 text-left hover:bg-[var(--subtle-bg)] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{matter.name}</p>
                    <p className="text-xs text-[var(--text-muted)]">{matter.clientName}</p>
                  </div>
                  <span className="flex items-center gap-1 text-xs font-medium text-gold-600 dark:text-gold-400 shrink-0">
                    <Plus className="w-3.5 h-3.5" />
                    Set Up
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <BillingConfigModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        matterId={editMatterId}
        existing={editExisting}
        onSaved={() => {
          setModalOpen(false);
          refreshConfigs();
        }}
      />
    </div>
  );
}
