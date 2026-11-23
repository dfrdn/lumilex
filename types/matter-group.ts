import type { NotionMatter, NotionCase } from './notion';

/** Matter enriched with parent_matter_id so the "same line" walk can follow it. */
export interface MatterGroupMember extends NotionCase {
  parentMatterId: string | null;
}

/** One row in the matter-groups listing page. */
export interface MatterGroupListing {
  /** Canonical id for the group = min(notion_id) of its connected component. */
  rootId: string;
  /** Display name derived from member matter names + shared client. */
  name: string;
  clientId: string | null;
  clientName: string;
  memberCount: number;
  memberMatterIds: string[];
  types: string[];
  openTaskCount: number;
  upcomingHearingCount: number;
  activeDeliverableCount: number;
  lastActivityAt: string | null;
}

/** Group-level AI brief mirroring matter_summaries but spanning multiple matters. */
export interface MatterGroupBrief {
  rootMatterId: string;
  memberMatterIds: string[];
  summary: string;
  posture: string | null;
  progressionNotes: string | null;
  parties: Array<{
    name: string;
    role: string;
    side?: 'us' | 'opposing' | 'other';
    notes?: string;
    sourceMatterIds?: string[];
  }> | null;
  keyDates: Array<{
    date: string;
    label: string;
    status?: 'upcoming' | 'past' | 'contingent';
    sourceMatterId?: string | null;
  }>;
  keyRulings: Array<{
    date: string;
    ruling: string;
    effect: string;
    sourceMatterId?: string | null;
  }> | null;
  openIssues: Array<{
    issue: string;
    sourceMatterIds?: string[];
    flaggedAt?: string | null;
  }>;
  modelUsed: string | null;
  generatedAt: string;
  stale: boolean;
}

/** Lightweight matter identity + lineage info used by the detail page. */
export interface MatterGroupMemberBadge {
  id: string;
  name: string;
  matterCode: string;
  type: string;
  status: string;
  outcome: string;
  parentMatterId: string | null;
  isCase: boolean;
}

/** Subset of a matter shown as a chip next to aggregated sub-rows (tasks, hearings...). */
export interface MatterSourceChip {
  id: string;
  name: string;
  matterCode: string;
}

export type { NotionMatter };
