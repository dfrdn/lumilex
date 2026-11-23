import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { fetchAllRows, fetchAllRowsIn } from '@/lib/supabase-paginate';
import { isClosed } from '@/lib/deliverable-status';

export interface OpenBreach {
  id: string;
  deliverableId: string;
  deliverableName: string;
  matterId: string;
  ruleName: string;
  breachType: string;
  severity: string;
  detectedAt: string;
}

// A many-to-one embed arrives as an object; the generated types say array.
function ruleName(embed: { name: string } | { name: string }[] | null): string {
  return (Array.isArray(embed) ? embed[0]?.name : embed?.name) ?? '';
}

/**
 * Unresolved breaches that still mean something for these matters: the rule
 * is still switched on and the deliverable is still open. The evaluator only
 * resolves breaches when it runs, so the table alone can hold stale ones.
 * `matterIds` may still be loading: the breach reads don't need it, so they
 * start at once and the matters only filter the result.
 */
export async function getOpenBreachesForMatters(
  firmId: string,
  matterIds: string[] | Promise<string[]>,
): Promise<OpenBreach[]> {
  const supabase = getServiceDbForFirm(firmId);

  const breaches = await fetchAllRows((from, to) =>
    supabase
      .from('sla_breaches')
      .select('id, deliverable_id, breach_type, severity, detected_at, sla_rules!inner(name, is_active)')
      .is('resolved_at', null)
      .eq('sla_rules.is_active', true)
      .order('id')
      .range(from, to),
  );
  if (breaches.length === 0) {
    await matterIds;
    return [];
  }

  const deliverables = await fetchAllRowsIn(
    [...new Set(breaches.map((b) => b.deliverable_id))],
    (batch, from, to) =>
      supabase
        .from('deliverables')
        .select('notion_id, name, matter_id, status')
        .in('notion_id', batch)
        .order('notion_id')
        .range(from, to),
  );
  const matterSet = new Set(await matterIds);
  const open = new Map(
    deliverables
      .filter((d) => d.matter_id && matterSet.has(d.matter_id) && !isClosed(d.status))
      .map((d) => [d.notion_id as string, d]),
  );

  return breaches
    .filter((b) => open.has(b.deliverable_id))
    .map((b) => {
      const d = open.get(b.deliverable_id)!;
      return {
        id: b.id,
        deliverableId: b.deliverable_id,
        deliverableName: d.name ?? '',
        matterId: d.matter_id as string,
        ruleName: ruleName(b.sla_rules),
        breachType: b.breach_type,
        severity: b.severity,
        detectedAt: b.detected_at,
      };
    })
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
}
