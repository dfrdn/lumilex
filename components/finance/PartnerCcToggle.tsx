'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Users } from 'lucide-react';

interface PartnerRef {
  name: string | null;
  email: string;
}

interface ClientPreview {
  clientName: string;
  invoiceCount: number;
  relationshipPartner: PartnerRef | null;
  note: string | null;
}

interface Preview {
  managingPartner: PartnerRef | null;
  managingPartnerNote: string | null;
  clients: ClientPreview[];
}

export interface PartnerCcState {
  ccRelationshipPartner: boolean;
  ccManagingPartner: boolean;
}

interface Props {
  invoiceIds: number[];
  value: PartnerCcState;
  onChange: (next: PartnerCcState) => void;
}

function label(p: PartnerRef): string {
  return p.name ?? p.email;
}

/**
 * "Copy to" control for the finance invoice emails. The relationship partner is
 * per-client, so a batch can resolve to several people (or to none, when a
 * client has no partner assigned) — the resolved names are shown rather than
 * left for finance to discover in their sent folder.
 */
export default function PartnerCcToggle({ invoiceIds, value, onChange }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);

  const idsKey = invoiceIds.join(',');

  useEffect(() => {
    if (invoiceIds.length === 0) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch('/api/finance/invoice-cc-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceIds }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const withRp = preview?.clients.filter((c) => c.relationshipPartner) ?? [];
  const withoutRp = preview?.clients.filter((c) => !c.relationshipPartner) ?? [];
  const rpNames = [...new Set(withRp.map((c) => label(c.relationshipPartner!)))];

  return (
    <div className="mb-4 p-3 rounded-xl bg-[var(--subtle-bg)] border border-[var(--border-color)]">
      <div className="flex items-center gap-1.5 mb-2">
        <Users className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Copy to</p>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-[var(--text-muted)]" />}
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={value.ccRelationshipPartner}
            onChange={(e) => onChange({ ...value, ccRelationshipPartner: e.target.checked })}
            className="mt-0.5 rounded border-[var(--border-color)] shrink-0"
          />
          <span className="min-w-0">
            <span className="block text-sm text-foreground">Relationship partner</span>
            {rpNames.length > 0 && (
              <span className="block text-xs text-[var(--text-muted)]">{rpNames.join(', ')}</span>
            )}
            {withoutRp.length > 0 && (
              <span className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>
                  No relationship partner for {withoutRp.map((c) => c.clientName).join(', ')} — those
                  will go out without a copy.
                </span>
              </span>
            )}
          </span>
        </label>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={value.ccManagingPartner}
            onChange={(e) => onChange({ ...value, ccManagingPartner: e.target.checked })}
            className="mt-0.5 rounded border-[var(--border-color)] shrink-0"
          />
          <span className="min-w-0">
            <span className="block text-sm text-foreground">Managing partner</span>
            {preview?.managingPartner && (
              <span className="block text-xs text-[var(--text-muted)]">
                {label(preview.managingPartner)}
              </span>
            )}
            {preview?.managingPartnerNote && (
              <span className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>{preview.managingPartnerNote}</span>
              </span>
            )}
          </span>
        </label>
      </div>
    </div>
  );
}
