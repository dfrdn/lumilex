import { FileText, Settings } from 'lucide-react';
import type { UserRole } from '@/lib/queries/team';
import { featuresVisible, type FeatureFlags } from '@/lib/firm/feature-shape';
import { canOpen } from './access';
import { ALL_PAGES } from './pages';
import type { NavPage } from './types';

/*
 * The settings hubs: Firm settings (/admin/settings) and Finance settings
 * (/finance/settings). Each lists the pages that set up the firm, by what
 * they are for, and links to them where they live. A page the role may not
 * open (the route map decides), one its registry entry keeps from the role,
 * and one behind a feature the firm lacks are left out, and so is a section
 * left empty. The pages themselves are More-only in their registry, so the
 * hub, More and the search bar are how people reach them.
 *
 * Configuration that belongs to the instance rather than the firm's staff —
 * branding, features, credentials, domains — is edited on /platform, not here.
 */

export type HubId = 'firm' | 'finance';

export interface HubEntry {
  href: string;
  /** Defaults to the registry page's label and description for `href`. */
  label?: string;
  description?: string;
  icon?: NavPage['icon'];
}

export interface HubSection {
  id: string;
  label: string;
  description: string;
  entries: HubEntry[];
}

export interface ResolvedEntry {
  href: string;
  label: string;
  description: string;
  icon: NavPage['icon'];
}

export interface ResolvedSection {
  id: string;
  label: string;
  description: string;
  entries: ResolvedEntry[];
}

export const HUB_HREFS: Record<HubId, string> = {
  firm: '/admin/settings',
  finance: '/finance/settings',
};

const BILLING_LETTER: HubEntry = {
  href: '/finance/billing-letter', label: 'Billing letter', icon: FileText,
  description: 'The cover letter every invoice goes out with.',
};

export const HUBS: Record<HubId, HubSection[]> = {
  firm: [
    {
      id: 'lists', label: 'Lists', description: 'The closed lists every form and grid offers.',
      entries: [{ href: '/admin/settings/enums' }, { href: '/finance/settings/expense-categories' }],
    },
    {
      id: 'wording', label: 'Wording', description: 'Standard text the firm writes once and sends many times.',
      entries: [
        BILLING_LETTER,
        { href: '/finance/templates' },
        {
          href: '/dashboard/trademarks/report-wording', label: 'Trademark report wording', icon: FileText,
          description: 'What the trademark status report tells a client about each mark.',
        },
        { href: '/admin/templates' },
      ],
    },
    {
      id: 'rules', label: 'Rules', description: 'What the app counts and flags on its own.',
      entries: [{ href: '/admin/sla-rules' }, { href: '/admin/ph_holidays' }],
    },
    {
      id: 'identity', label: 'Firm identity', description: 'How the firm presents itself on what it sends out.',
      entries: [
        { href: '/admin/firm-profile' },
        { href: '/admin/fee-schedule' },
        { href: '/finance/settings/firm-invoice' },
        { href: '/admin/signatures' },
      ],
    },
    {
      id: 'accounts', label: 'Accounts', description: 'Who can sign in, as staff or as a client.',
      entries: [{ href: '/admin/users' }, { href: '/admin/portal-users' }],
    },
    {
      id: 'integrations', label: 'Integrations', description: 'The outside services the app works with.',
      entries: [{ href: '/admin/integrations' }],
    },
    {
      id: 'audit', label: 'Audit log', description: 'What changed, and who changed it.',
      entries: [{ href: '/admin/audit-log' }],
    },
  ],
  finance: [
    {
      id: 'billing', label: 'Billing', description: 'What the firm charges, and on what terms.',
      entries: [{ href: '/finance/billing-configs' }, { href: '/finance/rates' }, { href: '/finance/transportation-tariff' }],
    },
    {
      id: 'wording', label: 'Wording', description: 'What the billing letter and finance emails say.',
      entries: [BILLING_LETTER, { href: '/finance/templates' }],
    },
    {
      id: 'costs', label: 'Costs', description: 'What expenses are filed under, and what staff cost.',
      entries: [{ href: '/finance/settings/expense-categories' }, { href: '/finance/employees' }],
    },
    {
      id: 'identity', label: 'Firm identity', description: 'The firm as its invoices print it.',
      entries: [{ href: '/finance/settings/firm-invoice' }],
    },
  ],
};

/** The registry page an entry links to, by its href. */
function registryPage(href: string): NavPage | undefined {
  return ALL_PAGES.find((p) => p.href === href);
}

/** Whether a role at this firm is shown an entry: the route map, and the registry's own role and feature gates. */
function shows(entry: HubEntry, role: UserRole, flags: FeatureFlags): boolean {
  if (!canOpen(role, entry.href)) return false;
  const page = registryPage(entry.href);
  if (!page) return true;
  if (page.roles && !page.roles.includes(role)) return false;
  return featuresVisible(flags, page.features);
}

function resolve(entry: HubEntry): ResolvedEntry {
  const page = registryPage(entry.href);
  return {
    href: entry.href,
    label: entry.label ?? page?.label ?? entry.href,
    description: entry.description ?? page?.description ?? '',
    icon: entry.icon ?? page?.icon ?? Settings,
  };
}

/** A hub's sections as a role sees them: only what it may open, and no empty section; nothing when it may not open the hub. */
export function hubFor(hub: HubId, role: UserRole, flags: FeatureFlags): ResolvedSection[] {
  if (!canOpen(role, HUB_HREFS[hub])) return [];
  return HUBS[hub]
    .map((section) => ({
      id: section.id,
      label: section.label,
      description: section.description,
      entries: section.entries.filter((e) => shows(e, role, flags)).map(resolve),
    }))
    .filter((s) => s.entries.length > 0);
}

/** Every page a hub links to, without its query. */
export function hubHrefs(hub: HubId): string[] {
  return [...new Set(HUBS[hub].flatMap((s) => s.entries.map((e) => e.href.split('?')[0])))];
}
