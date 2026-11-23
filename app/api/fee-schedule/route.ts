import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { recordRevision } from '@/lib/content-revisions';
import { canEditFeeSchedules } from '@/lib/fee-schedule/access';
import { feeScheduleSaveSchema } from '@/lib/fee-schedule/schema';
import { findFeeSchedules, type LoadedFeeSchedule } from '@/lib/fee-schedule/load';
import { SEED_FEE_SCHEDULES } from '@/lib/provisioning/seed-pack/fee-schedules';

/**
 * The starter skeletons a firm with no saved schedules edits from: the four
 * slugs, their page structure, and not one figure — the same rows
 * scripts/provision-firm.ts writes, so editing here and provisioning produce
 * the same document.
 *
 * This is the CMS surface only. Nothing that *quotes* a schedule reads it:
 * `loadFeeSchedules` throws for a firm with no rows rather than handing a
 * proposal something the firm never published.
 */
function starterSchedules(): LoadedFeeSchedule[] {
  return SEED_FEE_SCHEDULES.map((seed) => ({
    id: null,
    slug: seed.slug,
    name: seed.name,
    content: seed.content,
    isActive: seed.is_active,
    sortOrder: seed.sort_order,
    isTemplate: true,
  }));
}

/**
 * Anyone on the team may read the rate card — the proposal builder runs as the
 * partner drafting it. Editing stays with the roles that own firm-wide
 * published documents.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const saved = await findFeeSchedules(session.firmId);
  const schedules = saved.length > 0 ? saved : starterSchedules();

  const slug = req.nextUrl.searchParams.get('slug');
  if (slug) {
    const schedule = schedules.find((s) => s.slug === slug);
    if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ schedule });
  }

  return NextResponse.json({ schedules });
}

/** Upsert a schedule by its slug (insert on first save, update thereafter). */
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!canEditFeeSchedules(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const validation = await validateBody(req, feeScheduleSaveSchema);
  if (!validation.success) return validation.response;
  const { content, name, isActive, sortOrder } = validation.data;

  const supabase = getServiceDbForFirm(session.firmId);

  // A save has always overwritten with no version kept. Read what is there so
  // it can be snapshotted once the write lands.
  const { data: previous } = await supabase
    .from('fee_schedules').select('*').eq('slug', content.slug).maybeSingle();

  const { data, error } = await supabase
    .from('fee_schedules')
    .upsert(
      {
        slug: content.slug,
        name: name ?? content.name,
        content,
        ...(isActive === undefined ? {} : { is_active: isActive }),
        ...(sortOrder === undefined ? {} : { sort_order: sortOrder }),
        created_by: session.user.notionUserId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'firm_id,slug' },
    )
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (previous) {
    await recordRevision({
      firmId: session.firmId,
      entityType: 'fee_schedule',
      entityId: content.slug,
      before: previous,
      after: data,
      editedBy: session.user.notionUserId,
    });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'FeeSchedule',
    entityId: content.slug,
    action: 'updated',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ schedule: data });
}
