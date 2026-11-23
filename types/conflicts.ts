export interface ConflictCheckInput {
  names: string[];
  tin?: string;
  teamMemberIds?: string[];
  /** Exclude this matter from results (useful when editing an existing matter) */
  excludeMatterId?: string;
  /** Exclude this client from client_match results (e.g. the matter's own client) */
  excludeClientName?: string;
}

export type ConflictSeverity = 'high' | 'medium' | 'low';
export type ConflictType = 'name_match' | 'tin_match' | 'team_conflict' | 'client_match';

export interface ConflictResult {
  type: ConflictType;
  severity: ConflictSeverity;
  description: string;
  relatedMatterId?: string;
  relatedMatterName?: string;
  relatedClientName?: string;
  relatedPartyName?: string;
  relatedPartyRole?: string;
  confidence: number;
  matchType?: string; // 'exact' | 'fuzzy' | 'alias'
}

export interface ConflictCheckResponse {
  conflicts: ConflictResult[];
  checkedAt: string;
}

export interface Party {
  id: number;
  matter_id: string;
  party_name: string;
  party_role: 'client' | 'opposing_party' | 'co-counsel' | 'witness' | 'interested_party';
  entity_type: 'individual' | 'organization';
  aliases: string[];
  tin: string;
  contact_info: string;
  notes: string;
  source: 'manual' | 'client_auto' | 'file_analysis' | 'intake';
  source_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientIntake {
  id: number;
  client_id: string;
  stage: 'Lead' | 'Contacted' | 'Consultation Scheduled' | 'Consultation Done' | 'Proposal Sent' | 'Engaged' | 'Declined';
  assigned_lawyer_id: string | null;
  source: 'referral' | 'website' | 'walk-in' | 'event' | 'other';
  referral_source: string;
  consultation_date: string | null;
  consultation_notes: string;
  proposed_services: string[];
  proposed_fee: number | null;
  engagement_letter_url: string;
  declined_reason: string;
  conflict_check_result: ConflictCheckResponse | null;
  /** team.person_id of whoever added the prospect; null for pre-existing rows. */
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields from API
  client_name?: string;
  client_status?: string;
  client_full_name?: string;
  client_email?: string;
  client_phone?: string;
  client_tin?: string;
  assigned_lawyer_name?: string;
  created_by_name?: string;
}

export interface IntakeStageHistory {
  id: number;
  intake_id: number;
  old_stage: string;
  new_stage: string;
  changed_by: string;
  notes: string | null;
  created_at: string;
}
