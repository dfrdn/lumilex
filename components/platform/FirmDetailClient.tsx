'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, PauseCircle, PlayCircle } from 'lucide-react';
import {
  Panel,
  Field,
  ColorField,
  Select,
  TextArea,
  Caution,
  SaveButton,
  postJson,
} from '@/components/platform/form-ui';
import FirmDomainsSection from '@/components/platform/FirmDomainsSection';
import FirmFeaturesSection from '@/components/platform/FirmFeaturesSection';
import type { OperatorFirmIdentity, FirmDomainRow } from '@/lib/platform/firms';
import type { OperatorFeatureRow, OperatorInvoiceSettings } from '@/lib/platform/firm-detail';
import type { FirmInvoiceSettings } from '@/lib/billing/firm-defaults';
import {
  LETTERHEAD_DESIGNS,
  LETTERHEAD_LABELS,
  pickLetterheadDesign,
  type LetterheadSetting,
} from '@/lib/firm/letterhead-design';

/**
 * One firm's configuration, grouped the way an operator thinks about it.
 *
 * Every section saves on its own and updates local state from the server's
 * response — no `router.refresh()`, per the codebase's reactive-UI rule.
 */
export default function FirmDetailClient({
  firm: initialFirm,
  domains,
  invoice: initialInvoice,
  features,
  fontSets,
}: {
  firm: OperatorFirmIdentity;
  domains: FirmDomainRow[];
  invoice: OperatorInvoiceSettings;
  features: OperatorFeatureRow[];
  fontSets: { name: string; label: string }[];
}) {
  const [firm, setFirm] = useState(initialFirm);

  return (
    <div className="space-y-5 max-w-4xl">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl text-foreground tracking-tight truncate">
            {firm.name}
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1 font-mono">
            {firm.slug} · {firm.id}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium shrink-0 ${
            firm.status === 'active'
              ? 'bg-subtle text-[var(--text-secondary)]'
              : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
          }`}
        >
          {firm.status}
        </span>
      </header>

      <IdentityAndBranding firm={firm} fontSets={fontSets} onSaved={setFirm} />
      <EmailIdentity firm={firm} onSaved={setFirm} />
      <DocumentRoots firm={firm} onSaved={setFirm} />
      <InvoiceSettings firmId={firm.id} initial={initialInvoice} />
      <FirmDomainsSection firmId={firm.id} initial={domains} />
      <FirmFeaturesSection firmId={firm.id} initial={features} />
      <StatusSection firm={firm} onSaved={setFirm} />
    </div>
  );
}

type Saved = (firm: OperatorFirmIdentity) => void;

// ── Identity & branding ──────────────────────────────────────────────

function IdentityAndBranding({
  firm,
  fontSets,
  onSaved,
}: {
  firm: OperatorFirmIdentity;
  fontSets: { name: string; label: string }[];
  onSaved: Saved;
}) {
  const [name, setName] = useState(firm.name);
  const [shortName, setShortName] = useState(firm.shortName);
  const [branding, setBranding] = useState(firm.branding);
  const [saving, setSaving] = useState(false);

  const lines = [0, 1, 2].map((i) => branding.nameLines[i] ?? '');
  const dirty =
    name !== firm.name ||
    shortName !== firm.shortName ||
    JSON.stringify(branding) !== JSON.stringify(firm.branding);

  function setBrand<K extends keyof typeof branding>(key: K, value: (typeof branding)[K]) {
    setBranding((prev) => ({ ...prev, [key]: value }));
  }

  // Two sections in one panel, so two PATCHes — but only for the halves that
  // actually changed, which keeps a tagline edit out of the tenant's audit log
  // as an identity change.
  async function save() {
    const identityChanged = name !== firm.name || shortName !== firm.shortName;
    const brandingChanged = JSON.stringify(branding) !== JSON.stringify(firm.branding);

    setSaving(true);
    try {
      let latest: OperatorFirmIdentity = firm;
      if (identityChanged) {
        const json = await postJson(`/api/platform/firms/${firm.id}`, 'PATCH', {
          section: 'identity',
          name,
          shortName,
        });
        latest = json.firm as OperatorFirmIdentity;
      }
      if (brandingChanged) {
        const json = await postJson(`/api/platform/firms/${firm.id}`, 'PATCH', {
          section: 'branding',
          branding,
        });
        latest = json.firm as OperatorFirmIdentity;
      }
      onSaved(latest);
      setBranding(latest.branding);
      setName(latest.name);
      setShortName(latest.shortName);
      toast.success('Identity and branding saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Identity & branding"
      description="Validated through the same Zod schema lib/firm/config.ts parses firms.branding with, so nothing can be written here that the loader reads back as a default."
      footer={<SaveButton onClick={save} saving={saving} dirty={dirty} />}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          label="Name"
          value={name}
          onChange={setName}
          hint="The platform-facing label — this list, and nothing a client sees."
        />
        <Field
          label="Short name"
          value={shortName}
          onChange={setShortName}
          hint="Also the fallback root of the document archive."
        />
      </div>

      <Field
        label="Document name"
        value={branding.documentName}
        onChange={(v) => setBrand('documentName', v)}
        hint="How the firm is stamped on documents. An unset one throws at render rather than substituting."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ColorField
          label="Palette · primary"
          value={branding.palette.primary}
          onChange={(v) => setBrand('palette', { ...branding.palette, primary: v })}
        />
        <ColorField
          label="Palette · accent"
          value={branding.palette.accent}
          onChange={(v) => setBrand('palette', { ...branding.palette, accent: v })}
        />
      </div>

      <Select
        label="Font set"
        value={branding.fontSet}
        onChange={(v) => setBrand('fontSet', v)}
        options={fontSets.map((s) => ({ id: s.name, label: s.label }))}
        hint="From the curated FONT_SETS registry. An unknown name throws at render — the firm's documents fail loudly rather than printing in someone else's face."
      />

      <Select
        label="Letterhead"
        value={branding.letterhead}
        onChange={(v) => setBrand('letterhead', v as LetterheadSetting)}
        options={[
          {
            id: 'auto',
            label: `Automatic — ${LETTERHEAD_LABELS[pickLetterheadDesign('auto', branding.documentName)].split(' — ')[0]}, from the document name`,
          },
          ...LETTERHEAD_DESIGNS.map((d) => ({ id: d, label: LETTERHEAD_LABELS[d] })),
        ]}
        hint="The design of the firm's Word letters. Automatic picks one from the document name and keeps it while the name stays the same; choose one to fix it."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {lines.map((line, i) => (
          <Field
            key={i}
            label={`Cover line ${i + 1}`}
            value={line}
            onChange={(v) => {
              // Kept as up-to-three lines with trailing blanks dropped, so an
              // untouched third box doesn't store an empty cover line.
              const next = lines.map((l, j) => (j === i ? v : l));
              while (next.length > 0 && next[next.length - 1].trim() === '') next.pop();
              setBrand('nameLines', next);
            }}
          />
        ))}
      </div>

      <Field label="Tagline" value={branding.tagline} onChange={(v) => setBrand('tagline', v)} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          label="Logo path"
          value={branding.logoPath}
          onChange={(v) => setBrand('logoPath', v)}
          mono
          placeholder="branding/logo.png"
        />
        <Field
          label="Logo path (reversed out)"
          value={branding.logoLightPath}
          onChange={(v) => setBrand('logoLightPath', v)}
          mono
          hint="Falls back to the logo above."
        />
        <Field
          label="Monogram path"
          value={branding.monogramPath}
          onChange={(v) => setBrand('monogramPath', v)}
          mono
        />
        <Field
          label="Monogram path (reversed out)"
          value={branding.monogramLightPath}
          onChange={(v) => setBrand('monogramLightPath', v)}
          mono
          hint="Falls back to the monogram above."
        />
      </div>

      <Caution>
        Asset paths are storage keys relative to this firm&apos;s own prefix — this form records
        where a mark lives, it does not upload one. A blank slot renders clean empty space, never a
        stand-in mark and never another firm&apos;s.
      </Caution>
    </Panel>
  );
}

// ── Email identity ───────────────────────────────────────────────────

function EmailIdentity({ firm, onSaved }: { firm: OperatorFirmIdentity; onSaved: Saved }) {
  const [email, setEmail] = useState(firm.email);
  const [ownedText, setOwnedText] = useState(firm.email.ownedDomains.join(' '));
  const [saving, setSaving] = useState(false);

  const owned = ownedText
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  const dirty =
    JSON.stringify({ ...email, ownedDomains: owned }) !== JSON.stringify(firm.email);

  function set<K extends keyof typeof email>(key: K, value: (typeof email)[K]) {
    setEmail((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const json = await postJson(`/api/platform/firms/${firm.id}`, 'PATCH', {
        section: 'email',
        email: { ...email, ownedDomains: owned },
      });
      const updated = json.firm as OperatorFirmIdentity;
      onSaved(updated);
      setEmail(updated.email);
      setOwnedText(updated.email.ownedDomains.join(' '));
      toast.success('Email identity saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Email identity"
      description="Who the firm's outbound mail comes from, and which domains count as its own."
      footer={<SaveButton onClick={save} saving={saving} dirty={dirty} />}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="From name" value={email.fromName} onChange={(v) => set('fromName', v)} />
        <Field label="From address" value={email.fromAddress} onChange={(v) => set('fromAddress', v)} />
        <Field
          label="Finance address"
          value={email.financeAddress}
          onChange={(v) => set('financeAddress', v)}
        />
        <Field
          label="IP address (mailbox)"
          value={email.ipAddress}
          onChange={(v) => set('ipAddress', v)}
        />
        <Field
          label="Compliance address (mailbox)"
          value={email.complianceAddress}
          onChange={(v) => set('complianceAddress', v)}
        />
      </div>

      <TextArea
        label="Owned domains"
        value={ownedText}
        onChange={setOwnedText}
        placeholder="acmelegal.ph acmelegal.com"
        hint={
          owned.length > 0
            ? `${owned.length} domain${owned.length === 1 ? '' : 's'}: ${owned.join(', ')}`
            : 'None — every synced message will be classified inbound.'
        }
      />

      <Caution>
        This list is load-bearing, not cosmetic. Every synced message is classified inbound or
        outbound by whether its sender is on it, and the court-mail analyzer only looks at mail
        from <em>outside</em> it — so a wrong or empty list silently mislabels the firm&apos;s whole
        mailbox and changes what the analyzer sees.
      </Caution>
    </Panel>
  );
}

// ── Document roots ───────────────────────────────────────────────────

function DocumentRoots({ firm, onSaved }: { firm: OperatorFirmIdentity; onSaved: Saved }) {
  const [documents, setDocuments] = useState(firm.documents);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(documents) !== JSON.stringify(firm.documents);

  async function save() {
    setSaving(true);
    try {
      const json = await postJson(`/api/platform/firms/${firm.id}`, 'PATCH', {
        section: 'documents',
        documents,
      });
      const updated = json.firm as OperatorFirmIdentity;
      onSaved(updated);
      setDocuments(updated.documents);
      toast.success('Document roots saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Document roots"
      description="Root folders for documents mirrored to this firm's SharePoint or OneDrive."
      footer={<SaveButton onClick={save} saving={saving} dirty={dirty} />}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          label="Finance root"
          value={documents.financeRoot}
          onChange={(v) => setDocuments((p) => ({ ...p, financeRoot: v }))}
          placeholder={`${firm.shortName} Finance`}
          hint="Blank derives it from the short name."
        />
        <Field
          label="Corporate root"
          value={documents.corporateRoot}
          onChange={(v) => setDocuments((p) => ({ ...p, corporateRoot: v }))}
          placeholder={`${firm.shortName} Corporate`}
          hint="Blank derives it from the short name."
        />
      </div>

      <Caution>
        These name a <strong>live archive</strong>. Changing one does not move what is already
        filed under the old name — everything mirrored so far stays where it is, and new documents
        start landing somewhere else. Rename here only if you are also moving the folder.
      </Caution>
    </Panel>
  );
}

// ── Invoice settings ─────────────────────────────────────────────────

const INVOICE_FIELDS: [keyof FirmInvoiceSettings, string, string][] = [
  ['firmAddress', 'Firm address', 'Unit / Floor, Building, Street'],
  ['firmAddress2', 'Firm address (line 2)', 'District, City, Philippines'],
  ['firmTIN', 'VAT TIN', 'VAT Reg. TIN: 000-000-000-00000'],
  ['bankName', 'Bank', 'Bank name'],
  ['bankAccountNo', 'Account no.', 'Account number'],
  ['bankAccountName', 'Account name', 'Account name'],
  ['signerName', 'Signer name', 'NAME OF SIGNING PARTNER'],
  ['invoicePrefix', 'Invoice prefix', 'ACME'],
];

function InvoiceSettings({
  firmId,
  initial,
}: {
  firmId: string;
  initial: OperatorInvoiceSettings;
}) {
  const [state, setState] = useState(initial);
  const [form, setForm] = useState(initial.settings);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(state.settings);

  async function save() {
    setSaving(true);
    try {
      const json = await postJson(`/api/platform/firms/${firmId}/invoice-settings`, 'PUT', form);
      const next = json.invoice as OperatorInvoiceSettings;
      setState(next);
      setForm(next.settings);
      toast.success('Invoice settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Invoice settings"
      description="The firm_invoice_settings row. Provisioning writes it deliberately incomplete, and billing refuses on exactly the fields listed below — this is that same rule, not a second opinion about it."
      footer={<SaveButton onClick={save} saving={saving} dirty={dirty} />}
    >
      {!state.present ? (
        <Caution>
          This firm has no invoice settings row at all. Invoicing, the proposal&apos;s payment
          block and every branded letterhead refuse until one exists.
        </Caution>
      ) : state.missing.length > 0 ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5" />
            Incomplete — invoicing and branded documents refuse
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
            Still blank or still carrying a provisioning placeholder:{' '}
            <strong>{state.missing.join(', ')}</strong>.
          </p>
        </div>
      ) : (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          Complete — invoices and branded documents will render.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {INVOICE_FIELDS.map(([key, label, placeholder]) => {
          const isPlaceholder = state.placeholderFields.includes(key);
          return (
            <div key={key} className={key === 'firmAddress' ? 'sm:col-span-2' : undefined}>
              <Field
                label={label}
                value={form[key]}
                onChange={(v) =>
                  setForm((prev) => ({ ...prev, [key]: key === 'invoicePrefix' ? v.toUpperCase() : v }))
                }
                placeholder={placeholder}
                mono={key === 'invoicePrefix'}
                hint={
                  isPlaceholder ? (
                    <span className="text-amber-700 dark:text-amber-400">
                      Still the provisioning placeholder — nobody has said where the money goes.
                    </span>
                  ) : key === 'invoicePrefix' ? (
                    '2–8 letters or digits; invoice numbers are PREFIX-YYYY-MM-NNN. Changing it starts a new sequence.'
                  ) : undefined
                }
              />
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ── Status ───────────────────────────────────────────────────────────

function StatusSection({ firm, onSaved }: { firm: OperatorFirmIdentity; onSaved: Saved }) {
  const [saving, setSaving] = useState(false);
  const suspended = firm.status === 'suspended';

  async function flip() {
    setSaving(true);
    try {
      const json = await postJson(`/api/platform/firms/${firm.id}`, 'PATCH', {
        section: 'status',
        status: suspended ? 'active' : 'suspended',
      });
      onSaved(json.firm as OperatorFirmIdentity);
      toast.success(suspended ? 'Firm reactivated' : 'Firm suspended');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Status"
      description="firms.status — active or suspended."
      footer={
        <button
          type="button"
          onClick={flip}
          disabled={saving}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
            suspended
              ? 'bg-navy-800 text-white hover:bg-navy-700'
              : 'border border-amber-500/50 text-amber-800 dark:text-amber-300 hover:bg-amber-500/10'
          }`}
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : suspended ? (
            <PlayCircle className="w-4 h-4" />
          ) : (
            <PauseCircle className="w-4 h-4" />
          )}
          {suspended ? 'Reactivate firm' : 'Suspend firm'}
        </button>
      }
    >
      <Caution>
        Be clear about what this does today. <code className="font-mono">status</code> is read in
        exactly one place — the cron fan-out — so suspending a firm stops every scheduled job from
        running for it: email sync, notifications, summaries, backfills. It does{' '}
        <strong>not</strong> block sign-in, the client portal, or any interactive request; the
        proxy never reads it. Treat it as &ldquo;pause the background work&rdquo;, not as a kill
        switch.
      </Caution>
    </Panel>
  );
}
