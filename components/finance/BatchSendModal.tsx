'use client';

import { createPortal } from 'react-dom';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X, Loader2, Send, Upload, CheckCircle, AlertCircle, Paperclip,
  ArrowRight, ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';
import BillingEmailFrame from './BillingEmailFrame';
import PartnerCcToggle, { type PartnerCcState } from './PartnerCcToggle';
import { uploadToSignedUrl, commitUpload } from '@/lib/upload';
import { toast } from 'sonner';

interface Invoice {
  id: number;
  invoice_number: string;
  client_name: string;
  billing_month: string;
  total_amount: number;
  total_expenses: number;
  status: string;
  signed_pdf_path?: string | null;
  signed_breakdown_pdf_path?: string | null;
  pdf_storage_path?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  invoices: Invoice[];
  onSent?: () => void;
  /** The firm's own billing mailbox, resolved server-side. Blank omits the note. */
  financeAddress: string;
}

function fmt(n: number) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

export default function BatchSendModal({ open, onClose, invoices, onSent, financeAddress }: Props) {
  const sentFrom = financeAddress ? ` — sent from ${financeAddress}` : '';
  const [step, setStep] = useState<'select' | 'compose'>('select');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [results, setResults] = useState<{ sent: number; failed: string[]; warnings: string[] } | null>(null);
  const [localInvoices, setLocalInvoices] = useState(invoices);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [partnerCc, setPartnerCc] = useState<PartnerCcState>({
    ccRelationshipPartner: false,
    ccManagingPartner: false,
  });

  useEffect(() => {
    setLocalInvoices(invoices);
    const withPdf = invoices.filter((inv) => inv.signed_pdf_path || inv.pdf_storage_path).map((inv) => inv.id);
    setSelected(new Set(withPdf));
    setResults(null);
    setPartnerCc({ ccRelationshipPartner: false, ccManagingPartner: false });
    // When called with exactly one invoice (the per-row "Send" affordance in
    // InvoiceList), the select step has nothing useful to offer — jump
    // straight to composing the email.
    setStep(invoices.length === 1 ? 'compose' : 'select');
  }, [invoices]);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleUploadPdf = useCallback(async (invoiceId: number, files: FileList) => {
    if (files.length === 0) return;
    setUploading(invoiceId);

    // Signed invoices go browser-to-storage: routing them through the API
    // route capped them at Vercel's 4.5MB request-body limit.
    const picked: { slot: 'billingLetterPdf' | 'breakdownPdf'; file: File }[] = [
      { slot: 'billingLetterPdf' as const, file: files[0] },
      ...(files.length > 1 ? [{ slot: 'breakdownPdf' as const, file: files[1] }] : []),
    ];

    try {
      const prepRes = await fetch('/api/finance/invoices/upload-signed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoiceId.toString(), slots: picked.map((p) => p.slot) }),
      });
      const prep = await prepRes.json().catch(() => ({}));
      if (!prepRes.ok || !prep?.uploads) throw new Error(prep?.error || 'Could not start the upload.');

      for (const { slot, file } of picked) {
        await uploadToSignedUrl(prep.uploads[slot].signedUrl, file, {
          name: file.name,
          size: file.size,
          type: file.type,
        });
      }

      const data = await commitUpload<{ signedPdfPath: string | null; signedBreakdownPdfPath: string | null }>(
        '/api/finance/invoices/upload-signed',
        { commit: true, invoiceId: invoiceId.toString(), uploaded: picked.map((p) => p.slot) },
      );
      setLocalInvoices((prev) =>
        prev.map((inv) =>
          inv.id === invoiceId
            ? {
                ...inv,
                ...(data.signedPdfPath ? { signed_pdf_path: data.signedPdfPath } : {}),
                ...(data.signedBreakdownPdfPath
                  ? { signed_breakdown_pdf_path: data.signedBreakdownPdfPath }
                  : {}),
              }
            : inv
        )
      );
      setSelected((prev) => new Set([...prev, invoiceId]));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(null);
    }
  }, []);

  const readyIds = useMemo(
    () => [...selected].filter((id) => {
      const inv = localInvoices.find((i) => i.id === id);
      return inv?.signed_pdf_path || inv?.pdf_storage_path;
    }),
    [selected, localInvoices],
  );

  // The email as the first selected client will get it — every client gets
  // the same email, with its own figures.
  const previewInvoice = localInvoices.find((i) => readyIds.includes(i.id)) ?? null;
  const previewId = previewInvoice?.id ?? null;
  useEffect(() => {
    if (previewId == null) return;
    let cancelled = false;
    fetch(`/api/finance/invoices/email-preview?invoiceId=${previewId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { if (!cancelled) setPreview(json); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [previewId]);

  const handleSend = useCallback(async () => {
    if (readyIds.length === 0) return;
    setSending(true);
    setResults(null);

    try {
      const res = await fetch('/api/finance/batch-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceIds: readyIds,
          ...partnerCc,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Send failed');
      setResults({ sent: data.sent, failed: data.failed ?? [], warnings: data.warnings ?? [] });
      if (data.sent > 0) onSent?.();
    } catch (err) {
      setResults({ sent: 0, failed: [err instanceof Error ? err.message : 'Unknown error'], warnings: [] });
    } finally {
      setSending(false);
    }
  }, [readyIds, partnerCc, onSent]);

  if (!open) return null;

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {step === 'select'
                ? 'Send Invoices to Clients'
                : localInvoices.length === 1
                  ? 'Send Invoice'
                  : 'Compose Email'}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {step === 'select'
                ? 'Select invoices and upload signed PDFs'
                : localInvoices.length === 1
                  ? `${localInvoices[0].client_name} · ${localInvoices[0].invoice_number}${sentFrom}`
                  : `Editing email for ${readyIds.length} invoice${readyIds.length !== 1 ? 's' : ''}${sentFrom}`
              }
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Step indicator (only meaningful when there's a select step) */}
            {localInvoices.length > 1 && (
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  step === 'select' ? 'bg-gold-500 text-white' : 'bg-[var(--subtle-bg)] text-[var(--text-muted)]'
                }`}>1</span>
                <span className="w-4 h-px bg-[var(--border-color)]" />
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  step === 'compose' ? 'bg-gold-500 text-white' : 'bg-[var(--subtle-bg)] text-[var(--text-muted)]'
                }`}>2</span>
              </div>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--subtle-bg)] text-[var(--text-muted)] transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Step 1: Select invoices */}
        {step === 'select' && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
              {localInvoices.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] text-center py-8">No draft/sent invoices to send.</p>
              ) : (
                localInvoices.map((inv) => {
                  const hasSigned = !!inv.signed_pdf_path;
                  const hasGenerated = !!inv.pdf_storage_path;
                  const hasPdf = hasSigned || hasGenerated;
                  const isSelected = selected.has(inv.id);
                  const total = Number(inv.total_amount) + Number(inv.total_expenses);

                  return (
                    <div
                      key={inv.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                        isSelected && hasPdf
                          ? 'border-emerald-300 dark:border-emerald-600 bg-emerald-50/50 dark:bg-emerald-500/5'
                          : 'border-[var(--border-color)]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(inv.id)}
                        disabled={!hasPdf}
                        className="rounded border-[var(--border-color)] shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{inv.invoice_number}</span>
                          <span className="text-xs text-[var(--text-muted)]">{inv.client_name}</span>
                        </div>
                        <div className="text-xs text-[var(--text-muted)]">
                          {inv.billing_month} &middot; {fmt(total)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {hasSigned ? (
                          <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                            <Paperclip className="w-3.5 h-3.5" />
                            Signed PDF
                          </div>
                        ) : hasGenerated ? (
                          <div className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                            <Paperclip className="w-3.5 h-3.5" />
                            Auto PDF
                          </div>
                        ) : (
                          <span className="text-[10px] text-[var(--text-muted)]">No PDF</span>
                        )}
                        {!hasSigned && (
                          <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20 cursor-pointer transition-colors">
                            {uploading === inv.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Upload className="w-3 h-3" />
                            )}
                            {hasGenerated ? 'Replace' : 'Upload'}
                            <input
                              type="file"
                              accept=".pdf"
                              multiple
                              className="sr-only"
                              onChange={(e) => e.target.files && handleUploadPdf(inv.id, e.target.files)}
                              disabled={uploading === inv.id}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-color)]">
              <p className="text-xs text-[var(--text-muted)]">
                {readyIds.length} of {localInvoices.length} ready to send
              </p>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setStep('compose')}
                  disabled={readyIds.length === 0}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-navy-900 dark:bg-gold-400 text-white dark:text-navy-950 hover:bg-navy-800 dark:hover:bg-gold-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  Compose Email
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}

        {/* Step 2: Compose email */}
        {step === 'compose' && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {/* Recipient summary */}
              <div className="mb-4 p-3 rounded-xl bg-[var(--subtle-bg)] border border-[var(--border-color)]">
                <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Recipients ({readyIds.length})</p>
                <div className="flex flex-wrap gap-1.5">
                  {readyIds.map((id) => {
                    const inv = localInvoices.find((i) => i.id === id);
                    if (!inv) return null;
                    return (
                      <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-secondary)]">
                        {inv.client_name}
                        <span className="text-[var(--text-muted)]">{inv.invoice_number}</span>
                      </span>
                    );
                  })}
                </div>
              </div>

              <PartnerCcToggle invoiceIds={readyIds} value={partnerCc} onChange={setPartnerCc} />

              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <p className="text-xs font-medium text-[var(--text-secondary)]">
                    The email{previewInvoice ? <> as {previewInvoice.client_name} will get it</> : null}
                  </p>
                  <Link href="/finance/billing-letter" className="text-xs text-gold-700 dark:text-gold-400 hover:underline">Edit the wording</Link>
                </div>
                {preview ? (
                  <BillingEmailFrame html={preview.html} subject={preview.subject} from={financeAddress} />
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">{previewInvoice ? 'Loading the email…' : 'Select an invoice to see its email.'}</p>
                )}
                {readyIds.length > 1 && (
                  <p className="mt-1.5 text-[11px] text-[var(--text-secondary)]">Each client gets this email with its own figures, previous balance and discount.</p>
                )}
              </div>
            </div>

            {/* Results */}
            {results && (
              <div className="px-6 py-3 border-t border-[var(--border-color)]">
                {results.sent > 0 && (
                  <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 mb-1">
                    <CheckCircle className="w-4 h-4" />
                    {results.sent} invoice{results.sent !== 1 ? 's' : ''} sent successfully
                  </div>
                )}
                {results.failed.length > 0 && (
                  <div className="text-sm text-red-600 dark:text-red-400">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertCircle className="w-4 h-4" />
                      {results.failed.length} failed:
                    </div>
                    {results.failed.map((msg, i) => (
                      <p key={i} className="text-xs ml-6">{msg}</p>
                    ))}
                  </div>
                )}
                {results.warnings.length > 0 && (
                  <div className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertCircle className="w-4 h-4" />
                      Sent with warnings:
                    </div>
                    {results.warnings.map((msg, i) => (
                      <p key={i} className="text-xs ml-6">{msg}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-color)]">
              {localInvoices.length > 1 ? (
                <button
                  onClick={() => setStep('select')}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
              ) : (
                <span />
              )}
              <button
                onClick={handleSend}
                disabled={sending || readyIds.length === 0}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {sending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Send {readyIds.length} Invoice{readyIds.length !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
