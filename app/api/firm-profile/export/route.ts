import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { firmProfileContentSchema } from '@/lib/firm-profile/schema';
import { generateFirmProfilePdf } from '@/lib/pdf/firm-profile';
import { loadFirmBrand } from '@/lib/pdf/firm-brand';
import type { Brand } from '@/lib/pdf/brand';
import type { FirmProfileContent, FirmProfileRow } from '@/lib/firm-profile/types';

// PDF generation prefetches remote headshots then renders multiple pages;
// give it the same headroom as the other PDF export routes.
export const maxDuration = 60;

const ADMIN_ROLES = new Set(['admin', 'super_user', 'finance']);

function filename(brand: Brand, content: FirmProfileContent): string {
  const yr = content.cover.year || '';
  // Collapse anything non-alphanumeric so a stray quote can't break out of
  // the quoted Content-Disposition filename.
  return `${brand.documentName} Firm Profile ${yr}`.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') + '.pdf';
}

async function respondWithPdf(firmId: string, content: FirmProfileContent): Promise<NextResponse> {
  const brand = await loadFirmBrand(firmId);
  const buf = await generateFirmProfilePdf(brand, content);
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

// Export the editor's current (possibly unsaved) content as a PDF.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId || !ADMIN_ROLES.has(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const validation = await validateBody(req, firmProfileContentSchema);
  if (!validation.success) return validation.response;

  logAudit({
    firmId: session.firmId,
    entityType: 'FirmProfile',
    entityId: 'export',
    action: 'exported',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return respondWithPdf(session.firmId, validation.data);
}

// Export the saved default profile. There is no in-code template to fall back
// on: exporting one firm's seed profile under another firm's name is the exact
// failure this refuses.
export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId || !ADMIN_ROLES.has(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const { data } = await supabase
    .from('firm_profiles')
    .select('*')
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<FirmProfileRow>();

  if (!data?.content) {
    return NextResponse.json(
      { error: 'No firm profile saved yet — create one under Admin → Firm profile first.' },
      { status: 409 },
    );
  }
  return respondWithPdf(session.firmId, data.content);
}
