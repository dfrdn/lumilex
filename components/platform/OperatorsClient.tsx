'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, ShieldOff, UserPlus } from 'lucide-react';
import { Panel, Field, Caution, postJson } from '@/components/platform/form-ui';
import type { OperatorRow } from '@/lib/platform/auth';

/**
 * Add and revoke operator access.
 *
 * The lockout rule is enforced server-side (`checkOperatorDeactivation`) and
 * this component does not restate it — it surfaces the refusal. The one thing
 * it does add is the confirmation: deactivating your own access is allowed but
 * irreversible for the person doing it, so it must not be one click on a row in
 * a list.
 */
export default function OperatorsClient({
  initial,
  selfAuthUserId,
}: {
  initial: OperatorRow[];
  selfAuthUserId: string;
}) {
  const [operators, setOperators] = useState(initial);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const activeCount = operators.filter((o) => o.active).length;

  async function add() {
    setBusy('add');
    try {
      const json = await postJson('/api/platform/operators', 'POST', { email, name, password });
      setOperators(json.operators as OperatorRow[]);
      const outcome = json.outcome as string;
      toast.success(
        outcome === 'created'
          ? `${email} added`
          : outcome === 'reactivated'
            ? `${email} reactivated`
            : `${email} was already an active operator`,
      );
      setEmail('');
      setName('');
      setPassword('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add operator');
    } finally {
      setBusy(null);
    }
  }

  async function setActive(row: OperatorRow, active: boolean, confirmSelf?: boolean) {
    setBusy(row.authUserId);
    try {
      const json = await postJson('/api/platform/operators', 'PATCH', {
        authUserId: row.authUserId,
        active,
        ...(confirmSelf ? { confirmSelf: true } : {}),
      });
      setOperators(json.operators as OperatorRow[]);
      toast.success(active ? `${row.email} reactivated` : `${row.email} deactivated`);
      if (!active && row.authUserId === selfAuthUserId) {
        toast.message('That was your own access — reload and you will be redirected away.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  function deactivate(row: OperatorRow) {
    const self = row.authUserId === selfAuthUserId;
    if (self) {
      const ok = window.confirm(
        `${row.email} is your own operator access.\n\n` +
          'You will lose /platform immediately and only another operator can restore it. ' +
          'Continue?',
      );
      if (!ok) return;
      void setActive(row, false, true);
      return;
    }
    void setActive(row, false);
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <Panel
        title="Roster"
        description={`${activeCount} active of ${operators.length}.`}
      >
        <ul className="divide-y divide-[var(--border-color)] rounded-lg border border-[var(--border-color)]">
          {operators.map((row) => {
            const self = row.authUserId === selfAuthUserId;
            const lastActive = row.active && activeCount <= 1;
            return (
              <li key={row.authUserId} className="flex items-center gap-3 px-3 py-3">
                {row.active ? (
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <ShieldOff className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground truncate">
                    {row.name || row.email}
                    {self && (
                      <span className="ml-2 rounded-full bg-subtle px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
                        you
                      </span>
                    )}
                  </p>
                  {row.name && (
                    <p className="text-xs text-[var(--text-secondary)] truncate">{row.email}</p>
                  )}
                </div>
                {!row.active && (
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                    deactivated
                  </span>
                )}
                {row.active ? (
                  <button
                    type="button"
                    disabled={busy !== null || lastActive}
                    title={
                      lastActive
                        ? 'The last active operator cannot be deactivated — add another first.'
                        : undefined
                    }
                    onClick={() => deactivate(row)}
                    className="text-[11px] px-2 py-1 rounded-md text-[var(--text-secondary)] hover:text-red-600 hover:bg-subtle disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {busy === row.authUserId ? 'Working…' : 'Deactivate'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => setActive(row, true)}
                    className="text-[11px] px-2 py-1 rounded-md text-[var(--text-secondary)] hover:text-foreground hover:bg-subtle disabled:opacity-40"
                  >
                    {busy === row.authUserId ? 'Working…' : 'Reactivate'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <Caution>
          The last active operator cannot be deactivated, by anyone. `/platform` would then be
          unreachable to everyone, and the only way back in is{' '}
          <code className="font-mono">scripts/bootstrap-platform-operator.ts</code> run by whoever
          holds the service-role key. Add the replacement first.
        </Caution>
      </Panel>

      <Panel
        title="Add an operator"
        description="Idempotent per email. A person who already has an auth user — a firm's staff member, say — is bound to it and their password is left alone; a deactivated operator is reactivated."
        footer={
          <button
            type="button"
            onClick={add}
            disabled={busy !== null || !email.trim() || password.trim().length < 12}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-navy-800 text-white hover:bg-navy-700 disabled:opacity-50 transition-colors"
          >
            {busy === 'add' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UserPlus className="w-4 h-4" />
            )}
            Add operator
          </button>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Email" value={email} onChange={setEmail} placeholder="ops@lumilex.app" />
          <Field label="Name" value={name} onChange={setName} placeholder="Optional" />
        </div>
        <Field
          label="Password"
          value={password}
          onChange={setPassword}
          type="password"
          hint="At least 12 characters. Used only if this email has no auth user yet — an existing one keeps its own password. There is no reset flow on this surface."
        />
      </Panel>
    </div>
  );
}
