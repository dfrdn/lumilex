import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

function sanitize(name: string) {
  return name
    .replace(/[\[\](){}]/g, '')
    .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * POST /api/finance/matter-billing/engagement
 * Two-phase signed-URL upload for the signed engagement agreement PDF.
 *
 * Phase 1 — signed upload URL:
 *   Body JSON: { matterId: string, fileName: string, fileType: string }
 *   Returns: { storagePath, signedUrl, token }
 *
 * Phase 2 — confirm after client uploads directly to Supabase Storage:
 *   Body JSON: { confirm: true, matterId: string, storagePath: string, fileName: string }
 *   Returns: { ok: true, path, fileName }
 *
 * This bypasses Vercel's 4.5MB serverless body limit so large PDFs upload
 * reliably, and surfaces real errors at each phase (the previous
 * single-phase multipart route would fail silently in production on
 * oversized files).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  const allowed = ['admin', 'super_user', 'partner', 'finance'].includes(role);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await req.json();
    const supabase = getServiceDbForFirm(session.firmId);

    // Phase 2: confirm upload — write the storage path back onto the billing config
    if (body.confirm) {
      const { matterId, storagePath, fileName } = body as {
        matterId: string;
        storagePath: string;
        fileName: string;
      };
      if (!matterId || !storagePath || !fileName) {
        return NextResponse.json(
          { error: 'matterId, storagePath, and fileName required' },
          { status: 400 },
        );
      }

      const { data: updated, error: updateError } = await supabase
        .from('matter_billing_configs')
        .update({
          engagement_file_path: storagePath,
          engagement_file_name: fileName,
          updated_at: new Date().toISOString(),
        })
        .eq('matter_id', matterId)
        .select('matter_id');

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
      if (!updated || updated.length === 0) {
        // Zero rows matched — no billing config exists yet for this matter.
        // Silently returning ok here is what orphaned earlier uploads.
        return NextResponse.json(
          { error: 'No billing config exists for this matter yet. Save the billing config first, then upload the engagement agreement.' },
          { status: 409 },
        );
      }

      return NextResponse.json({ ok: true, path: storagePath, fileName });
    }

    // Phase 1: mint signed upload URL
    const { matterId, fileName, fileType } = body as {
      matterId: string;
      fileName: string;
      fileType?: string;
    };
    if (!matterId || !fileName) {
      return NextResponse.json({ error: 'matterId and fileName required' }, { status: 400 });
    }

    const sanitized = sanitize(fileName);
    const storagePath = `engagement-agreements/${matterId}/${sanitized}`;

    // Remove any existing object at the same path so the signed upload
    // won't fail with "resource already exists".
    await supabase.storage.from('documents').remove([storagePath]);

    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? 'Failed to create upload URL' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      storagePath,
      signedUrl: data.signedUrl,
      token: data.token,
      contentType: fileType ?? 'application/pdf',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[engagement] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/finance/matter-billing/engagement?matterId=X
 * Get signed URL for viewing the engagement agreement.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const matterId = req.nextUrl.searchParams.get('matterId');
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  const supabase = getServiceDbForFirm(session.firmId);
  const { data: config } = await supabase
    .from('matter_billing_configs')
    .select('engagement_file_path, engagement_file_name')
    .eq('matter_id', matterId)
    .single();

  if (!config?.engagement_file_path) {
    return NextResponse.json({ error: 'No engagement agreement uploaded' }, { status: 404 });
  }

  const { data: urlData } = await supabase.storage
    .from('documents')
    .createSignedUrl(config.engagement_file_path, 3600);

  if (!urlData?.signedUrl) {
    return NextResponse.json({ error: 'Failed to generate URL' }, { status: 500 });
  }

  return NextResponse.json({
    url: urlData.signedUrl,
    fileName: config.engagement_file_name,
  });
}
