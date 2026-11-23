import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { TRADEMARK_SELECT, rowToTrademark } from '@/lib/trademark-row';
import { owedDues, type DeadlineKind } from '@/lib/trademark-deadlines';
import type { Trademark } from '@/types/notion';

const ALLOWED_ROLES = new Set(['admin', 'lawyer', 'partner', 'super_user']);

interface DeadlineRequest {
  trademarkId: string;
  kind: DeadlineKind;
  due: string;
}

interface RequestBody {
  deadlines: DeadlineRequest[];
  notes?: string;
}

/**
 * POST /api/trademark/mark-reported
 * Record that a deadline was reported to the client out-of-band (no email
 * sent from the system). Inserts an audit row with subject `(manual)` so
 * the deadline shows as reported in the dashboard.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role ?? 'lawyer';
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as RequestBody | null;
  if (!body?.deadlines?.length) {
    return NextResponse.json({ error: 'deadlines required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const tmIds = [...new Set(body.deadlines.map((d) => d.trademarkId))];
  const { data: tmRows, error: tmErr } = await supabase
    .from('trademarks').select(TRADEMARK_SELECT).in('id', tmIds);
  if (tmErr) return NextResponse.json({ error: tmErr.message }, { status: 500 });

  const trademarksById = new Map<string, Trademark>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tmRows ?? []).map((r: any) => [r.id, rowToTrademark(r)]),
  );

  for (const d of body.deadlines) {
    const t = trademarksById.get(d.trademarkId);
    if (!t) {
      return NextResponse.json({ error: `Trademark ${d.trademarkId} not found` }, { status: 404 });
    }
    if (!owedDues(t, d.kind).includes(d.due)) {
      return NextResponse.json(
        { error: `Deadline ${d.kind} on "${t.mark}" no longer matches — refresh the page.` },
        { status: 409 },
      );
    }
  }

  const auditRows = body.deadlines.map((d) => ({
    firm_id: session.firmId,
    trademark_id: d.trademarkId,
    deadline_kind: d.kind,
    deadline_due: d.due,
    sent_by: session.user.notionUserId!,
    recipient_email: '',
    cc_emails: [],
    subject: '(manual)',
    body_html: '',
    notes: body.notes ?? null,
  }));

  const { data: inserted, error } = await supabase
    .from('trademark_client_reports')
    .insert(auditRows)
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    reportIds: (inserted ?? []).map((r: { id: number }) => r.id),
  });
}
