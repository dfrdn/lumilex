import useSWR from 'swr';
import type { SourceKey } from '@/lib/issuances/sources';

export interface Issuance {
  id: number;
  source: SourceKey;
  type: string;
  number: string | null;
  title: string;
  subject: string | null;
  date_issued: string | null;
  date_effective: string | null;
  summary: string | null;
  full_text: string | null;
  source_url: string;
  pdf_path: string | null;
  metadata: Record<string, unknown>;
  practice_areas: string[];
  tags: string[];
  status: 'published' | 'archived' | 'rejected';
  pinned: boolean;
  ai_confidence: 'high' | 'medium' | 'low' | null;
  ai_flags: string[];
  added_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  visible_to_roles: string[] | null;
  created_at: string;
  updated_at: string;
}

export type IssuanceSummary = Omit<Issuance, 'full_text' | 'metadata' | 'visible_to_roles'>;

export interface ScrapeRun {
  id: number;
  source: SourceKey;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'partial' | 'failed' | null;
  items_found: number;
  items_new: number;
  items_low_conf: number;
  errors: number;
  error_log: string | null;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

export interface IssuanceFilters {
  source?: string;
  type?: string;
  practiceArea?: string;
  status?: string;
  search?: string;
  confidence?: string;
  limit?: number;
}

function buildQuery(filters?: IssuanceFilters): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  if (filters.source) params.set('source', filters.source);
  if (filters.type) params.set('type', filters.type);
  if (filters.practiceArea) params.set('practice_area', filters.practiceArea);
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  if (filters.confidence) params.set('confidence', filters.confidence);
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useIssuances(filters?: IssuanceFilters) {
  const qs = buildQuery(filters);
  return useSWR<IssuanceSummary[]>(`/api/issuances${qs}`, fetcher);
}

export function useIssuance(id: number | null) {
  return useSWR<Issuance>(id ? `/api/issuances?id=${id}` : null, fetcher);
}

export function useScrapeRuns(limit = 50) {
  return useSWR<ScrapeRun[]>(`/api/issuances/runs?limit=${limit}`, fetcher);
}
