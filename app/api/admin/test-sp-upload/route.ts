import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { forEachFirmWithFeature } from '@/lib/tenancy/fan-out';

/**
 * POST /api/admin/test-sp-upload
 * Test a single file upload to SharePoint to diagnose errors. An admin
 * session tests a pending file from their firm; the cron path scans active
 * firms in order and tests the first pending file it finds.
 */
export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  const isWebhook = cronSecret && authHeader === `Bearer ${cronSecret}`;

  let sessionFirmId: string | null = null;
  if (!isWebhook) {
    const session = await getSession();
    const role = session?.user?.role;
    if (!session || !role || !['admin', 'super_user'].includes(role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    sessionFirmId = session.firmId;
  }

  const MS_TENANT_ID = process.env.MS_TENANT_ID!;
  const MS_CLIENT_ID = process.env.MS_CLIENT_ID!;
  const MS_CLIENT_SECRET = process.env.MS_CLIENT_SECRET!;
  const MS_SHAREPOINT_SITE_HOSTNAME = process.env.MS_SHAREPOINT_SITE_HOSTNAME;
  const MS_SHAREPOINT_SITE_PATH = process.env.MS_SHAREPOINT_SITE_PATH;
  const MS_SHAREPOINT_BASE_FOLDER = process.env.MS_SHAREPOINT_BASE_FOLDER || '';

  const steps: { step: string; status: string; detail?: string }[] = [];

  try {
    // Step 1: Get Graph token
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: MS_CLIENT_ID,
          client_secret: MS_CLIENT_SECRET,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }),
      },
    );
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      steps.push({ step: 'get_token', status: 'failed', detail: `${tokenRes.status}: ${body}` });
      return NextResponse.json({ steps });
    }
    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;
    steps.push({ step: 'get_token', status: 'ok' });

    // Step 2: Resolve SharePoint site
    const siteRes = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${MS_SHAREPOINT_SITE_HOSTNAME}:${MS_SHAREPOINT_SITE_PATH}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!siteRes.ok) {
      const body = await siteRes.text();
      steps.push({ step: 'resolve_site', status: 'failed', detail: `${siteRes.status}: ${body}` });
      return NextResponse.json({ steps });
    }
    const site = await siteRes.json();
    steps.push({ step: 'resolve_site', status: 'ok', detail: `siteId: ${site.id}` });

    // Step 3: Get drive
    const driveRes = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${site.id}/drive`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!driveRes.ok) {
      const body = await driveRes.text();
      steps.push({ step: 'get_drive', status: 'failed', detail: `${driveRes.status}: ${body}` });
      return NextResponse.json({ steps });
    }
    const drive = await driveRes.json();
    const driveId = drive.id;
    steps.push({ step: 'get_drive', status: 'ok', detail: `driveId: ${driveId}` });

    // Step 4: Pick a test file from Supabase (firm-scoped)
    type TestFileRow = {
      notion_id: string;
      name: string | null;
      matter_id: string | null;
      matter_name: string | null;
      origin: string | null;
      file_urls: unknown;
    };
    const pickTestFile = async (db: ReturnType<typeof getServiceDbForFirm>) => {
      const { data } = await db
        .from('files')
        .select('notion_id, name, matter_id, matter_name, origin, file_urls')
        .eq('sharepoint_urls', '[]')
        .neq('file_urls', '[]')
        .limit(1)
        .maybeSingle<TestFileRow>();
      return data ?? null;
    };

    let testFile: TestFileRow | null = null;
    let supabase = getServiceDbForFirm(sessionFirmId ?? '');
    if (sessionFirmId) {
      testFile = await pickTestFile(supabase);
    } else {
      const firms = await forEachFirmWithFeature('sharepoint', async ({ firm, db }) => ({
        firm,
        row: await pickTestFile(db),
      }));
      const hit = firms.find((f) => f.result?.row);
      if (hit?.result) {
        testFile = hit.result.row;
        supabase = getServiceDbForFirm(hit.result.firm.id);
      }
    }

    if (!testFile) {
      steps.push({ step: 'find_test_file', status: 'failed', detail: 'No pending files found' });
      return NextResponse.json({ steps });
    }

    const fileUrls: { name: string; path?: string }[] =
      typeof testFile.file_urls === 'string' ? JSON.parse(testFile.file_urls) : (testFile.file_urls ?? []);
    const firstWithPath = fileUrls.find((f) => f.path);

    if (!firstWithPath) {
      steps.push({ step: 'find_test_file', status: 'failed', detail: `No file with path in ${testFile.notion_id}` });
      return NextResponse.json({ steps });
    }
    steps.push({ step: 'find_test_file', status: 'ok', detail: `${testFile.name} / ${firstWithPath.name}` });

    // Step 5: Download from Supabase storage
    const { data: fileData, error: dlErr } = await supabase.storage
      .from('files')
      .download(firstWithPath.path!);

    if (dlErr || !fileData) {
      steps.push({ step: 'download_from_storage', status: 'failed', detail: dlErr?.message || 'no data' });
      return NextResponse.json({ steps });
    }
    const buffer = await fileData.arrayBuffer();
    steps.push({ step: 'download_from_storage', status: 'ok', detail: `${buffer.byteLength} bytes` });

    // Step 6: Build SharePoint path
    let clientName = 'Unknown Client';
    if (testFile.matter_id) {
      const { data: m } = await supabase
        .from('matters')
        .select('client_name')
        .eq('notion_id', testFile.matter_id)
        .single();
      if (m?.client_name) clientName = m.client_name;
    }
    const base = `${clientName}/${testFile.matter_name || 'Unknown'}/Incoming`;
    const folder = testFile.origin?.trim() ? `${base}/${testFile.origin.trim()}` : base;
    const basePath = MS_SHAREPOINT_BASE_FOLDER ? `${MS_SHAREPOINT_BASE_FOLDER}/${folder}` : folder;
    const uploadPath = `${basePath}/${firstWithPath.name}`;
    steps.push({ step: 'build_path', status: 'ok', detail: uploadPath });

    // Step 7: Upload to SharePoint
    const ext = firstWithPath.name.split('.').pop()?.toLowerCase() || '';
    const ctMap: Record<string, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      doc: 'application/msword',
    };
    const contentType = ctMap[ext] || 'application/octet-stream';

    const uploadRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURI(uploadPath)}:/content`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
        body: buffer,
      },
    );

    if (!uploadRes.ok) {
      const body = await uploadRes.text();
      steps.push({ step: 'upload_to_sharepoint', status: 'failed', detail: `${uploadRes.status}: ${body}` });
      return NextResponse.json({ steps });
    }

    const uploadData = await uploadRes.json();
    steps.push({
      step: 'upload_to_sharepoint',
      status: 'ok',
      detail: `itemId: ${uploadData.id}, webUrl: ${uploadData.webUrl}`,
    });

    return NextResponse.json({ success: true, steps });
  } catch (err: any) {
    steps.push({ step: 'unexpected_error', status: 'failed', detail: err.message });
    return NextResponse.json({ steps });
  }
}
