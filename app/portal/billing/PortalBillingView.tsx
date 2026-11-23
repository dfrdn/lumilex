import { Banknote, Download, Receipt, Wallet } from 'lucide-react';
import type { PortalInvoiceRow, PortalPaymentRow } from '@/lib/portal/data';

interface Props {
  invoices: PortalInvoiceRow[];
  payments: PortalPaymentRow[];
  deposits: { type: string; amount: number }[];
  /** Preview mode (team member): the invoice download hits a portal-only API, so disable it. */
  preview?: boolean;
}

function peso(n: number): string {
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtMonth(yyyymm: string | null): string {
  if (!yyyymm) return '—';
  return new Date(`${yyyymm.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'long',
  });
}

// Live links to the portal download API; preview shows the same control
// disabled (that API is portal-session only).
function InvoiceDownloadAction({ invoiceId, preview }: { invoiceId: number; preview: boolean }) {
  const inner = (
    <>
      <Download className="w-3.5 h-3.5" />
      Download invoice
    </>
  );
  if (preview) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] opacity-60 cursor-not-allowed"
        title="The client downloads this from their portal — not available in preview"
      >
        {inner}
      </span>
    );
  }
  return (
    <a
      href={`/api/portal/invoices/${invoiceId}/download?type=letter`}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-gold-700 dark:text-gold-400 hover:underline"
    >
      {inner}
    </a>
  );
}

function statusChip(status: string, balance: number) {
  if (status === 'paid' || balance <= 0) {
    return (
      <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-400/10 px-2 py-0.5 rounded">
        Paid
      </span>
    );
  }
  if (status === 'partial') {
    return (
      <span className="text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-400/10 px-2 py-0.5 rounded">
        Partially paid
      </span>
    );
  }
  return (
    <span className="text-[10px] font-medium uppercase tracking-wider text-navy-700 dark:text-gold-400 bg-navy-50 dark:bg-gold-400/10 px-2 py-0.5 rounded">
      Awaiting payment
    </span>
  );
}

export default function PortalBillingView({ invoices, payments, deposits, preview = false }: Props) {
  const rows = invoices;
  const paymentsByInvoice = new Map<number, PortalPaymentRow[]>();
  for (const p of payments) {
    const list = paymentsByInvoice.get(p.invoice_id) ?? [];
    list.push(p);
    paymentsByInvoice.set(p.invoice_id, list);
  }

  const faceOf = (inv: PortalInvoiceRow) =>
    (Number(inv.total_amount) || 0) + (Number(inv.total_expenses) || 0);
  const balanceOf = (inv: PortalInvoiceRow) =>
    Math.max(0, faceOf(inv) - (Number(inv.paid_amount) || 0));

  const outstanding = rows.reduce((s, inv) => s + balanceOf(inv), 0);
  const totalBilled = rows.reduce((s, inv) => s + faceOf(inv), 0);
  const depositBalance = deposits.reduce((s, d) => {
    const amt = Number(d.amount) || 0;
    // Ledger amounts are signed (+credit / −debit); 'payment' rows settle the
    // opening balance, not the deposit pool.
    return d.type === 'payment' ? s : s + amt;
  }, 0);

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      <section className="mb-10 pb-8 border-b border-gold-200/40 dark:border-gold-400/15">
        <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-gold-700 dark:text-gold-400">
          Billing &amp; payments
        </p>
        <h1 className="font-serif text-3xl md:text-4xl text-foreground tracking-tight mt-3">
          Your account with us
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-2">
          Statements of account, payment history, and downloadable copies of every invoice.
        </p>
      </section>

      {/* Summary */}
      <section className="grid gap-4 sm:grid-cols-3 mb-10">
        <div className="border border-[var(--border-color)] rounded-2xl bg-card p-5">
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <Banknote className="w-4 h-4" />
            <span className="text-xs font-medium">Outstanding balance</span>
          </div>
          <p className="font-serif text-2xl mt-2 tracking-tight">{peso(outstanding)}</p>
        </div>
        <div className="border border-[var(--border-color)] rounded-2xl bg-card p-5">
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <Receipt className="w-4 h-4" />
            <span className="text-xs font-medium">Billed to date</span>
          </div>
          <p className="font-serif text-2xl mt-2 tracking-tight">{peso(totalBilled)}</p>
        </div>
        <div className="border border-[var(--border-color)] rounded-2xl bg-card p-5">
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <Wallet className="w-4 h-4" />
            <span className="text-xs font-medium">Deposits on hand</span>
          </div>
          <p className="font-serif text-2xl mt-2 tracking-tight">{peso(Math.max(0, depositBalance))}</p>
        </div>
      </section>

      {/* Invoices */}
      {rows.length === 0 ? (
        <div className="border border-[var(--border-color)] rounded-2xl bg-card p-10 text-center">
          <Receipt className="w-8 h-8 mx-auto text-[var(--text-muted)] mb-3" />
          <p className="text-sm text-[var(--text-secondary)]">
            No invoices yet. Statements will appear here once issued.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((inv) => {
            const balance = balanceOf(inv);
            const invPayments = paymentsByInvoice.get(inv.id) ?? [];
            const hasLetter = !!(inv.signed_pdf_path ?? inv.pdf_storage_path);
            return (
              <li key={inv.id} className="border border-[var(--border-color)] rounded-xl bg-card p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)] bg-subtle px-2 py-0.5 rounded">
                        {inv.invoice_number}
                      </span>
                      {statusChip(inv.status, balance)}
                    </div>
                    <h2 className="font-serif text-lg text-foreground mt-2 tracking-tight">
                      {fmtMonth(inv.billing_month)}
                    </h2>
                    <p className="text-xs text-[var(--text-secondary)] mt-1">
                      {inv.matter_name ? `${inv.matter_name} · ` : ''}
                      issued {fmtDate(inv.sent_date)}
                      {inv.due_date ? ` · due ${fmtDate(inv.due_date)}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-serif text-xl tracking-tight">{peso(faceOf(inv))}</p>
                    {balance > 0 && balance < faceOf(inv) && (
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                        {peso(balance)} remaining
                      </p>
                    )}
                  </div>
                </div>

                {invPayments.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[var(--border-color)] space-y-1">
                    {invPayments.map((p, i) => (
                      <p key={i} className="text-xs text-[var(--text-secondary)]">
                        Payment received {fmtDate(p.payment_date)} — {peso(Number(p.amount) || 0)}
                        {p.payment_method ? ` via ${p.payment_method}` : ''}
                      </p>
                    ))}
                  </div>
                )}

                {hasLetter && (
                  <div className="mt-3">
                    <InvoiceDownloadAction invoiceId={inv.id} preview={preview} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[11px] text-[var(--text-muted)] mt-8">
        For payment instructions or billing questions, please reach out to your engagement team — bank
        details are on each invoice letter.
      </p>
    </main>
  );
}
