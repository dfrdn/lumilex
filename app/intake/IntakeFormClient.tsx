'use client';

import { useState } from 'react';
import { AlertCircle, Building2, CheckCircle2, Loader2, Scale, Send, Stamp } from 'lucide-react';

type Kind = 'general' | 'trademark' | 'incorporation';

const KINDS: { id: Kind; label: string; sub: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General engagement', sub: 'Litigation, labor, contracts, advice', icon: <Scale className="w-4 h-4" /> },
  { id: 'trademark', label: 'Trademark', sub: 'Register or protect a mark', icon: <Stamp className="w-4 h-4" /> },
  { id: 'incorporation', label: 'Incorporation', sub: 'Set up a Philippine corporation', icon: <Building2 className="w-4 h-4" /> },
];

const INPUT =
  'w-full px-4 py-3 text-sm rounded-xl border border-[var(--border-color)] bg-subtle placeholder:text-[var(--text-muted)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20 hover:border-[var(--border-hover)] transition-all disabled:opacity-50';

const LABEL = 'block text-xs font-medium text-[var(--text-secondary)] mb-1.5';

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'border-gold-400 bg-gold-50 dark:bg-gold-400/10 text-gold-700 dark:text-gold-300'
          : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--border-hover)]'
      }`}
    >
      {children}
    </button>
  );
}

export default function IntakeFormClient() {
  const [kind, setKind] = useState<Kind>('general');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  // trademark
  const [markNames, setMarkNames] = useState(['', '', '']);
  const [goodsServices, setGoodsServices] = useState('');
  const [inUse, setInUse] = useState<'yes' | 'no'>('no');
  const [inUseSince, setInUseSince] = useState('');
  const [ownerType, setOwnerType] = useState<'individual' | 'corporation'>('individual');
  // incorporation
  const [proposedNames, setProposedNames] = useState(['', '', '']);
  const [businessPurpose, setBusinessPurpose] = useState('');
  const [authorizedCapital, setAuthorizedCapital] = useState('');
  const [incorporators, setIncorporators] = useState('');
  const [timeline, setTimeline] = useState('');
  // honeypot
  const [website, setWebsite] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<number | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const details =
      kind === 'trademark'
        ? {
            markNames: markNames.map((m) => m.trim()).filter(Boolean),
            goodsServices: goodsServices.trim(),
            inUse,
            inUseSince: inUse === 'yes' ? inUseSince.trim() : undefined,
            ownerType,
          }
        : kind === 'incorporation'
          ? {
              proposedNames: proposedNames.map((n) => n.trim()).filter(Boolean),
              businessPurpose: businessPurpose.trim(),
              authorizedCapital: authorizedCapital.trim(),
              incorporators: incorporators.trim(),
              timeline: timeline.trim(),
            }
          : undefined;

    if (kind === 'trademark' && (details as { markNames: string[] }).markNames.length === 0) {
      setError('Please provide at least one mark name.');
      setSubmitting(false);
      return;
    }
    if (kind === 'incorporation' && (details as { proposedNames: string[] }).proposedNames.length === 0) {
      setError('Please provide at least one proposed corporate name.');
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch('/api/public/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, fullName, email, phone, company, message, details, website }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Something went wrong. Please try again.');
      setReference(body.reference ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (reference !== null) {
    return (
      <div className="border border-[var(--border-color)] rounded-2xl bg-card p-10 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-green-50 dark:bg-green-500/10 flex items-center justify-center mb-4">
          <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
        </div>
        <h2 className="font-serif text-2xl text-foreground tracking-tight">Thank you</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-2 max-w-md mx-auto">
          Your inquiry has been received{reference ? <> — reference <span className="font-mono font-semibold">INQ-{reference}</span></> : ''}.
          Our team reviews every inquiry (including the conflict-of-interest check every law firm must
          run) and will reach out by email.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-8">
      {/* Kind selector */}
      <div className="grid gap-3 sm:grid-cols-3">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => setKind(k.id)}
            className={`text-left rounded-2xl border p-4 transition-all ${
              kind === k.id
                ? 'border-gold-400 bg-gold-50/60 dark:bg-gold-400/10 ring-2 ring-gold-400/20'
                : 'border-[var(--border-color)] bg-card hover:border-[var(--border-hover)]'
            }`}
          >
            <div className={`flex items-center gap-2 text-sm font-medium ${kind === k.id ? 'text-gold-700 dark:text-gold-300' : 'text-foreground'}`}>
              {k.icon}
              {k.label}
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">{k.sub}</p>
          </button>
        ))}
      </div>

      {/* Contact */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL}>Full name *</label>
          <input className={INPUT} value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={120} placeholder="Juan dela Cruz" />
        </div>
        <div>
          <label className={LABEL}>Email *</label>
          <input className={INPUT} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={160} placeholder="you@company.com" />
        </div>
        <div>
          <label className={LABEL}>Phone</label>
          <input className={INPUT} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} placeholder="+63 ..." />
        </div>
        <div>
          <label className={LABEL}>Company (if any)</label>
          <input className={INPUT} value={company} onChange={(e) => setCompany(e.target.value)} maxLength={160} />
        </div>
      </div>

      {/* Honeypot — invisible to humans */}
      <div className="absolute -left-[9999px] top-auto" aria-hidden="true">
        <label>
          Website
          <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>

      {/* Kind-specific */}
      {kind === 'general' && (
        <div>
          <label className={LABEL}>What do you need help with? *</label>
          <textarea
            className={`${INPUT} min-h-[120px] resize-y`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            maxLength={4000}
            placeholder="A short description of your legal concern. Please avoid confidential details at this stage."
          />
        </div>
      )}

      {kind === 'trademark' && (
        <div className="space-y-4">
          <div>
            <label className={LABEL}>Mark name(s) to register * <span className="text-[var(--text-muted)] normal-case">(up to 3)</span></label>
            <div className="space-y-2">
              {markNames.map((m, i) => (
                <input
                  key={i}
                  className={INPUT}
                  value={m}
                  onChange={(e) => setMarkNames((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                  maxLength={120}
                  placeholder={i === 0 ? 'e.g. KAPEHAN & device' : 'optional'}
                />
              ))}
            </div>
          </div>
          <div>
            <label className={LABEL}>Goods / services the mark covers</label>
            <textarea className={`${INPUT} min-h-[80px] resize-y`} value={goodsServices} onChange={(e) => setGoodsServices(e.target.value)} maxLength={1000} placeholder="e.g. coffee shop services, roasted beans, merchandise" />
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div>
              <span className={LABEL}>Already in use?</span>
              <div className="flex gap-2">
                <Pill active={inUse === 'no'} onClick={() => setInUse('no')}>Not yet</Pill>
                <Pill active={inUse === 'yes'} onClick={() => setInUse('yes')}>Yes</Pill>
              </div>
            </div>
            {inUse === 'yes' && (
              <div className="flex-1 min-w-[160px]">
                <label className={LABEL}>Since when?</label>
                <input className={INPUT} value={inUseSince} onChange={(e) => setInUseSince(e.target.value)} maxLength={40} placeholder="e.g. March 2023" />
              </div>
            )}
            <div>
              <span className={LABEL}>Owner</span>
              <div className="flex gap-2">
                <Pill active={ownerType === 'individual'} onClick={() => setOwnerType('individual')}>Individual</Pill>
                <Pill active={ownerType === 'corporation'} onClick={() => setOwnerType('corporation')}>Corporation</Pill>
              </div>
            </div>
          </div>
          <div>
            <label className={LABEL}>Anything else we should know?</label>
            <textarea className={`${INPUT} min-h-[60px] resize-y`} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} />
          </div>
        </div>
      )}

      {kind === 'incorporation' && (
        <div className="space-y-4">
          <div>
            <label className={LABEL}>Proposed corporate name(s) * <span className="text-[var(--text-muted)] normal-case">(up to 3, in order of preference)</span></label>
            <div className="space-y-2">
              {proposedNames.map((n, i) => (
                <input
                  key={i}
                  className={INPUT}
                  value={n}
                  onChange={(e) => setProposedNames((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                  maxLength={160}
                  placeholder={i === 0 ? 'e.g. Sampaguita Ventures Corp.' : 'alternative'}
                />
              ))}
            </div>
          </div>
          <div>
            <label className={LABEL}>Primary business purpose</label>
            <textarea className={`${INPUT} min-h-[80px] resize-y`} value={businessPurpose} onChange={(e) => setBusinessPurpose(e.target.value)} maxLength={1000} placeholder="e.g. food and beverage retail; software development services" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={LABEL}>Authorized capital</label>
              <input className={INPUT} value={authorizedCapital} onChange={(e) => setAuthorizedCapital(e.target.value)} maxLength={60} placeholder="e.g. ₱1,000,000" />
            </div>
            <div>
              <label className={LABEL}>Incorporators</label>
              <input className={INPUT} value={incorporators} onChange={(e) => setIncorporators(e.target.value)} maxLength={120} placeholder="e.g. 2 individuals, 1 corp" />
            </div>
            <div>
              <label className={LABEL}>Target timeline</label>
              <input className={INPUT} value={timeline} onChange={(e) => setTimeline(e.target.value)} maxLength={120} placeholder="e.g. within 2 months" />
            </div>
          </div>
          <div>
            <label className={LABEL}>Anything else we should know?</label>
            <textarea className={`${INPUT} min-h-[60px] resize-y`} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} />
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !fullName.trim() || !email.trim()}
        className="w-full sm:w-auto flex items-center justify-center gap-2 bg-navy-900 dark:bg-gold-400 hover:bg-navy-800 dark:hover:bg-gold-300 text-white dark:text-navy-950 font-semibold text-sm px-8 py-3 rounded-xl transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        Submit inquiry
      </button>
    </form>
  );
}
