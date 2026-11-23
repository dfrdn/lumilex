// ── Matter Groups: derived from matters.related_matter_ids ──────────
//
// A "matter group" is a connected component of matters linked via the
// `matters.related_matter_ids` array treated as undirected edges. Groups
// are computed on read — there is no `matter_groups` table. For a seed
// matter the full component can also be resolved via the SQL function
// `matter_group_members(p_firm_id, seed_id)` (20260420_matter_groups.sql,
// firm-scoped in 20260824_firm_scope_blind_rpcs.sql).
//
// Canonical group id = min(notion_id) of the component. This is stable as
// long as membership doesn't change, which keeps URLs + cached briefs
// sensible without requiring a separate identifier.

import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import type { MatterGroupListing, MatterGroupMember, MatterGroupBrief } from '@/types/matter-group';
import {
  getTasksByMatterId, getMeetingsByMatterId, getHearingsByMatterId,
  getDeliverablesByMatterId, getFilesByMatterId, getFilingsByMatterId,
  getMattersByIds,
} from './detail';
import { toManilaDay } from '@/lib/dates';

// ── Component computation (all groups) ───────────────────────────────

interface MatterGraphNode {
  id: string;
  name: string;
  matterCode: string;
  clientId: string | null;
  clientName: string;
  type: string;
  status: string;
  parentMatterId: string | null;
  relatedMatterIds: string[];
  notionLastEditedAt: string | null;
}

/** Union-find — enough for ~thousands of matters. */
class DSU {
  private parent = new Map<string, string>();
  find(x: string): string {
    const p = this.parent.get(x);
    if (!p || p === x) {
      this.parent.set(x, x);
      return x;
    }
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // Make the lexicographically smaller id the root so `find` converges
    // on min(id) — that's our canonical group id.
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

/**
 * Parse the trailing number from a matter code (e.g. "103-20-9" → 9).
 * Returns -Infinity if the code has no recognizable sequence segment, so
 * matters without a code sort to the bottom when picking the "latest".
 */
function matterCodeSequence(code: string): number {
  if (!code) return -Infinity;
  const nums = code.match(/\d+/g);
  if (!nums || nums.length === 0) return -Infinity;
  return Number(nums[nums.length - 1]);
}

/**
 * Group name = the name of the matter with the highest matter_code sequence
 * (i.e. the most recently opened matter in the cluster, which is typically
 * the appeal / latest stage). Falls back to any member name if codes are
 * missing.
 */
function deriveGroupName<M extends { name: string; matterCode: string }>(members: M[]): string {
  if (members.length === 0) return '';
  const withScores = members.map((m) => ({ m, score: matterCodeSequence(m.matterCode) }));
  withScores.sort((a, b) => b.score - a.score);
  const best = withScores[0]?.m;
  return best?.name || members[0].name;
}

export async function getAllMatterGroups(firmId: string): Promise<MatterGroupListing[]> {
  const supabase = getServiceDbForFirm(firmId);

  const { data: mattersData, error } = await supabase
    .from('matters')
    .select('notion_id, name, matter_code, client_id, client_name, type, status, parent_matter_id, related_matter_ids, notion_last_edited_at');
  if (error) throw error;

  const nodes = new Map<string, MatterGraphNode>();
  for (const row of mattersData ?? []) {
    nodes.set(row.notion_id, {
      id: row.notion_id,
      name: row.name ?? '',
      matterCode: row.matter_code ?? '',
      clientId: row.client_id ?? null,
      clientName: row.client_name ?? '',
      type: row.type ?? '',
      status: row.status ?? '',
      parentMatterId: row.parent_matter_id ?? null,
      relatedMatterIds: row.related_matter_ids ?? [],
      notionLastEditedAt: row.notion_last_edited_at ?? null,
    });
  }

  const dsu = new DSU();
  for (const n of nodes.values()) {
    for (const neighbor of n.relatedMatterIds) {
      if (nodes.has(neighbor)) dsu.union(n.id, neighbor);
    }
  }

  // Gather members per root (via DSU find). Then drop singletons — a "group"
  // of one matter isn't interesting. Matters that are pointed at by others
  // but have no outgoing edges still get unioned with their pointer, so they
  // correctly show up in the component.
  const components = new Map<string, MatterGraphNode[]>();
  for (const n of nodes.values()) {
    const root = dsu.find(n.id);
    if (!components.has(root)) components.set(root, []);
    components.get(root)!.push(n);
  }
  for (const [root, members] of components) {
    if (members.length < 2) components.delete(root);
  }

  const componentRoots = Array.from(components.keys());
  if (componentRoots.length === 0) return [];

  // Pre-compute aggregate stats for all member matters in one pass per table.
  const allMemberIds = Array.from(components.values()).flat().map((n) => n.id);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

  const [tasksRes, hearingsRes, delivRes] = await Promise.all([
    supabase.from('tasks').select('matter_id, done').in('matter_id', allMemberIds),
    supabase.from('hearings').select('matter_id, date, type').in('matter_id', allMemberIds),
    supabase.from('deliverables').select('matter_id, status').in('matter_id', allMemberIds),
  ]);

  const openTaskByMatter = new Map<string, number>();
  for (const t of tasksRes.data ?? []) {
    if (t.done) continue;
    openTaskByMatter.set(t.matter_id, (openTaskByMatter.get(t.matter_id) ?? 0) + 1);
  }
  const upcomingHearingByMatter = new Map<string, number>();
  for (const h of hearingsRes.data ?? []) {
    const t = (h.type || '').toLowerCase();
    if (t === 'filing' || t.includes('filing')) continue;
    if (!h.date) continue;
    if (toManilaDay(h.date) < today) continue;
    upcomingHearingByMatter.set(h.matter_id, (upcomingHearingByMatter.get(h.matter_id) ?? 0) + 1);
  }
  const activeDelivByMatter = new Map<string, number>();
  for (const d of delivRes.data ?? []) {
    const s = (d.status || '').toLowerCase();
    if (s.includes('filed') || s.includes('sent out') || s.includes('archived')) continue;
    activeDelivByMatter.set(d.matter_id, (activeDelivByMatter.get(d.matter_id) ?? 0) + 1);
  }

  const result: MatterGroupListing[] = [];
  for (const [rootId, members] of components) {
    const memberIds = members.map((m) => m.id);
    const sortedMembers = [...members].sort((a, b) => (a.matterCode || '').localeCompare(b.matterCode || ''));
    const clientNames = Array.from(new Set(sortedMembers.map((m) => m.clientName).filter(Boolean)));
    const clientIds = Array.from(new Set(sortedMembers.map((m) => m.clientId).filter((v): v is string => !!v)));
    const types = Array.from(new Set(sortedMembers.map((m) => m.type).filter(Boolean)));

    let openTasks = 0;
    let upcomingHearings = 0;
    let activeDeliverables = 0;
    let lastActivity: string | null = null;
    for (const m of members) {
      openTasks += openTaskByMatter.get(m.id) ?? 0;
      upcomingHearings += upcomingHearingByMatter.get(m.id) ?? 0;
      activeDeliverables += activeDelivByMatter.get(m.id) ?? 0;
      if (m.notionLastEditedAt && (!lastActivity || m.notionLastEditedAt > lastActivity)) {
        lastActivity = m.notionLastEditedAt;
      }
    }

    result.push({
      rootId,
      name: deriveGroupName(sortedMembers.map((m) => ({ name: m.name, matterCode: m.matterCode }))),
      clientId: clientIds.length === 1 ? clientIds[0] : null,
      clientName: clientNames.length === 1 ? clientNames[0] : clientNames.join(' / '),
      memberCount: members.length,
      memberMatterIds: memberIds,
      types,
      openTaskCount: openTasks,
      upcomingHearingCount: upcomingHearings,
      activeDeliverableCount: activeDeliverables,
      lastActivityAt: lastActivity,
    });
  }

  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

// ── Single group (detail view) ───────────────────────────────────────

/** Return the component (connected set) containing `seedMatterId`. */
export async function getMatterGroupMemberIds(firmId: string, seedMatterId: string): Promise<string[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase.rpc('matter_group_members', {
    p_firm_id: firmId,
    seed_id: seedMatterId,
  });
  if (error) throw error;
  // Supabase wraps setof functions; rpc returns an array of { matter_group_members: id } or plain strings depending on driver.
  if (!Array.isArray(data)) return [];
  return data.map((row: unknown) => {
    if (typeof row === 'string') return row;
    if (row && typeof row === 'object') {
      const r = row as Record<string, unknown>;
      const v = r.matter_group_members;
      if (typeof v === 'string') return v;
    }
    return String(row);
  });
}

export interface MatterGroupDetailData {
  rootId: string;
  name: string;
  clientId: string | null;
  clientName: string;
  members: MatterGroupMember[];
  tasks: Awaited<ReturnType<typeof getTasksByMatterId>>;
  meetings: Awaited<ReturnType<typeof getMeetingsByMatterId>>;
  hearings: Awaited<ReturnType<typeof getHearingsByMatterId>>;
  deliverables: Awaited<ReturnType<typeof getDeliverablesByMatterId>>;
  files: Awaited<ReturnType<typeof getFilesByMatterId>>;
  filings: Awaited<ReturnType<typeof getFilingsByMatterId>>;
  parties: AggregatedParty[];
}

export interface AggregatedParty {
  name: string;
  role: string;
  entityType: string;
  aliases: string[];
  contactInfo: string;
  notes: string;
  sourceMatterIds: string[];
}

/**
 * Fetch a group by its canonical root id. The `rootId` is treated as any seed
 * in the component — if the user lands on a stale URL after relatedness
 * changed, we silently re-resolve to the new canonical root by returning the
 * component computed from the seed.
 */
export async function getMatterGroupById(firmId: string, rootId: string): Promise<MatterGroupDetailData | null> {
  const supabase = getServiceDbForFirm(firmId);
  const memberIds = await getMatterGroupMemberIds(firmId, rootId);
  if (memberIds.length === 0) return null;

  const { data: memberRows, error } = await supabase
    .from('matters')
    .select('*')
    .in('notion_id', memberIds);
  if (error) throw error;
  if (!memberRows || memberRows.length === 0) return null;

  const members: MatterGroupMember[] = memberRows.map((row: Record<string, unknown> & { notion_id: string; notion_url: string; name: string | null; matter_code: string | null; client_id: string | null; client_name: string | null; related_matter_ids: string[] | null; parent_matter_id: string | null; type: string | null; status: string | null; case_title: string | null; case_number: string | null; court: string | null; outcome: string | null; team_person_ids: string[] | null }) => ({
    id: row.notion_id,
    url: row.notion_url,
    name: row.name ?? '',
    matterCode: row.matter_code ?? '',
    clientId: row.client_id ?? null,
    clientName: row.client_name ?? '',
    relatedMatterIds: row.related_matter_ids ?? [],
    parentMatterId: row.parent_matter_id ?? null,
    type: row.type ?? '',
    status: row.status ?? '',
    caseTitle: row.case_title ?? '',
    caseNumber: row.case_number ?? '',
    court: row.court ?? '',
    outcome: row.outcome ?? '',
    teamPersonIds: row.team_person_ids ?? [],
  }));

  // Aggregate all sub-entities per member, in parallel.
  const [tasks, meetings, hearings, deliverables, files, filings, partyRows] = await Promise.all([
    Promise.all(memberIds.map((id) => getTasksByMatterId(id, firmId))).then((r) => r.flat()),
    Promise.all(memberIds.map((id) => getMeetingsByMatterId(id, firmId))).then((r) => r.flat()),
    Promise.all(memberIds.map((id) => getHearingsByMatterId(id, firmId))).then((r) => r.flat()),
    Promise.all(memberIds.map((id) => getDeliverablesByMatterId(id, firmId))).then((r) => r.flat()),
    Promise.all(memberIds.map((id) => getFilesByMatterId(id, firmId))).then((r) => r.flat()),
    Promise.all(memberIds.map((id) => getFilingsByMatterId(id, firmId))).then((r) => r.flat()),
    supabase.from('parties').select('*').in('matter_id', memberIds),
  ]);

  const parties = dedupeParties(partyRows.data ?? []);

  // Derive display metadata from the members themselves.
  const clientNames = Array.from(new Set(members.map((m) => m.clientName).filter(Boolean)));
  const clientIds = Array.from(new Set(members.map((m) => m.clientId).filter((v): v is string => !!v)));
  const sortedByCode = [...members].sort((a, b) => (a.matterCode || '').localeCompare(b.matterCode || ''));
  const canonicalRootId = memberIds.slice().sort()[0];

  return {
    rootId: canonicalRootId,
    name: deriveGroupName(sortedByCode.map((m) => ({ name: m.name, matterCode: m.matterCode }))),
    clientId: clientIds.length === 1 ? clientIds[0] : null,
    clientName: clientNames.length === 1 ? clientNames[0] : clientNames.join(' / '),
    members,
    tasks,
    meetings,
    hearings,
    deliverables,
    files,
    filings,
    parties,
  };
}

interface PartyRow {
  matter_id: string;
  party_name: string | null;
  party_role: string | null;
  entity_type: string | null;
  aliases: string[] | null;
  contact_info: string | null;
  notes: string | null;
}

function dedupeParties(rows: PartyRow[]): AggregatedParty[] {
  const byKey = new Map<string, AggregatedParty>();
  for (const r of rows) {
    const key = `${(r.party_name || '').toLowerCase()}::${(r.party_role || '').toLowerCase()}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        name: r.party_name ?? '',
        role: r.party_role ?? '',
        entityType: r.entity_type ?? '',
        aliases: r.aliases ?? [],
        contactInfo: r.contact_info ?? '',
        notes: r.notes ?? '',
        sourceMatterIds: [r.matter_id],
      });
    } else {
      const existing = byKey.get(key)!;
      if (!existing.sourceMatterIds.includes(r.matter_id)) existing.sourceMatterIds.push(r.matter_id);
      if (!existing.contactInfo && r.contact_info) existing.contactInfo = r.contact_info;
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// ── Line filter ──────────────────────────────────────────────────────

/**
 * Given a member matter, return the set of ids on its "line" — walk up
 * `parent_matter_id` to the root, then walk down all descendants. The line
 * is the transitive closure of the parent→child tree that the focused
 * matter belongs to.
 */
export async function getMatterLineIds(firmId: string, focusMatterId: string): Promise<string[]> {
  const supabase = getServiceDbForFirm(firmId);
  // Fetch every matter that could be part of any line we walk. A line
  // stays inside one connected component, and `matter_group_members`
  // gives us that set cheaply.
  const memberIds = await getMatterGroupMemberIds(firmId, focusMatterId);
  if (memberIds.length === 0) return [focusMatterId];

  const { data, error } = await supabase
    .from('matters')
    .select('notion_id, parent_matter_id')
    .in('notion_id', memberIds);
  if (error) throw error;

  const parentMap = new Map<string, string | null>();
  const childrenMap = new Map<string, string[]>();
  for (const row of data ?? []) {
    parentMap.set(row.notion_id, row.parent_matter_id ?? null);
    if (row.parent_matter_id) {
      const list = childrenMap.get(row.parent_matter_id) ?? [];
      list.push(row.notion_id);
      childrenMap.set(row.parent_matter_id, list);
    }
  }

  // Walk up to root.
  let root = focusMatterId;
  const visited = new Set<string>([focusMatterId]);
  while (true) {
    const parent = parentMap.get(root) ?? null;
    if (!parent || visited.has(parent)) break;
    visited.add(parent);
    root = parent;
  }

  // BFS down from root.
  const line = new Set<string>([root]);
  const queue = [root];
  while (queue.length) {
    const node = queue.shift()!;
    for (const child of childrenMap.get(node) ?? []) {
      if (line.has(child)) continue;
      line.add(child);
      queue.push(child);
    }
  }

  // If the focused matter isn't in the line (no parent/child relationships),
  // default to just the focused matter itself so filtering doesn't yield empty.
  if (!line.has(focusMatterId)) line.add(focusMatterId);

  return Array.from(line);
}

// ── Summary persistence ──────────────────────────────────────────────

export async function getMatterGroupSummary(firmId: string, rootMatterId: string): Promise<MatterGroupBrief | null> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('matter_group_summaries')
    .select('*')
    .eq('root_matter_id', rootMatterId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const ageMs = Date.now() - new Date(data.updated_at).getTime();
  const stale = ageMs > 24 * 60 * 60 * 1000;

  return {
    rootMatterId: data.root_matter_id,
    memberMatterIds: data.member_matter_ids ?? [],
    summary: data.summary ?? '',
    posture: data.posture ?? null,
    progressionNotes: data.progression_notes ?? null,
    parties: data.parties ?? null,
    keyDates: data.key_dates ?? [],
    keyRulings: data.key_rulings ?? null,
    openIssues: data.open_issues ?? [],
    modelUsed: data.model_used ?? null,
    generatedAt: data.generated_at,
    stale,
  };
}

export { getMattersByIds };
