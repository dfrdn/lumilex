import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { ALLOWLIST, isEntity, type Entity, type FilterOp } from '@/lib/reports/allowlist';
import { manilaDayEnd, manilaDayStart, manilaToday } from '@/lib/dates';

const MAX_ROWS = 10_000;

// Scalars Postgrest can compare against. Arrays are only valid for `in`,
// validated per-clause below. z.unknown() previously let nulls/objects/nested
// arrays flow straight into PostgREST and surface raw 500s.
const ScalarValue = z.union([z.string(), z.number(), z.boolean()]);

const FilterClauseSchema = z.object({
  col: z.string(),
  op: z.enum(['eq', 'in', 'gte', 'lte']),
  value: z.union([ScalarValue, z.array(ScalarValue).max(200)]),
});

// Bare snake_case identifiers only. Defends the .select()/.from() boundary
// against any future allowlist entry that sneaks in a PostgREST alias (`a:b`),
// embed (`a(b)`), or comma — the allowlist contents can't subvert the query.
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

const BodySchema = z.object({
  entity: z.string(),
  filters: z.array(FilterClauseSchema).default([]),
  columns: z.array(z.string()).min(1),
  group_by: z.string().nullable().optional(),
  format: z.enum(['json', 'xlsx']).default('json'),
  limit: z.number().int().positive().max(MAX_ROWS).optional(),
});

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * POST /api/reports/run
 *
 * Executes a custom report against a single entity. RLS-gated via the
 * authed client. Columns + filter ops + group-by are exact-matched
 * against lib/reports/allowlist.ts; any unknown input → 400.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  if (!['partner', 'admin', 'super_user', 'finance'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: 'Invalid request', details: (err as Error).message }, { status: 400 });
  }

  if (!isEntity(body.entity)) {
    return NextResponse.json({ error: `Unknown entity: ${body.entity}` }, { status: 400 });
  }
  const entity: Entity = body.entity;
  const spec = ALLOWLIST[entity];

  // Column allowlist (exact match) + identifier shape (defense in depth).
  for (const col of body.columns) {
    if (!spec.selectableColumns.has(col) || !SAFE_IDENTIFIER.test(col)) {
      return NextResponse.json({ error: `Column not allowed for ${entity}: ${col}` }, { status: 400 });
    }
  }

  // Filter allowlist (col + op + value shape).
  for (const f of body.filters) {
    const ops = spec.filterableColumns[f.col];
    if (!ops || !SAFE_IDENTIFIER.test(f.col)) {
      return NextResponse.json({ error: `Filter not allowed for ${entity}: ${f.col}` }, { status: 400 });
    }
    if (!ops.includes(f.op as FilterOp)) {
      return NextResponse.json({ error: `Operator ${f.op} not allowed on ${f.col}` }, { status: 400 });
    }
    if (f.op === 'in') {
      if (!Array.isArray(f.value) || f.value.length === 0) {
        return NextResponse.json({ error: `'in' on ${f.col} requires a non-empty array` }, { status: 400 });
      }
    } else if (Array.isArray(f.value)) {
      return NextResponse.json({ error: `'${f.op}' on ${f.col} requires a scalar value` }, { status: 400 });
    }
  }

  // group_by allowlist.
  if (body.group_by && (!spec.groupByColumns.has(body.group_by) || !SAFE_IDENTIFIER.test(body.group_by))) {
    return NextResponse.json({ error: `Group-by not allowed on ${body.group_by}` }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const selectCols = body.columns.join(',');
  let q = supabase.from(entity).select(selectCols);

  for (const f of body.filters) {
    // Shape already validated above: 'in' → non-empty scalar array, others → scalar.
    switch (f.op) {
      case 'eq':
        q = q.eq(f.col, f.value as string | number | boolean);
        break;
      case 'in':
        q = q.in(f.col, f.value as (string | number)[]);
        break;
      // A bare day bounds the whole Manila day. Against a timestamptz it would
      // mean midnight UTC; a date column reads the widened bound as the same day.
      case 'gte':
        q = q.gte(f.col, isDay(f.value) ? manilaDayStart(f.value) : (f.value as string | number));
        break;
      case 'lte':
        q = q.lte(f.col, isDay(f.value) ? manilaDayEnd(f.value) : (f.value as string | number));
        break;
    }
  }

  const limit = body.limit ?? MAX_ROWS;
  q = q.limit(limit);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as Record<string, unknown>[];

  // ── Group-by aggregation (counts only at MVP; sum/avg added later) ──
  let aggregated: { group: string; count: number }[] | null = null;
  if (body.group_by) {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = String(r[body.group_by] ?? '');
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    aggregated = [...map.entries()]
      .map(([group, count]) => ({ group, count }))
      .sort((a, b) => b.count - a.count);
  }

  if (body.format === 'xlsx') {
    return xlsxResponse(entity, body.columns, rows, aggregated);
  }

  return NextResponse.json({
    entity,
    columns: body.columns,
    rowCount: rows.length,
    cappedAt: rows.length === limit ? limit : null,
    rows,
    aggregated,
  });
}

async function xlsxResponse(
  entity: Entity,
  columns: string[],
  rows: Record<string, unknown>[],
  aggregated: { group: string; count: number }[] | null,
): Promise<Response> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(entity);
  const spec = ALLOWLIST[entity];
  ws.columns = columns.map((c) => ({
    header: spec.labels[c] ?? c,
    key: c,
    width: 18,
  }));
  for (const r of rows) {
    ws.addRow(columns.reduce<Record<string, unknown>>((acc, c) => {
      acc[c] = r[c] ?? '';
      return acc;
    }, {}));
  }
  ws.getRow(1).font = { bold: true };

  if (aggregated && aggregated.length > 0) {
    const ws2 = wb.addWorksheet('Group totals');
    ws2.columns = [
      { header: 'Group', key: 'group', width: 30 },
      { header: 'Count', key: 'count', width: 12 },
    ];
    for (const a of aggregated) ws2.addRow(a);
    ws2.getRow(1).font = { bold: true };
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="report-${entity}-${manilaToday()}.xlsx"`,
    },
  });
}
