import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { mintId } from '@/lib/ids';
import { getMatterTeamByRole } from '@/lib/queries/team-roles';
import { resolveStatusReportReviewer } from '@/lib/status-report-reviewer';
import { uploadToClaudeFiles, draftStatusReport } from '@/lib/ai/claude';
import { generateStatusReportDocx } from '@/lib/docx/status-report';
import { loadDocxBrand } from '@/lib/docx/brand';
import { FILE_ACTION_PREPARE_STATUS_REPORT, markFileActedUpon, fetchFileActionState } from '@/lib/file-action';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { manilaToday, addDays } from '@/lib/dates';

export const maxDuration = 120; // Skills API can take longer


export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();

  // Two input modes:
  //   A. { fileId, fileName, matterId }  — incoming file (Inbox button).
  //   B. { deliverableId }               — filed deliverable (reports on the
  //                                        latest deliverable_files version).
  // Both funnel into the same drafting / DOCX / deliverable-creation flow.
  const sourceDeliverableId: string | undefined = body.deliverableId;
  const fileIdArg: string | undefined = body.fileId;
  const fileNameArg: string | undefined = body.fileName;
  const matterIdArg: string | undefined = body.matterId;

  if (!sourceDeliverableId && (!fileIdArg || !fileNameArg || !matterIdArg)) {
    return NextResponse.json({
      error: 'Provide either { fileId, fileName, matterId } or { deliverableId }',
    }, { status: 400 });
  }

  // Exclusivity guard — an incoming file can only be acted upon by one user.
  // Using files.action_taken + files.acted_upon_by_ids as the source of truth:
  // if action_taken is non-empty, another action has already been chosen and
  // this request is rejected with 409.
  // Only applies to fileId mode — deliverableId mode operates on our own
  // outgoing filings and doesn't share this constraint.
  if (fileIdArg) {
    const state = await fetchFileActionState(fileIdArg, session.firmId);
    if (state?.actionTaken) {
      return NextResponse.json({
        error: 'already_acted_upon',
        existing: {
          action_taken: state.actionTaken,
          acted_upon_by_ids: state.actedUponByIds,
        },
      }, { status: 409 });
    }
  }

  try {
    const supabase = getServiceDbForFirm(session.firmId);

    // ── 1. Resolve sourceMode-specific context ───────────────
    //
    // Normalize to:
    //   - matterId, fileName
    //   - attachmentSources: [{ name, path?, url?, claudeFileId? }]
    //
    // The downstream flow uploads anything without a claudeFileId to
    // Claude Files API, drafts the report, renders DOCX, and creates a
    // Status Report deliverable.
    let matterId: string;
    let fileName: string;
    type SourceAttachment = {
      name: string;
      path?: string;
      url: string;
      /** cached claude_file_id from a prior analysis, if any */
      claudeFileId?: string;
      /** Linkage back to origin row so newly-uploaded claudeFileIds can be
          persisted into the right analysis row (one of these is set). */
      originFileId?: string;
      originDeliverableFileId?: number;
    };
    const sources: SourceAttachment[] = [];

    if (sourceDeliverableId) {
      // Mode B — load the deliverable + its latest version.
      const { data: deliv, error: dErr } = await supabase
        .from('deliverables')
        .select('notion_id, name, matter_id')
        .eq('notion_id', sourceDeliverableId)
        .single();
      if (dErr || !deliv) {
        return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 });
      }
      if (!deliv.matter_id) {
        return NextResponse.json({ error: 'Deliverable has no matter' }, { status: 400 });
      }
      matterId = deliv.matter_id;
      fileName = deliv.name ?? 'Filing';

      const { data: latest } = await supabase
        .from('deliverable_files')
        .select('id, version, file_name, file_url')
        .eq('deliverable_id', sourceDeliverableId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latest) {
        return NextResponse.json({ error: 'Deliverable has no filed version yet' }, { status: 400 });
      }

      // Look up any cached claude_file_id from a prior analysis on this version.
      const { data: analysisRow } = await supabase
        .from('file_analyses')
        .select('claude_file_id')
        .eq('deliverable_file_id', latest.id)
        .eq('status', 'completed')
        .not('claude_file_id', 'is', null)
        .maybeSingle();

      sources.push({
        name: latest.file_name,
        // file_url here can be either a bare storage path or a full URL — both
        // flow into the same download-then-upload block below.
        path: latest.file_url && !latest.file_url.startsWith('http') ? latest.file_url : undefined,
        url: latest.file_url,
        claudeFileId: analysisRow?.claude_file_id ?? undefined,
        originDeliverableFileId: latest.id,
      });
    } else {
      // Mode A — existing incoming-file path. Load the files row and use its attachments.
      matterId = matterIdArg!;
      fileName = fileNameArg!;

      const { data: fileRow, error: fileErr } = await supabase
        .from('files')
        .select('name, file_urls, matter_name')
        .eq('notion_id', fileIdArg!)
        .single();
      if (fileErr || !fileRow) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      const fileUrls: { name: string; url: string; path?: string }[] =
        typeof fileRow.file_urls === 'string'
          ? JSON.parse(fileRow.file_urls)
          : (fileRow.file_urls ?? []);

      for (const raw of fileUrls) {
        const { data: analysisRow } = await supabase
          .from('file_analyses')
          .select('claude_file_id')
          .eq('file_id', fileIdArg!)
          .eq('attachment_name', raw.name)
          .eq('status', 'completed')
          .not('claude_file_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        sources.push({
          name: raw.name,
          path: raw.path,
          url: raw.url,
          claudeFileId: analysisRow?.claude_file_id ?? undefined,
          originFileId: fileIdArg!,
        });
      }
    }

    // ── 2. Common context (team, matter, client) ─────────────

    const team = await getMatterTeamByRole(session.firmId, matterId);
    const reviewer = await resolveStatusReportReviewer(matterId, team, session.firmId);

    const { data: matterRow } = await supabase
      .from('matters')
      .select('name, client_name, client_id, case_title, case_number, court')
      .eq('notion_id', matterId)
      .single();

    const matterName = matterRow?.name ?? '';
    const clientName = matterRow?.client_name ?? '';

    // ── 3. Resolve Claude file IDs for any source without one ──
    //
    // For sources that already have a cached claudeFileId (from prior
    // analysis), reuse. For the rest, download and upload.
    const claudeFileIds: string[] = [];

    for (const raw of sources) {
      if (raw.claudeFileId) {
        claudeFileIds.push(raw.claudeFileId);
        console.log(`[status-report] Re-using claude_file_id for ${raw.name}: ${raw.claudeFileId}`);
        continue;
      }

      // No existing upload — download and upload to Claude Files API
      let storagePath = raw.path;
      if (!storagePath) {
        const match = raw.url.match(/\/storage\/v1\/object\/sign\/files\/([^?]+)/);
        if (match) storagePath = decodeURIComponent(match[1]);
      }

      let attachmentUrl = raw.url;
      if (storagePath) {
        const { data: signData } = await supabase.storage
          .from('files')
          .createSignedUrl(storagePath, 60 * 60);
        attachmentUrl = signData?.signedUrl ?? raw.url;
      }

      if (!attachmentUrl) continue;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60_000);
        try {
          const response = await fetch(attachmentUrl, { signal: controller.signal });
          if (!response.ok) throw new Error(`Download failed: ${response.status}`);
          const buffer = Buffer.from(await response.arrayBuffer());

          const claudeFileId = await uploadToClaudeFiles({ firmId: session.firmId, feature: 'ai_analysis' }, buffer, raw.name);
          claudeFileIds.push(claudeFileId);
          console.log(`[status-report] Uploaded ${raw.name} to Claude Files: ${claudeFileId}`);

          // Persist claude_file_id so future requests reuse it. Route to the
          // right row based on the source's origin (incoming file vs deliverable version).
          if (raw.originDeliverableFileId) {
            const { count } = await supabase.from('file_analyses')
              .update({ claude_file_id: claudeFileId })
              .eq('deliverable_file_id', raw.originDeliverableFileId);
            if (!count) {
              await supabase.from('file_analyses').insert({
                deliverable_file_id: raw.originDeliverableFileId,
                attachment_name: raw.name,
                attachment_url: raw.url,
                claude_file_id: claudeFileId,
                status: 'pending',
                analyzed_by: 'status-report',
              }).then(({ error: insertErr }) => {
                if (insertErr) console.warn('[status-report] Failed to save claude_file_id:', insertErr.message);
              });
            }
          } else if (raw.originFileId) {
            const { count } = await supabase.from('file_analyses')
              .update({ claude_file_id: claudeFileId })
              .eq('file_id', raw.originFileId)
              .eq('attachment_name', raw.name);
            if (!count) {
              await supabase.from('file_analyses').insert({
                file_id: raw.originFileId,
                attachment_name: raw.name,
                attachment_url: raw.url,
                claude_file_id: claudeFileId,
                status: 'pending',
                analyzed_by: 'status-report',
              }).then(({ error: insertErr }) => {
                if (insertErr) console.warn('[status-report] Failed to save claude_file_id:', insertErr.message);
              });
            }
          }
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        console.error(
          `[status-report] Failed to upload ${raw.name}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // ── 3. Fetch client details ─────────────────────────────────

    let clientDetails: {
      name?: string;
      full_company_name?: string;
      contact_email?: string;
      point_persons?: string | string[];
    } | null = null;

    if (matterRow?.client_id) {
      const { data: clientRow } = await supabase
        .from('clients')
        .select('name, full_company_name, contact_email, point_persons')
        .eq('notion_id', matterRow.client_id)
        .maybeSingle();
      clientDetails = clientRow;
    }

    if (!clientDetails && matterRow?.client_name) {
      const { data: clientRow } = await supabase
        .from('clients')
        .select('name, full_company_name, contact_email, point_persons')
        .eq('name', matterRow.client_name)
        .maybeSingle();
      clientDetails = clientRow;
    }

    // ── 4. AI-draft the status report content ──────────────────

    const draftArgs = {
      firmId: session.firmId,
      fileName,
      matter: {
        name: matterRow?.name ?? undefined,
        caseTitle: matterRow?.case_title ?? undefined,
        caseNumber: matterRow?.case_number ?? undefined,
        court: matterRow?.court ?? undefined,
        clientName: matterRow?.client_name ?? undefined,
      },
      client: clientDetails
        ? {
            name: clientDetails.name ?? undefined,
            fullCompanyName: clientDetails.full_company_name ?? undefined,
            contactEmail: clientDetails.contact_email ?? undefined,
            pointPersons: Array.isArray(clientDetails.point_persons)
              ? clientDetails.point_persons
              : clientDetails.point_persons
                ? [clientDetails.point_persons]
                : undefined,
          }
        : undefined,
    };

    let draft;
    try {
      draft = await draftStatusReport({
        ...draftArgs,
        claudeFileId: claudeFileIds[0],
        documentText: claudeFileIds.length === 0
          ? '(No document text available — draft based on matter details only)'
          : undefined,
      });
    } catch (err: unknown) {
      // Recover from stale cached claude_file_id: prior buggy runs deleted
      // the underlying Claude file after caching its id, or the file aged
      // out of Claude's TTL. Clear the stale row and re-upload from
      // storage so the user isn't stuck.
      const msg = err instanceof Error ? err.message : String(err);
      const staleFileId = msg.match(/File `(file_[A-Za-z0-9]+)` not found/)?.[1];
      const isStaleCache =
        staleFileId &&
        sources.some((s) => s.claudeFileId === staleFileId);
      if (!isStaleCache) throw err;

      console.warn(`[status-report] Cached claude_file_id ${staleFileId} is stale — clearing and re-uploading`);
      await supabase
        .from('file_analyses')
        .update({ claude_file_id: null })
        .eq('claude_file_id', staleFileId);

      // Re-upload the source(s) that were using the stale ID.
      const newIds: string[] = [];
      for (let i = 0; i < sources.length; i++) {
        const raw = sources[i];
        if (raw.claudeFileId !== staleFileId) {
          newIds.push(claudeFileIds[i]);
          continue;
        }
        let storagePath = raw.path;
        if (!storagePath) {
          const match = raw.url.match(/\/storage\/v1\/object\/sign\/files\/([^?]+)/);
          if (match) storagePath = decodeURIComponent(match[1]);
        }
        let attachmentUrl = raw.url;
        if (storagePath) {
          const { data: signData } = await supabase.storage
            .from('files')
            .createSignedUrl(storagePath, 60 * 60);
          attachmentUrl = signData?.signedUrl ?? raw.url;
        }
        if (!attachmentUrl) continue;
        const response = await fetch(attachmentUrl);
        if (!response.ok) throw new Error(`Re-upload download failed: ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        const newId = await uploadToClaudeFiles({ firmId: session.firmId, feature: 'ai_analysis' }, buffer, raw.name);
        newIds.push(newId);
        if (raw.originDeliverableFileId) {
          await supabase.from('file_analyses')
            .update({ claude_file_id: newId })
            .eq('deliverable_file_id', raw.originDeliverableFileId);
        } else if (raw.originFileId) {
          await supabase.from('file_analyses')
            .update({ claude_file_id: newId })
            .eq('file_id', raw.originFileId)
            .eq('attachment_name', raw.name);
        }
      }
      claudeFileIds.length = 0;
      claudeFileIds.push(...newIds);

      draft = await draftStatusReport({
        ...draftArgs,
        claudeFileId: claudeFileIds[0],
        documentText: claudeFileIds.length === 0
          ? '(No document text available — draft based on matter details only)'
          : undefined,
      });
    }

    // ── 5. Generate DOCX via Skills API ────────────────────────

    const today = manilaToday();
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const formattedDate = `${Number(today.slice(8, 10))} ${months[Number(today.slice(5, 7)) - 1]} ${today.slice(0, 4)}`;

    const signers = team.length > 0
      ? team.map((m) => ({ name: m.name, position: m.position }))
      : [{ name: '_______________', position: undefined }];

    const docxBuffer = await generateStatusReportDocx({
      date: formattedDate,
      addressee: {
        name: draft.addressee.name,
        address: draft.addressee.address ?? undefined,
        email: draft.addressee.email ?? undefined,
        throughName: draft.addressee.throughName ?? undefined,
        throughTitle: draft.addressee.throughTitle ?? undefined,
      },
      salutation: draft.salutation,
      reLines: draft.reLines,
      bodyParagraphs: draft.bodyParagraphs,
      annexes: draft.annexes.length > 0 ? draft.annexes : undefined,
      signers,
      brand: await loadDocxBrand(session.firmId),
    });

    console.log(`[status-report] DOCX generated (${(docxBuffer.length / 1024).toFixed(1)}KB)`);

    // ── 6. Resolve target deliverable (populate existing shell vs create new) ──
    //
    // When drafting off a filed deliverable (sourceDeliverableId), a Status
    // Report "shell" was likely already auto-created by
    // ensureStatusReportForFiledDeliverable when the deliverable transitioned
    // to "Filed or Sent out". In that case, populate the shell with a new
    // version of its deliverable_files instead of spawning a second
    // Status Report for the same filing.
    let existingShell: { notion_id: string; name: string | null } | null = null;
    if (sourceDeliverableId) {
      const { data: shell } = await supabase
        .from('deliverables')
        .select('notion_id, name')
        .eq('source_deliverable_id', sourceDeliverableId)
        .eq('type', 'Status Report')
        .order('created_time', { ascending: false })
        .limit(1)
        .maybeSingle();
      existingShell = shell ?? null;
    }

    const deliverableId = existingShell?.notion_id ?? mintId('deliverable');
    const deliverableName = existingShell?.name ?? `Status Report - ${fileName}`;
    const safeDeliverableName = deliverableName.replace(/[^a-zA-Z0-9._\- ]/g, '_');

    // ── 7. Upload DOCX to Supabase Storage ─────────────────────
    //
    // If populating an existing shell, this is the next version (v2+),
    // otherwise v1. Store path uses the resolved deliverable_id so the
    // file sits under the right folder either way.

    let nextVersion = 1;
    if (existingShell) {
      const { data: lastVersion } = await supabase
        .from('deliverable_files')
        .select('version')
        .eq('deliverable_id', existingShell.notion_id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      nextVersion = (lastVersion?.version ?? 0) + 1;
    }

    const storagePath = `${deliverableId}/v${nextVersion}/${safeDeliverableName}.docx`;

    const { error: uploadErr } = await supabase.storage
      .from('files')
      .upload(storagePath, docxBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      });

    if (uploadErr) {
      throw new Error(`Storage upload failed: ${uploadErr.message}`);
    }

    // ── 8. Create deliverable or attach to existing shell ──────

    if (existingShell) {
      // Populate the auto-created shell: insert the new version + log action.
      const { error: insertFileErr } = await supabase.from('deliverable_files').insert({
        deliverable_id: existingShell.notion_id,
        version: nextVersion,
        file_name: `${safeDeliverableName}.docx`,
        file_url: storagePath,
        file_size: docxBuffer.length,
        uploaded_by: 'system',
        action: 'ai-generated',
      });
      if (insertFileErr) {
        console.error('[status-report] Failed to attach DOCX to shell:', insertFileErr.message);
      }
      console.log(`[status-report] Populated existing shell ${existingShell.notion_id} with v${nextVersion}`);
    } else {
      // No existing shell — create a new Status Report deliverable as before.
      const externalDueDate = addDays(today, 1);

      const { error: delivErr } = await supabase.from('deliverables').insert({
        notion_id: deliverableId,
        notion_url: '',
        name: deliverableName,
        matter_id: matterId,
        matter_name: matterName,
        client_name: clientName,
        type: 'Status Report',
        status: DELIVERABLE_STATUS.DRAFTING,
        drafter_ids: [],
        reviewer_ids: reviewer ? [reviewer.personId] : [],
        currently_with_ids: reviewer ? [reviewer.personId] : [],
        external_due_date: externalDueDate,
        review_dates: [],
        priority: '',
        date_done: null,
        revision_count: 0,
        parent_deliverable_id: null,
        related_hearing_id: null,
        source_deliverable_id: sourceDeliverableId ?? null,
        source_file_id: fileIdArg ?? null,
        created_time: new Date().toISOString(),
        notion_last_edited_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      });
      if (delivErr) {
        throw new Error(`Deliverable insert failed: ${delivErr.message}`);
      }

      const { error: fileErr } = await supabase.from('deliverable_files').insert({
        deliverable_id: deliverableId,
        version: 1,
        file_name: `${safeDeliverableName}.docx`,
        file_url: storagePath,
        file_size: docxBuffer.length,
        uploaded_by: 'system',
        action: 'ai-generated',
      });
      if (fileErr) {
        throw new Error(`Deliverable file insert failed: ${fileErr.message}`);
      }
    }

    // Claude Files are intentionally NOT deleted at end of request — every
    // ID used here is persisted to file_analyses.claude_file_id for future
    // reuse. Deleting would orphan the cache. Claude's TTL + the periodic
    // cleanupDuplicateClaudeFiles task handle long-term cleanup.

    // ── 9. Mark the file as acted upon (fileId mode only) ──
    // Writes files.action_taken + adds the actor to files.acted_upon_by_ids.
    // Other users' inboxes see the "Prepare Status Report by X" badge and
    // their action buttons disappear. deliverableId mode is our own outgoing
    // filing — no inbox gate applies.
    if (fileIdArg) {
      const actorId = session.user.notionUserId;
      await markFileActedUpon({
        fileId: fileIdArg,
        firmId: session.firmId,
        actorId,
        label: FILE_ACTION_PREPARE_STATUS_REPORT,
      });
    }

    console.log(`[status-report] Deliverable created: ${deliverableName}`);
    return NextResponse.json({ ok: true, deliverableId, deliverableName });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[status-report] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
