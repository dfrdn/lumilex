'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { toast } from 'sonner';
import type { ClientBillingProfile } from '@/lib/billing/client-profile';

interface OptionalParagraph { key: string; label: string }

interface Props {
  clientId: string;
  onClose: () => void;
  onSaved?: (profile: ClientBillingProfile) => void;
}

const inputClass = 'w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40';
const labelClass = 'block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1';

/**
 * A client's billing profile: who the letter goes to and how it reads, set once
 * for all the client's matters. The wording itself is edited firm-wide on the
 * Billing Letter page; here finance picks which optional paragraphs this client gets.
 */
export default function ClientBillingProfileModal({ clientId, onClose, onSaved }: Props) {
  const [clientName, setClientName] = useState('');
  const [profile, setProfile] = useState<ClientBillingProfile>({});
  const [paragraphs, setParagraphs] = useState<OptionalParagraph[]>([]);
  const [defaultEmail, setDefaultEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [p, t] = await Promise.all([
          fetch(`/api/finance/clients/${encodeURIComponent(clientId)}/billing-profile`).then((r) => r.json()),
          fetch('/api/finance/letter-template').then((r) => r.json()),
        ]);
        setClientName(p.clientName ?? '');
        setProfile(p.profile ?? {});
        setDefaultEmail(p.defaultClientEmail ?? '');
        setParagraphs(t.choices ?? []);
      } catch {
        setError('Could not load the billing profile.');
      } finally {
        setLoading(false);
      }
    })();
  }, [clientId]);

  const set = <K extends keyof ClientBillingProfile>(k: K, v: ClientBillingProfile[K]) => setProfile((p) => ({ ...p, [k]: v }));
  const text = (k: 'clientAddress' | 'attnName' | 'attnTitle' | 'throughName' | 'salutation' | 'clientEmail' | 'ccEmails' | 'earlyPaymentDiscountPercent' | 'earlyPaymentDays') => profile[k] ?? '';
  const chosen = new Set(profile.optionalParagraphs ?? []);
  const toggleParagraph = (key: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(key); else next.delete(key);
    set('optionalParagraphs', [...next]);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/finance/clients/${encodeURIComponent(clientId)}/billing-profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.details?.join(', ') || json.error || 'Save failed');
      toast.success('Billing profile saved');
      onSaved?.(json.profile);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const addressee = profile.letterAddressee ?? 'company';
  const visibleParagraphs = paragraphs;

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!saving}
      title="Client billing profile"
      description={`${clientName || '…'} — applies to every matter billed to this client`}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving || loading}>{saving ? 'Saving…' : 'Save profile'}</Button>
        </div>
      }
    >
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : (
          <div className="space-y-5">
            <section className="space-y-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Addressed to</h3>
              <div className="inline-flex rounded-lg border border-[var(--border-color)] overflow-hidden text-xs">
                {([['company', 'Company, with Attention line'], ['person', 'A person']] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set('letterAddressee', value)}
                    className={`px-3 py-1.5 transition-colors cursor-pointer ${addressee === value ? 'bg-navy-900 text-white dark:bg-gold-400 dark:text-navy-950' : 'bg-[var(--background)] text-[var(--text-secondary)] hover:bg-subtle'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div>
                <label className={labelClass}>Address</label>
                <textarea value={text('clientAddress')} onChange={(e) => set('clientAddress', e.target.value)} rows={2} className={`${inputClass} resize-none`} placeholder="12/F Tower One, Ayala Avenue&#10;Makati City" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>{addressee === 'person' ? 'Name' : 'Attention'}</label>
                  <input value={text('attnName')} onChange={(e) => set('attnName', e.target.value)} className={inputClass} placeholder="Ms. Jane Doe" />
                </div>
                {addressee === 'company' && (
                  <div>
                    <label className={labelClass}>Their title</label>
                    <input value={text('attnTitle')} onChange={(e) => set('attnTitle', e.target.value)} className={inputClass} placeholder="Chief Financial Officer" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Through</label>
                  <input value={text('throughName')} onChange={(e) => set('throughName', e.target.value)} className={inputClass} placeholder="Optional" />
                </div>
                <div>
                  <label className={labelClass}>Salutation</label>
                  <input value={text('salutation')} onChange={(e) => set('salutation', e.target.value)} className={inputClass} placeholder="Gentlemen/Mesdames" />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Email</h3>
              <div>
                <label className={labelClass}>Send to</label>
                <input type="email" value={text('clientEmail')} onChange={(e) => set('clientEmail', e.target.value)} className={inputClass} placeholder={defaultEmail ? `Defaults to ${defaultEmail}` : 'accounting@client.com'} />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">Blank uses the email on the client record.</p>
              </div>
              <div>
                <label className={labelClass}>CC (comma-separated)</label>
                <input value={text('ccEmails')} onChange={(e) => set('ccEmails', e.target.value)} className={inputClass} placeholder="cfo@client.com, controller@client.com" />
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">The letter</h3>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={profile.includeVAT ?? false} onChange={(e) => set('includeVAT', e.target.checked)} className="rounded" />
                <span className="text-[var(--text-secondary)]">Bill with VAT (12% on top)</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={profile.includeLessenFeesNote ?? false} onChange={(e) => set('includeLessenFeesNote', e.target.checked)} className="rounded" />
                <span className="text-[var(--text-secondary)]">Add the &quot;to further lessen your fees&quot; note</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={profile.initialStatement ?? false} onChange={(e) => set('initialStatement', e.target.checked)} className="rounded" />
                <span className="text-[var(--text-secondary)]">Open as an initial billing statement</span>
              </label>
              {visibleParagraphs.length > 0 && (
                <div className="pt-1">
                  <p className="text-[11px] text-[var(--text-muted)] mb-1">Your paragraphs (edit their wording on the Billing Letter page)</p>
                  {visibleParagraphs.map((p) => (
                    <label key={p.key} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                      <input type="checkbox" checked={chosen.has(p.key)} onChange={(e) => toggleParagraph(p.key, e.target.checked)} className="rounded" />
                      <span className="text-[var(--text-secondary)]">{p.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Early-payment discount</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Discount (%)</label>
                  <input type="number" min={0} max={100} value={text('earlyPaymentDiscountPercent')} onChange={(e) => set('earlyPaymentDiscountPercent', e.target.value)} className={inputClass} placeholder="5" />
                </div>
                <div>
                  <label className={labelClass}>If paid within (days)</label>
                  <input type="number" min={0} max={60} value={text('earlyPaymentDays')} onChange={(e) => set('earlyPaymentDays', e.target.value)} className={inputClass} placeholder="5" />
                </div>
              </div>
              <p className="text-[10px] text-[var(--text-muted)]">
                Off the month&apos;s legal fees (with their VAT), never expenses or a previous balance. The pay-by date is never later than the due date. A payment recorded by then books the discount as a credit; undoing the payment takes it back out. Blank means no offer.
              </p>
            </section>

            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        )}
    </Modal>
  );
}
