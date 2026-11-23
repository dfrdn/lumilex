// ── SharePoint Sync ─────────────────────────────────────────────────
// Auto-upload finalized deliverables + incoming files to SharePoint
// organized by client/matter

import { uploadToSharePoint, type SharePointUploadResult } from '@/lib/microsoft-graph';
import { isFeatureAvailable } from '@/lib/firm/features';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { contentTypeFor } from '@/lib/mime';

export interface SharePointSyncResult {
  docx?: SharePointUploadResult;
  pdf?: SharePointUploadResult;
  uploaded?: SharePointUploadResult[];
  skipped?: boolean;
  error?: string;
}

/**
 * Build the SharePoint folder path for a deliverable.
 * Format: {ClientName}/{MatterName}/Finalized
 */
function buildDeliverableFolderPath(clientName: string, matterName: string): string {
  const cleanClient = (clientName || 'Unknown Client').trim();
  const cleanMatter = (matterName || 'Unknown Matter').trim();
  return `${cleanClient}/${cleanMatter}/Finalized`;
}

/**
 * Build the SharePoint folder path for an incoming file.
 * Format: {ClientName}/{MatterName}/Incoming/{Origin}
 * Falls back to: {MatterName}/Incoming if no client found
 */
function buildIncomingFolderPath(
  clientName: string,
  matterName: string,
  origin?: string,
): string {
  const cleanClient = (clientName || 'Unknown Client').trim();
  const cleanMatter = (matterName || 'Unknown Matter').trim();
  const base = `${cleanClient}/${cleanMatter}/Incoming`;
  if (origin?.trim()) return `${base}/${origin.trim()}`;
  return base;
}

/**
 * Sync a finalized deliverable's files to SharePoint.
 *
 * Downloads the latest finalized DOCX and PDF from Supabase storage,
 * then uploads them to SharePoint under the client/matter folder structure.
 *
 * Updates the deliverable_files records with SharePoint item IDs and URLs.
 *
 * @param deliverableId - The deliverable's notion_id
 * @param version       - The version number of the finalized files
 */
export async function syncDeliverableToSharePoint(
  firmId: string,
  deliverableId: string,
  version: number,
): Promise<SharePointSyncResult> {
  if (!(await isFeatureAvailable(firmId, 'sharepoint'))) {
    console.log(`[sharepoint] Off for firm ${firmId}, skipping sync`);
    return { skipped: true };
  }

  const supabase = getServiceDbForFirm(firmId);

  try {
    // 1. Get deliverable info for folder path
    const { data: deliverable, error: delErr } = await supabase
      .from('deliverables')
      .select('name, matter_name, client_name')
      .eq('notion_id', deliverableId)
      .single();

    if (delErr || !deliverable) {
      throw new Error(`Deliverable not found: ${delErr?.message}`);
    }

    // 2. Get the finalized files for this version
    const { data: files, error: filesErr } = await supabase
      .from('deliverable_files')
      .select('*')
      .eq('deliverable_id', deliverableId)
      .eq('version', version)
      .eq('action', 'finalized');

    if (filesErr || !files?.length) {
      throw new Error(`No finalized files found for v${version}: ${filesErr?.message}`);
    }

    const folderPath = buildDeliverableFolderPath(
      deliverable.client_name,
      deliverable.matter_name,
    );

    const result: SharePointSyncResult = {};

    // 3. Upload each file
    for (const file of files) {
      // Download from Supabase storage
      const { data: fileData, error: dlErr } = await supabase.storage
        .from('files')
        .download(file.file_url);

      if (dlErr || !fileData) {
        console.error(`[sharepoint] Failed to download ${file.file_name}:`, dlErr?.message);
        continue;
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());

      const contentType = file.file_name.endsWith('.pdf')
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      // Upload to SharePoint
      const spResult = await uploadToSharePoint(
        firmId,
        buffer,
        folderPath,
        file.file_name,
        contentType,
      );

      // Update deliverable_files record with SharePoint info
      await supabase
        .from('deliverable_files')
        .update({
          sharepoint_item_id: spResult.itemId,
          sharepoint_web_url: spResult.webUrl,
        })
        .eq('id', file.id);

      if (file.file_name.endsWith('.pdf')) {
        result.pdf = spResult;
      } else {
        result.docx = spResult;
      }

      console.log(`[sharepoint] Uploaded ${file.file_name} → ${spResult.webUrl}`);
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'SharePoint sync failed';
    console.error('[sharepoint]', message);
    return { error: message };
  }
}

// ── Incoming Files Sync ─────────────────────────────────────────────

/**
 * Sync an incoming file's attachments to SharePoint.
 *
 * Downloads files from Supabase storage and uploads to SharePoint
 * under: {Client}/{Matter}/Incoming/{Origin}/
 *
 * @param fileNotionId - The files row's notion_id
 * @param specificFiles - Optional: only sync these file names (for newly uploaded files).
 *                        If omitted, syncs all files in file_urls.
 */
export async function syncIncomingFileToSharePoint(
  firmId: string,
  fileNotionId: string,
  specificFiles?: string[],
): Promise<SharePointSyncResult> {
  if (!(await isFeatureAvailable(firmId, 'sharepoint'))) {
    console.log(`[sharepoint] Off for firm ${firmId}, skipping incoming file sync`);
    return { skipped: true };
  }

  const supabase = getServiceDbForFirm(firmId);

  try {
    // 1. Get file record with matter info
    const { data: fileRecord, error: fileErr } = await supabase
      .from('files')
      .select('notion_id, name, matter_id, matter_name, origin, file_urls, sharepoint_urls')
      .eq('notion_id', fileNotionId)
      .single();

    if (fileErr || !fileRecord) {
      throw new Error(`File record not found: ${fileErr?.message}`);
    }

    const fileUrls: { name: string; url: string; path?: string }[] =
      Array.isArray(fileRecord.file_urls) ? fileRecord.file_urls : [];

    if (fileUrls.length === 0) {
      return { skipped: true };
    }

    // 2. Resolve client name from matter
    let clientName = 'Unknown Client';
    if (fileRecord.matter_id) {
      const { data: matter } = await supabase
        .from('matters')
        .select('client_name')
        .eq('notion_id', fileRecord.matter_id)
        .single();
      if (matter?.client_name) clientName = matter.client_name;
    }

    const folderPath = buildIncomingFolderPath(
      clientName,
      fileRecord.matter_name,
      fileRecord.origin,
    );

    // 3. Filter to specific files if provided
    const toSync = specificFiles
      ? fileUrls.filter((f) => specificFiles.includes(f.name))
      : fileUrls;

    const existingSpUrls: { name: string; sharePointUrl: string; itemId: string }[] =
      Array.isArray(fileRecord.sharepoint_urls) ? fileRecord.sharepoint_urls : [];

    const uploaded: SharePointUploadResult[] = [];

    // 4. Upload each file
    for (const fileEntry of toSync) {
      const storagePath = fileEntry.path || fileEntry.url;
      if (!storagePath) continue;

      // Download from Supabase
      const { data: fileData, error: dlErr } = await supabase.storage
        .from('files')
        .download(storagePath);

      if (dlErr || !fileData) {
        console.error(`[sharepoint] Failed to download ${fileEntry.name}:`, dlErr?.message);
        continue;
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());

      const contentType = contentTypeFor(fileEntry.name);

      const spResult = await uploadToSharePoint(
        firmId,
        buffer,
        folderPath,
        fileEntry.name,
        contentType,
      );

      uploaded.push(spResult);

      // Update sharepoint_urls array
      const existingIdx = existingSpUrls.findIndex((s) => s.name === fileEntry.name);
      const spEntry = { name: fileEntry.name, sharePointUrl: spResult.webUrl, itemId: spResult.itemId };
      if (existingIdx >= 0) {
        existingSpUrls[existingIdx] = spEntry;
      } else {
        existingSpUrls.push(spEntry);
      }

      console.log(`[sharepoint] Incoming file: ${fileEntry.name} → ${spResult.webUrl}`);
    }

    // 5. Update the files row with SharePoint URLs
    await supabase
      .from('files')
      .update({ sharepoint_urls: existingSpUrls })
      .eq('notion_id', fileNotionId);

    return { uploaded };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Incoming file SharePoint sync failed';
    console.error('[sharepoint]', message);
    return { error: message };
  }
}

/**
 * Get SharePoint sync status for an incoming file.
 */
export function getIncomingFileSharePointStatus(
  fileUrls: { name: string }[],
  sharePointUrls: { name: string; sharePointUrl: string }[],
) {
  const spMap = new Map(sharePointUrls.map((s) => [s.name, s.sharePointUrl]));
  return {
    synced: sharePointUrls.length > 0 && sharePointUrls.length >= fileUrls.length,
    files: fileUrls.map((f) => ({
      name: f.name,
      sharePointUrl: spMap.get(f.name) ?? null,
      synced: spMap.has(f.name),
    })),
  };
}

// ── Deliverable Files Status ────────────────────────────────────────

/**
 * Get SharePoint sync status for a deliverable's files.
 */
export async function getSharePointStatus(firmId: string, deliverableId: string) {
  const supabase = getServiceDbForFirm(firmId);

  const { data: files } = await supabase
    .from('deliverable_files')
    .select('id, file_name, version, action, sharepoint_item_id, sharepoint_web_url')
    .eq('deliverable_id', deliverableId)
    .eq('action', 'finalized')
    .order('version', { ascending: false });

  if (!files?.length) return { synced: false, files: [] };

  return {
    synced: files.some((f: { sharepoint_item_id: string | null }) => !!f.sharepoint_item_id),
    files: files.map((f: { id: number; file_name: string; version: number; sharepoint_item_id: string | null; sharepoint_web_url: string | null }) => ({
      id: f.id,
      fileName: f.file_name,
      version: f.version,
      sharePointUrl: f.sharepoint_web_url,
      synced: !!f.sharepoint_item_id,
    })),
  };
}
