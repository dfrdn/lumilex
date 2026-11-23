export type SearchEntityType =
  | 'matters'
  | 'deliverables'
  | 'tasks'
  | 'meetings'
  | 'hearings'
  | 'filings'
  | 'clients'
  | 'files';

export interface SearchResult {
  id: string;
  name: string;
  entityType: SearchEntityType;
  href: string;
  subtitle: string;
  semantic?: boolean;
  relevanceScore?: number;
  snippet?: string;
}

export interface SearchResponse {
  results: Record<string, SearchResult[]>;
  query: string;
}
