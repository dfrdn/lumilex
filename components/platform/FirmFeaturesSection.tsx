'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Check, ChevronDown, KeyRound, Loader2, ShieldOff, X } from 'lucide-react';
import { Panel, Label, Toggle, Caution, postJson } from '@/components/platform/form-ui';
import type { OperatorFeatureRow } from '@/lib/platform/firm-detail';

/**
 * The feature switchboard.
 *
 * The important thing this renders is not the toggles — it is the resolved
 * answer underneath them. `lib/firm/features.ts` is the authority on whether a
 * feature is usable, and it says no for five distinguishable reasons. A row
 * that showed only "on" would be lying about a firm that is entitled,
 * switched on, and still missing its client secret.
 *
 * Credentials are one-way. A stored secret never comes back from the server —
 * the row reports which names are set, and the operator can replace or clear,
 * never read.
 */

const REASON_TEXT: Record<string, string> = {
  ok: 'Available',
  not_entitled: 'Not entitled — the firm is not signed up for this feature',
  not_registered: 'No integration row — an unregistered feature is off, never unrestricted',
  switched_off: 'Registered but switched off',
  platform_unconfigured: 'The platform environment this feature needs is not configured',
  credentials_missing: 'This firm’s own credentials or config are incomplete',
  allowance_spent: 'This firm’s AI allowance for this hour or day is spent',
};

const FIELD_LABEL: Record<string, string> = {
  tenantId: 'Directory (tenant) ID',
  clientId: 'Application (client) ID',
  clientSecret: 'Client secret',
  spHostname: 'SharePoint hostname',
  spSitePath: 'SharePoint site path',
  driveUser: 'OneDrive user (UPN)',
  botToken: 'Bot token',
};

export default function FirmFeaturesSection({
  firmId,
  initial,
}: {
  firmId: string;
  initial: OperatorFeatureRow[];
}) {
  const [rows, setRows] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});

  async function patch(key: string, body: Record<string, unknown>, marker: string, ok: string) {
    setBusy(marker);
    try {
      const json = await postJson(`/api/platform/firms/${firmId}/features`, 'PATCH', {
        key,
        ...body,
      });
      setRows(json.features as OperatorFeatureRow[]);
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  function setDraft(key: string, field: string, value: string) {
    setDrafts((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), [field]: value } }));
  }

  return (
    <Panel
      title="Features & credentials"
      description="Three levels, all of which must hold: the firm is entitled to it, the integration row is switched on, and — for a bring-your-own integration — its own credentials are complete. The state under each row is what lib/firm/features.ts actually answers."
    >
      <ul className="divide-y divide-[var(--border-color)] rounded-lg border border-[var(--border-color)]">
        {rows.map((row) => {
          const expanded = open === row.key;
          const configDraft = drafts[row.key] ?? {};
          return (
            <li key={row.key}>
              <div className="flex items-center gap-3 px-3 py-3">
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : row.key)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-foreground">{row.key}</span>
                    {row.available ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                        <Check className="w-3 h-3" />
                        available
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                        <ShieldOff className="w-3 h-3" />
                        {row.reason}
                      </span>
                    )}
                    {row.byo && (
                      <span className="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        bring your own
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-1">
                    {REASON_TEXT[row.reason] ?? row.reason}
                  </p>
                </button>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <span className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                      Entitled
                    </span>
                    <Toggle
                      label={`${row.key} entitlement`}
                      checked={row.entitled}
                      disabled={busy !== null}
                      onChange={(v) =>
                        patch(
                          row.key,
                          { entitled: v },
                          `ent:${row.key}`,
                          v ? `${row.key} entitled` : `${row.key} entitlement removed`,
                        )
                      }
                    />
                  </div>
                  <div className="text-right">
                    <span className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                      Switch
                    </span>
                    <Toggle
                      label={`${row.key} switch`}
                      checked={row.enabled}
                      disabled={busy !== null}
                      onChange={(v) =>
                        patch(
                          row.key,
                          { enabled: v },
                          `on:${row.key}`,
                          v ? `${row.key} switched on` : `${row.key} switched off`,
                        )
                      }
                    />
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${
                      expanded ? 'rotate-180' : ''
                    }`}
                  />
                </div>
              </div>

              {expanded && (
                <div className="px-3 pb-4 space-y-4 border-t border-[var(--border-color)] pt-3 bg-[var(--background)]/40">
                  {!row.byo && (
                    <p className="text-xs text-[var(--text-secondary)]">
                      Not a bring-your-own integration: this feature runs on a platform service or
                      a platform-owned keypair, so there is nothing per-firm to store.
                    </p>
                  )}

                  {row.byo && (
                    <>
                      <div className="flex items-start gap-3">
                        <Toggle
                          label={`${row.key} uses the platform app`}
                          checked={row.usesPlatformEnv}
                          disabled={busy !== null}
                          onChange={(v) =>
                            patch(
                              row.key,
                              { config: { usePlatformEnv: v } },
                              `pe:${row.key}`,
                              v
                                ? `${row.key} now declares the platform app as its own`
                                : `${row.key} no longer uses the platform app`,
                            )
                          }
                        />
                        <div className="min-w-0">
                          <span className="block text-xs font-medium text-foreground">
                            This firm&apos;s app is the platform app
                          </span>
                          <span className="block text-[11px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                            An explicit declaration, never a fallback. An app registration lives in
                            one Entra directory: lending the platform&apos;s app to a firm that
                            does not own it would not fail cleanly — for SharePoint and OneDrive it
                            would <em>succeed</em>, filing this firm&apos;s client documents into
                            another firm&apos;s library.
                          </span>
                        </div>
                      </div>

                      {row.configFields.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {row.configFields.map((field) => {
                            const stored =
                              typeof row.config[field] === 'string'
                                ? (row.config[field] as string)
                                : '';
                            return (
                              <label key={field} className="block">
                                <Label>{FIELD_LABEL[field] ?? field}</Label>
                                <input
                                  value={configDraft[field] ?? stored}
                                  onChange={(e) => setDraft(row.key, field, e.target.value)}
                                  className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:ring-1 focus:ring-gold-300"
                                />
                              </label>
                            );
                          })}
                        </div>
                      )}

                      {row.secretFields.length > 0 && (
                        <div className="space-y-3">
                          {row.secretFields.map((field) => {
                            const isSet = row.secretsSet.includes(field);
                            return (
                              <label key={field} className="block">
                                <Label>
                                  {FIELD_LABEL[field] ?? field}{' '}
                                  <span
                                    className={
                                      isSet
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : 'text-amber-700 dark:text-amber-400'
                                    }
                                  >
                                    · {isSet ? 'stored' : 'not set'}
                                  </span>
                                </Label>
                                <input
                                  type="password"
                                  value={configDraft[field] ?? ''}
                                  placeholder={isSet ? 'Stored — type to replace' : 'Paste the secret'}
                                  onChange={(e) => setDraft(row.key, field, e.target.value)}
                                  className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:ring-1 focus:ring-gold-300"
                                />
                              </label>
                            );
                          })}
                          <p className="text-[11px] text-[var(--text-muted)]">
                            Sealed with AES-256-GCM under the platform key and never rendered back.
                            Leave a box empty to keep what is stored.
                          </p>
                        </div>
                      )}

                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => {
                            const config: Record<string, string> = {};
                            const secrets: Record<string, string> = {};
                            for (const field of row.configFields) {
                              if (configDraft[field] !== undefined) config[field] = configDraft[field];
                            }
                            for (const field of row.secretFields) {
                              if ((configDraft[field] ?? '').trim() !== '') {
                                secrets[field] = configDraft[field];
                              }
                            }
                            if (
                              Object.keys(config).length === 0 &&
                              Object.keys(secrets).length === 0
                            ) {
                              toast.message('Nothing to save');
                              return;
                            }
                            setDrafts((prev) => ({ ...prev, [row.key]: {} }));
                            patch(
                              row.key,
                              {
                                ...(Object.keys(config).length > 0 ? { config } : {}),
                                ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
                              },
                              `save:${row.key}`,
                              `${row.key} credentials saved`,
                            );
                          }}
                          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-navy-800 text-white hover:bg-navy-700 disabled:opacity-50 transition-colors"
                        >
                          {busy === `save:${row.key}` ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <KeyRound className="w-3.5 h-3.5" />
                          )}
                          Save credentials
                        </button>
                        {row.secretsSet.length > 0 && (
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() =>
                              patch(
                                row.key,
                                { clearSecrets: true },
                                `clear:${row.key}`,
                                `${row.key} credentials cleared`,
                              )
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-red-600 hover:border-red-500/40 disabled:opacity-50 transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                            Clear stored secrets
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Caution>
        Switching a feature on does not make it usable. An unregistered feature is off, an
        unentitled one is off, and a bring-your-own integration with half its credentials is off —
        each with its own reason above. That is the guard, not a UI nicety.
      </Caution>
    </Panel>
  );
}
