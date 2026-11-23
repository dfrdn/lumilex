import { NextResponse, after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSession } from '@/lib/session';
import { generateFinalizedNotifications } from '@/lib/notifications';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { cleanDocx } from '@/lib/docx/cleanup';
import { insertSignatures, type Signatory } from '@/lib/docx/signatures';
import { convertDocxToPdf, GraphNotConfiguredError } from '@/lib/microsoft-graph';
import { requireFeature, FeatureDisabledError } from '@/lib/firm/features';
import { proofreadDocument } from '@/lib/ai/proofread';
import { sanitizeStorageName } from '@/lib/storage-name';
import { verifyStorageObjects } from '@/lib/storage-verify';
import { annexLetter, isAnnexFile } from '@/lib/annexes';
import { baseDocumentName } from '@/lib/finalize/file-names';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
// SharePoint sync handled by database webhook (on_deliverable_file_finalized trigger)

export const maxDuration = 120;

async function assertAdmin() {
  const session = await getSession();
  const role = session?.user?.role;
  if (!role || !['admin', 'super_user', 'finance'].includes(role)) return null;
  return session;
}

// ── Annexes ───────────────────────────────────────────────────────
// Supplementary files attached at finalize time. Each is saved as its own
// `deliverable_files` row at the finalized version, named "Annex A - <label>",
// so it travels with the deliverable and SharePoint-syncs like the main output.
type AnnexInput = {
  source: 'matter' | 'upload';
  label: string; // editable display label, no "Annex X -" prefix, extension optional
  ext?: string; // file extension without the leading dot
  sourcePath?: string; // source='matter': storage path in the `files` bucket to copy from
  uploadPath?: string; // source='upload': temp path the client already PUT the file to
};

/**
 * The two temp paths the client PUTs to and then names back to the server.
 * Both are minted here and re-derived here rather than trusted on the way
 * back: a storage key the caller chose is a read of whatever it points at.
 */
function annexTempPrefix(firmId: string, deliverableId: string): string {
  return firmStoragePath(firmId, `temp/finalize/annex/${deliverableId}/`);
}

function editedDocxTempPath(firmId: string, deliverableId: string): string {
  return firmStoragePath(firmId, `temp/finalize/${deliverableId}_edited.docx`);
}

/**
 * Resolve the set of storage paths that actually belong to a deliverable's
 * matter. Used to validate client-supplied annex `sourcePath`s so a finalize
 * request can't copy an arbitrary object out of the shared `files` bucket.
 * Mirrors the `matter-files` picker query so anything pickable is allowed.
 */
async function allowedMatterFilePaths(
  supabase: SupabaseClient,
  deliverableId: string,
): Promise<Set<string>> {
  const paths = new Set<string>();
  const { data: del } = await supabase
    .from('deliverables')
    .select('matter_id')
    .eq('notion_id', deliverableId)
    .maybeSingle();
  if (!del?.matter_id) return paths;

  const { data: rows } = await supabase
    .from('files')
    .select('file_urls')
    .eq('matter_id', del.matter_id)
    .order('created_time', { ascending: false })
    .limit(500);
  for (const r of rows ?? []) {
    const urls = Array.isArray(r.file_urls) ? r.file_urls : [];
    for (const u of urls) {
      const p = (u as { path?: string })?.path;
      if (p) paths.add(p);
    }
  }
  return paths;
}

/**
 * Copy each annex into the deliverable's version folder under an
 * "Annex {LETTER} - {label}.{ext}" name and record a `deliverable_files` row.
 * Letters are assigned to successfully-copied annexes in order, so the lettering
 * stays contiguous (A, B, C …) even when one is rejected or fails. Copies happen
 * within the same `files` bucket, so we never pull bytes through the function.
 *
 * Individual failures are non-fatal: a matter path that isn't in the matter, a
 * missing source object (a legacy "needs re-upload" attachment), or an object
 * that doesn't verify after copy is skipped and reported in `failed`, so the
 * main finalize still completes rather than leaving a half-finalized version.
 */
async function attachAnnexes(
  supabase: SupabaseClient,
  firmId: string,
  deliverableId: string,
  version: number,
  personId: string,
  annexes: AnnexInput[],
): Promise<{ created: { name: string; path: string }[]; failed: string[] }> {
  const valid = annexes.filter(
    (a) => a && (a.source === 'matter' ? a.sourcePath : a.uploadPath),
  );
  if (valid.length === 0) return { created: [], failed: [] };

  // Never trust a client-supplied matter path — re-resolve what this matter owns.
  const allowedMatterPaths = valid.some((a) => a.source === 'matter')
    ? await allowedMatterFilePaths(supabase, deliverableId)
    : new Set<string>();
  const uploadPrefix = annexTempPrefix(firmId, deliverableId);

  const copied: { name: string; path: string; uploadPath?: string }[] = [];
  const failed: string[] = [];
  for (const a of valid) {
    const labelText = (a.label ?? '').trim();
    const ext = (a.ext ?? '').replace(/^\./, '').trim();

    if (a.source === 'matter' && !allowedMatterPaths.has(a.sourcePath!)) {
      console.error(`[finalize] Annex rejected — sourcePath not in matter: ${a.sourcePath}`);
      failed.push(labelText || 'Unknown file');
      continue;
    }

    // The upload branch had no equivalent check: `uploadPath` came back from
    // the client and was copied from as-is, so any object key in the shared
    // `files` bucket — including another firm's — could be copied into this
    // firm's version folder and then downloaded from it. annex-prepare mints
    // these paths under one prefix; nothing else is a legitimate source.
    if (a.source !== 'matter' && !a.uploadPath!.startsWith(uploadPrefix)) {
      console.error(`[finalize] Annex rejected — uploadPath outside the annex temp prefix: ${a.uploadPath}`);
      failed.push(labelText || 'Unknown file');
      continue;
    }

    // Letter is keyed off successful copies so it never skips or runs past 'Z'.
    const letter = annexLetter(copied.length);
    const label = labelText || `Annex ${letter}`;
    const displayName = ext ? `Annex ${letter} - ${label}.${ext}` : `Annex ${letter} - ${label}`;
    const finalPath = firmStoragePath(firmId, `${deliverableId}/v${version}/${sanitizeStorageName(displayName)}`);
    const fromPath = (a.source === 'matter' ? a.sourcePath : a.uploadPath)!;

    const { error: copyErr } = await supabase.storage.from('files').copy(fromPath, finalPath);
    if (copyErr) {
      console.error(`[finalize] Annex copy failed for "${displayName}":`, copyErr.message);
      failed.push(label);
      continue;
    }
    copied.push({
      name: displayName,
      path: finalPath,
      uploadPath: a.source === 'upload' ? a.uploadPath : undefined,
    });
  }

  // Verify each copied object before recording a row (mirrors the manual step's
  // verify-before-commit so a lost copy never leaves a dangling row). Insert the
  // surviving rows in one batch.
  const created: { name: string; path: string }[] = [];
  const createdTempPaths: string[] = [];
  if (copied.length > 0) {
    const verified = await verifyStorageObjects(supabase, 'files', copied.map((c) => c.path));
    const rows: Record<string, unknown>[] = [];
    for (const c of copied) {
      if (!verified.get(c.path)?.exists) {
        console.error(`[finalize] Annex object missing after copy, skipping: ${c.path}`);
        failed.push(c.name);
        continue;
      }
      rows.push({
        deliverable_id: deliverableId,
        version,
        file_name: c.name,
        file_url: c.path,
        file_size: verified.get(c.path)?.size ?? null,
        uploaded_by: personId,
        action: 'finalized',
      });
      created.push({ name: c.name, path: c.path });
      if (c.uploadPath) createdTempPaths.push(c.uploadPath);
    }
    if (rows.length > 0) {
      await supabase.from('deliverable_files').insert(rows);
    }
  }

  // Remove temp upload objects only for annexes we actually recorded, so a
  // failed copy keeps its source for a retry rather than losing it.
  if (createdTempPaths.length > 0) {
    supabase.storage.from('files').remove(createdTempPaths).catch(() => {});
  }

  return { created, failed };
}

export async function POST(req: Request) {
  const session = await assertAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const {
    deliverableId,
    step,
    editedDocxPath,
    manualFiles,
    manualVersion,
    annexes,
    annexUploads,
  } = body as {
    deliverableId?: string;
    step?: string;
    editedDocxPath?: string;
    manualFiles?: { kind?: string; name?: string; path?: string; size?: number }[];
    manualVersion?: number;
    annexes?: AnnexInput[];
    annexUploads?: { name?: string }[];
  };
  if (!deliverableId || !step) {
    return NextResponse.json(
      { error: 'deliverableId and step are required' },
      { status: 400 },
    );
  }

  const firmId = session.firmId;
  const supabase = getServiceDbForFirm(firmId);
  const personId = session.user!.notionUserId;

  // Fetch deliverable
  const { data: deliverable, error: delErr } = await supabase
    .from('deliverables')
    .select('*')
    .eq('notion_id', deliverableId)
    .single();

  if (delErr || !deliverable) {
    return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 });
  }

  if (deliverable.status !== DELIVERABLE_STATUS.PRE_FINALIZED) {
    return NextResponse.json(
      { error: `Deliverable is "${deliverable.status}", expected "Pre-finalized"` },
      { status: 400 },
    );
  }

  // Lazy-load the existing DOCX (only needed by preview/confirm; manual finalize
  // skips this because the admin supplies files from outside the system).
  const needsSourceDocx = step === 'preview' || step === 'confirm';
  let docxFile: { file_name: string; file_url: string } | undefined;
  let docxBuffer: Buffer = Buffer.alloc(0);

  if (needsSourceDocx) {
    const { data: latestFiles } = await supabase
      .from('deliverable_files')
      .select('*')
      .eq('deliverable_id', deliverableId)
      .order('version', { ascending: false })
      .limit(10);

    // Never pick an annex as the source document to clean/sign — only the real
    // draft / *_FINAL.docx is a valid source.
    docxFile = latestFiles?.find((f: { file_name: string }) =>
      !isAnnexFile(f.file_name) && f.file_name.toLowerCase().endsWith('.docx'),
    );

    if (!docxFile) {
      return NextResponse.json(
        { error: 'No DOCX file found for this deliverable' },
        { status: 400 },
      );
    }

    const { data: fileData, error: downloadErr } = await supabase.storage
      .from('files')
      .download(docxFile.file_url);

    if (downloadErr || !fileData) {
      return NextResponse.json(
        { error: `Failed to download file: ${downloadErr?.message}` },
        { status: 500 },
      );
    }

    docxBuffer = Buffer.from(await fileData.arrayBuffer());
  }

  // ── Step: Preview (proofread) ─────────────────────────────────
  if (step === 'preview') {
    try {
      // Clean the DOCX first
      const cleanedBuffer = await cleanDocx(docxBuffer);

      // Upload cleaned DOCX to temp storage for SuperDoc preview
      const tempPath = firmStoragePath(firmId, `temp/finalize/${deliverableId}_preview.docx`);
      await supabase.storage.from('files').upload(tempPath, cleanedBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      });
      const { data: signedUrlData } = await supabase.storage
        .from('files')
        .createSignedUrl(tempPath, 3600);

      // Proofread: extract text → AI check (best-effort, don't block on failure)
      let corrections: { original: string; corrected: string; reason: string }[] = [];
      let proofreadSummary = 'Document cleaned successfully.';
      try {
        const mammoth = await import('mammoth');
        const { value: text } = await mammoth.extractRawText({ buffer: cleanedBuffer });
        const result = await proofreadDocument(firmId, text);
        corrections = result.corrections;
        proofreadSummary = result.summary;
      } catch (proofErr) {
        console.warn('[finalize/preview] Proofreading skipped:', proofErr instanceof Error ? proofErr.message : proofErr);
        proofreadSummary = 'Proofreading was skipped due to a text extraction issue. You can still review and finalize the document.';
      }

      return NextResponse.json({
        ok: true,
        corrections,
        summary: proofreadSummary,
        fileName: docxFile!.file_name,
        cleanedDocxUrl: signedUrlData?.signedUrl ?? null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Preview failed';
      console.error('[finalize/preview]', message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // ── Step: Edited prepare (signed URL for the SuperDoc-edited DOCX) ──
  // The edited document can carry embedded images, so it goes to a temp path
  // via a signed URL rather than base64-in-JSON (4.5 MB serverless body cap).
  if (step === 'edited-prepare') {
    const path = editedDocxTempPath(firmId, deliverableId);
    const { data, error } = await supabase.storage
      .from('files')
      .createSignedUploadUrl(path, { upsert: true });
    if (error || !data) {
      console.error('[finalize/edited-prepare] createSignedUploadUrl failed:', error);
      return NextResponse.json({ error: 'Failed to prepare upload' }, { status: 500 });
    }
    return NextResponse.json({ path, signedUrl: data.signedUrl, token: data.token });
  }

  // ── Step: Confirm (generate files + update status) ────────────
  if (step === 'confirm') {
    try {
      // 1. Use edited DOCX from SuperDoc if provided (uploaded to a temp path
      //    via edited-prepare), otherwise clean the original.
      let cleanedBuffer: Buffer;
      if (editedDocxPath) {
        // edited-prepare mints exactly one path for this firm and deliverable.
        // Anything else is a key the caller picked, and it would be downloaded
        // with service-role rights and then written out as this deliverable's
        // final document.
        if (editedDocxPath !== editedDocxTempPath(firmId, deliverableId)) {
          return NextResponse.json({ error: 'Invalid editedDocxPath' }, { status: 400 });
        }
        const { data: editedData, error: editedErr } = await supabase.storage
          .from('files')
          .download(editedDocxPath);
        if (editedErr || !editedData) {
          throw new Error(`Failed to download edited DOCX: ${editedErr?.message}`);
        }
        cleanedBuffer = Buffer.from(await editedData.arrayBuffer());
      } else {
        cleanedBuffer = await cleanDocx(docxBuffer);
      }

      // Clean up temp preview + edited files (fire-and-forget)
      supabase.storage
        .from('files')
        .remove([
          firmStoragePath(firmId, `temp/finalize/${deliverableId}_preview.docx`),
          firmStoragePath(firmId, `temp/finalize/${deliverableId}_edited.docx`),
        ])
        .catch(() => {});

      // 2. Gather signatories from reviewers (final first, then initial)
      const reviewers: string[] = deliverable.reviewer_ids ?? [];
      const signatoryIds: string[] = [];
      if (reviewers.length > 1) signatoryIds.push(reviewers[reviewers.length - 1]); // final
      if (reviewers.length > 0) signatoryIds.push(reviewers[0]); // initial

      const signatories: Signatory[] = [];
      if (signatoryIds.length > 0) {
        const { data: teamMembers } = await supabase
          .from('team')
          .select('person_id, name, position, signature_url')
          .in('person_id', signatoryIds);

        if (teamMembers) {
          for (const member of teamMembers) {
            if (!member.signature_url) continue;

            // Download signature image
            const { data: sigData } = await supabase.storage
              .from('files')
              .download(member.signature_url);

            if (sigData) {
              signatories.push({
                personId: member.person_id,
                name: member.name,
                position: member.position,
                signatureBuffer: Buffer.from(await sigData.arrayBuffer()),
              });
            }
          }
        }
      }

      // 3. Determine next version
      const { data: existingFiles } = await supabase
        .from('deliverable_files')
        .select('version')
        .eq('deliverable_id', deliverableId)
        .order('version', { ascending: false })
        .limit(1);

      const nextVersion = (existingFiles?.[0]?.version ?? 0) + 1;

      // 4. Base name for output files
      const baseName = baseDocumentName(docxFile!.file_name);

      // 5. Upload clean DOCX (no signatures)
      const cleanDocxName = `${baseName}_FINAL.docx`;
      const cleanDocxPath = firmStoragePath(firmId, `${deliverableId}/v${nextVersion}/${sanitizeStorageName(cleanDocxName)}`);

      const { error: cleanUploadErr } = await supabase.storage
        .from('files')
        .upload(cleanDocxPath, cleanedBuffer, {
          contentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          upsert: false,
        });

      if (cleanUploadErr) {
        throw new Error(`Failed to upload clean DOCX: ${cleanUploadErr.message}`);
      }

      // Insert DB record for clean DOCX
      await supabase.from('deliverable_files').insert({
        deliverable_id: deliverableId,
        version: nextVersion,
        file_name: cleanDocxName,
        file_url: cleanDocxPath,
        file_size: cleanedBuffer.length,
        uploaded_by: personId,
        action: 'finalized',
      });

      // 6. Insert signatures + convert to PDF
      let signedPdfPath: string | null = null;
      let signedPdfName: string | null = null;

      const signedDocx =
        signatories.length > 0
          ? await insertSignatures(cleanedBuffer, signatories)
          : cleanedBuffer;

      await requireFeature(firmId, 'docx_pdf');
      const pdfBuffer = await convertDocxToPdf(firmId, signedDocx, `${baseName}_FINAL.docx`);
      signedPdfName = `${baseName}_FINAL_SIGNED.pdf`;
      signedPdfPath = firmStoragePath(firmId, `${deliverableId}/v${nextVersion}/${sanitizeStorageName(signedPdfName)}`);

      const { error: pdfUploadErr } = await supabase.storage
        .from('files')
        .upload(signedPdfPath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: false,
        });

      if (pdfUploadErr) {
        throw new Error(`Failed to upload PDF: ${pdfUploadErr.message}`);
      }

      // Insert DB record for PDF
      await supabase.from('deliverable_files').insert({
        deliverable_id: deliverableId,
        version: nextVersion,
        file_name: signedPdfName,
        file_url: signedPdfPath,
        file_size: pdfBuffer.length,
        uploaded_by: personId,
        action: 'finalized',
      });

      // 6b. Attach annexes (matter files + uploads) as labeled sibling files.
      const { created: attachedAnnexes, failed: failedAnnexes } = await attachAnnexes(
        supabase,
        firmId,
        deliverableId,
        nextVersion,
        personId,
        Array.isArray(annexes) ? annexes : [],
      );

      // 7. Update status: Pre-finalized → Outbox
      // Keep currently_with_ids so the assigned lawyer can still see it and mark it Filed/Sent out.
      await supabase
        .from('deliverables')
        .update({ status: DELIVERABLE_STATUS.OUTBOX })
        .eq('notion_id', deliverableId);

      // 8. Log the action
      const annexNote = attachedAnnexes.length
        ? ` ${attachedAnnexes.length} annex${attachedAnnexes.length === 1 ? '' : 'es'} attached.`
        : '';
      await supabase.from('deliverable_actions').insert({
        deliverable_id: deliverableId,
        action: 'Finalized',
        old_status: DELIVERABLE_STATUS.PRE_FINALIZED,
        new_status: DELIVERABLE_STATUS.OUTBOX,
        performed_by: personId,
        comment: `Document finalized. Clean DOCX and signed PDF generated (v${nextVersion}).${annexNote}`,
      });

      // 8b. Notify drafters + reviewers that it's finalized and ready to send.
      after(() =>
        generateFinalizedNotifications({ notionId: deliverableId, performedBy: personId, firmId }).catch(
          (err) => console.error('[finalize/confirm] Notification generation failed:', err.message),
        ),
      );

      // 9. SharePoint sync handled by database webhook (on_deliverable_file_finalized)

      // 10. Generate signed URLs for response
      const { data: urls } = await supabase.storage
        .from('files')
        .createSignedUrls(
          [cleanDocxPath, signedPdfPath].filter(Boolean) as string[],
          3600,
        );

      const urlMap: Record<string, string> = {};
      urls?.forEach((u) => {
        if (u.signedUrl && u.path) urlMap[u.path] = u.signedUrl;
      });

      return NextResponse.json({
        ok: true,
        version: nextVersion,
        cleanDocxUrl: urlMap[cleanDocxPath] ?? null,
        signedPdfUrl: signedPdfPath ? urlMap[signedPdfPath] ?? null : null,
        signatoryCount: signatories.length,
        annexCount: attachedAnnexes.length,
        warnings: [
          ...(signatoryIds.length > signatories.length
            ? ['Some signatories are missing signature images']
            : []),
          ...failedAnnexes.map((n) => `Annex could not be attached: ${n}`),
        ],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Finalization failed';
      console.error('[finalize/confirm]', message);
      return NextResponse.json(
        { error: message },
        {
          status:
            err instanceof GraphNotConfiguredError || err instanceof FeatureDisabledError
              ? 503
              : 500,
        },
      );
    }
  }

  // ── Step: Annex prepare (mint signed upload URLs for uploaded annexes) ──
  // Annexes the admin uploads (vs. picks from matter files) land on a temp path
  // first; the confirm/manual step then copies them into the version folder
  // under their "Annex X - …" name. Same signed-URL rationale as manual-prepare.
  if (step === 'annex-prepare') {
    const reqFiles = Array.isArray(annexUploads) ? annexUploads : [];
    if (reqFiles.length === 0) {
      return NextResponse.json({ error: 'No annex files to prepare' }, { status: 400 });
    }

    const uploads: { name: string; path: string; signedUrl: string; token: string }[] = [];
    for (let i = 0; i < reqFiles.length; i++) {
      const f = reqFiles[i];
      if (!f?.name) continue;
      const path = `${annexTempPrefix(firmId, deliverableId)}${i}-${sanitizeStorageName(f.name)}`;
      const { data, error } = await supabase.storage
        .from('files')
        .createSignedUploadUrl(path, { upsert: true });
      if (error || !data) {
        console.error('[finalize/annex-prepare] createSignedUploadUrl failed:', error);
        return NextResponse.json(
          { error: `Failed to prepare annex upload for ${f.name}` },
          { status: 500 },
        );
      }
      uploads.push({ name: f.name, path, signedUrl: data.signedUrl, token: data.token });
    }

    if (uploads.length === 0) {
      return NextResponse.json({ error: 'No valid annex files' }, { status: 400 });
    }

    return NextResponse.json({ uploads });
  }

  // ── Step: Manual prepare (mint signed upload URLs) ────────────
  // Final files (signed PDFs, image-heavy DOCX) routinely run to tens of MB.
  // Base64-in-JSON would blow past the 4.5 MB serverless request-body cap and
  // bounce back a plain-text 413, so the client uploads straight to storage via
  // signed URLs and only sends the paths back in the `manual` step.
  if (step === 'manual-prepare') {
    const reqFiles = Array.isArray(manualFiles) ? manualFiles : [];
    if (reqFiles.length === 0) {
      return NextResponse.json({ error: 'No files to prepare' }, { status: 400 });
    }

    const { data: existingFiles } = await supabase
      .from('deliverable_files')
      .select('version')
      .eq('deliverable_id', deliverableId)
      .order('version', { ascending: false })
      .limit(1);
    const nextVersion = (existingFiles?.[0]?.version ?? 0) + 1;

    const uploads: {
      kind: string;
      name: string;
      path: string;
      signedUrl: string;
      token: string;
    }[] = [];

    for (const f of reqFiles) {
      if (!f?.name) continue;
      const path = firmStoragePath(firmId, `${deliverableId}/v${nextVersion}/${sanitizeStorageName(f.name)}`);
      const { data, error } = await supabase.storage
        .from('files')
        .createSignedUploadUrl(path, { upsert: true });
      if (error || !data) {
        console.error('[finalize/manual-prepare] createSignedUploadUrl failed:', error);
        return NextResponse.json(
          { error: `Failed to prepare upload for ${f.name}` },
          { status: 500 },
        );
      }
      uploads.push({
        kind: f.kind ?? '',
        name: f.name,
        path,
        signedUrl: data.signedUrl,
        token: data.token,
      });
    }

    if (uploads.length === 0) {
      return NextResponse.json({ error: 'No valid files' }, { status: 400 });
    }

    return NextResponse.json({ version: nextVersion, uploads });
  }

  // ── Step: Manual (record pre-finalized files already in storage) ──
  // Skips AI proofread, cleanup, signature insertion, and PDF generation.
  // Admin supplies files finalized outside the system; they were PUT straight
  // to storage by the client during `manual-prepare`, so here we only persist
  // the rows and flip status to Outbox.
  if (step === 'manual') {
    try {
      const confirmed = (Array.isArray(manualFiles) ? manualFiles : []).filter(
        (f): f is { kind?: string; name: string; path: string; size?: number } =>
          !!f?.path && !!f?.name,
      );
      if (confirmed.length === 0) {
        return NextResponse.json(
          { error: 'At least one uploaded file (DOCX or PDF) is required' },
          { status: 400 },
        );
      }

      // Trust the version minted by manual-prepare; recompute as a fallback.
      let version = typeof manualVersion === 'number' ? manualVersion : 0;
      if (!version) {
        const { data: existingFiles } = await supabase
          .from('deliverable_files')
          .select('version')
          .eq('deliverable_id', deliverableId)
          .order('version', { ascending: false })
          .limit(1);
        version = (existingFiles?.[0]?.version ?? 0) + 1;
      }

      // Verify each manually-uploaded object exists in Storage before recording
      // rows — a lost client PUT must not leave a dangling "finalized" file.
      const verified = await verifyStorageObjects(
        supabase,
        'files',
        confirmed.map((f) => f.path),
      );
      const missingFiles = confirmed.filter((f) => !verified.get(f.path)?.exists);
      if (missingFiles.length > 0) {
        return NextResponse.json(
          {
            error: `Upload did not complete for ${missingFiles.length} file(s): ${missingFiles
              .map((m) => m.name)
              .join(', ')}. Please re-add and try again.`,
            missing: missingFiles.map((m) => m.name),
          },
          { status: 422 },
        );
      }

      const uploaded: { path: string; name: string }[] = [];
      for (const f of confirmed) {
        await supabase.from('deliverable_files').insert({
          deliverable_id: deliverableId,
          version,
          file_name: f.name,
          file_url: f.path,
          file_size: verified.get(f.path)?.size ?? (typeof f.size === 'number' ? f.size : null),
          uploaded_by: personId,
          action: 'finalized',
        });
        uploaded.push({ path: f.path, name: f.name });
      }

      // Attach annexes (matter files + uploads) as labeled sibling files.
      const { created: attachedAnnexes, failed: failedAnnexes } = await attachAnnexes(
        supabase,
        firmId,
        deliverableId,
        version,
        personId,
        Array.isArray(annexes) ? annexes : [],
      );

      // Flip status to Outbox
      // Keep currently_with_ids so the assigned lawyer can still see it and mark it Filed/Sent out.
      await supabase
        .from('deliverables')
        .update({ status: DELIVERABLE_STATUS.OUTBOX })
        .eq('notion_id', deliverableId);

      // Log the action
      const annexNote = attachedAnnexes.length
        ? ` ${attachedAnnexes.length} annex${attachedAnnexes.length === 1 ? '' : 'es'} attached.`
        : '';
      await supabase.from('deliverable_actions').insert({
        deliverable_id: deliverableId,
        action: 'Finalized',
        old_status: DELIVERABLE_STATUS.PRE_FINALIZED,
        new_status: DELIVERABLE_STATUS.OUTBOX,
        performed_by: personId,
        comment: `Manually finalized. ${uploaded.length} file${uploaded.length === 1 ? '' : 's'} uploaded (v${version}).${annexNote}`,
      });

      // Notify drafters + reviewers that it's finalized and ready to send.
      after(() =>
        generateFinalizedNotifications({ notionId: deliverableId, performedBy: personId, firmId }).catch(
          (err) => console.error('[finalize/manual] Notification generation failed:', err.message),
        ),
      );

      // Generate signed URLs for response
      const { data: urls } = await supabase.storage
        .from('files')
        .createSignedUrls(
          uploaded.map((u) => u.path),
          3600,
        );

      const urlMap: Record<string, string> = {};
      urls?.forEach((u) => {
        if (u.signedUrl && u.path) urlMap[u.path] = u.signedUrl;
      });

      const docxUploaded = uploaded.find((u) => u.name.toLowerCase().endsWith('.docx'));
      const pdfUploaded = uploaded.find((u) => u.name.toLowerCase().endsWith('.pdf'));

      return NextResponse.json({
        ok: true,
        version,
        cleanDocxUrl: docxUploaded ? urlMap[docxUploaded.path] ?? null : null,
        signedPdfUrl: pdfUploaded ? urlMap[pdfUploaded.path] ?? null : null,
        signatoryCount: 0,
        annexCount: attachedAnnexes.length,
        warnings: failedAnnexes.map((n) => `Annex could not be attached: ${n}`),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Manual finalization failed';
      console.error('[finalize/manual]', message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Invalid step' }, { status: 400 });
}

/**
 * GET /api/admin/finalize?action=latest-file&deliverableId=...
 * Returns the storage path of the latest DOCX file for a deliverable.
 */
export async function GET(req: Request) {
  const session = await assertAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const deliverableId = searchParams.get('deliverableId');

  if (action === 'latest-file' && deliverableId) {
    const supabase = getServiceDbForFirm(session.firmId);
    const { data } = await supabase
      .from('deliverable_files')
      .select('file_url, file_name')
      .eq('deliverable_id', deliverableId)
      .order('version', { ascending: false })
      .limit(10);

    const docx = data?.find((f: { file_name: string }) =>
      !isAnnexFile(f.file_name) && f.file_name.toLowerCase().endsWith('.docx'),
    );
    const target = docx ?? data?.find((f: { file_name: string }) => !isAnnexFile(f.file_name)) ?? data?.[0];

    if (!target) {
      return NextResponse.json({ error: 'No file found' }, { status: 404 });
    }

    return NextResponse.json({ fileUrl: target.file_url, fileName: target.file_name });
  }

  // Returns every file in the deliverable's most recent version.
  if (action === 'latest-version-files' && deliverableId) {
    const supabase = getServiceDbForFirm(session.firmId);

    // Find the latest version number for this deliverable
    const { data: latestRow } = await supabase
      .from('deliverable_files')
      .select('version')
      .eq('deliverable_id', deliverableId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestRow) {
      return NextResponse.json({ version: null, files: [] });
    }

    const { data: files } = await supabase
      .from('deliverable_files')
      .select('file_url, file_name, file_size, created_at')
      .eq('deliverable_id', deliverableId)
      .eq('version', latestRow.version)
      .order('created_at', { ascending: true });

    return NextResponse.json({
      version: latestRow.version,
      files: (files ?? []).map((f) => ({
        fileUrl: f.file_url,
        fileName: f.file_name,
        fileSize: f.file_size ?? null,
      })),
    });
  }

  // Matter files available to attach as annexes — flattened from each `files`
  // row's `file_urls` array (only entries backed by a storage object).
  if (action === 'matter-files' && deliverableId) {
    const supabase = getServiceDbForFirm(session.firmId);

    const { data: del } = await supabase
      .from('deliverables')
      .select('matter_id, matter_name')
      .eq('notion_id', deliverableId)
      .maybeSingle();

    if (!del?.matter_id) {
      return NextResponse.json({ matterName: del?.matter_name ?? null, files: [] });
    }

    const { data: rows } = await supabase
      .from('files')
      .select('notion_id, name, file_urls, created_time')
      .eq('matter_id', del.matter_id)
      .order('created_time', { ascending: false })
      .limit(500);

    const files: { fileId: string; recordName: string; sourceName: string; path: string }[] = [];
    for (const r of rows ?? []) {
      const urls = Array.isArray(r.file_urls) ? r.file_urls : [];
      for (const u of urls) {
        const path = (u as { path?: string })?.path;
        if (!path) continue;
        const sourceName = (u as { name?: string })?.name ?? r.name ?? 'file';
        files.push({
          fileId: `${r.notion_id}::${path}`,
          recordName: r.name ?? sourceName,
          sourceName,
          path,
        });
      }
    }

    return NextResponse.json({ matterName: del.matter_name ?? null, files });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
