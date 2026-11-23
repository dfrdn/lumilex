'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FileSignature, X } from 'lucide-react';
import ProposalDraftForm, { type ProposalDraftPayload } from './ProposalDraftForm';
import type { LoadedScopeTemplate } from '@/lib/scope-library/types';
import type { AcceptanceFeeOption } from '@/lib/engagement-proposal/catalogue';
import type { RetainerTierOption } from './proposal-ui';

/**
 * The drafting questions in a dialog. Both places that draft — opening a new
 * proposal from the list and adding a version from the editor — raise the same
 * one, so a drafter answers the same form wherever they start.
 */
export default function ProposalDraftModal({
  open, onClose, title, scopeTemplates, retainerTiers, acceptanceFees, proposedServices,
  submitLabel, busy, disabled, onDraft, children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  scopeTemplates: LoadedScopeTemplate[];
  retainerTiers: RetainerTierOption[];
  acceptanceFees: AcceptanceFeeOption[];
  proposedServices: string[];
  submitLabel: string;
  busy: boolean;
  disabled?: boolean;
  onDraft: (payload: ProposalDraftPayload) => void;
  /** Recipient picker, rendered above the fee arrangement. */
  children?: React.ReactNode;
}) {
  // Escape closes, but not mid-draft: the call takes the better part of a
  // minute and dismissing the dialog would leave it running with nowhere to land.
  useEffect(() => {
    if (!open || busy) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="relative bg-[var(--card-bg)] rounded-2xl shadow-2xl border border-[var(--border-color)] w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <FileSignature className="w-5 h-5 text-gold-500 dark:text-gold-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Claude drafts from what the firm holds on the recipient, quoting only the current fee
                schedule. You review and edit every section before anything is sent.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy}
            className="p-1 rounded-lg hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] transition-colors disabled:opacity-40 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <ProposalDraftForm
          scopeTemplates={scopeTemplates}
          retainerTiers={retainerTiers}
          acceptanceFees={acceptanceFees}
          proposedServices={proposedServices}
          submitLabel={submitLabel}
          busy={busy}
          disabled={disabled}
          onDraft={onDraft}
          onCancel={onClose}
        >
          {children}
        </ProposalDraftForm>
      </div>
    </div>,
    document.body,
  );
}
