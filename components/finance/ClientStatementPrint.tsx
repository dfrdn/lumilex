'use client';

import Link from 'next/link';
import { Printer, ArrowLeft } from 'lucide-react';
import type { ClientStatement } from '@/lib/finance/client-statement';
import { formatManilaDate } from '@/lib/finance/format';

interface Props {
  clientName: string;
  statement: ClientStatement;
  asOfToday: string;
  found: boolean;
  /** Letterhead, resolved server-side from the firm's own profile. */
  letterhead: { firmName: string; addressLines: string[] };
}

function fmt(n: number) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string) {
  return d ? formatManilaDate(d) : '—';
}

export default function ClientStatementPrint({ clientName, statement, asOfToday, found, letterhead }: Props) {
  const balance = statement.currentBalance;
  const owes = balance > 0.005;
  const credit = balance < -0.005;

  return (
    <div className="min-h-screen bg-[var(--background)] print:bg-white py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Action bar — hidden when printing */}
        <div className="flex items-center justify-between mb-6 print:hidden">
          <Link
            href="/finance/receivables"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-foreground"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to receivables
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-foreground text-[var(--background)] hover:opacity-90 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </button>
        </div>

        {/* Statement sheet */}
        <div className="bg-white text-black rounded-lg border border-stone-200 shadow-sm print:border-0 print:shadow-none print:rounded-none p-8">
          {/* Letterhead */}
          <div className="border-b-2 border-stone-800 pb-4 mb-6">
            {letterhead.firmName && (
              <h1 className="text-lg font-bold tracking-tight text-stone-900">{letterhead.firmName}</h1>
            )}
            {letterhead.addressLines.length > 0 && (
              <p className="text-[11px] text-stone-500 mt-0.5">{letterhead.addressLines.join(', ')}</p>
            )}
          </div>

          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-900">Statement of Account</h2>
              <p className="text-sm text-stone-700 mt-1">{clientName}</p>
            </div>
            <div className="text-right text-[11px] text-stone-500">
              <p>As of {asOfToday}</p>
            </div>
          </div>

          {!found ? (
            <p className="text-sm text-stone-500 py-8 text-center">No record found for this client.</p>
          ) : statement.lines.length === 0 ? (
            <p className="text-sm text-stone-500 py-8 text-center">No outstanding balance or activity to report.</p>
          ) : (
            <>
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="border-b border-stone-300 text-[10px] uppercase tracking-wider text-stone-500">
                    <th className="text-left font-semibold py-1.5">Date</th>
                    <th className="text-left font-semibold py-1.5">Description</th>
                    <th className="text-right font-semibold py-1.5">Charge / (Credit)</th>
                    <th className="text-right font-semibold py-1.5">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.lines.map((line) => (
                    <tr key={line.key} className="border-b border-stone-100">
                      <td className="py-1.5 text-stone-500 whitespace-nowrap pr-3 align-top">{fmtDate(line.date)}</td>
                      <td className="py-1.5 text-stone-800 pr-3">{line.label}</td>
                      <td className="py-1.5 text-right tabular-nums whitespace-nowrap pr-3">
                        {line.charge > 0 ? fmt(line.charge) : line.credit > 0 ? `(${fmt(line.credit)})` : '—'}
                      </td>
                      <td className="py-1.5 text-right tabular-nums whitespace-nowrap font-medium text-stone-900">
                        {fmt(line.runningBalance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex justify-end mt-6">
                <div className="w-64 border-t-2 border-stone-800 pt-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-700">
                    {credit ? 'Credit balance' : 'Total due'}
                  </span>
                  <span className="text-sm font-bold tabular-nums text-stone-900">
                    {fmt(Math.abs(balance))}
                  </span>
                </div>
              </div>

              {credit && (
                <p className="text-[11px] text-stone-500 mt-2 text-right">
                  This client is in credit; the firm holds an advance balance.
                </p>
              )}
              {!owes && !credit && (
                <p className="text-[11px] text-stone-500 mt-2 text-right">Account settled.</p>
              )}
            </>
          )}

          <p className="text-[10px] text-stone-400 mt-10 pt-4 border-t border-stone-200">
            Generated {asOfToday}. Amounts in Philippine Pesos (₱). For questions about this statement, please contact the firm&apos;s finance team.
          </p>
        </div>
      </div>
    </div>
  );
}
