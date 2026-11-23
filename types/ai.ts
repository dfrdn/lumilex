export interface AnalysisEntities {
  parties: { name: string; role: string }[];
  dates: { date: string; description: string }[];
  deadlines: { date: string; description: string }[];
  obligations: { party: string; description: string }[];
  caseReferences: string[];
  documentType: string;
  jurisdiction: string;
  /** Citations verified against juris.ph after analysis (see lib/juris.ts). */
  resolvedCitations?: import('@/lib/juris').ResolvedCitation[];
}

export interface FileAnalysis {
  id: number;
  fileId: string;
  attachmentName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  summary: string | null;
  entities: AnalysisEntities | null;
  modelUsed: string | null;
  shortSummary: string | null;
  extractedText: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}
