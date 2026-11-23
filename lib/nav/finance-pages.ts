import {
  Home, Receipt, DollarSign, Wallet, TrendingDown, TrendingUp, CreditCard, Settings, Mail, ClipboardCheck,
  Eye, MapPin, Users, CheckSquare, MessageSquare, List, BookOpen, Building2, Activity, Droplets, Landmark, Bike, Cog,
} from 'lucide-react';
import { settingsEntry } from './settings-entry';
import type { NavPage, NavSection } from './types';

/** Every page that came with the finance sidebar: before any "New" window. */
const BASE = '2026-08-22';

export const FINANCE_SECTIONS: NavSection[] = [
  { id: 'home', label: null },
  { id: 'workspace', label: 'Workspace' },
  { id: 'billing', label: 'Billing' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'configuration', label: 'Configuration' },
];

export const FINANCE_PAGES: NavPage[] = [
  { section: 'home', label: 'Overview', icon: Home, href: '/finance', addedOn: BASE,
    description: "The month's billing, collections and what needs finance's attention." },

  { section: 'workspace', label: 'Team Dashboard', icon: Eye, href: '/finance/team-dashboard', addedOn: BASE,
    description: "Each lawyer's deliverables, tasks and deadlines, as they see them." },
  { section: 'workspace', label: 'My Tasks', icon: CheckSquare, href: '/finance/my-tasks', addedOn: BASE,
    description: 'Tasks assigned to you.' },
  // Opened from the header's Chat button, which carries the unread count.
  { section: 'workspace', sidebar: false, label: 'Chat', icon: MessageSquare, href: '/chat', matchPrefix: true, addedOn: BASE,
    description: 'Message colleagues, one to one or in matter channels.', keywords: ['message', 'dm'] },
  settingsEntry('workspace', '/dashboard/settings'),

  { section: 'billing', label: 'Review & Generate', icon: ClipboardCheck, href: '/finance/dtr-review', matchPrefix: true, addedOn: BASE,
    description: "Review each client's billable time for the month, then generate the invoices.",
    keywords: ['dtr', 'bundle', 'invoice', 'billing run'] },
  { section: 'billing', label: 'Invoices', icon: Receipt, href: '/finance/invoices', matchPrefix: true, addedOn: BASE,
    description: 'Every invoice: send, record payments, regenerate.', keywords: ['bill', 'payment'] },
  { section: 'billing', label: 'Receivables', icon: TrendingDown, href: '/finance/receivables', addedOn: BASE,
    description: 'What clients owe, by age.', keywords: ['aging', 'collections', 'overdue'] },
  { section: 'billing', label: 'Ledger', icon: BookOpen, href: '/finance/ledger', addedOn: BASE,
    description: "Every billing, payment and deposit, by client and month.", keywords: ['statement', 'deposit'] },

  { section: 'analysis', label: 'Insights', icon: Droplets, href: '/finance/insights', addedOn: BASE,
    description: 'What the billing data says. Tabs: Leakage, Cash flow, Profitability.',
    keywords: ['write-off', 'realization', 'leakage', 'billing insights'] },
  { section: 'analysis', sidebar: false, label: 'Cash Flow', icon: Activity, href: '/finance/insights?tab=cash-flow', addedOn: BASE,
    description: 'Money in and out, month by month: the Insights tab.' },
  { section: 'analysis', sidebar: false, label: 'Profitability', icon: TrendingUp, href: '/finance/insights?tab=profitability', addedOn: BASE,
    description: 'What each client and matter earns against what it costs: the Insights tab.' },

  { section: 'expenses', label: 'Matter Expenses', icon: CreditCard, href: '/finance/expenses', addedOn: BASE,
    description: 'Expenses charged to matters.' },
  { section: 'expenses', label: 'Operating Expenses', icon: Building2, href: '/finance/operating-expenses', addedOn: BASE,
    description: "The firm's own running costs." },
  { section: 'expenses', label: 'Reimbursements', icon: Wallet, href: '/finance/reimbursements', addedOn: BASE,
    description: 'Staff reimbursement claims.' },
  { section: 'expenses', label: 'Liaison Errand Costs', icon: Bike, href: '/finance/liaison-errand-costs', addedOn: BASE,
    description: 'What the liaison officers spent on errands.', keywords: ['transportation', 'errand'] },

  // One sidebar link for the finance setup pages; they stay in More and search.
  { section: 'configuration', label: 'Finance settings', icon: Cog, href: '/finance/settings', addedOn: '2026-11-21',
    description: 'How the firm bills and books: rates, billing configs, wording, costs, invoice details.',
    keywords: ['settings', 'configuration', 'setup'] },
  { section: 'configuration', sidebar: false, label: 'Billing Configs', icon: Settings, href: '/finance/billing-configs', addedOn: BASE,
    description: 'How each matter and client is billed.' },
  // Ungated, matching the page: the email templates it manages feed sends that
  // run on Resend, a platform service.
  { section: 'configuration', sidebar: false, label: 'Templates', icon: Mail, href: '/finance/templates', addedOn: BASE,
    description: 'The billing letter and the emails invoices go out with.' },
  { section: 'configuration', sidebar: false, label: 'Rates', icon: DollarSign, href: '/finance/rates', addedOn: BASE,
    description: 'Hourly rates by position.' },
  { section: 'configuration', sidebar: false, label: 'Transportation Tariff', icon: MapPin, href: '/finance/transportation-tariff', addedOn: BASE,
    description: 'What an errand to each zone costs.' },
  { section: 'configuration', sidebar: false, label: 'Employees', icon: Users, href: '/finance/employees', addedOn: BASE,
    description: 'Monthly salaries, for profitability labour costs.' },
  { section: 'configuration', sidebar: false, label: 'Expense Categories', icon: List, href: '/finance/settings/expense-categories', addedOn: BASE,
    description: 'The categories expenses are filed under.' },
  { section: 'configuration', sidebar: false, label: 'Firm Invoice Details', icon: Landmark, href: '/finance/settings/firm-invoice', addedOn: BASE,
    description: 'The bank details and numbering invoices carry.' },
];
