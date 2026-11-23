/*
 * Pages that were folded into another, each kept working by a permanent
 * redirect: next.config.ts serves this list as its redirects, so old links in
 * chat, email, notifications and bookmarks still land. Next passes the query
 * string through.
 *
 * The syntax is Next's: `:name` is one segment. lib/nav/retired-routes.test.ts
 * checks every entry against the pages that exist and the route map, so a
 * retired page can't come back by accident and a destination is never one a
 * role that could open the old page is refused.
 *
 * Kept free of imports: next.config.ts loads it before the app's aliases.
 */
export interface RetiredRoute {
  source: string;
  destination: string;
}

export const RETIRED_ROUTES: readonly RetiredRoute[] = [
  // The Search / Library reorganization.
  { source: '/dashboard/knowledge', destination: '/dashboard/search' },
  { source: '/dashboard/knowledge/library', destination: '/dashboard/library?status=review' },
  { source: '/dashboard/knowledge/library/:id', destination: '/dashboard/library/:id' },
  { source: '/dashboard/resources', destination: '/dashboard/library' },
  { source: '/admin/resources', destination: '/dashboard/library' },
  { source: '/liaison/resources', destination: '/liaison' },

  // One home per page: the admin copies of dashboard pages render in the
  // dashboard shell, which admin and finance open too.
  { source: '/admin/library', destination: '/dashboard/library' },
  { source: '/admin/issuances', destination: '/dashboard/issuances' },
  { source: '/admin/portal-previews', destination: '/dashboard/clients/portal-previews' },
  { source: '/admin/chat', destination: '/chat' },
  { source: '/admin/chat/:channelId', destination: '/chat/:channelId' },
  { source: '/finance/generate', destination: '/finance/dtr-review' },
  { source: '/finance/client-billing', destination: '/finance/billing-configs?view=client' },

  // One Deliverables list: the old lists are its saved filters
  // (lib/deliverables/views.ts), and a filing is a deliverable, with its id.
  { source: '/dashboard/filings', destination: '/dashboard/deliverables?view=filings' },
  // global_search (v1, kept for the search eval) still builds /dashboard/filings/<id>.
  { source: '/dashboard/filings/:id', destination: '/dashboard/deliverables/:id' },
  { source: '/dashboard/status-reports', destination: '/dashboard/deliverables?view=status-reports' },
  { source: '/dashboard/internal', destination: '/dashboard/deliverables?view=internal' },
  { source: '/dashboard/deliverables/by-status', destination: '/dashboard/deliverables?view=by-status' },

  // Calendar's tabs: the Hearings and Meetings lists. A hearing or
  // meeting still opens at /dashboard/hearings/:id or /dashboard/meetings/:id.
  { source: '/dashboard/hearings', destination: '/dashboard/calendar?tab=hearings' },
  { source: '/dashboard/meetings', destination: '/dashboard/calendar?tab=meetings' },

  // Finance Insights' tabs (lib/finance/insights-tabs.ts).
  { source: '/finance/cash-flow', destination: '/finance/insights?tab=cash-flow' },
  { source: '/finance/profitability', destination: '/finance/insights?tab=profitability' },
];
