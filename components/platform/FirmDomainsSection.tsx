'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Globe, Loader2, Plus, Star, Trash2 } from 'lucide-react';
import { Panel, Caution, postJson } from '@/components/platform/form-ui';
import type { FirmDomainRow } from '@/lib/platform/firms';

/**
 * `firm_domains` for one firm.
 *
 * Every refusal the operator can hit here comes from the server — a host
 * another firm has claimed, or removing the primary while other hosts remain.
 * The form does not pre-empt either: the first is a fact only the database
 * holds, and the second is a rule that belongs next to the write.
 */
export default function FirmDomainsSection({
  firmId,
  initial,
}: {
  firmId: string;
  initial: FirmDomainRow[];
}) {
  const [domains, setDomains] = useState(initial);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function call(
    method: 'POST' | 'PATCH' | 'DELETE',
    domain: string,
    marker: string,
    success: string,
  ) {
    setBusy(marker);
    try {
      const json = await postJson(`/api/platform/firms/${firmId}/domains`, method, { domain });
      setDomains(json.domains as FirmDomainRow[]);
      toast.success(success);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      title="Domains"
      description="Hosts that resolve to this firm. The primary is where the firm's people and clients are sent, and what every outbound link uses."
    >
      <ul className="divide-y divide-[var(--border-color)] rounded-lg border border-[var(--border-color)]">
        {domains.length === 0 && (
          <li className="px-3 py-3 text-xs text-amber-700 dark:text-amber-400">
            No domains. Outbound links fall back to the platform host under this firm&apos;s name.
          </li>
        )}
        {domains.map((d) => (
          <li key={d.domain} className="flex items-center gap-3 px-3 py-2.5">
            <Globe className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
            <span className="font-mono text-sm text-foreground truncate flex-1">{d.domain}</span>
            {d.isPrimary ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                <Star className="w-3 h-3" />
                primary
              </span>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => call('PATCH', d.domain, `primary:${d.domain}`, `${d.domain} is now primary`)}
                className="text-[11px] text-[var(--text-secondary)] hover:text-foreground px-2 py-1 rounded-md hover:bg-subtle disabled:opacity-50"
              >
                {busy === `primary:${d.domain}` ? 'Setting…' : 'Make primary'}
              </button>
            )}
            <button
              type="button"
              aria-label={`Remove ${d.domain}`}
              disabled={busy !== null}
              onClick={() => call('DELETE', d.domain, `del:${d.domain}`, `${d.domain} removed`)}
              className="text-[var(--text-muted)] hover:text-red-600 p-1 rounded-md hover:bg-subtle disabled:opacity-50"
            >
              {busy === `del:${d.domain}` ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.toLowerCase())}
          placeholder="app.acmelegal.ph"
          className="flex-1 px-3 py-2 text-sm font-mono rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:ring-1 focus:ring-gold-300"
        />
        <button
          type="button"
          disabled={!draft.trim() || busy !== null}
          onClick={async () => {
            if (await call('POST', draft.trim(), 'add', `${draft.trim()} added`)) setDraft('');
          }}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-navy-800 text-white hover:bg-navy-700 disabled:opacity-50 transition-colors"
        >
          {busy === 'add' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add
        </button>
      </div>

      <Caution>
        A hostname maps to a firm <em>before</em> anyone signs in. Adding one that another firm
        already claims is refused rather than re-pointed — it would serve that firm&apos;s branding
        and its sign-in page under this name. Removing the primary while other hosts remain is
        refused too: promote the replacement first.
      </Caution>
    </Panel>
  );
}
