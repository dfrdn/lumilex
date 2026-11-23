import useSWR, { type SWRResponse } from 'swr';

// ── Types ───────────────────────────────────────────────────────────

export interface Member {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
}

interface ClientMatterData {
  clients: { notion_id: string; name: string }[];
  matters: {
    notion_id: string;
    name: string;
    matter_code: string;
    client_id: string;
    client_name: string;
    team_person_ids: string[];
  }[];
}

interface AdminEntityResponse {
  data: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── Hooks ───────────────────────────────────────────────────────────

/**
 * Fetch active team members — cached across components.
 * Used for name resolution in deliverables, actions, etc.
 */
export function useMembers(): SWRResponse<Member[]> {
  return useSWR<Member[]>('/api/members');
}

/**
 * Fetch clients and matters for dropdowns — cached.
 */
export function useClientMatters(): SWRResponse<ClientMatterData> {
  return useSWR<ClientMatterData>('/api/clients-matters');
}

/**
 * Build a URL key for admin entity queries (enables SWR caching + deduplication).
 */
export function buildAdminEntityKey(
  entity: string,
  params: {
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortDir?: string;
    search?: string;
    filters?: Record<string, string>;
  },
): string {
  const sp = new URLSearchParams();
  if (params.page) sp.set('page', String(params.page));
  if (params.pageSize) sp.set('pageSize', String(params.pageSize));
  if (params.sortBy) sp.set('sortBy', params.sortBy);
  if (params.sortDir) sp.set('sortDir', params.sortDir);
  if (params.search) sp.set('search', params.search);
  if (params.filters) {
    for (const [key, value] of Object.entries(params.filters)) {
      if (value) sp.set(`filter.${key}`, value);
    }
  }
  return `/api/admin/${entity}?${sp.toString()}`;
}

/**
 * Fetch admin entity data with pagination, sorting, and filtering.
 * The key changes when params change, triggering a new fetch.
 */
export function useAdminEntity(
  entity: string,
  params: {
    page: number;
    pageSize: number;
    sortBy: string;
    sortDir: string;
    search: string;
    filters: Record<string, string>;
  },
): SWRResponse<AdminEntityResponse> {
  const key = buildAdminEntityKey(entity, params);
  return useSWR<AdminEntityResponse>(key, {
    keepPreviousData: true, // don't flash empty while paginating
  });
}
