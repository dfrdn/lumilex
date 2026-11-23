import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { feeScheduleContentSchema } from '@/lib/fee-schedule/schema';
import { generateFeeSchedulePdf } from '@/lib/pdf/fee-schedule';
import { loadFirmBrand } from '@/lib/pdf/firm-brand';
import type { Brand } from '@/lib/pdf/brand';
import { loadFeeSchedule, FeeSchedulesNotConfigured } from '@/lib/fee-schedule/load';
import type { FeeScheduleContent } from '@/lib/fee-schedule/types';

// Table-heavy schedules run to several pages; match the other PDF exports.
export const maxDuration = 60;

function filename(brand: Brand, content: FeeScheduleContent): string {
  // Collapse anything non-alphanumeric so a stray quote can't break out of
  // the quoted Content-Disposition filename.
  const base = `${brand.documentName} ${content.name} ${content.year}`.trim();
  return base.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') + '.pdf';
}

async function respondWithPdf(firmId: string, content: FeeScheduleContent): Promise<NextResponse> {
  const brand = await loadFirmBrand(firmId);
  const buf = await generateFeeSchedulePdf(brand, content);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename(brand, content)}"`,
      'Content-Length': String(buf.length),
      'Cache-Control': 'no-store',
    },
  });
}

/** Export a saved schedule by slug. */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const slug = req.nextUrl.searchParams.get('slug') ?? 'professional';
  let schedule;
  try {
    schedule = await loadFeeSchedule(session.firmId, slug);
  } catch (e) {
    // An unpublished starter skeleton is editable and previewable (POST), but
    // there is nothing to export until the firm saves it.
    if (e instanceof FeeSchedulesNotConfigured) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return respondWithPdf(session.firmId, schedule.content);
}

/** Export the editor's current (possibly unsaved) content. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validation = await validateBody(req, feeScheduleContentSchema);
  if (!validation.success) return validation.response;

  logAudit({
    firmId: session.firmId,
    entityType: 'FeeSchedule',
    entityId: validation.data.slug,
    action: 'exported',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return respondWithPdf(session.firmId, validation.data);
}
