'use client';

import { useState, useEffect } from 'react';
import {
  Loader2,
  FolderSync,
  Check,
  AlertCircle,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────

// ── Component ───────────────────────────────────────────────────────

export default function IntegrationsManager() {
  return <SharePointPanel />;
}


// ── SharePoint Panel ────────────────────────────────────────────────

function SharePointPanel() {
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/admin/sharepoint-sync?deliverableId=_check')
      .then((r) => r.json())
      .then((d) => setConfigured(d.configured !== false))
      .catch(() => setConfigured(false));
  }, []);

  if (configured === null) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--text-secondary)]" />
      </div>
    );
  }

  const spHost = process.env.NEXT_PUBLIC_MS_SHAREPOINT_SITE_HOSTNAME;

  return (
    <div className="space-y-6">
      {/* Status card */}
      <div className="rounded-xl border border-[var(--border-color)] bg-background p-6">
        <div className="flex items-start gap-4">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
            configured
              ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'
          }`}>
            <FolderSync className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              SharePoint Auto-Sync
              <span className={`ml-2 inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                configured
                  ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10'
                  : 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10'
              }`}>
                {configured ? (
                  <><Check className="w-3 h-3" /> Active</>
                ) : (
                  <><AlertCircle className="w-3 h-3" /> Not configured</>
                )}
              </span>
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
              Documents are automatically synced to SharePoint when:
            </p>
            <ul className="text-xs text-[var(--text-secondary)] mt-2 space-y-1">
              <li className="flex items-center gap-2">
                <Check className="w-3 h-3 text-emerald-500 shrink-0 dark:text-emerald-400" />
                Deliverables are finalized → <code className="text-[10px] bg-[var(--subtle-bg)] px-1 rounded">Client/Matter/Finalized/</code>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3 h-3 text-emerald-500 shrink-0 dark:text-emerald-400" />
                Incoming files are uploaded → <code className="text-[10px] bg-[var(--subtle-bg)] px-1 rounded">Client/Matter/Incoming/Origin/</code>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Configuration details */}
      {configured && (
        <div className="rounded-xl border border-[var(--border-color)] bg-background p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Configuration</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ConfigRow label="Site" value={spHost || 'Set via MS_SHAREPOINT_SITE_HOSTNAME'} />
            <ConfigRow label="Sync Trigger" value="Automatic on upload/finalize" />
            <ConfigRow label="Folder Structure" value="{Client}/{Matter}/{Type}" />
            <ConfigRow label="Conflict Handling" value="Replace existing files" />
          </div>
        </div>
      )}

      {!configured && (
        <div className="rounded-xl border border-[var(--border-primary)] bg-background p-6">
          <h3 className="text-sm font-semibold text-foreground mb-2">Setup Required</h3>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            Add the following environment variables:
          </p>
          <div className="mt-3 space-y-1.5">
            <code className="block text-xs bg-[var(--subtle-bg)] px-3 py-1.5 rounded">MS_SHAREPOINT_SITE_HOSTNAME=yourfirm.sharepoint.com</code>
            <code className="block text-xs bg-[var(--subtle-bg)] px-3 py-1.5 rounded">MS_SHAREPOINT_SITE_PATH=/sites/YourSite</code>
            <code className="block text-xs bg-[var(--subtle-bg)] px-3 py-1.5 rounded">MS_SHAREPOINT_BASE_FOLDER=Optional/Base/Folder</code>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-3">
            Also add <strong>Sites.ReadWrite.All</strong> permission to your Azure AD app registration.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Shared UI ───────────────────────────────────────────────────────

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs font-medium text-[var(--text-secondary)] shrink-0 w-28">{label}</span>
      <span className="text-xs text-foreground">{value}</span>
    </div>
  );
}
