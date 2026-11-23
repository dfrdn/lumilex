// ── Microsoft Graph API ─────────────────────────────────────────────
// DOCX → PDF conversion, SharePoint document sync, Outlook Calendar sync
//
// Every entry point here takes a `firmId` and runs on THAT firm's Graph app.
// A Graph app registration lives in exactly one Entra directory: its app-only
// token can only reach that directory's mailboxes, calendars, OneDrive and
// SharePoint site. So there is no cross-firm fallback — see
// getGraphConfigForFirm.

import { randomUUID } from 'node:crypto';
import { loadFirmIntegration, usesPlatformEnv } from '@/lib/firm/integrations';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  driveUser: string;
  tokenUrl: string;
  spHostname: string;
  spSitePath: string;
  spBaseFolder: string;
}

let _config: GraphConfig | null = null;

/**
 * The PLATFORM's Graph app from env. Used by the is*Configured() predicates
 * that lib/firm/features.ts composes, and by a firm that has explicitly
 * declared the platform app as its own. Never reached implicitly.
 */
function getGraphConfig(): GraphConfig {
  if (!_config) {
    const tenantId = process.env.MS_TENANT_ID ?? '';
    _config = {
      tenantId,
      clientId: process.env.MS_CLIENT_ID ?? '',
      clientSecret: process.env.MS_CLIENT_SECRET ?? '',
      driveUser: process.env.MS_DRIVE_USER ?? '',
      tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      spHostname: process.env.MS_SHAREPOINT_SITE_HOSTNAME ?? '',
      spSitePath: process.env.MS_SHAREPOINT_SITE_PATH ?? '',
      spBaseFolder: process.env.MS_SHAREPOINT_BASE_FOLDER ?? '',
    };
  }
  return _config;
}

/**
 * The Graph app a firm's requests run on, or null when it has none.
 *
 * There is deliberately NO fallback to the platform env. A shared Graph app
 * across law firms is not merely wrong on identity — for SharePoint and
 * OneDrive it would silently SUCCEED, filing firm B's client documents into
 * firm A's document library, somewhere no RLS policy can see. A firm without
 * its own credentials has the feature unconfigured, full stop.
 *
 * `usePlatformEnv` is the one way the platform env is reached, and it is an
 * explicit per-firm declaration meaning "this app registration is mine" — held
 * today only by the founding tenant whose Entra directory the platform env
 * actually is.
 *
 * Either Graph feature row may carry the credentials; they are one app
 * registration, so both are consulted in turn.
 */
export async function getGraphConfigForFirm(firmId: string): Promise<GraphConfig | null> {
  for (const feature of GRAPH_FEATURES) {
    const integration = await loadFirmIntegration(firmId, feature);
    if (!integration?.enabled) continue;

    if (usesPlatformEnv(integration)) {
      const platform = getGraphConfig();
      return platform.tenantId && platform.clientId && platform.clientSecret ? platform : null;
    }

    const cfg = integration.config as Record<string, unknown>;
    const str = (key: string): string => {
      const value = cfg[key];
      return typeof value === 'string' ? value.trim() : '';
    };
    const tenantId = str('tenantId');
    const clientId = str('clientId');
    const clientSecret = integration.credentials.clientSecret?.trim() ?? '';
    if (!tenantId || !clientId || !clientSecret) continue;

    return {
      tenantId,
      clientId,
      clientSecret,
      driveUser: str('driveUser'),
      tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      spHostname: str('spHostname'),
      spSitePath: str('spSitePath'),
      spBaseFolder: str('spBaseFolder'),
    };
  }
  return null;
}

/** The features backed by one Entra app registration. */
const GRAPH_FEATURES = ['sharepoint', 'docx_pdf'] as const;

/** Thrown when a Graph-backed feature is invoked without credentials configured. */
export class GraphNotConfiguredError extends Error {}

async function requireGraphConfig(firmId: string): Promise<GraphConfig> {
  const config = await getGraphConfigForFirm(firmId);
  if (!config) {
    throw new GraphNotConfiguredError(
      `Microsoft Graph is not configured for firm ${firmId}. Add the firm's own directory id, application id and client secret under its integration settings.`,
    );
  }
  return config;
}

/**
 * Retry a Graph API fetch with exponential backoff on 429 (throttled) responses.
 * Respects the Retry-After header when provided.
 */
async function graphFetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastRes: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429 || attempt === maxRetries) return res;
    lastRes = res;
    const retryAfter = res.headers.get('Retry-After');
    const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(1000 * 2 ** attempt, 10000);
    console.warn(`[graph] 429 throttled, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return lastRes!;
}

// In-memory token cache, keyed by the app registration the token belongs to
// rather than by firm: two firms declaring the same app share one token, and
// a firm's token can never be handed to a firm on a different app.
const _tokens = new Map<string, { token: string; expiry: number }>();

/**
 * Get an access token for a firm's Graph app via the client credentials flow.
 * Caches in-memory until 5 minutes before expiry.
 */
async function getGraphAccessToken(firmId: string): Promise<string> {
  const config = await requireGraphConfig(firmId);
  const cacheKey = `${config.tenantId}:${config.clientId}`;
  const hit = _tokens.get(cacheKey);
  if (hit && Date.now() < hit.expiry) return hit.token;

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    // The response body of a failed token request can echo the client secret
    // back; report the status only.
    throw new Error(`Graph token request failed (${res.status}) for firm ${firmId}`);
  }

  const json = await res.json();
  _tokens.set(cacheKey, {
    token: json.access_token,
    expiry: Date.now() + (json.expires_in - 300) * 1000,
  });
  return json.access_token as string;
}

// ── DOCX → PDF Conversion ──────────────────────────────────────────

/**
 * Convert a DOCX buffer to PDF using Microsoft Graph API.
 *
 * Flow:
 * 1. Upload DOCX to OneDrive (temp folder)
 * 2. Download as PDF via ?format=pdf
 * 3. Delete the temp file (fire-and-forget)
 */
export async function convertDocxToPdf(
  firmId: string,
  docxBuffer: Buffer,
  fileName: string,
): Promise<Buffer> {
  const config = await requireGraphConfig(firmId);
  if (!config.driveUser) {
    throw new GraphNotConfiguredError(
      `PDF conversion needs a OneDrive account (driveUser) for firm ${firmId}`,
    );
  }
  const token = await getGraphAccessToken(firmId);
  const headers = { Authorization: `Bearer ${token}` };

  // The temp object is one flat folder on one OneDrive account, so a key
  // derived from the document alone is a collision: two conversions of a
  // same-named file running at once write the same item, and each then reads
  // `?format=pdf` back off it — handing one caller a PDF of the other's
  // document, and letting the fire-and-forget DELETE remove a file still in
  // use. The random component is what makes the key unique; the firm id keeps
  // the object attributable, which matters because two firms declaring
  // `usePlatformEnv` share this driveUser and would otherwise be indistinct
  // here. The name is tail-truncated so the added prefix cannot push a long
  // filename past OneDrive's 255-character limit, keeping the extension Graph
  // needs to recognise the source format.
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const tempName = `${firmId}-${randomUUID()}-${safeName}`;
  const driveItemPath = `users/${config.driveUser}/drive/root:/lumilex-temp/${tempName}:`;

  // 1. Upload DOCX to OneDrive
  const uploadRes = await fetch(`${GRAPH_BASE}/${driveItemPath}/content`, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    body: new Uint8Array(docxBuffer),
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`Graph upload failed (${uploadRes.status}): ${text}`);
  }

  // 2. Download as PDF
  const pdfRes = await fetch(
    `${GRAPH_BASE}/${driveItemPath}/content?format=pdf`,
    { headers, redirect: 'follow' },
  );

  if (!pdfRes.ok) {
    const text = await pdfRes.text();
    throw new Error(`Graph PDF conversion failed (${pdfRes.status}): ${text}`);
  }

  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

  // 3. Delete temp file (fire-and-forget)
  fetch(`${GRAPH_BASE}/${driveItemPath}`, {
    method: 'DELETE',
    headers,
  }).catch((err) =>
    console.error('[ms-graph] Failed to delete temp file:', err.message),
  );

  return pdfBuffer;
}

/**
 * Upload a DOCX to a permanent OneDrive folder and convert to PDF.
 *
 * Keeps the DOCX in OneDrive at the specified folder path so finance
 * can browse invoices directly. Returns both the PDF buffer and the
 * OneDrive web URL for the uploaded DOCX.
 *
 * @param docxBuffer - The DOCX file buffer
 * @param folderPath - OneDrive folder path, e.g. "Billing/Acme Corp"
 * @param fileName - File name, e.g. "INV-2026-04-001 - Billing Letter.docx"
 */
export async function uploadAndConvertToPdf(
  firmId: string,
  docxBuffer: Buffer,
  folderPath: string,
  fileName: string,
): Promise<{ pdfBuffer: Buffer; docxWebUrl: string }> {
  const config = await requireGraphConfig(firmId);
  if (!config.driveUser) {
    throw new GraphNotConfiguredError(
      `PDF conversion needs a OneDrive account (driveUser) for firm ${firmId}`,
    );
  }
  const token = await getGraphAccessToken(firmId);
  const headers = { Authorization: `Bearer ${token}` };

  const safeName = fileName.replace(/[^a-zA-Z0-9._\- ]/g, '_');
  const safeFolder = folderPath.replace(/[#%&{}\\<>*?/$!'":@+`|=]/g, '_');
  const driveItemPath = `users/${config.driveUser}/drive/root:/${safeFolder}/${safeName}:`;

  // 1. Upload DOCX to OneDrive (permanent location)
  const uploadRes = await fetch(`${GRAPH_BASE}/${driveItemPath}/content`, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    body: new Uint8Array(docxBuffer),
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`Graph upload failed (${uploadRes.status}): ${text}`);
  }

  const uploadData = await uploadRes.json();
  const docxWebUrl = uploadData.webUrl ?? '';

  // 2. Download as PDF
  const pdfRes = await fetch(
    `${GRAPH_BASE}/${driveItemPath}/content?format=pdf`,
    { headers, redirect: 'follow' },
  );

  if (!pdfRes.ok) {
    const text = await pdfRes.text();
    throw new Error(`Graph PDF conversion failed (${pdfRes.status}): ${text}`);
  }

  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

  return { pdfBuffer, docxWebUrl };
}

/**
 * Is the PLATFORM's Graph app configured for DOCX → PDF conversion?
 *
 * Platform-level only — it says nothing about any particular firm. Ask
 * isFeatureAvailable(firmId, 'docx_pdf') from lib/firm/features.ts, which
 * composes this with the firm's flag and its own credentials.
 */
export function isDocxConvertConfigured(): boolean {
  const config = getGraphConfig();
  return !!(config.tenantId && config.clientId && config.clientSecret);
}

// ── SharePoint Integration ──────────────────────────────────────────

// Cache the SharePoint drive ID per site — a drive id is a handle on one
// firm's document library and must never be reused across firms.
const _spDriveIds = new Map<string, string>();

/**
 * Resolve the SharePoint site's default document library drive ID.
 * Cached in-memory after first call.
 */
async function getSharePointDriveId(firmId: string): Promise<string> {
  const config = await requireGraphConfig(firmId);
  if (!config.spHostname || !config.spSitePath) {
    throw new GraphNotConfiguredError(
      `SharePoint is not configured for firm ${firmId}: its integration needs spHostname and spSitePath.`,
    );
  }

  const siteKey = `${config.spHostname}${config.spSitePath}`;
  const cached = _spDriveIds.get(siteKey);
  if (cached) return cached;

  const token = await getGraphAccessToken(firmId);

  // Resolve site ID
  const siteRes = await fetch(
    `${GRAPH_BASE}/sites/${config.spHostname}:${config.spSitePath}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!siteRes.ok) {
    const text = await siteRes.text();
    throw new Error(`Failed to resolve SharePoint site (${siteRes.status}): ${text}`);
  }

  const site = await siteRes.json();

  // Get default document library drive
  const driveRes = await fetch(
    `${GRAPH_BASE}/sites/${site.id}/drive`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!driveRes.ok) {
    const text = await driveRes.text();
    throw new Error(`Failed to get SharePoint drive (${driveRes.status}): ${text}`);
  }

  const drive = await driveRes.json();
  _spDriveIds.set(siteKey, drive.id);
  return drive.id as string;
}

export interface SharePointUploadResult {
  itemId: string;
  webUrl: string;
  name: string;
}

/**
 * Upload a file to SharePoint document library.
 *
 * @param buffer     - File contents
 * @param folderPath - Folder path relative to base folder (e.g., "ClientName/MatterName/Finalized")
 * @param fileName   - File name (e.g., "Report_FINAL.docx")
 * @param contentType - MIME type
 * @returns SharePoint item ID and web URL
 */
export async function uploadToSharePoint(
  firmId: string,
  buffer: Buffer,
  folderPath: string,
  fileName: string,
  contentType: string,
): Promise<SharePointUploadResult> {
  const config = await requireGraphConfig(firmId);
  const driveId = await getSharePointDriveId(firmId);
  const token = await getGraphAccessToken(firmId);

  // Build full path: base folder + relative path + file name
  const segments = [config.spBaseFolder, folderPath, fileName]
    .filter(Boolean)
    .join('/');

  // Sanitize path segments (keep slashes)
  const safePath = segments
    .split('/')
    .map((s) => s.replace(/[#%&{}\\<>*?/$!'":@+`|=]/g, '_').trim())
    .filter(Boolean)
    .join('/');

  // Graph simple-upload accepts @microsoft.graph.conflictBehavior as a query param,
  // not as an HTTP header. Setting it as a header throws an "invalid header name" error
  // from undici because "@" is not a valid token character in RFC 7230.
  const uploadUrl = `${GRAPH_BASE}/drives/${driveId}/root:/${safePath}:/content?@microsoft.graph.conflictBehavior=replace`;

  // For files up to 4MB, use simple upload. For larger files, use upload session.
  if (buffer.length > 4 * 1024 * 1024) {
    return uploadLargeFileToSharePoint(firmId, driveId, safePath, buffer, contentType);
  }

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body: new Uint8Array(buffer),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SharePoint upload failed (${res.status}): ${text}`);
  }

  const item = await res.json();
  return {
    itemId: item.id,
    webUrl: item.webUrl,
    name: item.name,
  };
}

/**
 * Delete a file from the SharePoint document library by its driveItem ID.
 *
 * Fetches the item first so callers can see what they're removing; pass
 * `expectNameIncludes` to abort unless the item's name contains that substring
 * — a guard against deleting the wrong driveItem. A 404 (already gone) is
 * treated as success.
 *
 * @returns the deleted item's name and webUrl, or null if it was already gone.
 */
export async function deleteSharePointItem(
  firmId: string,
  itemId: string,
  opts?: { expectNameIncludes?: string },
): Promise<{ name: string; webUrl: string } | null> {
  const driveId = await getSharePointDriveId(firmId);
  const token = await getGraphAccessToken(firmId);
  const headers = { Authorization: `Bearer ${token}` };

  const getRes = await graphFetchWithRetry(
    `${GRAPH_BASE}/drives/${driveId}/items/${itemId}`,
    { headers },
  );
  if (getRes.status === 404) return null;
  if (!getRes.ok) {
    const text = await getRes.text();
    throw new Error(`SharePoint item lookup failed (${getRes.status}): ${text}`);
  }
  const item = await getRes.json();

  if (opts?.expectNameIncludes && !String(item.name ?? '').includes(opts.expectNameIncludes)) {
    throw new Error(
      `SharePoint item ${itemId} is "${item.name}", expected name to include "${opts.expectNameIncludes}" — aborting delete.`,
    );
  }

  const delRes = await graphFetchWithRetry(
    `${GRAPH_BASE}/drives/${driveId}/items/${itemId}`,
    { method: 'DELETE', headers },
  );
  if (!delRes.ok && delRes.status !== 404) {
    const text = await delRes.text();
    throw new Error(`SharePoint delete failed (${delRes.status}): ${text}`);
  }

  return { name: item.name, webUrl: item.webUrl };
}

/**
 * Upload a large file (>4MB) to SharePoint using an upload session.
 */
async function uploadLargeFileToSharePoint(
  firmId: string,
  driveId: string,
  filePath: string,
  buffer: Buffer,
  contentType: string,
): Promise<SharePointUploadResult> {
  const token = await getGraphAccessToken(firmId);

  // Create upload session
  const sessionRes = await fetch(
    `${GRAPH_BASE}/drives/${driveId}/root:/${filePath}:/createUploadSession`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        item: {
          '@microsoft.graph.conflictBehavior': 'replace',
          name: filePath.split('/').pop(),
        },
      }),
    },
  );

  if (!sessionRes.ok) {
    const text = await sessionRes.text();
    throw new Error(`SharePoint upload session failed (${sessionRes.status}): ${text}`);
  }

  const session = await sessionRes.json();
  const uploadUrl = session.uploadUrl;

  // Upload in ~3.2MB chunks. Microsoft Graph requires chunk sizes to be
  // integer multiples of 320 KiB (327,680 bytes). Also, all offsets in the
  // Content-Range header must be integers — the previous 3.2 * 1024 * 1024
  // was a float, which produced fractional values and "malformed Content-Range"
  // errors from Graph.
  const GRAPH_CHUNK_UNIT = 320 * 1024; // 327,680 bytes
  const chunkSize = 10 * GRAPH_CHUNK_UNIT; // 3,276,800 bytes (~3.125 MiB)
  const totalSize = buffer.length;
  let offset = 0;
  let result: SharePointUploadResult | null = null;

  while (offset < totalSize) {
    const end = Math.min(offset + chunkSize, totalSize);
    const chunk = buffer.subarray(offset, end);

    const chunkRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(chunk.length),
        'Content-Range': `bytes ${offset}-${end - 1}/${totalSize}`,
        'Content-Type': contentType,
      },
      body: new Uint8Array(chunk),
    });

    if (chunkRes.status === 200 || chunkRes.status === 201) {
      // Final chunk — response contains the driveItem
      const item = await chunkRes.json();
      result = {
        itemId: item.id,
        webUrl: item.webUrl,
        name: item.name,
      };
    } else if (chunkRes.status !== 202) {
      const text = await chunkRes.text();
      throw new Error(`SharePoint chunk upload failed (${chunkRes.status}): ${text}`);
    }

    offset = end;
  }

  if (!result) {
    throw new Error('SharePoint large file upload completed but no item was returned');
  }

  return result;
}

/**
 * Is the PLATFORM's SharePoint site configured? Platform-level only — ask
 * isFeatureAvailable(firmId, 'sharepoint') for a firm's answer.
 */
export function isSharePointConfigured(): boolean {
  const config = getGraphConfig();
  return !!(config.spHostname && config.spSitePath);
}
