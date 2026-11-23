'use client';

import { useState } from 'react';
import { AlertCircle, CheckCircle2, Download, Eye, FileSignature, FileText, Loader2, PenLine } from 'lucide-react';

export interface EngagementSignatureState {
  typedName: string;
  signedAt: string;
}

interface Props {
  matterId: string;
  documentName: string;
  /** Signed URL for reading the engagement letter (minted server-side). */
  documentUrl: string | null;
  signerName: string;
  initialSignature: EngagementSignatureState | null;
  /** Read-only partner/admin preview — disables signing. */
  preview?: boolean;
}

function fmtSignedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Manila',
  });
}

export default function EngagementSignatureCard({
  matterId,
  documentName,
  documentUrl,
  signerName,
  initialSignature,
  preview = false,
}: Props) {
  const [signature, setSignature] = useState<EngagementSignatureState | null>(initialSignature);
  const [typedName, setTypedName] = useState(signerName);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sign(e: React.FormEvent) {
    e.preventDefault();
    if (preview || !consent || typedName.trim().length < 4) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/matters/${encodeURIComponent(matterId)}/sign-engagement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ typedName: typedName.trim(), consent: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not record the signature.');
      setSignature({ typedName: body.data.typed_name, signedAt: body.data.signed_at });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the signature.');
    } finally {
      setSubmitting(false);
    }
  }

  // Engagement-letter e-signing is hidden in the portal for now. Clients can
  // still view and download their engagement agreement; they just can't sign it
  // here. Flip SIGNING_ENABLED back to true to restore the typed-name acceptance
  // flow below (the signed/awaiting branches and the POST handler stay intact).
  const SIGNING_ENABLED: boolean = false;

  if (!SIGNING_ENABLED) {
    const downloadUrl = documentUrl
      ? `${documentUrl}${documentUrl.includes('?') ? '&' : '?'}download=${encodeURIComponent(documentName || 'Engagement agreement')}`
      : null;
    return (
      <section className="mb-8 border border-[var(--border-color)] rounded-2xl bg-card p-5">
        <div className="flex items-start gap-3">
          <FileText className="w-5 h-5 text-navy-700 dark:text-gold-400 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Engagement agreement</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              {documentName || 'Your engagement agreement'} is available for your records.
            </p>
            {documentUrl ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={documentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground border border-[var(--border-color)] bg-card hover:bg-subtle rounded-lg px-3 py-2 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                  View
                </a>
                <a
                  href={downloadUrl ?? documentUrl}
                  download
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-navy-900 dark:bg-gold-400 dark:text-navy-950 hover:bg-navy-800 dark:hover:bg-gold-300 rounded-lg px-3 py-2 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </a>
              </div>
            ) : (
              <p className="mt-3 text-xs text-[var(--text-muted)] italic">
                The document link is being prepared — please check back shortly.
              </p>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (signature) {
    return (
      <section className="mb-8 border border-emerald-200/60 dark:border-emerald-400/20 rounded-2xl bg-emerald-50/40 dark:bg-emerald-400/5 p-5">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Engagement letter signed</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Electronically accepted by <span className="font-semibold">{signature.typedName}</span> on{' '}
              {fmtSignedAt(signature.signedAt)}.
              {documentUrl && (
                <>
                  {' '}
                  <a href={documentUrl} target="_blank" rel="noreferrer" className="text-gold-700 dark:text-gold-400 hover:underline">
                    View the letter
                  </a>
                </>
              )}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-8 border border-gold-300/60 dark:border-gold-400/30 rounded-2xl bg-gold-50/40 dark:bg-gold-400/5 p-5">
      <div className="flex items-start gap-3">
        <FileSignature className="w-5 h-5 text-gold-700 dark:text-gold-400 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Engagement letter awaiting your signature</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            {documentUrl ? (
              <>
                Please read{' '}
                <a href={documentUrl} target="_blank" rel="noreferrer" className="text-gold-700 dark:text-gold-400 font-medium hover:underline">
                  {documentName || 'the engagement letter'}
                </a>{' '}
                before signing.
              </>
            ) : (
              <>Please read the engagement letter provided by the firm before signing.</>
            )}
          </p>

          <form onSubmit={sign} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Type your full legal name to sign
              </label>
              <input
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                maxLength={160}
                disabled={submitting || preview}
                className="w-full sm:max-w-sm px-4 py-2.5 text-sm rounded-xl border border-[var(--border-color)] bg-card placeholder:text-[var(--text-muted)] text-foreground font-serif italic focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20 transition-all disabled:opacity-50"
                placeholder="Full legal name"
              />
            </div>

            <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)] cursor-pointer max-w-xl">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                disabled={submitting || preview}
                className="mt-0.5 accent-gold-500"
              />
              <span>
                I have read and agree to the terms of the engagement letter. I understand that typing my
                name above constitutes my electronic signature and acceptance on behalf of myself or the
                company I represent.
              </span>
            </label>

            {error && (
              <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || preview || !consent || typedName.trim().length < 4}
              title={preview ? 'The client signs here — disabled in preview' : undefined}
              className="inline-flex items-center gap-2 bg-navy-900 dark:bg-gold-400 hover:bg-navy-800 dark:hover:bg-gold-300 text-white dark:text-navy-950 font-semibold text-sm px-6 py-2.5 rounded-xl transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />}
              Sign engagement letter
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
