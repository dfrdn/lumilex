'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Check, Loader2, Rocket } from 'lucide-react';
import {
  Panel,
  Field,
  ColorField,
  Select,
  TextArea,
  Toggle,
  Caution,
  postJson,
} from '@/components/platform/form-ui';

/**
 * Create a firm.
 *
 * The fields are `provisionConfigSchema` — the same object the JSON config
 * file holds — because the request body IS that config. The server parses it
 * with `parseProvisionConfig`, so this form deliberately does almost no
 * validation of its own: the answers that matter (is this slug shaped the way
 * the database's CHECK demands, is this hostname already another firm's) can
 * only be given by the database, and a client-side approximation of them would
 * be a second opinion that drifts.
 */

interface Props {
  fontSets: { name: string; label: string }[];
  featureKeys: string[];
  defaultFontSet: string;
}

interface ProvisionStep {
  label: string;
  outcome: string;
  detail?: string;
}

interface Result {
  firmId: string;
  slug: string;
  steps: ProvisionStep[];
  admin: { email: string; password: string | null };
}

const FEATURE_NOTE: Record<string, string> = {
  portal: 'Client portal',
  sharepoint: 'SharePoint document mirroring (bring your own Entra app)',
  docx_pdf: 'DOCX → PDF conversion (bring your own Entra app)',
  push: 'Web push notifications',
  issuances: 'Government issuance tracking',
  drafting: 'Drafting studio',
  red_team: 'Pleading red team',
};

export default function NewFirmForm({ fontSets, featureKeys, defaultFontSet }: Props) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [primaryDomain, setPrimaryDomain] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('');

  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPosition, setAdminPosition] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  const [documentName, setDocumentName] = useState('');
  const [primary, setPrimary] = useState('#0F2A44');
  const [accent, setAccent] = useState('#B08D57');
  const [nameLines, setNameLines] = useState(['', '', '']);
  const [tagline, setTagline] = useState('');
  const [fontSet, setFontSet] = useState(defaultFontSet);

  const [fromName, setFromName] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [financeAddress, setFinanceAddress] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [complianceAddress, setComplianceAddress] = useState('');
  const [ownedDomains, setOwnedDomains] = useState('');

  const [financeRoot, setFinanceRoot] = useState('');
  const [corporateRoot, setCorporateRoot] = useState('');

  const [features, setFeatures] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function submit() {
    setSaving(true);
    try {
      const json = await postJson('/api/platform/firms', 'POST', {
        slug,
        name,
        shortName,
        primaryDomain,
        invoicePrefix,
        admin: { email: adminEmail, name: adminName, position: adminPosition },
        branding: {
          documentName,
          palette: { primary, accent },
          nameLines: nameLines.map((l) => l.trim()).filter(Boolean),
          tagline,
          fontSet,
        },
        email: {
          fromName,
          fromAddress,
          financeAddress,
          ipAddress,
          complianceAddress,
          ownedDomains: ownedDomains
            .split(/[\s,]+/)
            .map((d) => d.trim())
            .filter(Boolean),
        },
        documents: { financeRoot, corporateRoot },
        features,
        ...(adminPassword.trim() ? { adminPassword: adminPassword.trim() } : {}),
      });
      setResult(json as unknown as Result);
      toast.success('Firm provisioned');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Provisioning failed');
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-5 max-w-3xl">
        <Panel
          title="Provisioned"
          description={
            <>
              <span className="font-mono">{result.slug}</span> · {result.firmId}
            </>
          }
        >
          {result.admin.password ? (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                First admin password — shown once
              </p>
              <p className="text-sm text-foreground mt-2">{result.admin.email}</p>
              <p className="font-mono text-base text-foreground mt-1 select-all break-all">
                {result.admin.password}
              </p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-2">
                It is not stored anywhere this surface can read back. Hand it over out of band and
                have them change it.
              </p>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">
              The first admin ({result.admin.email}) already existed — their password was not
              touched.
            </p>
          )}

          <ul className="space-y-1">
            {result.steps.map((step) => (
              <li key={step.label} className="flex items-start gap-2 text-xs">
                <span
                  className={`font-mono shrink-0 ${
                    step.outcome === 'created'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-[var(--text-muted)]'
                  }`}
                >
                  {step.outcome === 'created' ? '+' : '='}
                </span>
                <span className="text-foreground">{step.label}</span>
                {step.detail && (
                  <span className="text-[var(--text-secondary)]">— {step.detail}</span>
                )}
              </li>
            ))}
          </ul>

          <Caution>
            The firm is not usable yet. Its invoice settings carry placeholders, so invoicing and
            every branded document refuse until finance completes them; every integration is
            registered and switched off; the billing rates are 0.00 and the fee schedules unpriced;
            and no branding assets are uploaded. Finish those on the firm&apos;s page.
          </Caution>

          <div className="flex items-center gap-3 pt-1">
            <Link
              href={`/platform/firms/${result.firmId}`}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-navy-800 text-white hover:bg-navy-700 transition-colors"
            >
              <Check className="w-4 h-4" />
              Configure this firm
            </Link>
            <Link href="/platform" className="text-xs text-[var(--text-secondary)] hover:text-foreground">
              Back to firms
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <Panel
        title="Identity"
        description="The slug and the invoice prefix are validated against the database's own CHECK patterns when you submit — not against a copy of them kept here."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Slug"
            value={slug}
            onChange={(v) => setSlug(v.toLowerCase())}
            placeholder="acme-legal"
            mono
            hint="Lowercase letters, digits and hyphens; 2–31 characters."
          />
          <Field
            label="Invoice prefix"
            value={invoicePrefix}
            onChange={(v) => setInvoicePrefix(v.toUpperCase())}
            placeholder="ACME"
            mono
            hint="2–8 letters or digits. Invoice numbers are PREFIX-YYYY-MM-NNN."
          />
          <Field label="Name" value={name} onChange={setName} placeholder="Acme Legal Partners" />
          <Field
            label="Short name"
            value={shortName}
            onChange={setShortName}
            placeholder="Acme"
            hint="Also the fallback root of the firm's document archive."
          />
        </div>
        <Field
          label="Primary domain"
          value={primaryDomain}
          onChange={(v) => setPrimaryDomain(v.toLowerCase())}
          placeholder="app.acmelegal.ph"
          mono
          hint="A bare hostname. It resolves to this firm before anyone signs in; a host another firm already claims is refused."
        />
      </Panel>

      <Panel
        title="First admin"
        description="Created last, after everything else has landed. Leave the password blank to have one generated and shown once."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Email" value={adminEmail} onChange={setAdminEmail} placeholder="admin@acmelegal.ph" />
          <Field label="Name" value={adminName} onChange={setAdminName} placeholder="Juana Dela Cruz" />
          <Field label="Position" value={adminPosition} onChange={setAdminPosition} placeholder="Managing Partner" />
          <Field
            label="Password (optional)"
            value={adminPassword}
            onChange={setAdminPassword}
            type="password"
            hint="Blank generates one."
          />
        </div>
      </Panel>

      <Panel
        title="Branding"
        description="The document name, palette and font set are required — lib/pdf/brand.ts throws at render on an unset one, and a firm provisioned without them is a firm whose first branded document fails in front of a client."
      >
        <Field
          label="Document name"
          value={documentName}
          onChange={setDocumentName}
          placeholder="ACME LEGAL PARTNERS"
          hint="How the firm is stamped on documents — running headers, PDF author, DOCX signature blocks. Distinct from the platform-facing name above."
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ColorField label="Palette · primary" value={primary} onChange={setPrimary} />
          <ColorField label="Palette · accent" value={accent} onChange={setAccent} />
        </div>
        <Select
          label="Font set"
          value={fontSet}
          onChange={setFontSet}
          options={fontSets.map((s) => ({ id: s.name, label: s.label }))}
          hint="A curated set. Arbitrary font upload is out of scope; an unknown name throws at render rather than substituting."
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {nameLines.map((line, i) => (
            <Field
              key={i}
              label={`Cover line ${i + 1}`}
              value={line}
              onChange={(v) => setNameLines((prev) => prev.map((l, j) => (j === i ? v : l)))}
            />
          ))}
        </div>
        <Field label="Tagline" value={tagline} onChange={setTagline} placeholder="Counsel to enterprise" />
      </Panel>

      <Panel
        title="Email identity"
        description="Who the firm's outbound mail comes from, and which domains count as its own."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="From name" value={fromName} onChange={setFromName} />
          <Field label="From address" value={fromAddress} onChange={setFromAddress} />
          <Field label="Finance address" value={financeAddress} onChange={setFinanceAddress} />
          <Field label="IP address (mailbox)" value={ipAddress} onChange={setIpAddress} />
          <Field label="Compliance address (mailbox)" value={complianceAddress} onChange={setComplianceAddress} />
        </div>
        <TextArea
          label="Owned domains"
          value={ownedDomains}
          onChange={setOwnedDomains}
          placeholder="acmelegal.ph acmelegal.com"
          hint="Space- or comma-separated. Load-bearing: this list decides whether every synced message is inbound or outbound, and the court-mail analyzer only looks at mail from outside it. A firm with none classifies everything as inbound."
        />
      </Panel>

      <Panel
        title="Document roots"
        description="Root folders for documents mirrored to the firm's SharePoint or OneDrive. Blank derives them from the short name."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Finance root"
            value={financeRoot}
            onChange={setFinanceRoot}
            placeholder={shortName ? `${shortName} Finance` : 'Acme Finance'}
          />
          <Field
            label="Corporate root"
            value={corporateRoot}
            onChange={setCorporateRoot}
            placeholder={shortName ? `${shortName} Corporate` : 'Acme Corporate'}
          />
        </div>
        <Caution>
          These name a live archive. Set them once here: changing one later does not move what is
          already filed under the old name.
        </Caution>
      </Panel>

      <Panel
        title="Entitlements"
        description="What the firm is signed up for — level one of three. Every integration row is still written disabled, so nothing here switches anything on."
      >
        <div className="space-y-2">
          {featureKeys.map((key) => (
            <div key={key} className="flex items-center gap-3">
              <Toggle
                label={key}
                checked={features.includes(key)}
                onChange={(on) =>
                  setFeatures((prev) => (on ? [...prev, key] : prev.filter((k) => k !== key)))
                }
              />
              <span className="text-sm text-foreground font-mono">{key}</span>
              <span className="text-xs text-[var(--text-secondary)]">{FEATURE_NOTE[key] ?? ''}</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-navy-800 text-white hover:bg-navy-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
          {saving ? 'Provisioning…' : 'Provision firm'}
        </button>
        <Link href="/platform" className="text-xs text-[var(--text-secondary)] hover:text-foreground">
          Cancel
        </Link>
      </div>
    </div>
  );
}
