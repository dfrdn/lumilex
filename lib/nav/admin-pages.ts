import {
  Home, FileText, Scale, CheckSquare, Handshake, Gavel, FolderOpen, Users, Paperclip, Shield, FileCheck,
  PenTool, Plug, ScrollText, FileInput, UserPlus, CalendarDays, Calendar, BookOpen, MessageSquare,
  ClipboardList, Eye, Bike, Stamp, List, Scroll, BookText, BarChart3, Siren, Receipt, Cog,
} from 'lucide-react';
import type { UserRole } from '@/lib/queries/team';
import { settingsEntry } from './settings-entry';
import type { NavPage, NavSection } from './types';

const ADMIN_ONLY: readonly UserRole[] = ['admin', 'super_user'];
/** Every page that came with the admin sidebar: before any "New" window. */
const BASE = '2026-08-22';

export const ADMIN_SECTIONS: NavSection[] = [
  { id: 'main', label: null },
  { id: 'workflows', label: 'Workflows' },
  { id: 'databases', label: 'Databases' },
  { id: 'settings', label: 'Settings' },
  { id: 'system', label: 'System' },
];

export const ADMIN_PAGES: NavPage[] = [
  { section: 'main', label: 'Overview', icon: Home, href: '/admin', addedOn: BASE,
    description: 'The work queues, filings coming due, and the size of every database.' },
  { section: 'main', label: 'Team Dashboard', icon: Eye, href: '/admin/team-dashboard', matchPrefix: true, addedOn: BASE,
    description: "Each lawyer's deliverables, tasks and deadlines, as they see them." },
  { section: 'main', label: 'My Tasks', icon: CheckSquare, href: '/admin/my-tasks', matchPrefix: true, addedOn: BASE,
    description: 'Tasks assigned to you.' },
  { section: 'main', label: 'Calendar', icon: Calendar, href: '/admin/calendar', addedOn: BASE,
    description: "Everyone's hearings, meetings, deadlines and leaves on one calendar.",
    keywords: ['schedule', 'agenda'] },
  // Opened from the header's Chat button, which carries the unread count.
  { section: 'main', sidebar: false, label: 'Chat', icon: MessageSquare, href: '/chat', matchPrefix: true, addedOn: BASE,
    description: 'Message colleagues, one to one or in matter channels.', keywords: ['message', 'dm'] },

  { section: 'workflows', label: 'Prospects', icon: UserPlus, href: '/admin/prospects', matchPrefix: true, addedOn: BASE,
    description: 'The client intake pipeline.', keywords: ['intake', 'lead'] },
  { section: 'workflows', label: 'Parties', icon: Shield, href: '/admin/parties', addedOn: BASE,
    description: 'Parties across matters, for conflict checks.', keywords: ['conflict', 'adverse party'] },
  { section: 'workflows', label: 'Liaison Command', icon: Bike, href: '/admin/liaison-command', matchPrefix: true, addedOn: BASE,
    description: "The liaison officers' errands: assign, schedule and track them.",
    keywords: ['errand', 'messenger', 'courier'] },
  { section: 'workflows', label: 'Finalize', icon: FileCheck, href: '/admin/finalize', matchPrefix: true, addedOn: BASE,
    description: 'Deliverables ready to finalize: produce the clean copy and file or send it.',
    keywords: ['clean copy', 'file', 'send out'] },
  { section: 'workflows', label: 'Signatures', icon: PenTool, href: '/admin/signatures', matchPrefix: true, addedOn: BASE,
    description: 'The signature images the firm stamps on its documents.',
    keywords: ['signature'] },

  { section: 'databases', label: 'Clients', icon: Users, href: '/admin/clients', matchPrefix: true, addedOn: BASE,
    description: 'Edit client records.' },
  { section: 'databases', label: 'Matters', icon: Scale, href: '/admin/matters', matchPrefix: true, addedOn: BASE,
    description: 'Edit matter records.' },
  { section: 'databases', label: 'Deliverables', icon: FileText, href: '/admin/deliverables', matchPrefix: true, addedOn: BASE,
    description: 'Edit deliverable records.' },
  { section: 'databases', label: 'Status Reports', icon: ClipboardList, href: '/admin/status_reports', matchPrefix: true, addedOn: BASE,
    description: 'Edit status report records.' },
  { section: 'databases', label: 'Tasks', icon: CheckSquare, href: '/admin/tasks', matchPrefix: true, addedOn: BASE,
    description: 'Edit task records.' },
  { section: 'databases', label: 'Meetings', icon: Handshake, href: '/admin/meetings', matchPrefix: true, addedOn: BASE,
    description: 'Edit meeting records.' },
  { section: 'databases', label: 'Hearings', icon: Gavel, href: '/admin/hearings', matchPrefix: true, addedOn: BASE,
    description: 'Edit hearing records.' },
  { section: 'databases', label: 'Filings', icon: FolderOpen, href: '/admin/filings', matchPrefix: true, addedOn: BASE,
    description: 'Edit filing records.' },
  { section: 'databases', label: 'Files', icon: Paperclip, href: '/admin/files', matchPrefix: true, addedOn: BASE,
    description: 'Edit file records.' },
  { section: 'databases', label: 'Trademarks', icon: Stamp, href: '/admin/trademarks', matchPrefix: true, addedOn: BASE,
    description: 'Edit trademark records.' },
  { section: 'databases', label: 'Errands', icon: Bike, href: '/admin/liaison_tasks', matchPrefix: true, addedOn: BASE,
    description: 'Edit liaison errand records.' },
  { section: 'databases', label: 'PH Holidays', icon: CalendarDays, href: '/admin/ph_holidays', matchPrefix: true, addedOn: BASE,
    description: 'The holidays deadlines skip over.', keywords: ['holiday', 'non-working day'] },

  // One sidebar link for everything that sets up the firm; the pages stay in More and search.
  { section: 'settings', label: 'Firm settings', icon: Cog, href: '/admin/settings', addedOn: '2026-11-21',
    description: 'Everything that sets up the firm, by what it is for: lists, wording, rules, identity, accounts.',
    keywords: ['settings', 'configuration', 'setup', 'system'] },
  { section: 'settings', label: 'Reports', icon: BarChart3, href: '/admin/reports', addedOn: BASE,
    description: 'Build custom reports across matters, deliverables, DTR and invoices.', keywords: ['export', 'analytics'] },
  { section: 'settings', sidebar: false, label: 'SLA Rules', icon: Siren, href: '/admin/sla-rules', addedOn: BASE, roles: ADMIN_ONLY,
    description: 'The rules that flag deliverables idle or late, and who hears about it.' },
  // Gated on exactly what the page itself redirects on.
  { section: 'settings', sidebar: false, label: 'Integrations', icon: Plug, href: '/admin/integrations', addedOn: BASE,
    roles: ADMIN_ONLY, features: ['sharepoint'],
    description: "The firm's SharePoint connection." },
  { section: 'settings', sidebar: false, label: 'Templates', icon: FileInput, href: '/admin/templates', addedOn: BASE,
    description: 'The document templates the firm fills from its matters.' },
  { section: 'settings', sidebar: false, label: 'Firm Profile', icon: BookText, href: '/admin/firm-profile', addedOn: BASE,
    roles: ['admin', 'super_user', 'finance'],
    description: "The firm's profile as proposals and letters print it." },
  { section: 'settings', sidebar: false, label: 'Fee Schedules', icon: Receipt, href: '/admin/fee-schedule', addedOn: BASE,
    roles: ['admin', 'super_user', 'finance'],
    description: "The firm's published rates, quoted in engagement proposals.", keywords: ['rates', 'annex'] },
  { section: 'settings', sidebar: false, label: 'Dropdown Options', icon: List, href: '/admin/settings/enums', addedOn: BASE,
    description: 'The choices offered in the firm’s dropdowns.' },
  { section: 'settings', sidebar: false, label: 'Audit Log', icon: ScrollText, href: '/admin/audit-log', addedOn: BASE,
    description: 'Who changed what, and when.', keywords: ['history', 'changes'] },

  settingsEntry('settings', '/dashboard/settings'),

  { section: 'system', sidebar: false, label: 'User Management', icon: Shield, href: '/admin/users', addedOn: BASE,
    description: 'Staff accounts, roles and access.', keywords: ['account', 'role', 'password'] },
  { section: 'system', sidebar: false, label: 'Portal Users', icon: Users, href: '/admin/portal-users', addedOn: BASE, features: ['portal'],
    description: "Clients' portal accounts." },
];
