import { Bike, BarChart3, Calendar, Clock, Eye, Send, MessageSquare } from 'lucide-react';
import { settingsEntry } from './settings-entry';
import type { NavPage, NavSection } from './types';

/** Every page that came with the liaison sidebar: before any "New" window. */
const BASE = '2026-08-22';
/** The liaison shell's own Schedule and Settings, which liaisons used to open on the dashboard. */
const SHELL_PAGES = '2026-11-23';

export const LIAISON_SECTIONS: NavSection[] = [
  { id: 'errands', label: null },
  { id: 'workspace', label: 'Workspace' },
];

export const LIAISON_PAGES: NavPage[] = [
  { section: 'errands', label: 'Command Center', icon: BarChart3, href: '/liaison', addedOn: BASE,
    description: 'Assign errands to the liaison officers and see where each one stands.',
    keywords: ['errand', 'assign', 'dispatch'] },
  { section: 'errands', label: 'My Errands', icon: Bike, href: '/liaison/my-errands', addedOn: BASE,
    description: 'The errands assigned to you, and what is left to do on each.',
    keywords: ['errand', 'messenger', 'courier'] },
  { section: 'errands', label: 'Liaison Schedule', icon: Eye, href: '/liaison/schedule', addedOn: SHELL_PAGES,
    description: 'Where each liaison officer is going and when, across the team.',
    keywords: ['errand', 'schedule', 'logistics'] },

  { section: 'workspace', label: 'Firm Calendar', icon: Calendar, href: '/liaison/calendar', addedOn: BASE,
    description: "Everyone's hearings, meetings, deadlines and leaves on one calendar.",
    keywords: ['schedule', 'agenda'] },
  { section: 'workspace', label: 'My DTR', icon: Clock, href: '/liaison/my-dtr', addedOn: BASE,
    description: 'Log and review your daily time records.',
    keywords: ['time', 'timesheet', 'hours'] },
  { section: 'workspace', label: 'My Requests', icon: Send, href: '/liaison/my-requests', addedOn: BASE,
    description: 'File and track your leaves, reimbursements and feedback.',
    keywords: ['leave', 'reimbursement', 'feedback'] },
  // Opened from the header's Chat button, which carries the unread count.
  { section: 'workspace', sidebar: false, label: 'Chat', icon: MessageSquare, href: '/chat', matchPrefix: true, addedOn: BASE,
    description: 'Message colleagues, one to one or in matter channels.',
    keywords: ['message', 'dm'] },
  // The liaison sidebar keeps Settings: its people work from a phone.
  { ...settingsEntry('workspace', '/liaison/settings', true), addedOn: SHELL_PAGES },
];
