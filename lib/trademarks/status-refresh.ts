import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtensionDecision } from '@/types/notion';
import { fetchAllRows } from '@/lib/supabase-paginate';
import { manilaToday } from '@/lib/corporations/status';
import { buildTrademarkStatus } from '@/lib/trademarks/status';
import { MADRID_COLUMNS, madridFields, rowsToOfficeActions } from '@/lib/trademark-row';
import type { LifecycleOfficeAction } from '@/lib/trademark-deadlines';

/**
 * Store each mark's status in subject_status / subject_status_items — the
 * same read model the companies use, so the Trademarks list, the deadline
 * dashboard and the portal read marks without loading the book.
 * Called by refreshSubjectStatus for subjects of type 'trademark'.
 */

type Row = Record<string, unknown>;

/** The embedded rounds, as the deadline math reads them. */
export function lifecycleOfficeActions(embed: unknown): LifecycleOfficeAction[] {
  return rowsToOfficeActions(Array.isArray(embed) ? embed : []).map(({ id, kind, mailingDate, respondBy, motex, motexDecision, responseFiledDate }) => ({
    id, kind, mailingDate, respondBy, motex, motexDecision, responseFiledDate,
  }));
}

const LIFECYCLE =
  `id, mark, status, type, reg_ir_no, client_id, client_name, ${MADRID_COLUMNS}, filing_date, noi_date, noi_payment_date, issuance_notice_date, issuance_fee_paid_date, ` +
  'reg_date, dau_3_filing_date, dau_3_motex, dau_3_motex_decision, dau_5_filing_date, renewal_filing_date, renewal_dau_filed_date, renewal_dau_5_filed_date, ' +
  'abandonment_mailing_date, revival_filed_date, revival_declined, ' +
  'trademark_office_actions(id, kind, mailing_date, respond_by, motex, motex_decision, response_filed_date)';

export async function refreshTrademarkBatch(supabase: SupabaseClient, firmId: string, ids: string[], today = manilaToday()): Promise<number> {
  if (!ids.length) return 0;

  const [marks, links] = await Promise.all([
    fetchAllRows<Row>((f, t) => supabase.from('trademarks').select(LIFECYCLE).in('id', ids).order('id').range(f, t).returns<Row[]>()),
    fetchAllRows<Row>((f, t) => supabase.from('matter_subjects').select('subject_id, matter_id').in('subject_id', ids).order('subject_id').range(f, t)),
  ]);
  const matterIds = [...new Set(links.map((l) => l.matter_id as string))];
  const [matters, requests] = await Promise.all([
    matterIds.length
      ? supabase.from('matters').select('notion_id, team_person_ids').in('notion_id', matterIds).then((r) => r.data ?? [])
      : Promise.resolve([] as Row[]),
    matterIds.length
      ? supabase
          .from('file_requests')
          .select('matter_id')
          .in('matter_id', matterIds)
          .is('fulfilled_at', null)
          .is('canceled_at', null)
          .then((r) => r.data ?? [])
      : Promise.resolve([] as Row[]),
  ]);
  const teamIds = [...new Set(matters.flatMap((m) => (m.team_person_ids as string[] | null) ?? []))];
  const teamRows = teamIds.length
    ? (await supabase.from('team').select('person_id, name, initials, avatar_url').in('person_id', teamIds).eq('active', true)).data ?? []
    : [];
  const personById = new Map(teamRows.map((p) => [p.person_id as string, p]));
  const teamByMatter = new Map(matters.map((m) => [m.notion_id as string, (m.team_person_ids as string[] | null) ?? []]));
  const openMatters = new Set(requests.map((r) => r.matter_id as string));
  const mattersOf = new Map<string, string[]>();
  for (const l of links) mattersOf.set(l.subject_id as string, [...(mattersOf.get(l.subject_id as string) ?? []), l.matter_id as string]);

  const statusRows: Row[] = [];
  const itemRows: Row[] = [];
  const computedAt = new Date().toISOString();

  for (const m of marks) {
    const own = mattersOf.get(m.id as string) ?? [];
    const status = buildTrademarkStatus(
      {
        status: (m.status as string) ?? '',
        ...madridFields(m),
        filingDate: (m.filing_date as string | null) ?? null,
        noiDate: (m.noi_date as string | null) ?? null,
        noiPaymentDate: (m.noi_payment_date as string | null) ?? null,
        issuanceNoticeDate: (m.issuance_notice_date as string | null) ?? null,
        issuanceFeePaidDate: (m.issuance_fee_paid_date as string | null) ?? null,
        officeActions: lifecycleOfficeActions(m.trademark_office_actions),
        abandonmentMailingDate: (m.abandonment_mailing_date as string | null) ?? null,
        revivalFiledDate: (m.revival_filed_date as string | null) ?? null,
        revivalDeclined: !!m.revival_declined,
        regDate: (m.reg_date as string | null) ?? null,
        dau3FilingDate: (m.dau_3_filing_date as string | null) ?? null,
        dau3Motex: !!m.dau_3_motex,
        dau3MotexDecision: (m.dau_3_motex_decision as ExtensionDecision | null) ?? null,
        dau5FilingDate: (m.dau_5_filing_date as string | null) ?? null,
        renewalFilingDate: (m.renewal_filing_date as string | null) ?? null,
        renewalDauFiledDate: (m.renewal_dau_filed_date as string | null) ?? null,
        renewalDau5FiledDate: (m.renewal_dau_5_filed_date as string | null) ?? null,
      },
      { today, waitingOnClient: own.some((id) => openMatters.has(id)) },
    );
    const team = [...new Set(own.flatMap((id) => teamByMatter.get(id) ?? []))];
    statusRows.push({
      firm_id: firmId,
      subject_id: m.id,
      type: 'trademark',
      name: (m.mark as string) ?? '',
      lifecycle_status: m.status,
      company_type: m.type ?? null,
      identifier: m.reg_ir_no ?? null,
      client_id: m.client_id ?? null,
      client_name: m.client_name ?? null,
      team: team
        .map((id) => personById.get(id))
        .filter((p) => !!p)
        .map((p) => ({ name: (p!.name as string) ?? '', initials: (p!.initials as string) || '??', avatarUrl: (p!.avatar_url as string | null) ?? null })),
      team_person_ids: team,
      phase: status.phase,
      health: status.health,
      overdue: status.overdue,
      due_soon: status.dueSoon,
      waiting_on_client: status.waitingOnClient,
      focus: [],
      next_label: status.next?.label ?? null,
      next_due: status.next?.dueDate ?? null,
      next_track: status.next?.track ?? null,
      next_state: status.next?.state ?? null,
      computed_for: today,
      computed_at: computedAt,
    });
    for (const i of status.items) {
      itemRows.push({
        firm_id: firmId,
        subject_id: m.id,
        item_key: i.key,
        track: i.track,
        label: i.label,
        detail: i.detail,
        state: i.state,
        due_date: i.dueDate,
        provisional: false,
        deliverable_id: null,
        team_person_ids: team,
        meta: { kind: i.kind, opens: i.opens, extendedDue: i.extendedDue, extensionBasis: i.extensionBasis, officeAction: i.officeAction, extension: i.extension },
      });
    }
  }

  if (statusRows.length) {
    const { error } = await supabase.from('subject_status').upsert(statusRows, { onConflict: 'subject_id' });
    if (error) throw new Error(`subject_status upsert (trademarks): ${error.message}`);
  }
  const done = marks.map((m) => m.id as string);
  if (done.length) {
    const { error } = await supabase.from('subject_status_items').delete().in('subject_id', done);
    if (error) throw new Error(`subject_status_items clear (trademarks): ${error.message}`);
  }
  for (let i = 0; i < itemRows.length; i += 500) {
    const { error } = await supabase.from('subject_status_items').insert(itemRows.slice(i, i + 500).map((r) => ({ ...r, firm_id: firmId })));
    if (error) throw new Error(`subject_status_items insert (trademarks): ${error.message}`);
  }
  return statusRows.length;
}
