'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Search, RefreshCw, Trash2, Check, Clock, ExternalLink } from 'lucide-react';
import { confirmAction } from '@/components/ui/confirm';

export interface PortalUserRow {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
  client_id: string;
  client_name: string;
}

type StatusFilter = 'all' | 'invited' | 'active';

export default function PortalUsersTable({ initialRows }: { initialRows: PortalUserRow[] }) {
  const [rows, setRows] = useState(initialRows);
  useEffect(() => { setRows(initialRows); }, [initialRows]);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status === 'invited' && r.last_login_at) return false;
      if (status === 'active' && !r.last_login_at) return false;
      if (!q) return true;
      return (
        r.email.toLowerCase().includes(q) ||
        (r.name ?? '').toLowerCase().includes(q) ||
        r.client_name.toLowerCase().includes(q)
      );
    });
  }, [rows, query, status]);

  const pendingCount = rows.filter((r) => !r.last_login_at).length;
  const activeCount = rows.filter((r) => r.last_login_at).length;

  async function handleResend(row: PortalUserRow) {
    const ok = await confirmAction({
      title: `Resend invitation to ${row.email}?`,
      message: 'A new invitation email will be sent. Any previous invitation link will stop working.',
      confirmLabel: 'Resend',
    });
    if (!ok) return;
    setRowBusy(row.id);
    const res = await fetch(
      `/api/clients/${encodeURIComponent(row.client_id)}/users/${encodeURIComponent(row.id)}/resend`,
      { method: 'POST' },
    );
    const body = await res.json().catch(() => ({}));
    setRowBusy(null);
    if (!res.ok) {
      toast.error(body?.error || 'Could not resend invitation.');
      return;
    }
    toast.success(`Resent invitation to ${row.email}`);
    // Bump created_at locally so the row's "Invited" timestamp reflects the
    // new invitation immediately.
    setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, created_at: new Date().toISOString() } : r));
  }

  async function handleRevoke(row: PortalUserRow) {
    const ok = await confirmAction({
      title: `Revoke portal access for ${row.email}?`,
      message: 'They will no longer be able to sign in. This cannot be undone.',
      confirmLabel: 'Revoke',
      danger: true,
    });
    if (!ok) return;
    setRowBusy(row.id);
    const res = await fetch(
      `/api/clients/${encodeURIComponent(row.client_id)}/users/${encodeURIComponent(row.id)}`,
      { method: 'DELETE' },
    );
    const body = await res.json().catch(() => ({}));
    setRowBusy(null);
    if (!res.ok) {
      toast.error(body?.error || 'Could not revoke access.');
      return;
    }
    toast.success(`Revoked ${row.email}`);
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  }

  function formatDate(s: string | null): string {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'Asia/Manila',
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search by client, name, or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-card placeholder:text-[var(--text-muted)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20"
          />
        </div>
        <div className="flex rounded-lg border border-[var(--border-color)] bg-card p-0.5 text-xs">
          {[
            { v: 'all' as const, label: `All (${rows.length})` },
            { v: 'invited' as const, label: `Pending (${pendingCount})` },
            { v: 'active' as const, label: `Active (${activeCount})` },
          ].map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setStatus(opt.v)}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                status === opt.v
                  ? 'bg-navy-900 dark:bg-gold-400 text-white dark:text-navy-950 font-medium'
                  : 'text-[var(--text-secondary)] hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card border border-[var(--border-color)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-subtle border-b border-[var(--border-color)] text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Client</th>
              <th className="text-left px-4 py-3 font-medium">User</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Invited</th>
              <th className="text-left px-4 py-3 font-medium">Last login</th>
              <th className="text-right px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                  {rows.length === 0
                    ? 'No portal users yet. Invite the first one from a client detail page.'
                    : 'No portal users match your filters.'}
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const isPending = !row.last_login_at;
                const isBusy = rowBusy === row.id;
                return (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--border-color)] last:border-0 hover:bg-subtle/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/clients/${encodeURIComponent(row.client_id)}/users`}
                        className="inline-flex items-center gap-1.5 text-foreground hover:text-gold-600 dark:hover:text-gold-400 transition-colors"
                      >
                        <span className="truncate max-w-[18rem]">{row.client_name}</span>
                        <ExternalLink className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-foreground truncate">{row.name ?? '—'}</p>
                        <p className="text-xs text-[var(--text-secondary)] truncate">{row.email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {isPending ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                          <Clock className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                          Invited
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
                          <Check className="w-3.5 h-3.5" />
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                      {formatDate(row.created_at)}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                      {formatDate(row.last_login_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {isPending && (
                          <button
                            type="button"
                            onClick={() => handleResend(row)}
                            disabled={isBusy}
                            title="Resend invitation"
                            aria-label={`Resend invitation to ${row.email}`}
                            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-subtle transition-colors disabled:opacity-40 disabled:cursor-wait"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRevoke(row)}
                          disabled={isBusy}
                          title="Revoke access"
                          aria-label={`Revoke ${row.email}`}
                          className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-wait"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
