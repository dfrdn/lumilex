'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Mail, UserPlus, AlertCircle, Check, Clock, ChevronLeft, Building2, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { confirmAction } from '@/components/ui/confirm';

interface ClientUser {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export default function ClientUsersSection({
  clientId,
  clientName,
  initialUsers,
}: {
  clientId: string;
  clientName: string;
  initialUsers: ClientUser[];
}) {
  const [users, setUsers] = useState(initialUsers);
  useEffect(() => { setUsers(initialUsers); }, [initialUsers]);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  async function handleResend(user: ClientUser) {
    const ok = await confirmAction({
      title: `Resend invitation to ${user.email}?`,
      message: 'A new invitation email will be sent. Any previous invitation link will stop working.',
      confirmLabel: 'Resend',
    });
    if (!ok) return;

    setRowBusy(user.id);
    const res = await fetch(
      `/api/clients/${encodeURIComponent(clientId)}/users/${encodeURIComponent(user.id)}/resend`,
      { method: 'POST' },
    );
    const body = await res.json().catch(() => ({}));
    setRowBusy(null);
    if (!res.ok) {
      toast.error(body?.error || 'Could not resend invitation.');
      return;
    }
    toast.success(`Resent invitation to ${user.email}`);
    setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, created_at: new Date().toISOString() } : u));
  }

  async function handleRevoke(user: ClientUser) {
    const ok = await confirmAction({
      title: `Revoke portal access for ${user.email}?`,
      message: 'They will no longer be able to sign in. This cannot be undone.',
      confirmLabel: 'Revoke',
      danger: true,
    });
    if (!ok) return;

    setRowBusy(user.id);
    const res = await fetch(
      `/api/clients/${encodeURIComponent(clientId)}/users/${encodeURIComponent(user.id)}`,
      { method: 'DELETE' },
    );
    const body = await res.json().catch(() => ({}));
    setRowBusy(null);
    if (!res.ok) {
      toast.error(body?.error || 'Could not revoke access.');
      return;
    }
    toast.success(`Revoked ${user.email}`);
    setUsers((prev) => prev.filter((u) => u.id !== user.id));
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !name) return;
    setError('');
    setSubmitting(true);

    const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name }),
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(body?.error || 'Could not send invite.');
      setSubmitting(false);
      return;
    }

    toast.success(`Invited ${email}`);
    if (body?.user) {
      setUsers((prev) => [body.user, ...prev]);
    } else {
      // Fall back to a synthetic row so the list shows the invite immediately.
      setUsers((prev) => [{
        id: `temp-${Date.now()}`,
        email,
        name,
        active: false,
        created_at: new Date().toISOString(),
        last_login_at: null,
      }, ...prev]);
    }
    setEmail('');
    setName('');
    setSubmitting(false);
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
    <div className="max-w-3xl mx-auto px-6 py-8">
      <Link
        href={`/dashboard/clients/${encodeURIComponent(clientId)}`}
        className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-foreground transition-colors mb-4"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Back to client
      </Link>

      <div className="mb-8 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-subtle border border-[var(--border-color)] flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5 text-[var(--text-secondary)]" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
            {clientName}
          </p>
          <h1 className="text-xl font-semibold text-foreground mt-0.5">Portal users</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Who from this organization can sign in to the client portal and see their matters,
            deliverables, and status.
          </p>
        </div>
      </div>

      <div className="bg-card border border-[var(--border-color)] rounded-2xl p-6 mb-8">
        <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <UserPlus className="w-4 h-4" /> Invite a portal user
        </h2>
        <form onSubmit={handleInvite} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              required
              maxLength={120}
              className="w-full px-3 py-2.5 text-sm rounded-lg border border-[var(--border-color)] bg-subtle placeholder:text-[var(--text-muted)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20 disabled:opacity-50"
            />
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                required
                className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-[var(--border-color)] bg-subtle placeholder:text-[var(--text-muted)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20 disabled:opacity-50"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !email || !name}
            className="flex items-center justify-center gap-2 bg-navy-900 dark:bg-gold-400 hover:bg-navy-800 dark:hover:bg-gold-300 text-white dark:text-navy-950 font-medium text-sm px-5 py-2.5 rounded-lg transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Sending…' : 'Send invitation'}
          </button>
        </form>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">
          {users.length} {users.length === 1 ? 'user' : 'users'}
        </h2>
        {users.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)] bg-subtle border border-[var(--border-color)] rounded-xl px-4 py-6 text-center">
            No portal users yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {users.map((u) => {
              const isPending = !u.last_login_at;
              const isBusy = rowBusy === u.id;
              return (
                <li
                  key={u.id}
                  className="flex items-center justify-between gap-4 bg-card border border-[var(--border-color)] rounded-xl px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {u.name ?? u.email}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] truncate">{u.email}</p>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <span className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      {isPending ? (
                        <>
                          <Clock className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                          <span>Invited · {formatDate(u.created_at)}</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                          <span>Active · {formatDate(u.last_login_at)}</span>
                        </>
                      )}
                    </span>

                    <div className="flex items-center gap-1">
                      {isPending && (
                        <button
                          type="button"
                          onClick={() => handleResend(u)}
                          disabled={isBusy}
                          title="Resend invitation"
                          aria-label={`Resend invitation to ${u.email}`}
                          className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-subtle transition-colors disabled:opacity-40 disabled:cursor-wait"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRevoke(u)}
                        disabled={isBusy}
                        title="Revoke access"
                        aria-label={`Revoke ${u.email}`}
                        className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-wait"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
