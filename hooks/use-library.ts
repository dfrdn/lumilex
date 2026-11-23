import useSWR from 'swr';
import type { LibraryPageSummary } from '@/lib/library/model';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** The Library index, already narrowed by RLS and by what the caller may act on. */
export function useLibraryPages() {
  return useSWR<{ pages: LibraryPageSummary[] }>('/api/library/pages', fetcher);
}
