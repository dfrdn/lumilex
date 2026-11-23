'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';
import type { FirmInvoiceSettings } from '@/lib/billing/firm-defaults';

export default function FirmInvoiceSettingsForm({ initial }: { initial: FirmInvoiceSettings }) {
  const [form, setForm] = useState<FirmInvoiceSettings>(initial);
  const [saved, setSaved] = useState<FirmInvoiceSettings>(initial);
  const [saving, setSaving] = useState(false);

  const dirty = (Object.keys(form) as (keyof FirmInvoiceSettings)[]).some((k) => form[k] !== saved[k]);

  function set<K extends keyof FirmInvoiceSettings>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/finance/firm-invoice-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      setForm(json.settings);
      setSaved(json.settings);
      toast.success('Firm invoice details saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Section title="Letterhead">
        <Field label="Firm Address" value={form.firmAddress} onChange={(v) => set('firmAddress', v)} placeholder="Unit / Floor, Building, Street" />
        <Field label="Firm Address (line 2)" value={form.firmAddress2} onChange={(v) => set('firmAddress2', v)} placeholder="District, City, Philippines" />
        <Field label="VAT TIN" value={form.firmTIN} onChange={(v) => set('firmTIN', v)} placeholder="VAT Reg. TIN: 000-000-000-00000" />
      </Section>

      <Section title="Bank Details">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Bank" value={form.bankName} onChange={(v) => set('bankName', v)} placeholder="Bank name" />
          <Field label="Account No." value={form.bankAccountNo} onChange={(v) => set('bankAccountNo', v)} placeholder="Account number" />
          <Field label="Account Name" value={form.bankAccountName} onChange={(v) => set('bankAccountName', v)} placeholder="Account name" />
        </div>
      </Section>

      <Section title="Invoice Numbering">
        <Field
          label="Invoice Prefix"
          value={form.invoicePrefix}
          onChange={(v) => set('invoicePrefix', v.toUpperCase())}
          placeholder="e.g. ACME"
        />
        <p className="text-xs text-[var(--text-muted)] -mt-1">
          2–8 letters or digits. Invoice numbers are minted as PREFIX-YYYY-MM-NNN; changing the prefix
          starts a new sequence.
        </p>
      </Section>

      <Section title="Signature">
        <Field label="Fallback Signer (only if no Managing Partner is on the roster)" value={form.signerName} onChange={(v) => set('signerName', v)} placeholder="NAME OF SIGNING PARTNER" />
      </Section>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-navy-800 text-white hover:bg-navy-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {dirty && !saving && (
          <span className="text-xs text-[var(--text-muted)]">Unsaved changes</span>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-[var(--border-color)] rounded-xl p-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
      />
    </div>
  );
}
