import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { rowToCorporation, rowToCorporationPerson, rowToShareClass, rowToAffiliation } from '@/lib/corporation-row';
import { fillSecGis } from '@/lib/xlsx/sec-gis';
import { logAudit, getClientIP } from '@/lib/audit';
import { CORPORATION_SELECT } from '@/lib/corporations/matter-links';

/**
 * GET /api/corporation/[id]/gis?year=YYYY
 *
 * Returns SEC's General Information Sheet (Stock) filled from the registry.
 * The response carries an X-Gis-Unfilled header listing what the registry
 * couldn't supply, so the caller can tell the user what still needs typing
 * rather than implying a complete form.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const url = new URL(req.url);
  const yearParam = Number(url.searchParams.get('year'));
  const year = Number.isInteger(yearParam) && yearParam > 1900 ? yearParam : new Date().getFullYear();

  const supabase = await getSupabaseServerAuthClient();
  const { data: row } = await supabase.from('corporations').select(CORPORATION_SELECT).eq('id', id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const corporation = rowToCorporation(row as Record<string, unknown>);
  if (corporation.companyType && corporation.companyType !== 'Stock') {
    return NextResponse.json(
      { error: `This is the stock-corporation GIS; ${corporation.approvedName ?? 'this entity'} is a ${corporation.companyType}.` },
      { status: 422 },
    );
  }

  const { data: peopleRows } = await supabase
    .from('corporation_persons')
    .select('*')
    .eq('corporation_id', id)
    .order('sort_order', { ascending: true });
  const people = (peopleRows ?? []).map((p) => rowToCorporationPerson(p as Record<string, unknown>));

  const [{ data: classRows }, { data: affilRows }] = await Promise.all([
    supabase.from('corporation_share_classes').select('*').eq('corporation_id', id).order('sort_order'),
    supabase.from('corporation_affiliations').select('*').eq('corporation_id', id).order('sort_order'),
  ]);

  // The GIS asks for the annual meeting actually held in the covered year.
  const { data: meeting } = await supabase
    .from('corporation_meetings')
    .select('meeting_date')
    .eq('corporation_id', id)
    .eq('meeting_type', 'Annual Stockholders')
    .gte('meeting_date', `${year}-01-01`)
    .lte('meeting_date', `${year}-12-31`)
    .order('meeting_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { buffer, unfilled, counts } = await fillSecGis({
    corporation,
    people,
    shareClasses: (classRows ?? []).map((r) => rowToShareClass(r as Record<string, unknown>)),
    affiliations: (affilRows ?? []).map((r) => rowToAffiliation(r as Record<string, unknown>)),
    year,
    actualMeetingDate: (meeting?.meeting_date as string) ?? null,
  });

  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    entityName: corporation.approvedName ?? undefined,
    action: 'gis_generated',
    fieldChanged: String(year),
    newValue: `${counts.directorsOfficers} directors/officers, ${counts.stockholders} stockholders`,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  const safeName = (corporation.approvedName ?? 'Corporation').replace(/[^a-zA-Z0-9 ._-]/g, '_');
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="GIS ${year} - ${safeName}.xlsx"`,
      // Header values must be latin-1 safe; the labels are ASCII by construction.
      'X-Gis-Unfilled': JSON.stringify(unfilled),
      'X-Gis-Counts': JSON.stringify(counts),
    },
  });
}
