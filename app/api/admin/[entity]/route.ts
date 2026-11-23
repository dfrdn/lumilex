import { getSession } from '@/lib/session';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { TENANT_TABLES } from '@/lib/tenancy/tables.generated';
import { refuseInDemo } from '@/lib/demo/guard';
import { cascadeClientRename } from '@/lib/clients/cascade-rename';
import { clientRenameWarning, CLIENT_RENAME_CONFIRM } from '@/lib/clients/rename-guard';
import { getEntityConfig, MATTER_TYPE_CODES, EntityConfig } from '@/lib/admin/entity-config';
import { ilikeAnyFilter } from '@/lib/admin/search-filter';
import { relationIdFor } from '@/lib/admin/relation-pick';
import { fetchMatterTypeCodes } from '@/lib/enum-options';
import { allocateClientCode } from '@/lib/clients/allocate-client-code';
import { deriveMatterCode } from '@/lib/matters/derive-matter-code';
import { mintId } from '@/lib/ids';
import { SupabaseClient } from '@supabase/supabase-js';
import { logAudit, getClientIP } from '@/lib/audit';
import { checkConflicts } from '@/lib/conflicts/check';
import {
  notifyAttendeesAddedToMeeting,
  notifyAttendeesAddedToHearing,
} from '@/lib/notifications';
import { LIAISON_ROLES } from '@/lib/queries/liaison';
import { manilaDayEnd, manilaDayStart, toManilaInstant } from '@/lib/dates';

type RouteContext = { params: Promise<{ entity: string }> };

// ---------------------------------------------------------------------------
// Auto-generation helpers
// ---------------------------------------------------------------------------

/**
 * Turn a unique violation on `clients_name_unique_ci` into a message the admin
 * UI can act on, instead of a generic 500. Client names are unique because the
 * schema treats the name as an identifier — ten tables denormalize
 * `client_name` and match on the string.
 */
function duplicateClientNameResponse(
  error: { code?: string; message?: string } | null,
): NextResponse | null {
  if (error?.code !== '23505' || !error.message?.includes('clients_name_unique_ci')) return null;
  return NextResponse.json(
    {
      error:
        'A client with that name already exists. Client names must be unique — ' +
        'give one of them a distinguishing suffix if they really are different clients.',
    },
    { status: 409 },
  );
}

/** Allocate the next client code atomically (collision-proof under concurrency). */
async function nextClientCode(firmId: string): Promise<number> {
  const supabase = await getSupabaseServerAuthClient();
  return allocateClientCode(supabase, firmId);
}

/** Derive a matter code for the admin surface, under the caller's RLS. */
async function deriveMatterCodeForAdmin(
  firmId: string,
  clientName: string,
  typeName: string,
  excludeNotionId?: string,
): Promise<string> {
  const supabase = await getSupabaseServerAuthClient();
  return deriveMatterCode(supabase, firmId, { clientName, type: typeName, excludeNotionId });
}

async function assertAdmin() {
  const session = await getSession();
  if (!session?.user?.role || !['admin', 'super_user', 'finance'].includes(session.user.role)) {
    return null;
  }
  return session;
}

// ---------------------------------------------------------------------------
// Filings virtual view — deliverables with deadline + matter has case info
// ---------------------------------------------------------------------------
async function handleFilingsView(
  supabase: SupabaseClient,
  url: URL,
  page: number,
  pageSize: number,
  sortBy: string,
  sortDir: boolean,
  search: string,
  _config: EntityConfig,
) {
  // Step 1: Get matter IDs that have case info (case_title, case_number, or court)
  const { data: caseMatterRows } = await supabase
    .from('matters')
    .select('notion_id')
    .or('case_title.neq.,case_number.neq.,court.neq.');

  const caseMatterIds = (caseMatterRows ?? []).map((m) => m.notion_id);

  if (caseMatterIds.length === 0) {
    return NextResponse.json({ data: [], total: 0, page, pageSize, totalPages: 0 });
  }

  // Step 2: Query external deliverables with deadline, filtered to case matters
  let query = supabase
    .from('deliverables')
    .select('*', { count: 'exact' })
    .eq('type', 'External')
    .not('external_due_date', 'is', null)
    .in('matter_id', caseMatterIds);

  // Search
  if (search) {
    query = query.or(ilikeAnyFilter(['name', 'matter_name', 'client_name', 'status'], search));
  }

  // Column filters
  for (const [param, val] of url.searchParams.entries()) {
    if (!param.startsWith('filter.') || !val) continue;
    const rest = param.slice(7);
    if (rest.endsWith('.gte')) {
      query = query.gte(rest.slice(0, -4), val);
    } else if (rest.endsWith('.lte')) {
      query = query.lte(rest.slice(0, -4), val);
    } else {
      query = query.eq(rest, val);
    }
  }

  query = query.order(sortBy, { ascending: sortDir, nullsFirst: false });

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await query.range(from, to);

  if (error) {
    console.error('[admin]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Enrich filings with "Related SR" (status report name+status) and
  // "Filed Copy" (whether a deliverable_files row tagged 'Filed version'
  // exists). Both are synthetic / computed columns not in the DB row.
  let enriched = data ?? [];
  if (enriched.length > 0) {
    const ids = enriched.map((r) => r.notion_id).filter(Boolean) as string[];

    // Related status report: deliverables of type='Status Report' whose
    // source_deliverable_id points to one of these filings.
    const [srResult, filedResult] = await Promise.all([
      supabase
        .from('deliverables')
        .select('source_deliverable_id, name, status')
        .eq('type', 'Status Report')
        .in('source_deliverable_id', ids),
      supabase
        .from('deliverable_files')
        .select('deliverable_id, action')
        .in('deliverable_id', ids)
        .ilike('action', 'Filed version%'),
    ]);

    const srMap = new Map<string, { name: string; status: string }>();
    for (const sr of srResult.data ?? []) {
      if (sr.source_deliverable_id) {
        srMap.set(sr.source_deliverable_id, { name: sr.name, status: sr.status });
      }
    }

    const filedSet = new Set<string>(
      (filedResult.data ?? []).map((f) => f.deliverable_id),
    );

    enriched = enriched.map((r) => {
      const sr = srMap.get(r.notion_id);
      return {
        ...r,
        related_sr_name: sr ? `${sr.name} (${sr.status})` : null,
        has_filed_copy: filedSet.has(r.notion_id) ? 'Yes' : null,
      };
    });
  }

  return NextResponse.json({
    data: enriched,
    total: count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((count ?? 0) / pageSize),
  });
}

// ---------------------------------------------------------------------------
// GET  /api/admin/[entity]
// Fetch all rows from the entity's Supabase table.
// ---------------------------------------------------------------------------
export async function GET(
  req: NextRequest,
  context: RouteContext,
) {
  const session = await assertAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { entity } = await context.params;
  const config = getEntityConfig(entity);
  if (!config) {
    return NextResponse.json({ error: `Unknown entity: ${entity}` }, { status: 400 });
  }

  const datetimeColumns = new Set(config.fields.filter((f) => f.type === 'datetime').map((f) => f.supabaseColumn));
  const isBareDayOnDatetime = (col: string, value: string) =>
    datetimeColumns.has(col) && /^\d{4}-\d{2}-\d{2}$/.test(value);

  const url = req.nextUrl;
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '50', 10)));
  const search = url.searchParams.get('search')?.trim() ?? '';
  let sortBy = url.searchParams.get('sortBy') ?? 'name';
  const sortDir = url.searchParams.get('sortDir') === 'desc' ? false : true;

  // Tables synced from Notion use created_time; newer in-app tables use created_at.
  const TABLES_WITH_CREATED_AT = ['ph_holidays', 'parties', 'client_intakes', 'audit_log', 'matter_sol', 'deadline_chains', 'deadline_chain_items', 'liaison_tasks', 'trademarks', 'transportation_zones'];
  // The table's recency column — also the safe fallback when a sort targets a
  // synthetic (non-DB) column.
  const recencyColumn = TABLES_WITH_CREATED_AT.includes(config.dbTable) ? 'created_at' : 'created_time';
  if (sortBy === 'created_time') sortBy = recencyColumn;

  const supabase = await getSupabaseServerAuthClient();

  // ── Special handling for virtual views (e.g., filings = deliverables with deadline + case) ──
  if (config.viewOf === 'deliverables' && entity === 'filings') {
    return handleFilingsView(supabase, url, page, pageSize, sortBy, sortDir, search, config);
  }

  // Build the query
  let query = supabase.from(config.dbTable).select('*', { count: 'exact' });

  // Apply entity-config fixed filters (for virtual views like status_reports)
  if (config.fixedFilters) {
    for (const [col, val] of Object.entries(config.fixedFilters)) {
      query = query.eq(col, val);
    }
  }

  // Exclude Status Report deliverables from the main Deliverables view —
  // they live under their own status_reports virtual view. The Finalize page
  // opts back in (?includeStatusReports=1) so Pre-finalized status reports are
  // finalizable through the same flow.
  if (entity === 'deliverables' && url.searchParams.get('includeStatusReports') !== '1') {
    query = query.neq('type', 'Status Report');
  }

  // Synthetic (computed) columns that don't exist in the underlying table.
  const SYNTHETIC_COLUMNS = new Set(['related_parent_name', 'related_sr_name', 'has_filed_copy', 'zone_name']);

  // Server-side search across text fields
  if (search) {
    const textFields = config.fields.filter(
      (f) =>
        (f.type === 'text' || f.type === 'relation' || f.type === 'select') &&
        f.searchable !== false &&
        !SYNTHETIC_COLUMNS.has(f.supabaseColumn),
    );
    if (textFields.length > 0) {
      query = query.or(ilikeAnyFilter(textFields.map((f) => f.supabaseColumn), search));
    }
  }

  // Column filters: filter.{column}=value, filter.{column}.gte=date, filter.{column}.lte=date
  // Whitelist: entity-config columns + standard FK columns used as scope keys
  // by other entities pointing here (e.g., deliverables.matter_id is the FK a
  // liaison_task's deliverable picker scopes by).
  const allowedColumns = new Set(
    config.fields
      .map((f) => f.supabaseColumn)
      .filter((c) => !SYNTHETIC_COLUMNS.has(c)),
  );
  for (const fkCol of ['matter_id', 'client_id', 'deliverable_id']) {
    allowedColumns.add(fkCol);
  }
  for (const [param, val] of url.searchParams.entries()) {
    if (!param.startsWith('filter.') || !val) continue;
    const rest = param.slice(7); // after "filter."

    // Date range: filter.column.gte or filter.column.lte. The picker emits a
    // bare YYYY-MM-DD; on a timestamptz column that compares against midnight
    // UTC, so a "to" bound dropped the whole final Manila day. Widen a bare
    // date on a datetime column to the Manila day it names.
    if (rest.endsWith('.gte')) {
      const col = rest.slice(0, -4);
      if (!allowedColumns.has(col)) continue; // skip unknown columns
      query = query.gte(col, isBareDayOnDatetime(col, val) ? manilaDayStart(val) : val);
    } else if (rest.endsWith('.lte')) {
      const col = rest.slice(0, -4);
      if (!allowedColumns.has(col)) continue;
      query = query.lte(col, isBareDayOnDatetime(col, val) ? manilaDayEnd(val) : val);
    } else {
      // Exact match for select/checkbox, array-contains for people
      const col = rest;
      if (!allowedColumns.has(col)) continue;
      const fieldDef = config.fields.find((f) => f.supabaseColumn === col);
      if (fieldDef?.type === 'checkbox') {
        query = query.eq(col, val === 'true');
      } else if (fieldDef?.type === 'people') {
        // People columns are TEXT[] arrays — use contains to match rows
        // where the array includes the given person_id.
        query = query.contains(col, [val]);
      } else {
        query = query.eq(col, val);
      }
    }
  }

  // Sort + paginate
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Synthetic (computed) columns aren't real DB columns — ordering by one would
  // 500. Fall back to the table's recency column.
  if (SYNTHETIC_COLUMNS.has(sortBy)) sortBy = recencyColumn;

  const { data, error, count } = await query
    .order(sortBy, { ascending: sortDir, nullsFirst: false })
    .range(from, to);

  if (error) {
    console.error('[admin]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Enrich status_reports with the parent (hearing / source deliverable / file) name.
  let enriched = data ?? [];
  if (entity === 'status_reports' && enriched.length > 0) {
    const hearingIds = Array.from(
      new Set(enriched.map((r) => r.related_hearing_id).filter(Boolean)),
    ) as string[];
    const sourceIds = Array.from(
      new Set(enriched.map((r) => r.source_deliverable_id).filter(Boolean)),
    ) as string[];
    const fileIds = Array.from(
      new Set(enriched.map((r) => r.source_file_id).filter(Boolean)),
    ) as string[];

    const [hearingLookup, sourceLookup, fileLookup] = await Promise.all([
      hearingIds.length > 0
        ? supabase.from('hearings').select('notion_id, name').in('notion_id', hearingIds)
        : Promise.resolve({ data: [] as { notion_id: string; name: string }[] }),
      sourceIds.length > 0
        ? supabase.from('deliverables').select('notion_id, name').in('notion_id', sourceIds)
        : Promise.resolve({ data: [] as { notion_id: string; name: string }[] }),
      fileIds.length > 0
        ? supabase.from('files').select('notion_id, name').in('notion_id', fileIds)
        : Promise.resolve({ data: [] as { notion_id: string; name: string }[] }),
    ]);

    const hearingMap = new Map((hearingLookup.data ?? []).map((h) => [h.notion_id, h.name]));
    const sourceMap = new Map((sourceLookup.data ?? []).map((d) => [d.notion_id, d.name]));
    const fileMap = new Map((fileLookup.data ?? []).map((f) => [f.notion_id, f.name]));

    enriched = enriched.map((r) => {
      let label: string | null = null;
      if (r.related_hearing_id && hearingMap.has(r.related_hearing_id)) {
        label = `Hearing · ${hearingMap.get(r.related_hearing_id)}`;
      } else if (r.source_deliverable_id && sourceMap.has(r.source_deliverable_id)) {
        label = `Filing · ${sourceMap.get(r.source_deliverable_id)}`;
      } else if (r.source_file_id && fileMap.has(r.source_file_id)) {
        label = `File · ${fileMap.get(r.source_file_id)}`;
      }
      return { ...r, related_parent_name: label };
    });
  }

  // Errands: enrich each row with zone_name (Destination) resolved from the
  // numeric zone_id FK. liaison_tasks has no zone_name column — the relation
  // picker reads this display name, and the write path (POST/PATCH) maps a
  // picked name back to zone_id.
  if (entity === 'liaison_tasks' && enriched.length > 0) {
    const zoneIds = Array.from(
      new Set(enriched.map((r) => r.zone_id).filter((z): z is number => z != null)),
    );
    const zoneMap = new Map<number, string>();
    if (zoneIds.length > 0) {
      const { data: zoneRows } = await supabase
        .from('transportation_zones')
        .select('id, name')
        .in('id', zoneIds);
      for (const z of zoneRows ?? []) zoneMap.set(z.id, z.name);
    }
    enriched = enriched.map((r) => ({
      ...r,
      zone_name: r.zone_id != null ? zoneMap.get(r.zone_id) ?? null : null,
    }));
  }

  return NextResponse.json({
    data: enriched,
    total: count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((count ?? 0) / pageSize),
  });
}

// ---------------------------------------------------------------------------
// PATCH  /api/admin/[entity]
// Update a single field on a row identified by notionId.
// Body: { notionId: string, field: string, value: unknown }
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  context: RouteContext,
) {
  const session = await assertAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { entity } = await context.params;
  const config = getEntityConfig(entity);
  if (!config) {
    return NextResponse.json({ error: `Unknown entity: ${entity}` }, { status: 400 });
  }
  // A global table (ph_holidays) is read by every firm on the instance, so a
  // demo visitor's edit would outlive the nightly reset and reach past the demo.
  if (!TENANT_TABLES.has(config.dbTable)) {
    const demoRefusal = await refuseInDemo(session.firmId, 'Editing shared reference data');
    if (demoRefusal) return demoRefusal;
  }

  const body = await req.json();
  const { notionId, field, value, confirmRename } = body as {
    notionId: string;
    field: string;
    value: unknown;
    confirmRename?: boolean;
  };

  if (!notionId || !field) {
    return NextResponse.json({ error: 'notionId and field are required' }, { status: 400 });
  }

  const fieldConfig = config.fields.find((f) => f.key === field || f.supabaseColumn === field);
  if (!fieldConfig) {
    return NextResponse.json({ error: `Unknown field: ${field}` }, { status: 400 });
  }
  if (!fieldConfig.editable) {
    return NextResponse.json({ error: `Field "${field}" is not editable` }, { status: 400 });
  }

  // Errands must be completed through POST /api/liaison-tasks/[id]/complete so
  // the transportation tariff posts to both ledgers (liaison reimbursement +
  // client billing). Flipping status here would silently skip that pipeline.
  if (entity === 'liaison_tasks' && fieldConfig.supabaseColumn === 'status' && value === 'completed') {
    return NextResponse.json(
      { error: 'Use the errand completion flow to mark an errand completed — it records the transportation charge.' },
      { status: 400 },
    );
  }

  // Coerce null / empty string to [] for NOT NULL array columns so admins
  // can clear the cell without hitting a 23502 "null value in column"
  // error. This is the root cause of the 500 on inline people-multi edits
  // (drafter_ids, reviewer_ids, attendee_ids, etc.) and on review_dates
  // clears.
  const NOT_NULL_ARRAY_COLUMNS = new Set<string>([
    'deliverables.drafter_ids',
    'deliverables.reviewer_ids',
    'deliverables.currently_with_ids',
    'deliverables.review_dates',
    'meetings.attendee_ids',
    'hearings.attendee_ids',
    'tasks.assignee_ids',
    'matters.team_person_ids',
    'matters.related_matter_ids',
    'files.acted_upon_by_ids',
    'files.persons_read_ids',
    'reimbursements.lawyer_ids',
    'dtr.with_ids',
    'dtr.with_names',
  ]);
  const columnKey = `${config.dbTable}.${fieldConfig.supabaseColumn}`;
  let coercedValue: unknown = value;
  if (
    NOT_NULL_ARRAY_COLUMNS.has(columnKey) &&
    (coercedValue === null || coercedValue === '' || coercedValue === undefined)
  ) {
    coercedValue = [];
  }
  // Trim string inputs so stray leading/trailing whitespace can't fragment lookups
  // (e.g. "Acme Builders Inc. " vs "Acme Builders Inc.").
  if (typeof coercedValue === 'string') {
    coercedValue = coercedValue.trim();
  }
  if (fieldConfig.type === 'datetime' && typeof coercedValue === 'string' && coercedValue) {
    coercedValue = toManilaInstant(coercedValue);
  }

  const supabase = await getSupabaseServerAuthClient();
  const updatePayload: Record<string, unknown> = { [fieldConfig.supabaseColumn]: coercedValue };

  // Fetch current matter row before update (needed for code derivation and client status)
  let oldMatterRow: { client_name: string; type: string; matter_code: string; status: string } | null = null;
  if (entity === 'matters' && (field === 'client_name' || field === 'type' || field === 'status')) {
    const { data } = await supabase
      .from('matters')
      .select('client_name, type, matter_code, status')
      .eq('notion_id', notionId)
      .single();
    oldMatterRow = data;
  }

  // Re-derive matter code when client or type changes
  if (entity === 'matters' && (field === 'client_name' || field === 'type')) {
    const currentRow = oldMatterRow;

    if (currentRow) {
      const newClientName = field === 'client_name' ? (value as string) : currentRow.client_name;
      const newType = field === 'type' ? (value as string) : currentRow.type;

      if (newClientName && newType) {
        if (field === 'client_name') {
          // Client changed — sequence recalculated for new client
          updatePayload.matter_code = await deriveMatterCodeForAdmin(session.firmId, newClientName, newType, notionId);
        } else {
          // Type changed — keep existing sequence, just swap the type code portion
          const nums = (currentRow.matter_code || '').match(/\d+/g);
          const existingSequence = nums && nums.length >= 3 ? nums[2] : '0';
          const { data: client } = await supabase
            .from('clients')
            .select('client_code')
            .eq('name', newClientName)
            .maybeSingle();
          const clientCode = client?.client_code || '0';
          const dbCodes = await fetchMatterTypeCodes(session.firmId);
          const typeCode = dbCodes[newType] ?? MATTER_TYPE_CODES[newType] ?? 0;
          updatePayload.matter_code = `${clientCode}-${typeCode}-${existingSequence}`;
        }
      }
    }
  }

  // Auto-resolve matter_id when matter_name is edited
  if (fieldConfig.supabaseColumn === 'matter_name' && value) {
    const entityColumns = new Set(config.fields.map((f) => f.supabaseColumn));
    if (entityColumns.has('matter_name')) {
      const { data: matterRow } = await supabase
        .from('matters')
        .select('notion_id, client_id, client_name')
        .eq('name', value as string)
        .limit(1)
        .single();
      if (matterRow) {
        const row = matterRow as unknown as { notion_id: string; client_id?: string; client_name?: string };
        updatePayload.matter_id = row.notion_id;
        // For errands, changing matter also resyncs client and clears any
        // prior deliverable link (since the deliverable belonged to the old matter).
        if (entity === 'liaison_tasks') {
          if (row.client_id) updatePayload.client_id = row.client_id;
          if (row.client_name) updatePayload.client_name = row.client_name;
          updatePayload.deliverable_id = null;
          updatePayload.deliverable_name = '';
        }
        // A mark's client is its own (several matters can cover one mark):
        // a new filing matter supplies it only to a mark that has none. The
        // database fills the name, code and index from the client, and the
        // matter_id write becomes the mark's filing link.
        if (entity === 'trademarks' && row.client_id) {
          const { data: mark } = await supabase.from('trademarks').select('client_id').eq('id', notionId).maybeSingle();
          if (!mark?.client_id) updatePayload.client_id = row.client_id;
        }
        // Deliverables denormalize client_name from the linked matter; resync it
        // so reassigning a deliverable to another client's matter doesn't leave
        // the old client showing on the detail page.
        if (entity === 'deliverables' && row.client_name) {
          updatePayload.client_name = row.client_name;
        }
      }
    }
  }

  // Auto-resolve client_id when client_name is edited (for matters, errands, trademarks)
  if (fieldConfig.supabaseColumn === 'client_name' && value
      && (entity === 'matters' || entity === 'liaison_tasks' || entity === 'trademarks')) {
    // No .limit(1): clients_name_unique_ci guarantees at most one match, and a
    // future duplicate should surface here rather than silently binding the row
    // to whichever client happens to sort first.
    const { data: clientRow } = await supabase
      .from('clients')
      .select('notion_id, client_code')
      .eq('name', value as string)
      .maybeSingle();
    if (clientRow) {
      // For a mark the database follows with the client's code and the next
      // index in its numbering (trg_trademarks_client_fields).
      updatePayload.client_id = clientRow.notion_id;
    }
  }

  // Errand-specific resolvers: deliverable name → id, liaison name → person_id.
  if (entity === 'liaison_tasks' && fieldConfig.supabaseColumn === 'deliverable_name') {
    if (!value) {
      updatePayload.deliverable_id = null;
      updatePayload.deliverable_name = '';
    } else {
      const { data: dRow } = await supabase
        .from('deliverables')
        .select('notion_id')
        .eq('name', value as string)
        .limit(1)
        .single();
      if (dRow) updatePayload.deliverable_id = dRow.notion_id;
    }
  }
  if (entity === 'liaison_tasks' && fieldConfig.supabaseColumn === 'assigned_to_name' && value) {
    const { data: person } = await supabase
      .from('team')
      .select('person_id, role')
      .eq('name', value as string)
      .eq('active', true)
      .in('role', [...LIAISON_ROLES])
      .limit(1)
      .single();
    if (!person) {
      return NextResponse.json(
        { error: 'Liaison must be an active liaison officer' },
        { status: 400 },
      );
    }
    updatePayload.assigned_to = person.person_id;
  }
  // Errand Destination edit: zone_name is synthetic — never write it; map the
  // picked name to the numeric zone_id (clear to NULL when the cell is emptied).
  if (entity === 'liaison_tasks' && fieldConfig.supabaseColumn === 'zone_name') {
    delete updatePayload.zone_name;
    if (!value) {
      updatePayload.zone_id = null;
    } else {
      const { data: zoneRow } = await supabase
        .from('transportation_zones')
        .select('id')
        .eq('name', value as string)
        .limit(1)
        .maybeSingle();
      updatePayload.zone_id = zoneRow?.id ?? null;
    }
  }

  // Auto-resolve parent_matter_id when parent_matter_name is edited.
  // Scoped to the current matter's client so name collisions across
  // clients don't pick the wrong row.
  if (fieldConfig.supabaseColumn === 'parent_matter_name' && entity === 'matters') {
    if (!value) {
      updatePayload.parent_matter_name = '';
      updatePayload.parent_matter_id = null;
    } else {
      const { data: currentRow } = await supabase
        .from('matters')
        .select('client_id')
        .eq('notion_id', notionId)
        .single();
      let query = supabase
        .from('matters')
        .select('notion_id')
        .eq('name', value as string)
        .neq('notion_id', notionId);
      if (currentRow?.client_id) query = query.eq('client_id', currentRow.client_id);
      const { data: parentRow } = await query.limit(1).maybeSingle();
      updatePayload.parent_matter_id = parentRow?.notion_id ?? null;
    }
  }

  // Most legacy tables use notion_id as PK; in-app tables (e.g. liaison_tasks)
  // declare a different column via primaryKeyColumn.
  const pkColumn = config.primaryKeyColumn ?? 'notion_id';
  const pkValue: string | number =
    pkColumn === 'id' && /^\d+$/.test(String(notionId)) ? Number(notionId) : notionId;

  // Capture previous attendee_ids before update so we can diff after for
  // meeting/hearing invite notifications.
  let previousAttendeeIds: string[] | null = null;
  if (
    (entity === 'meetings' || entity === 'hearings') &&
    fieldConfig.supabaseColumn === 'attendee_ids'
  ) {
    const { data: priorRow } = await supabase
      .from(config.dbTable)
      .select('attendee_ids')
      .eq(pkColumn, pkValue)
      .single();
    previousAttendeeIds = (priorRow?.attendee_ids ?? []) as string[];
  }

  // Capture the previous client name before the update so a rename can be
  // cascaded to every table that denormalizes client_name.
  let previousClientName: string | null = null;
  if (entity === 'clients' && fieldConfig.supabaseColumn === 'name') {
    const { data: priorRow } = await supabase
      .from(config.dbTable)
      .select('name')
      .eq(pkColumn, pkValue)
      .single();
    previousClientName = (priorRow?.name ?? null) as string | null;

    if (!confirmRename && typeof coercedValue === 'string') {
      const warning = await clientRenameWarning(getServiceDbForFirm(session.firmId), {
        clientId: String(notionId),
        from: previousClientName,
        to: coercedValue,
      });
      if (warning) return NextResponse.json({ error: warning, code: CLIENT_RENAME_CONFIRM }, { status: 409 });
    }
  }

  const { error } = await supabase
    .from(config.dbTable)
    .update(updatePayload)
    .eq(pkColumn, pkValue);

  if (error) {
    const duplicate = duplicateClientNameResponse(error);
    if (duplicate) return duplicate;
    console.error('[admin]', error.message);
    // Renaming a client into an existing (case/whitespace-insensitive) name or an
    // empty name trips the same DB guards as creation — surface them clearly.
    if (entity === 'clients' && fieldConfig.supabaseColumn === 'name') {
      if (error.code === '23505') {
        const attempted = typeof value === 'string' ? value.trim() : '';
        return NextResponse.json(
          { error: attempted ? `A client named "${attempted}" already exists.` : 'A client with that name already exists.' },
          { status: 409 },
        );
      }
      if (error.code === '23514' && error.message.includes('clients_name_nonempty')) {
        return NextResponse.json({ error: 'Client name is required.' }, { status: 400 });
      }
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Fire-and-forget attendee invite notifications when attendee_ids changes
  // on a meeting or hearing. The notifier filters out the performer and any
  // already-present attendees.
  if (
    previousAttendeeIds !== null &&
    Array.isArray(coercedValue) &&
    typeof notionId === 'string'
  ) {
    const newList = (coercedValue as unknown[]).filter(
      (v): v is string => typeof v === 'string',
    );
    const performer = session.user.notionUserId;
    if (entity === 'meetings') {
      notifyAttendeesAddedToMeeting({
        firmId: session.firmId,
        meetingId: notionId,
        newAttendeeIds: newList,
        previousAttendeeIds,
        performedBy: performer,
      }).catch((err) =>
        console.error('[admin] meeting attendee notify failed:', (err as Error).message),
      );
    } else if (entity === 'hearings') {
      notifyAttendeesAddedToHearing({
        firmId: session.firmId,
        hearingId: notionId,
        newAttendeeIds: newList,
        previousAttendeeIds,
        performedBy: performer,
      }).catch((err) =>
        console.error('[admin] hearing attendee notify failed:', (err as Error).message),
      );
    }
  }

  // Fire-and-forget audit log
  logAudit({
    firmId: session.firmId,
    entityType: entity,
    entityId: notionId,
    action: 'update',
    fieldChanged: field,
    oldValue: oldMatterRow
      ? String((oldMatterRow as Record<string, unknown>)[field] ?? '')
      : (previousClientName ?? undefined),
    newValue: String(value ?? ''),
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  // Cascade matter name changes to all dependent tables
  if (entity === 'matters' && fieldConfig.supabaseColumn === 'name') {
    const newName = value as string;
    const DEPENDENT_TABLES = ['deliverables', 'meetings', 'hearings', 'filings', 'tasks', 'files', 'reimbursements', 'invoices', 'generated_documents'] as const;
    Promise.all(
      DEPENDENT_TABLES.map((table) =>
        supabase.from(table).update({ matter_name: newName }).eq('matter_id', notionId)
      ),
    ).catch((err) => console.error('[admin] Matter name cascade failed:', err.message));
  }

  // Cascade client name changes to every table that denormalizes client_name
  // (matters, DTRs, invoices, the review bundles the finance Review groups by,
  // the deposit ledger, etc.). Runs on the service-role client so RLS can't
  // silently drop a finance-table update. Fire-and-forget.
  if (entity === 'clients' && fieldConfig.supabaseColumn === 'name' && previousClientName) {
    cascadeClientRename(getServiceDbForFirm(session.firmId), {
      clientId: String(notionId),
      oldName: previousClientName,
      newName: value as string,
    }).catch((err) => console.error('[admin] Client name cascade failed:', err.message));
  }

  // When a matter is reassigned to a different client, move its client_id to
  // match (it's the canonical FK). That fires the matters→clients status trigger,
  // which recomputes both the old and new client's derived status. Status-only
  // edits already fire the trigger directly, so no extra work is needed there.
  if (entity === 'matters' && oldMatterRow && field === 'client_name') {
    const newName = value as string;
    if (newName && newName !== oldMatterRow.client_name) {
      const { data: newClient } = await supabase
        .from('clients').select('notion_id').eq('name', newName).maybeSingle();
      if (newClient?.notion_id) {
        await supabase.from('matters').update({ client_id: newClient.notion_id }).eq('notion_id', notionId);
      }

      // Push the new client down to the matter's live work items, which
      // denormalize it. Without this they keep the old client forever — the
      // mirror of the deliverable/errand/trademark edit paths above, which
      // already resync client_name when a row's matter changes.
      //
      // Deliberately NOT cascaded: invoices, dtr, dtr_revisions, reimbursements
      // and generated_documents. Those are historical records of who was billed
      // or what was produced; rewriting them would retroactively reassign
      // finished financial work to a different client. A client *rename* (same
      // client, new spelling) does cascade there — that's cascadeClientRename.
      // A mark follows only when it carried this matter's old client — a mark
      // owns its client, and one filed for someone else stays theirs.
      Promise.all([
        supabase.from('deliverables').update({ client_name: newName }).eq('matter_id', notionId),
        ...(newClient?.notion_id
          ? [
              supabase
                .from('liaison_tasks')
                .update({ client_name: newName, client_id: newClient.notion_id })
                .eq('matter_id', notionId),
              supabase
                .from('trademarks')
                .update({ client_id: newClient.notion_id })
                .eq('matter_id', notionId)
                .eq('client_name', oldMatterRow.client_name),
            ]
          : []),
      ]).catch((err) => console.error('[admin] Matter client cascade failed:', err.message));
    }
  }

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// POST  /api/admin/[entity]
// Create a new row. Body: partial row object with field keys.
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  context: RouteContext,
) {
  const session = await assertAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { entity } = await context.params;
  const config = getEntityConfig(entity);
  if (!config) {
    return NextResponse.json({ error: `Unknown entity: ${entity}` }, { status: 400 });
  }
  // A global table (ph_holidays) is read by every firm on the instance, so a
  // demo visitor's edit would outlive the nightly reset and reach past the demo.
  if (!TENANT_TABLES.has(config.dbTable)) {
    const demoRefusal = await refuseInDemo(session.firmId, 'Editing shared reference data');
    if (demoRefusal) return demoRefusal;
  }

  const body = await req.json();

  // Accept both { row: {...} } and flat body for backwards compat
  const inputRow = body.row ?? body;
  // The picked records behind relation names (field key → id); names repeat.
  const relationIds: unknown = body.row ? body.relationIds : undefined;

  // Validate required fields
  for (const f of config.fields) {
    if (f.required && !inputRow[f.key]) {
      return NextResponse.json(
        { error: `Missing required field: ${f.label}` },
        { status: 400 },
      );
    }
  }

  // Map field keys to supabase columns. Tables with SERIAL primary keys
  // (declared via primaryKeyColumn !== 'notion_id') don't accept a synthesized
  // notion_id — the DB generates the id automatically.
  const usesNotionIdPk = (config.primaryKeyColumn ?? 'notion_id') === 'notion_id';
  const row: Record<string, unknown> = usesNotionIdPk
    ? { notion_id: mintId(entity) }
    : {};
  // firm_id is stamped explicitly: this handler writes through the authed
  // client, which (unlike getServiceDbForFirm) does not inject it, and the
  // column's transitional default is gone. Asked of the registry rather than
  // stamped unconditionally, because one admin entity (ph_holidays) is a
  // global table with no firm_id column — stamping it there trades a 23502 on
  // every other entity for a 42703 on that one.
  if (TENANT_TABLES.has(config.dbTable)) row.firm_id = session.firmId;
  for (const f of config.fields) {
    let val = inputRow[f.key];
    // Trim string inputs so a trailing space can't fragment downstream lookups.
    if (typeof val === 'string') val = val.trim();
    // Apply default values for fields not provided
    if ((val === undefined || val === '') && f.defaultValue) {
      row[f.supabaseColumn] = f.defaultValue;
      continue;
    }
    if (val !== undefined && val !== '' && !f.autoGenerated) {
      // Skip empty arrays
      if (Array.isArray(val) && val.length === 0) continue;
      row[f.supabaseColumn] = f.type === 'datetime' && typeof val === 'string' ? toManilaInstant(val) : val;
    }
  }

  // Auto-generate client code
  if (entity === 'clients') {
    row.client_code = await nextClientCode(session.firmId);
  }

  // Auto-derive matter code
  if (entity === 'matters' && row.client_name && row.type) {
    row.matter_code = await deriveMatterCodeForAdmin(
      session.firmId,
      row.client_name as string,
      row.type as string,
    );
  }

  const supabase = await getSupabaseServerAuthClient();

  // Auto-resolve relation IDs from display names
  // Build a set of columns this entity's table actually has (from field config + known DB-only columns)
  const entityColumns = new Set(config.fields.map((f) => f.supabaseColumn));
  // Tables with matter_name always have matter_id in the DB even if not in field config
  if (entityColumns.has('matter_name')) entityColumns.add('matter_id');
  // Tables that store client_name + client_id (matters, tasks with client refs)
  // Only matters and deliverables-like tables have client columns; matters has client_id, deliverables does not
  if (entity === 'matters') entityColumns.add('client_id');
  // Liaison_tasks also stores client_id and deliverable_id alongside its name columns.
  if (entity === 'liaison_tasks') {
    entityColumns.add('client_id');
    entityColumns.add('deliverable_id');
    entityColumns.add('assigned_to');
    entityColumns.add('assigned_by');
    entityColumns.add('assigned_by_name');
  }
  // Trademarks store denormalized client_id, client_name, client_code, plus
  // a per-client client_index that the server assigns.
  if (entity === 'trademarks') {
    entityColumns.add('client_id');
    entityColumns.add('client_code');
    entityColumns.add('client_index');
  }

  // matter_name → matter_id: by the picked id when the form sent one, since
  // two matters can share a name and a lookup by name would pick either.
  if (row.matter_name && !row.matter_id) {
    const pickedMatterId = relationIdFor(relationIds, 'matter_name');
    const lookup = supabase.from('matters').select('notion_id, name, client_name, client_id');
    const { data: matterRow } = await (pickedMatterId
      ? lookup.eq('notion_id', pickedMatterId)
      : lookup.eq('name', row.matter_name as string)
    )
      .limit(1)
      .single();
    if (matterRow) {
      row.matter_id = matterRow.notion_id;
      row.matter_name = matterRow.name;
      // Only set client_name / client_id if this table actually has those columns
      if (!row.client_name && matterRow.client_name && entityColumns.has('client_name')) row.client_name = matterRow.client_name;
      if (!row.client_id && matterRow.client_id && entityColumns.has('client_id')) row.client_id = matterRow.client_id;
    }
  }

  // client_name → client_id (only for entities whose table has client_id)
  if (row.client_name && !row.client_id && entityColumns.has('client_id')) {
    const { data: clientRow } = await supabase
      .from('clients')
      .select('notion_id')
      .eq('name', row.client_name)
      .limit(1)
      .single();
    if (clientRow) {
      row.client_id = clientRow.notion_id;
    }
  }

  // Trademark-specific: also denormalize client_code from clients (used by
  // the computed Ref. No.). client_index is filled in below in a retry loop.
  if (entity === 'trademarks' && row.client_id && row.client_code == null) {
    const { data: client } = await supabase
      .from('clients').select('client_code').eq('notion_id', row.client_id).single();
    if (client?.client_code != null) row.client_code = client.client_code;
  }

  // Errand-specific resolvers
  if (entity === 'liaison_tasks') {
    // Can't create an errand already 'completed' — completion must run through
    // POST /api/liaison-tasks/[id]/complete so the transportation tariff posts
    // to both ledgers (liaison reimbursement + client billing).
    if (row.status === 'completed') {
      return NextResponse.json(
        { error: 'Use the errand completion flow to mark an errand completed — it records the transportation charge.' },
        { status: 400 },
      );
    }
    // deliverable_name → deliverable_id
    if (row.deliverable_name && !row.deliverable_id) {
      const pickedDeliverableId = relationIdFor(relationIds, 'deliverable_name');
      const lookup = supabase.from('deliverables').select('notion_id');
      const { data: dRow } = await (pickedDeliverableId
        ? lookup.eq('notion_id', pickedDeliverableId)
        : lookup.eq('name', row.deliverable_name as string)
      )
        .limit(1)
        .single();
      if (dRow) row.deliverable_id = dRow.notion_id;
    }
    // assigned_to_name → assigned_to (must be an active liaison)
    if (row.assigned_to_name && !row.assigned_to) {
      const { data: person } = await supabase
        .from('team')
        .select('person_id, role')
        .eq('name', row.assigned_to_name as string)
        .eq('active', true)
        .in('role', [...LIAISON_ROLES])
        .limit(1)
        .single();
      if (!person) {
        return NextResponse.json(
          { error: 'Liaison must be an active liaison officer' },
          { status: 400 },
        );
      }
      row.assigned_to = person.person_id;
    }
    // zone_name (Destination) → zone_id. zone_name is synthetic (no column),
    // so strip it before the insert regardless of whether it resolved.
    if (row.zone_name) {
      const { data: zoneRow } = await supabase
        .from('transportation_zones')
        .select('id')
        .eq('name', row.zone_name as string)
        .limit(1)
        .maybeSingle();
      if (zoneRow) row.zone_id = zoneRow.id;
    }
    delete row.zone_name;
    // Stamp who created the errand
    row.assigned_by = session.user.notionUserId;
    row.assigned_by_name = session.user.name ?? '';
  }

  // Set created_time for new rows — but only for tables that have it
  // (legacy Notion-synced tables). In-app tables use created_at via DEFAULT.
  if (!row.created_time && usesNotionIdPk) {
    row.created_time = new Date().toISOString();
  }

  // Trademarks: assign client_index in a retry loop. The (client_id,
  // client_index) unique constraint guards against concurrent inserts
  // racing for the same number — on a 23505 collision, refetch and retry.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any = null;
  let error: { code?: string; message: string } | null = null;
  if (entity === 'trademarks' && row.client_id) {
    async function nextClientIndex(): Promise<number> {
      const { data: max } = await supabase
        .from('trademarks')
        .select('client_index')
        .eq('client_id', row.client_id as string)
        .order('client_index', { ascending: false })
        .limit(1);
      return ((max?.[0]?.client_index as number | undefined) ?? 0) + 1;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      row.client_index = await nextClientIndex();
      const res = await supabase.from(config.dbTable).insert(row).select().single();
      if (!res.error && res.data) { data = res.data; error = null; break; }
      error = res.error ?? null;
      if (res.error?.code !== '23505') break;
    }
  } else {
    const res = await supabase.from(config.dbTable).insert(row).select().single();
    data = res.data;
    error = res.error;
  }

  if (error) {
    const duplicate = duplicateClientNameResponse(error);
    if (duplicate) return duplicate;
    console.error('[admin]', error.message);
    // Surface the two client-name constraints as actionable messages rather than
    // a generic 500. Both are enforced at the DB (clients_name_unique_ci on
    // lower(normalize_client_name(name)), and the clients_name_nonempty CHECK).
    if (entity === 'clients') {
      if (error.code === '23505') {
        const attempted = typeof row.name === 'string' ? row.name.trim() : '';
        return NextResponse.json(
          { error: attempted ? `A client named "${attempted}" already exists.` : 'A client with that name already exists.' },
          { status: 409 },
        );
      }
      if (error.code === '23514' && error.message.includes('clients_name_nonempty')) {
        return NextResponse.json({ error: 'Client name is required.' }, { status: 400 });
      }
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Auto-create party record for the linked client when creating a matter
  if (entity === 'matters' && data?.notion_id && data?.client_name) {
    supabase
      .from('parties')
      .insert({
        firm_id: session.firmId,
        matter_id: data.notion_id,
        party_name: data.client_name,
        party_role: 'client',
        entity_type: 'organization',
        source: 'client_auto',
        source_ref: data.client_id || null,
      })
      .then(({ error: partyErr }) => {
        if (partyErr) console.error('[admin] Auto-create party failed:', partyErr.message);
      });
  }

  // Auto-create intake record when creating a prospective client.
  // Awaited (not fire-and-forget) so callers that POST to /api/intakes right
  // after — e.g. the New Prospect modal — find this row instead of racing
  // and inserting a duplicate.
  if (entity === 'clients' && data?.notion_id && (data?.status === 'Prospective' || !data?.status)) {
    // Run an initial conflict check so the intake card always shows the
    // shield indicator (green when clean, amber when there's a hit).
    // Exclude the client we just created so it doesn't self-match.
    const names = [data.name];
    if (data.full_company_name) names.push(data.full_company_name);
    let conflict_check_result = null;
    try {
      conflict_check_result = await checkConflicts({
        names,
        tin: data.tin || undefined,
        excludeClientName: data.name,
      }, session.firmId);
    } catch (e) {
      console.error('[admin] Auto-intake conflict check failed:', (e as Error).message);
    }
    const { error: intakeErr } = await supabase
      .from('client_intakes')
      .insert({
        firm_id: session.firmId,
        client_id: data.notion_id,
        stage: 'Lead',
        source: 'other',
        conflict_check_result,
        created_by: session.user.notionUserId,
      });
    if (intakeErr) console.error('[admin] Auto-create intake failed:', intakeErr.message);
  }

  // Fire-and-forget audit log
  logAudit({
    firmId: session.firmId,
    entityType: entity,
    entityId: data?.notion_id,
    action: 'create',
    entityName: data?.name ?? data?.remarks ?? undefined,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  // Fire-and-forget attendee invite notifications when a meeting / hearing is
  // created with attendees via the admin editor.
  if (data?.notion_id && Array.isArray(data.attendee_ids) && data.attendee_ids.length > 0) {
    const newList = (data.attendee_ids as unknown[]).filter(
      (v): v is string => typeof v === 'string',
    );
    const performer = session.user.notionUserId;
    if (entity === 'meetings') {
      notifyAttendeesAddedToMeeting({
        firmId: session.firmId,
        meetingId: data.notion_id,
        newAttendeeIds: newList,
        previousAttendeeIds: [],
        performedBy: performer,
      }).catch((err) =>
        console.error('[admin] meeting attendee notify failed:', (err as Error).message),
      );
    } else if (entity === 'hearings') {
      notifyAttendeesAddedToHearing({
        firmId: session.firmId,
        hearingId: data.notion_id,
        newAttendeeIds: newList,
        previousAttendeeIds: [],
        performedBy: performer,
      }).catch((err) =>
        console.error('[admin] hearing attendee notify failed:', (err as Error).message),
      );
    }
  }

  return NextResponse.json({ data });
}

// ---------------------------------------------------------------------------
// DELETE  /api/admin/[entity]
// Delete a row by notionId. Body: { notionId: string }
// ---------------------------------------------------------------------------
export async function DELETE(
  req: NextRequest,
  context: RouteContext,
) {
  const session = await assertAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { entity } = await context.params;
  const config = getEntityConfig(entity);
  if (!config) {
    return NextResponse.json({ error: `Unknown entity: ${entity}` }, { status: 400 });
  }
  // A global table (ph_holidays) is read by every firm on the instance, so a
  // demo visitor's edit would outlive the nightly reset and reach past the demo.
  if (!TENANT_TABLES.has(config.dbTable)) {
    const demoRefusal = await refuseInDemo(session.firmId, 'Editing shared reference data');
    if (demoRefusal) return demoRefusal;
  }

  const body = await req.json();
  const { notionId } = body as { notionId: string };

  if (!notionId) {
    return NextResponse.json({ error: 'notionId is required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const pkColumn = config.primaryKeyColumn ?? 'notion_id';
  const pkValue: string | number =
    pkColumn === 'id' && /^\d+$/.test(String(notionId)) ? Number(notionId) : notionId;
  const { error } = await supabase
    .from(config.dbTable)
    .delete()
    .eq(pkColumn, pkValue);

  if (error) {
    console.error('[admin]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // TODO: Archive in Notion (fire-and-forget) — skipped for now.

  // Fire-and-forget audit log
  logAudit({
    firmId: session.firmId,
    entityType: entity,
    entityId: notionId,
    action: 'delete',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true });
}
