'use client';

import Link from 'next/link';
import { FileText, Receipt, Clock, DollarSign, TrendingDown, TrendingUp } from 'lucide-react';
import { manilaHour, formatManila } from '@/lib/dates';
import { insightsHref } from '@/lib/finance/insights-tabs';

interface Props {
  unbilledEntries: number;
  totalBilledThisMonth: number;
  outstandingInvoices: number;
  totalOutstandingAR: number;
  currentMonth: string;
  userName?: string;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
}

export default function FinanceOverview({ unbilledEntries, totalBilledThisMonth, outstandingInvoices, totalOutstandingAR, userName }: Props) {
  const hour = manilaHour();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const displayName = userName ? userName.split(' ')[0] : null;
  const dayName = formatManila(new Date(), { weekday: 'long' });
  const subtitleMap = {
    morning:   `Here's where the numbers stand this ${dayName}.`,
    afternoon: `Afternoon snapshot. Your firm's financial position at a glance.`,
    evening:   `End-of-day summary. Here's your financial position.`,
  };
  const subtitle = subtitleMap[hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'];

  const cards = [
    {
      label: 'Unbilled DTR Entries',
      value: unbilledEntries.toString(),
      icon: Clock,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-500/10',
    },
    {
      label: 'Billed This Month',
      value: formatCurrency(totalBilledThisMonth),
      icon: DollarSign,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-500/10',
    },
    {
      label: 'Outstanding Invoices',
      value: outstandingInvoices.toString(),
      icon: Receipt,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-50 dark:bg-blue-500/10',
    },
    {
      label: 'Total Outstanding AR',
      value: formatCurrency(totalOutstandingAR),
      icon: TrendingDown,
      color: 'text-red-600 dark:text-red-400',
      bg: 'bg-red-50 dark:bg-red-500/10',
    },
  ];

  return (
    <div>
      <div className="mb-8 animate-fade-up">
        <h1 className="font-serif text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          {greeting}{displayName ? `, ${displayName}` : ''}
        </h1>
        <div className="greeting-accent mt-2" />
        <p className="text-sm text-[var(--text-secondary)] mt-2.5">{subtitle}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8 page-stagger">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-5 shadow-[var(--shadow-card)] hover-lift"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-9 h-9 rounded-lg ${card.bg} flex items-center justify-center`}>
                <card.icon className={`w-4.5 h-4.5 ${card.color}`} />
              </div>
              <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                {card.label}
              </span>
            </div>
            <p className="text-2xl font-bold text-foreground tabular-nums">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href="/finance/dtr-review"
          className="flex items-center gap-4 p-5 bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] transition-shadow"
        >
          <div className="w-11 h-11 rounded-lg bg-gold-50 dark:bg-gold-500/10 flex items-center justify-center">
            <FileText className="w-5 h-5 text-gold-600 dark:text-gold-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Review &amp; Generate</p>
            <p className="text-xs text-[var(--text-muted)]">Review a client&apos;s bundle and generate the invoice</p>
          </div>
        </Link>

        <Link
          href="/finance/invoices"
          className="flex items-center gap-4 p-5 bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] transition-shadow"
        >
          <div className="w-11 h-11 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
            <Receipt className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">View Invoices</p>
            <p className="text-xs text-[var(--text-muted)]">Manage and download generated invoices</p>
          </div>
        </Link>

        <Link
          href="/finance/receivables"
          className="flex items-center gap-4 p-5 bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] transition-shadow"
        >
          <div className="w-11 h-11 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
            <TrendingDown className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Accounts Receivable</p>
            <p className="text-xs text-[var(--text-muted)]">Track outstanding invoices and record payments</p>
          </div>
        </Link>

        <Link
          href={insightsHref('profitability')}
          className="flex items-center gap-4 p-5 bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] transition-shadow"
        >
          <div className="w-11 h-11 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Profitability Report</p>
            <p className="text-xs text-[var(--text-muted)]">Revenue vs cost analysis per matter</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
