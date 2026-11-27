import type { ProvisionChange, ProvisionStatus } from '@/lib/codes/model';

/**
 * The file a parse writes and the import reads: data/codes/<code>.json. One
 * code, every provision in reading order, each with its history oldest
 * first. Committed, so a re-import is reproducible without the source PDFs.
 */
export interface CodeFile {
  code: string;
  /** Where the text was taken from, for the record: "signed copy, transcribed and checked against lawphil.net". */
  provenance: string;
  provisions: CodeFileProvision[];
}

export interface CodeFileProvision {
  number: string;
  formerNumber: string | null;
  heading: string | null;
  text: string;
  path: string[];
  status: ProvisionStatus;
  versions: CodeFileVersion[];
}

export interface CodeFileVersion {
  seq: number;
  change: ProvisionChange;
  number: string | null;
  heading: string | null;
  text: string | null;
  effectiveOn: string | null;
  instrument: string | null;
  instrumentSection: string | null;
  approvedOn: string | null;
  instrumentUrl: string | null;
  note: string | null;
}
