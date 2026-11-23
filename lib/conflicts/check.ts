import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import type {
  ConflictCheckInput,
  ConflictCheckResponse,
  ConflictResult,
  ConflictSeverity,
} from '@/types/conflicts';

/**
 * Run a conflict of interest check against the parties and clients tables.
 * Uses pg_trgm fuzzy matching for name similarity and exact matching for TIN.
 *
 * Scoped to one firm throughout: a match is only a conflict if it comes from
 * the firm's own book of business, and another firm's client and adverse-party
 * names must never surface here.
 */
export async function checkConflicts(
  input: ConflictCheckInput,
  firmId: string,
): Promise<ConflictCheckResponse> {
  const supabase = getServiceDbForFirm(firmId);
  const conflicts: ConflictResult[] = [];
  const names = input.names.filter((n) => n.trim().length > 0);

  if (names.length === 0 && !input.tin && !input.teamMemberIds?.length) {
    return { conflicts: [], checkedAt: new Date().toISOString() };
  }

  const promises: Promise<void>[] = [];

  // 1. Fuzzy name match against parties table
  if (names.length > 0) {
    promises.push((async () => {
      const { data, error } = await supabase.rpc('check_name_conflicts', {
        p_firm_id: firmId,
        check_names: names,
        similarity_threshold: 0.3,
        max_results: 50,
      });
      if (error || !data) return;
      for (const row of data) {
        if (input.excludeMatterId && row.matched_matter_id === input.excludeMatterId) continue;
        const isOpposing = row.matched_party_role === 'opposing_party';
        const severity: ConflictSeverity =
          row.similarity_score >= 0.9 && isOpposing ? 'high' :
          row.similarity_score >= 0.6 && isOpposing ? 'medium' :
          row.similarity_score >= 0.9 ? 'medium' : 'low';

        conflicts.push({
          type: 'name_match',
          severity,
          description: `"${row.input_name}" matches ${row.matched_party_role.replace('_', ' ')} "${row.matched_party_name}" in matter "${row.matched_matter_name}"`,
          relatedMatterId: row.matched_matter_id,
          relatedMatterName: row.matched_matter_name,
          relatedClientName: row.matched_client_name,
          relatedPartyName: row.matched_party_name,
          relatedPartyRole: row.matched_party_role,
          confidence: row.similarity_score,
          matchType: row.match_type,
        });
      }
    })());

    // 2. Fuzzy name match against clients table
    promises.push((async () => {
      const { data, error } = await supabase.rpc('check_client_name_conflicts', {
        p_firm_id: firmId,
        check_names: names,
        similarity_threshold: 0.3,
      });
      if (error || !data) return;
      for (const row of data) {
        if (input.excludeClientName && row.client_name.toLowerCase() === input.excludeClientName.toLowerCase()) continue;
        conflicts.push({
          type: 'client_match',
          severity: row.similarity_score >= 0.9 ? 'medium' : 'low',
          description: `"${row.input_name}" matches existing client "${row.client_name}"${row.full_company_name ? ` (${row.full_company_name})` : ''}`,
          relatedClientName: row.client_name,
          confidence: row.similarity_score,
          matchType: row.match_type,
        });
      }
    })());
  }

  // 3. TIN exact match
  if (input.tin && input.tin.trim()) {
    const tin = input.tin.trim();

    // Check parties
    promises.push((async () => {
      const { data } = await supabase
        .from('parties')
        .select('id, party_name, party_role, matter_id, matters!inner(name, client_name)')
        .eq('tin', tin)
        .limit(20);
      if (!data) return;
      for (const row of data) {
        if (input.excludeMatterId && row.matter_id === input.excludeMatterId) continue;
        const matter = row.matters as unknown as { name: string; client_name: string };
        conflicts.push({
          type: 'tin_match',
          severity: 'high',
          description: `TIN "${tin}" matches ${row.party_role.replace('_', ' ')} "${row.party_name}" in matter "${matter.name}"`,
          relatedMatterId: row.matter_id,
          relatedMatterName: matter.name,
          relatedClientName: matter.client_name,
          relatedPartyName: row.party_name,
          relatedPartyRole: row.party_role,
          confidence: 1.0,
          matchType: 'exact',
        });
      }
    })());

    // Check clients
    promises.push((async () => {
      const { data } = await supabase
        .from('clients')
        .select('notion_id, name, full_company_name')
        .eq('tin', tin)
        .limit(10);
      if (!data) return;
      for (const row of data) {
        conflicts.push({
          type: 'tin_match',
          severity: 'high',
          description: `TIN "${tin}" matches existing client "${row.name}"${row.full_company_name ? ` (${row.full_company_name})` : ''}`,
          relatedClientName: row.name,
          confidence: 1.0,
          matchType: 'exact',
        });
      }
    })());
  }

  // 4. Team member conflict check: has any proposed team member represented an opposing party?
  if (input.teamMemberIds?.length && names.length > 0) {
    promises.push((async () => {
      const { data: teamMatters } = await supabase
        .from('matters')
        .select('notion_id, name, team_person_ids')
        .overlaps('team_person_ids', input.teamMemberIds!);

      if (!teamMatters?.length) return;

      const teamMatterIds = teamMatters.map((m) => m.notion_id);
      if (input.excludeMatterId) {
        const idx = teamMatterIds.indexOf(input.excludeMatterId);
        if (idx >= 0) teamMatterIds.splice(idx, 1);
      }
      if (!teamMatterIds.length) return;

      const { data: opposingParties } = await supabase
        .from('parties')
        .select('id, party_name, party_role, matter_id')
        .in('matter_id', teamMatterIds)
        .eq('party_role', 'opposing_party');

      if (!opposingParties?.length) return;

      for (const party of opposingParties) {
        for (const name of names) {
          const nameLower = name.toLowerCase().trim();
          const partyLower = party.party_name.toLowerCase().trim();
          if (nameLower === partyLower || partyLower.includes(nameLower) || nameLower.includes(partyLower)) {
            const matter = teamMatters.find((m) => m.notion_id === party.matter_id);
            conflicts.push({
              type: 'team_conflict',
              severity: 'high',
              description: `Team member previously represented opposing party "${party.party_name}" in matter "${matter?.name}"`,
              relatedMatterId: party.matter_id,
              relatedMatterName: matter?.name,
              relatedPartyName: party.party_name,
              relatedPartyRole: 'opposing_party',
              confidence: 1.0,
            });
          }
        }
      }
    })());
  }

  await Promise.all(promises);

  // Deduplicate by matter+party+type, keeping highest confidence
  const seen = new Map<string, ConflictResult>();
  for (const c of conflicts) {
    const key = `${c.type}:${c.relatedMatterId ?? ''}:${c.relatedPartyName ?? c.relatedClientName ?? ''}`;
    const existing = seen.get(key);
    if (!existing || c.confidence > existing.confidence) {
      seen.set(key, c);
    }
  }

  // Sort by severity (high first) then confidence
  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...seen.values()].sort((a, b) => {
    const sd = severityOrder[a.severity] - severityOrder[b.severity];
    if (sd !== 0) return sd;
    return b.confidence - a.confidence;
  });

  return {
    conflicts: sorted,
    checkedAt: new Date().toISOString(),
  };
}
