import {
  BarChart3, Home, Clock, CalendarDays, Mail, Calendar, Scale, CheckSquare, Handshake, Gavel, FolderOpen,
  FolderKanban, Users, Send, Inbox, UserPlus, Users2, MessageSquare, FileCheck, Briefcase, ClipboardCheck,
  Stamp, Building2, Eye, Search, Scroll, Library, PenTool, ScanSearch, Swords, Wallet, FileSignature,
  Landmark, FileText, FileInput, ListChecks, Paperclip, LayoutGrid,
} from 'lucide-react';
import type { UserRole } from '@/lib/queries/team';
import { addDays, manilaToday } from '@/lib/dates';
import { ADMIN_PAGES, ADMIN_SECTIONS } from './admin-pages';
import { FINANCE_PAGES, FINANCE_SECTIONS } from './finance-pages';
import { LIAISON_PAGES, LIAISON_SECTIONS } from './liaison-pages';
import { canOpen } from './access';
import { featuresVisible, type FeatureFlags } from '@/lib/firm/feature-shape';
import { settingsEntry } from './settings-entry';
import type { NavArea, NavPage, NavSection } from './types';

export type { NavArea, NavPage, NavSection } from './types';

/*
 * Every page in each sidebar, in sidebar order: the team dashboard here, the
 * admin, finance and liaison areas beside it. The sidebars, the search bar's Pages
 * group, the More page, the "New" pills and the hover descriptions all read
 * these lists, so a new page is added once.
 */

const PARTNER: readonly UserRole[] = ['partner', 'super_user'];

/**
 * The day every page that came with the sidebar is dated: before any "New"
 * window, so a fresh install points at nothing. A page added later carries
 * the day it shipped.
 */
const BASE = '2026-08-22';
/** More, the All tools page that lists every page a role can open. */
const MORE_PAGE = '2026-11-23';

/*
 * The dashboard sidebar is a neutral default, grouped by purpose: the day
 * itself, the matters and the practice's records, drafting and research, the
 * person's own time and requests, and the partner block after all of it. The
 * links are the pages a lawyer opens most days; the rest are `sidebar: false`
 * and live in More under the same heading, sidebar pages first. More, the
 * search bar and the "New" pills read every page the role can open — and the
 * firm's features allow (`visiblePages`).
 */
const DASHBOARD_SECTIONS: NavSection[] = [
  { id: 'today', label: null, moreLabel: 'Today' },
  { id: 'matters', label: 'Matters', defaultFoldedFor: PARTNER },
  { id: 'practice', label: 'Practice', defaultFoldedFor: PARTNER },
  { id: 'draft', label: 'Draft & research', defaultFoldedFor: PARTNER },
  { id: 'me', label: 'Me' },
  {
    id: 'partner', label: 'Partner', roles: PARTNER, variant: 'partner',
    subsections: [
      { id: 'approvals', label: 'Approvals' },
      { id: 'oversight', label: 'Oversight' },
      { id: 'pipeline', label: 'Pipeline' },
      { id: 'reference', label: 'Reference' },
    ],
  },
];

const DASHBOARD_PAGES: NavPage[] = [
  { section: 'today', label: 'Dashboard', icon: Home, href: '/dashboard', addedOn: BASE,
    description: 'Your day: deliverables, deadlines, tasks, the week ahead and recent files.' },
  { section: 'today', label: 'Calendar', icon: Calendar, href: '/dashboard/calendar', addedOn: BASE,
    description: "Everyone's hearings, meetings, deadlines and leaves on one calendar. Tabs: Hearings, Meetings.",
    keywords: ['schedule', 'agenda', 'firm calendar'] },
  { section: 'today', sidebar: false, label: 'Tasks', icon: CheckSquare, href: '/dashboard/tasks', addedOn: BASE,
    description: 'Every open task.', keywords: ['to do'] },
  { section: 'today', sidebar: false, label: 'Meetings', icon: Handshake, href: '/dashboard/calendar?tab=meetings', addedOn: BASE,
    description: 'Every meeting, as a list: the Calendar tab, from 90 days back on unless you pick other dates.' },
  { section: 'today', sidebar: false, label: 'Hearings', icon: Gavel, href: '/dashboard/calendar?tab=hearings', addedOn: BASE,
    description: 'Every hearing, as a list: the Calendar tab, from 90 days back on unless you pick other dates.',
    keywords: ['court', 'trial'] },
  // Opened from the header's Chat button, which carries the unread count.
  { section: 'today', sidebar: false, label: 'Chat', icon: MessageSquare, href: '/chat', matchPrefix: true, addedOn: BASE,
    description: 'Message colleagues, one to one or in matter channels.',
    keywords: ['message', 'dm'] },
  { section: 'today', sidebar: false, label: 'Liaison Schedule', icon: Eye, href: '/dashboard/liaison-schedule', addedOn: BASE,
    description: 'Where the liaison officers are going and when, so you can send an errand along.',
    keywords: ['errand', 'messenger', 'courier'] },

  { section: 'matters', label: 'My Matters', icon: Briefcase, href: '/dashboard/my-matters', addedOn: BASE,
    description: 'The matters you are on.' },
  { section: 'matters', label: 'My Deliverables', icon: FileText, href: '/dashboard/deliverables', addedOn: BASE,
    description: 'The deliverables you are on, or every one in the firm, with who has it and when it is due. Views: All, Filings, Status reports, Internal, By status.',
    keywords: ['deliverables', 'all deliverables', 'filed copy', 'by status', 'mine'] },
  { section: 'matters', label: 'Matters', icon: Scale, href: '/dashboard/matters', addedOn: BASE,
    description: 'Every matter in the firm.' },
  { section: 'matters', label: 'Clients', icon: Users, href: '/dashboard/clients', addedOn: BASE,
    description: 'Every client.' },
  { section: 'matters', sidebar: false, label: 'Matter Groups', icon: FolderKanban, href: '/dashboard/matter-groups', addedOn: BASE,
    description: 'Connected matters, such as an investigation, its case and the appeal, kept together.' },
  { section: 'matters', sidebar: false, label: 'Filings', icon: FolderOpen, href: '/dashboard/deliverables?view=filings', addedOn: BASE,
    description: 'Every filing on a case: the Deliverables view of external work with a due date.',
    keywords: ['filed', 'court', 'pleading'] },
  { section: 'matters', sidebar: false, label: 'Status Reports', icon: ClipboardCheck, href: '/dashboard/deliverables?view=status-reports', addedOn: BASE,
    description: 'Status reports across all matters: the Deliverables view of reports to clients.' },
  { section: 'matters', sidebar: false, label: 'Internal', icon: Inbox, href: '/dashboard/deliverables?view=internal', addedOn: BASE,
    description: 'Internal deliverables sent to or from you: the Deliverables view of internal work.', keywords: ['memo'] },
  { section: 'matters', sidebar: false, label: 'Files', icon: Paperclip, href: '/dashboard/files', addedOn: BASE,
    description: 'Everything the firm received on its matters.',
    keywords: ['documents', 'attachments', 'received'] },

  { section: 'practice', label: 'Cases', icon: Landmark, href: '/dashboard/cases', addedOn: BASE,
    description: 'Every dispute the firm handles, from study through each forum to the end.',
    keywords: ['litigation', 'proceeding', 'appeal'] },
  { section: 'practice', label: 'Corporations', icon: Building2, href: '/dashboard/corporations', addedOn: BASE,
    description: 'Every company the firm looks after: where each stands, and what falls due next.',
    keywords: ['company', 'gis', 'compliance', 'incorporation'] },
  { section: 'practice', label: 'Trademarks', icon: Stamp, href: '/dashboard/trademarks', addedOn: BASE,
    description: 'Filing pipeline, Office Actions, and the DAU and renewal cadence.',
    keywords: ['ipophl', 'mark', 'dau', 'renewal', 'ip'] },

  { section: 'draft', label: 'Drafting Studio', icon: PenTool, href: '/dashboard/drafting', addedOn: BASE, features: ['drafting'],
    description: "Draft a pleading, letter or contract from the matter's record and the firm's past work, or fill a template.",
    keywords: ['draft', 'generate', 'template', 'ai', 'write'] },
  { section: 'draft', label: 'Library', icon: Library, href: '/dashboard/library', matchPrefix: true, addedOn: BASE,
    description: 'The firm handbook (guides, policies, references, announcements) and the Rules of Court.',
    keywords: ['handbook', 'policy', 'guide', 'wiki', 'knowledge base', 'rules of court'] },
  { section: 'draft', label: 'Search', icon: Search, href: '/dashboard/search', addedOn: BASE, features: ['ai_search'],
    description: 'Find anything the firm has filed, received or written by describing it.',
    keywords: ['semantic', 'knowledge', 'precedent'] },
  { section: 'draft', sidebar: false, label: 'Affidavit Review', icon: ScanSearch, href: '/dashboard/affidavit-review', matchPrefix: true, addedOn: BASE,
    features: ['ai_analysis'],
    description: "Check a judicial affidavit's questions for objectionable form or substance, ours before filing or theirs before trial.",
    keywords: ['judicial affidavit', 'objection', 'evidence'] },
  { section: 'draft', sidebar: false, label: 'Red Team', icon: Swords, href: '/dashboard/red-team', matchPrefix: true, addedOn: BASE, features: ['red_team'],
    description: 'Argue against our own pleading before opposing counsel does, and check every case we cite holds what we say.',
    keywords: ['stress test', 'pleading', 'citation check', 'opposing'] },
  { section: 'draft', sidebar: false, label: 'Documents', icon: FileInput, href: '/dashboard/documents', addedOn: BASE,
    description: "Fill one of the firm's document templates from a matter.",
    keywords: ['template', 'generate', 'docx'] },
  { section: 'draft', label: 'Issuances', icon: Scroll, href: '/dashboard/issuances', addedOn: BASE, features: ['issuances'],
    description: 'New circulars and issuances from courts and agencies that bear on the practice.',
    keywords: ['circular', 'regulation', 'memorandum circular'] },

  { section: 'me', label: 'My DTR', icon: Clock, href: '/dashboard/my-dtr', addedOn: BASE,
    description: 'Log and review your daily time records.',
    keywords: ['time', 'timesheet', 'hours', 'billable'] },
  { section: 'me', label: 'My Requests', icon: Send, href: '/dashboard/my-submissions', addedOn: BASE,
    description: 'File and track your leaves, reimbursements and feedback.',
    keywords: ['leave', 'reimbursement', 'feedback'] },
  { section: 'me', sidebar: false, label: 'More', icon: LayoutGrid, href: '/dashboard/tools', addedOn: MORE_PAGE,
    description: 'Every page you can open, with what each one is for.',
    keywords: ['more', 'pages', 'tools', 'directory'] },
  settingsEntry('me', '/dashboard/settings'),

  { section: 'partner', subsection: 'oversight', label: 'Partner Overview', icon: BarChart3, href: '/dashboard/partner', addedOn: BASE,
    description: 'The firm at a glance for partners: workload, deadlines and billing across every matter.' },
  { section: 'partner', subsection: 'approvals', label: 'Pre-Finalizing', icon: FileCheck, href: '/dashboard/partner/pre-finalizing', addedOn: BASE,
    description: 'Deliverables waiting on a partner before they are finalized.', keywords: ['approve', 'sign-off'] },
  { section: 'partner', subsection: 'approvals', label: 'Billing Review', icon: ClipboardCheck, href: '/dashboard/partner/billing-review', addedOn: BASE,
    description: "Approve each client's monthly billing bundle, or clear it as the client's relationship partner.",
    keywords: ['invoice', 'bundle', 'dtr', 'clearance', 'approve'] },
  { section: 'partner', subsection: 'approvals', label: 'Leave Requests', icon: CalendarDays, href: '/dashboard/partner/leaves', addedOn: BASE,
    description: 'Approve or reject leave applications, with who else is out on the same days.',
    keywords: ['vacation', 'absence', 'time off'] },
  { section: 'partner', subsection: 'approvals', label: 'Feedbacks', icon: Mail, href: '/dashboard/partner/feedbacks', addedOn: BASE,
    description: 'Read and answer the suggestions and bug reports the team sends in.', keywords: ['suggestion', 'bug report'] },
  { section: 'partner', subsection: 'oversight', sidebar: false, label: 'Finance Overview', icon: Wallet, href: '/dashboard/partner/finance-overview', matchPrefix: true, addedOn: BASE,
    description: 'Collection rate against operating expenses, by period and client.',
    keywords: ['cash flow', 'revenue', 'collections', 'expenses'] },
  { section: 'partner', subsection: 'oversight', sidebar: false, label: 'Client Management', icon: Building2, href: '/dashboard/partner/clients', matchPrefix: true, addedOn: BASE,
    description: 'Client profitability, matters and priority.', keywords: ['profitability', 'relationship partner'] },
  { section: 'partner', subsection: 'oversight', sidebar: false, label: 'Matter Management', icon: FolderKanban, href: '/dashboard/partner/matters', matchPrefix: true, addedOn: BASE,
    description: 'Every matter with its team and state, and matters ready to close.', keywords: ['close matter', 'archive'] },
  { section: 'partner', subsection: 'oversight', sidebar: false, label: 'Lawyers', icon: Users2, href: '/dashboard/partner/lawyers', matchPrefix: true, addedOn: BASE,
    description: "Each lawyer's workload, hours and open work.", keywords: ['workload', 'utilization', 'associates'] },
  { section: 'partner', subsection: 'oversight', sidebar: false, label: 'Reports', icon: BarChart3, href: '/dashboard/partner/reports', matchPrefix: true, addedOn: BASE,
    description: 'Build custom reports across matters, deliverables, DTR and invoices.', keywords: ['export', 'analytics'] },
  { section: 'partner', subsection: 'pipeline', sidebar: false, label: 'Prospects', icon: UserPlus, href: '/dashboard/prospects', matchPrefix: true, addedOn: BASE,
    except: ['/dashboard/prospects/proposals', '/dashboard/prospects/scope-library'],
    description: 'The client intake pipeline.', keywords: ['intake', 'lead'] },
  { section: 'partner', subsection: 'pipeline', sidebar: false, label: 'Engagement Proposals', icon: FileSignature, href: '/dashboard/prospects/proposals', matchPrefix: true, addedOn: BASE,
    description: 'Engagement proposals drafted and sent from the intake pipeline.', keywords: ['engagement', 'proposal', 'fees'] },
  { section: 'partner', subsection: 'pipeline', sidebar: false, label: 'Scope Library', icon: ListChecks, href: '/dashboard/prospects/scope-library', matchPrefix: true, addedOn: BASE,
    description: 'Reusable scope-of-work lines for engagement proposals.', keywords: ['scope of work', 'proposal'] },
  { section: 'partner', subsection: 'reference', sidebar: false, label: 'Court Rules', icon: Gavel, href: '/dashboard/partner/rules', addedOn: BASE,
    description: 'Deadline rule sets for court proceedings, and the periods the Rules of Court state.',
    keywords: ['deadline', 'reglementary period'] },
];

export const NAV_AREAS: Record<NavArea, { sections: NavSection[]; pages: NavPage[] }> = {
  dashboard: { sections: DASHBOARD_SECTIONS, pages: DASHBOARD_PAGES },
  admin: { sections: ADMIN_SECTIONS, pages: ADMIN_PAGES },
  finance: { sections: FINANCE_SECTIONS, pages: FINANCE_PAGES },
  liaison: { sections: LIAISON_SECTIONS, pages: LIAISON_PAGES },
};

/** Every page in every area (Chat appears in all four). */
export const ALL_PAGES: NavPage[] = [...DASHBOARD_PAGES, ...ADMIN_PAGES, ...FINANCE_PAGES, ...LIAISON_PAGES];

/** The sidebar a path is shown under. */
export function areaForPath(pathname: string): NavArea {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname === '/finance' || pathname.startsWith('/finance/')) return 'finance';
  if (pathname === '/liaison' || pathname.startsWith('/liaison/')) return 'liaison';
  return 'dashboard';
}

export function canSeeSection(area: NavArea, id: string, role: UserRole): boolean {
  const roles = NAV_AREAS[area].sections.find((s) => s.id === id)?.roles;
  return !roles || roles.includes(role);
}

/**
 * The pages a role can open in an area, in sidebar order, which More and the
 * search bar list: never one the route map (lib/nav/access.ts) refuses it.
 */
export function pagesForRole(role: UserRole, area: NavArea = 'dashboard'): NavPage[] {
  return NAV_AREAS[area].pages.filter((p) =>
    canSeeSection(area, p.section, role) && (!p.roles || p.roles.includes(role)) && canOpen(role, p.href));
}

/**
 * The pages a role can open in an area that the firm's features allow.
 * Everything a person is shown — sidebar, More, search, "New for you" —
 * reads this, so a firm without a feature never sees a link to it.
 */
export function visiblePages(role: UserRole, area: NavArea, flags: FeatureFlags): NavPage[] {
  return pagesForRole(role, area).filter((p) => featuresVisible(flags, p.features));
}

/** The links an area's sidebar draws for a role: its pages less those kept to search and More. */
export function sidebarPagesForRole(role: UserRole, area: NavArea, flags: FeatureFlags): NavPage[] {
  const moreOnly = new Set(NAV_AREAS[area].sections.filter((s) => s.more).map((s) => s.id));
  return visiblePages(role, area, flags).filter((p) => p.sidebar !== false && !moreOnly.has(p.section));
}

/** Where the team dashboard's More page lives; its sidebar link closes the list. */
export const MORE_HREF = '/dashboard/tools';

/** Counts another control carries: Chat's unread sits on the header's Chat button. */
const HEADER_COUNTS: ReadonlySet<string> = new Set(['/chat']);

/**
 * The pages whose counts the More link adds up for a role: those it can open
 * with no sidebar link of their own, so a count never hides. `linked` is
 * what the sidebar actually draws, when the person has changed it.
 */
export function moreCountHrefs(
  role: UserRole,
  area: NavArea,
  flags: FeatureFlags,
  linked: Iterable<string> = sidebarPagesForRole(role, area, flags).map((p) => p.href),
): string[] {
  const inSidebar = new Set(linked);
  return visiblePages(role, area, flags).map((p) => p.href).filter((h) => !inSidebar.has(h) && !HEADER_COUNTS.has(h));
}

/** Whether a section starts folded for a role before the person has folded or opened it. */
export function foldedByDefault(area: NavArea, sectionId: string, role: UserRole): boolean {
  return !!NAV_AREAS[area].sections.find((s) => s.id === sectionId)?.defaultFoldedFor?.includes(role);
}

export function isPageActive(page: NavPage, pathname: string): boolean {
  if (page.except?.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false;
  return pathname === page.href || (!!page.matchPrefix && pathname.startsWith(`${page.href}/`));
}

/**
 * Pages matching a search, best first: every word must appear in the label,
 * description or keywords, and label matches rank above the rest.
 */
export function searchPages(pages: NavPage[], query: string): NavPage[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return pages;
  const scored: { page: NavPage; score: number }[] = [];
  for (const page of pages) {
    const label = page.label.toLowerCase();
    const hay = [label, page.description, ...(page.keywords ?? [])].join(' ').toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const score = label.startsWith(words[0]) ? 0 : words.every((w) => label.includes(w)) ? 1 : 2;
    scored.push({ page, score });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.page);
}

/** The page a path belongs to, for recording a visit. */
export function pageForPath(pathname: string): NavPage | null {
  let best: NavPage | null = null;
  for (const p of ALL_PAGES) {
    const root = p.href === '/dashboard' || p.href === '/admin' || p.href === '/finance' || p.href === '/liaison';
    const hit = pathname === p.href || (!root && pathname.startsWith(`${p.href}/`));
    if (hit && (!best || p.href.length > best.href.length)) best = p;
  }
  return best;
}

/** How long a page counts as new, for anyone who hasn't opened it. */
export const NEW_PAGE_DAYS = 45;

export function isRecentlyAdded(page: NavPage, today: string = manilaToday()): boolean {
  return page.addedOn >= addDays(today, -NEW_PAGE_DAYS);
}
