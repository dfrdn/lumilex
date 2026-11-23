'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import CellDropdown from '@/components/admin/CellDropdown';
import type { Trademark } from '@/types/notion';
import { MARK_SCOPES, MARK_SCOPE_LABEL, type MarkMatterLink, type MarkScope } from '@/lib/trademarks/matter-links';

interface MatterOption {
  id: string;
  name: string;
  clientName: string;
  matterCode: string | null;
}

/**
 * Which engagements cover the mark, by role. A renewal or an opposition gets
 * its own matter without a second record of the mark; a retainer can cover
 * marks with no filing matter of their own. Billing and time stay on the
 * matters.
 */
export default function MarkMatterLinks({
  trademarkId,
  onUpdated,
}: {
  trademarkId: string;
  onUpdated?: (t: Trademark) => void;
}) {
  const [links, setLinks] = useState<MarkMatterLink[] | null>(null);
  const [matters, setMatters] = useState<MatterOption[] | null>(null);
  const [editing, setEditing] = useState<MarkScope | null>(null);
  const [saving, setSaving] = useState<MarkScope | null>(null);
  const anchors = useRef<Partial<Record<MarkScope, HTMLButtonElement | null>>>({});

  useEffect(() => {
    fetch(`/api/trademark/${trademarkId}/matters`)
      .then((r) => r.json())
      .then((d: { links?: MarkMatterLink[] }) => setLinks(d.links ?? []))
      .catch(() => setLinks([]));
  }, [trademarkId]);

  useEffect(() => {
    if (!editing || matters) return;
    fetch('/api/clients-matters')
      .then((r) => r.json())
      .then((d: { clients?: { id: string; name: string }[]; matters?: { id: string; name: string; code: string | null; clientId: string }[] }) => {
        const clientName = new Map((d.clients ?? []).map((c) => [c.id, c.name]));
        setMatters((d.matters ?? []).map((m) => ({ id: m.id, name: m.name, clientName: clientName.get(m.clientId) ?? '', matterCode: m.code ?? null })));
      })
      .catch(() => toast.error('Could not load matters.'));
  }, [editing, matters]);

  async function save(scope: MarkScope, matterId: string | null) {
    setEditing(null);
    setSaving(scope);
    try {
      const res = await fetch(`/api/trademark/${trademarkId}/matters`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, matterId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'Could not change the matter.');
        return;
      }
      setLinks(data.links ?? []);
      if (data.trademark) onUpdated?.(data.trademark as Trademark);
    } finally {
      setSaving(null);
    }
  }

  const linkOf = (scope: MarkScope) => links?.find((l) => l.scope === scope) ?? null;

  return (
    <div className="space-y-1">
      {MARK_SCOPES.map((scope) => {
        const link = linkOf(scope);
        return (
          <div key={scope} className="group/link flex items-center justify-between gap-2 py-1 min-w-0">
            <span className="text-[11px] text-stone-400 dark:text-stone-500 w-36 shrink-0">{MARK_SCOPE_LABEL[scope]}</span>
            <span className="flex-1 min-w-0 flex items-center justify-end gap-1">
              {link ? (
                <Link href={`/dashboard/matters/${link.matterId}`} className="reveal text-sm text-navy-700 dark:text-navy-300 hover:underline underline-offset-2 truncate" title={link.matterName}>
                  {link.matterCode ? `[${link.matterCode}] ` : ''}
                  {link.matterName}
                </Link>
              ) : (
                <span className="text-sm text-stone-400 dark:text-stone-500">{saving === scope ? 'Saving…' : links ? '—' : '…'}</span>
              )}
              {link && (
                <button
                  type="button"
                  onClick={() => void save(scope, null)}
                  disabled={saving === scope}
                  className="press p-1 text-stone-400 dark:text-stone-500 opacity-0 group-hover/link:opacity-100 focus:opacity-100 hover:text-rose-600 transition-opacity"
                  title={`Remove the ${MARK_SCOPE_LABEL[scope].toLowerCase()} matter`}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
              <button
                ref={(el) => {
                  anchors.current[scope] = el;
                }}
                type="button"
                onClick={() => setEditing((e) => (e === scope ? null : scope))}
                disabled={saving === scope}
                className="press p-1 text-stone-400 dark:text-stone-500 hover:text-navy-700 dark:hover:text-navy-300 disabled:opacity-50"
                title={link ? `Change the ${MARK_SCOPE_LABEL[scope].toLowerCase()} matter` : `Add a ${MARK_SCOPE_LABEL[scope].toLowerCase()} matter`}
              >
                <Pencil className="w-3 h-3" />
              </button>
              {editing === scope && (
                <CellDropdown
                  mode="single"
                  value={link?.matterId ?? null}
                  placeholder={matters ? 'Search matters…' : 'Loading matters…'}
                  options={(matters ?? []).map((m) => ({
                    id: m.id,
                    label: m.matterCode ? `[${m.matterCode}] ${m.name}` : m.name,
                    sublabel: m.clientName,
                  }))}
                  anchorRef={{ current: anchors.current[scope] ?? null }}
                  onClose={() => setEditing(null)}
                  onSelect={(next) => void save(scope, next)}
                />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
