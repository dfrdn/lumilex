'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { failureMessage } from '@/lib/api-error';
import CellDropdown from '@/components/admin/CellDropdown';
import type { LoadedScopeTemplate } from '@/lib/scope-library/types';
import type { ProposalRecipient } from '@/lib/engagement-proposal/types';
import type { AcceptanceFeeOption, RecipientOption } from '@/lib/engagement-proposal/catalogue';
import ProposalDraftModal from './ProposalDraftModal';
import type { ProposalDraftPayload } from './ProposalDraftForm';
import { labelCls, type RetainerTierOption } from './proposal-ui';

/** `prospect:12` / `client:abc` — one id space for a picker over two tables. */
function optionKey(o: RecipientOption): string {
  return `${o.kind}:${o.id}`;
}

function toRecipient(key: string): ProposalRecipient | null {
  const [kind, ...rest] = key.split(':');
  const id = rest.join(':');
  if (kind === 'prospect') {
    const intakeId = Number(id);
    return Number.isInteger(intakeId) ? { kind: 'prospect', intakeId } : null;
  }
  if (kind === 'client' && id) return { kind: 'client', clientId: id };
  return null;
}

/**
 * The New proposal button and the dialog behind it. `?new=prospect:12` opens it
 * with that prospect chosen, which is how a prospect's own page hands off.
 */
export default function NewProposalLauncher() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get('new');

  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [recipients, setRecipients] = useState<RecipientOption[]>([]);
  const [scopeTemplates, setScopeTemplates] = useState<LoadedScopeTemplate[]>([]);
  const [retainerTiers, setRetainerTiers] = useState<RetainerTierOption[]>([]);
  const [acceptanceFees, setAcceptanceFees] = useState<AcceptanceFeeOption[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);

  // The catalogue is fetched once, on first open — the list page shouldn't pay
  // for 200-odd recipients nobody asked to see.
  useEffect(() => {
    if (!open || loaded) return;
    fetch('/api/proposals/catalogue')
      .then((r) => r.json())
      .then((j) => {
        setRecipients(j.recipients ?? []);
        setScopeTemplates(j.scopeTemplates ?? []);
        setRetainerTiers(j.retainerTiers ?? []);
        setAcceptanceFees(j.acceptanceFees ?? []);
        setLoaded(true);
      })
      .catch(() => toast.error('Could not load the recipient list.'));
  }, [open, loaded]);

  useEffect(() => {
    if (!requested) return;
    setSelected(requested);
    setOpen(true);
  }, [requested]);

  const close = useCallback(() => {
    setOpen(false);
    // Drop ?new= so a refresh or a back-navigation doesn't reopen the dialog.
    if (requested) router.replace('/dashboard/prospects/proposals');
  }, [requested, router]);

  const options = useMemo(
    () => recipients.map((o) => ({
      id: optionKey(o),
      label: o.name,
      sublabel: o.kind === 'prospect'
        ? `Prospect${o.detail ? ` · ${o.detail}` : ''}`
        : `Client${o.detail ? ` · ${o.detail}` : ''}`,
    })),
    [recipients],
  );

  const chosen = options.find((o) => o.id === selected);

  const draft = async (payload: ProposalDraftPayload) => {
    const recipient = selected ? toRecipient(selected) : null;
    if (!recipient) {
      toast.error('Choose who this proposal is addressed to.');
      return;
    }
    setDrafting(true);
    try {
      const r = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, recipient }),
      });
      if (!r.ok) throw new Error(await failureMessage(r, 'Could not draft the proposal.'));
      const j = await r.json();
      toast.success('Draft ready — review every section before sending.');
      router.push(`/dashboard/prospects/proposals/${j.proposal.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setDrafting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-navy-900 text-white hover:bg-navy-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        New proposal
      </button>

      <ProposalDraftModal
        open={open}
        onClose={close}
        title="New engagement proposal"
        scopeTemplates={scopeTemplates}
        retainerTiers={retainerTiers}
        acceptanceFees={acceptanceFees}
        proposedServices={[]}
        submitLabel="Draft proposal"
        busy={drafting}
        disabled={!selected}
        onDraft={draft}
      >
        <div>
          <span className={labelCls}>Addressed to</span>
          <button
            type="button"
            ref={anchor}
            onClick={() => setPickerOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-left"
          >
            <span className={chosen ? 'text-[var(--text-primary)] truncate' : 'text-[var(--text-muted)]'}>
              {chosen
                ? `${chosen.label} — ${chosen.sublabel}`
                : loaded ? 'Choose a prospect or an existing client…' : 'Loading…'}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
          </button>
          {pickerOpen && (
            <CellDropdown
              mode="single"
              value={selected}
              options={options}
              onSelect={(id) => { setSelected(id); setPickerOpen(false); }}
              onClose={() => setPickerOpen(false)}
              anchorRef={anchor}
              placeholder="Search prospects and clients…"
            />
          )}
          <p className="text-[10px] text-[var(--text-muted)] mt-1">
            A prospect brings its consultation notes and conflict check into the draft. An existing
            client brings neither — the firm already acts for it — so say what this engagement is for
            under Instructions.
          </p>
        </div>
      </ProposalDraftModal>
    </>
  );
}
