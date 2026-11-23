'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { AlertTriangle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import type { PORTAL_PREVIEW_REQUIRED, PortalSwitchPreview } from '@/lib/portal/switch-access';

const PREVIEW_REQUIRED: typeof PORTAL_PREVIEW_REQUIRED = 'portal_preview_required';

const PortalCompanyView = dynamic(() => import('@/app/portal/companies/[id]/PortalCompanyView'));
const PortalTrademarkView = dynamic(() => import('@/app/portal/trademarks/[id]/PortalTrademarkView'));

/** The links in the client's view lead to portal pages staff can't open. */
function stayInPreview(e: React.MouseEvent) {
  if ((e.target as HTMLElement).closest('a')) {
    e.preventDefault();
    e.stopPropagation();
  }
}

/**
 * Whether the client sees this company or mark in their portal. Off until the
 * team turns it on, once the record is clean enough to show. Turning it on
 * opens exactly what the client will see first; the server decides who may.
 */
export default function PortalSwitch({
  endpoint,
  visible,
  noun,
  onSaved,
}: {
  /** The record's endpoint: PATCH takes `{ portalVisible }`, and `/portal-preview` sits under it. */
  endpoint: string;
  visible: boolean;
  /** "company" or "mark", for the wording. */
  noun: string;
  onSaved?: (response: Record<string, unknown>) => void;
}) {
  const [on, setOn] = useState(visible);
  const [busy, setBusy] = useState(false);
  const [bump, setBump] = useState(0);
  const [access, setAccess] = useState<'checking' | 'allowed' | 'refused' | 'failed'>('checking');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<PortalSwitchPreview | null>(null);
  const [audience, setAudience] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`${endpoint}/portal-preview?access`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`portal switch access ${res.status}`))))
      .then((data: { canSwitch?: boolean }) => {
        if (live) setAccess(data.canSwitch ? 'allowed' : 'refused');
      })
      .catch((err: unknown) => {
        if (live) setAccess('failed');
        console.error('[portal switch]', err);
      });
    return () => {
      live = false;
    };
  }, [endpoint]);

  /** Whether the switch moved, or the server's refusal code when it didn't. */
  async function save(next: boolean): Promise<true | string | undefined> {
    setOn(next);
    setBump((b) => b + 1);
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portalVisible: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOn(!next);
        if (data.code !== PREVIEW_REQUIRED) toast.error(data.error ?? 'Could not change portal visibility.');
        if (res.status >= 500) console.error(`portal switch ${res.status}`);
        return data.code as string | undefined;
      }
      onSaved?.(data);
      toast.success(next ? 'Now shown in the client portal' : 'Hidden from the client portal');
      return true;
    } catch (err) {
      setOn(!next);
      toast.error('Could not change portal visibility.');
      console.error('[portal switch]', err);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function openPreview() {
    setPreview(null);
    setAudience(0);
    setPreviewOpen(true);
    try {
      const res = await fetch(`${endpoint}/portal-preview`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPreviewOpen(false);
        toast.error(data.error ?? 'Could not open the preview.');
        if (res.status >= 500) console.error(`portal preview ${res.status}`);
        return;
      }
      setPreview(data as PortalSwitchPreview);
    } catch (err) {
      setPreviewOpen(false);
      toast.error('Could not open the preview.');
      console.error('[portal switch]', err);
    }
  }

  async function confirm() {
    const result = await save(true);
    if (result === true) {
      setPreviewOpen(false);
    } else if (result === PREVIEW_REQUIRED) {
      toast.info('That preview was too old to count. Here it is again: check it and confirm.');
      await openPreview();
    }
  }

  const shown = preview?.audiences[audience] ?? null;
  const locked =
    access === 'refused'
      ? `Only a lawyer on this ${noun}'s team, the client's relationship partner, a partner or an admin can change this.`
      : access === 'failed'
        ? 'Could not check who can change this. Reload to try again.'
        : null;

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => {
          if (locked) toast.info(locked);
          else if (on) void save(false);
          else void openPreview();
        }}
        disabled={busy || access === 'checking'}
        aria-disabled={!!locked}
        aria-label={locked ? `Client portal. ${locked}` : 'Client portal'}
        title={locked ?? (on ? `The client sees this ${noun} in their portal` : 'Hidden from the client portal')}
        className={`press group inline-flex items-center gap-2 pl-2 pr-1 py-1 rounded-full text-[11px] font-medium ring-1 ring-inset transition-colors disabled:opacity-60 ${locked ? 'opacity-60' : ''} ${
          on
            ? 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-400/25'
            : 'bg-stone-50 text-stone-500 ring-stone-200 hover:text-stone-700 dark:bg-white/[0.04] dark:text-stone-400 dark:ring-white/10 dark:hover:text-stone-200'
        }`}
      >
        <span key={bump} className={bump ? 'pop' : ''}>
          {on ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </span>
        <span className="hidden sm:inline">Client portal</span>
        <span
          className={`relative w-7 h-4 rounded-full transition-colors duration-200 ${on ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-stone-300 dark:bg-white/20'}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${on ? 'translate-x-3' : ''}`}
          />
        </span>
      </button>

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        dismissible={!busy}
        size="xl"
        title="What the client will see"
        description={`This ${noun} as it will appear in the client's portal. Nothing is shared until you confirm.`}
        bodyClassName="pb-2"
        footer={
          <>
            <Button variant="outline" size="lg" onClick={() => setPreviewOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="lg" onClick={() => void confirm()} disabled={busy || !preview?.ready}>
              Show to client
            </Button>
          </>
        }
      >
        {!preview ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-stone-500 dark:text-stone-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading what the client will see
          </div>
        ) : (
          <>
            {preview.blockers.length > 0 && (
              <div className="mx-6 mb-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-200">
                {preview.blockers.map((b) => (
                  <p key={b} className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    {b}
                  </p>
                ))}
              </div>
            )}
            {preview.audiences.length > 1 && (
              <div className="mx-6 mb-3 flex flex-wrap gap-2">
                {preview.audiences.map((a, i) => (
                  <Button key={a.clientId} size="sm" variant={i === audience ? 'primary' : 'outline'} className="max-w-full" title={a.clientName} onClick={() => setAudience(i)}>
                    <span className="truncate">{a.clientName}</span>
                  </Button>
                ))}
              </div>
            )}
            {shown && shown.activeUsers === 0 && preview.audiences.length > 1 && (
              <p className="mx-6 mb-3 text-xs text-stone-500 dark:text-stone-400">{shown.clientName} has no active portal user, so nobody there will see this yet.</p>
            )}
            {shown && (
              <div onClickCapture={stayInPreview}>
                {'company' in shown.detail ? (
                  <PortalCompanyView data={shown.detail} basePath="/portal" today={preview.today} preview />
                ) : (
                  <PortalTrademarkView data={shown.detail} basePath="/portal" today={preview.today} />
                )}
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
