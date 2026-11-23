import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/session';
import { isFeatureAvailable } from '@/lib/firm/features';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { validateBody } from '@/lib/validation';
import { generateDocumentDocx } from '@/lib/docx/template-generator';
import { generatePleadingDocx } from '@/lib/docx/pleading-generator';
import { loadDocxBrand } from '@/lib/docx/brand';
import { persistGeneratedDoc } from '@/lib/docx/persist-generated-doc';
import { assembleDraftGrounding, type DraftGrounding } from '@/lib/ai/draft-grounding';
import { composeStatusReport } from '@/lib/ai/compose-status-report';
import { logAudit, getClientIP } from '@/lib/audit';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';

// Grounding retrieval + drafting can run long.
export const maxDuration = 300;

// Draft model policy. 'standard' is the everyday choice; 'complex' opts a hard
// brief into the top-tier model. Both force a single tool call, so the callers
// disable thinking (adaptive thinking is incompatible with forced tool_choice).
const DRAFT_MODELS = {
  standard: 'claude-sonnet-5',
  complex: 'claude-opus-4-8',
} as const;

// Output-token budget by document type. Long-form filings (position papers,
// petitions, memoranda, judicial affidavits) need far more room than a short
// manifestation or letter. The generators stream + continue past a single
// budget, so these are the per-pass ceiling, not a hard document limit.
function tokenBudgetFor(documentType: string, format: 'pleading' | 'letter'): number {
  const t = documentType.toLowerCase();
  if (/position paper|petition|memorandum|memo|judicial affidavit|answer|comment|opposition|brief/.test(t)) {
    return 32_000;
  }
  if (/manifestation|notice|entry of appearance|motion for extension/.test(t)) {
    return 12_000;
  }
  return format === 'letter' ? 16_000 : 24_000;
}

const bodySchema = z.object({
  matterId: z.string().min(1),
  documentType: z.string().trim().min(3).max(200),
  // 'pleading' (no letterhead, Book Antiqua, Efficient Use of Paper Rule),
  // 'letter' (firm letterhead template), or 'status_report' (client status
  // letter, activity aggregated since the last report). Defaults to pleading.
  format: z.enum(['pleading', 'letter', 'status_report']).default('pleading'),
  // Status reports only: aggregate activity since this date (YYYY-MM-DD).
  // Omitted → since the last sent status report, else matter creation.
  sinceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // 'standard' → Sonnet 5; 'complex' → Opus 4.8 for a hard brief.
  model: z.enum(['standard', 'complex']).default('standard'),
  instructions: z.string().trim().max(4000).optional(),
  deliverableType: z.enum(['External', 'Internal', 'For Client']).default('External'),
  createDeliverable: z.boolean().default(true),
  reviewerIds: z.array(z.string()).max(10).optional(),
  signerName: z.string().trim().max(160).optional(),
  signerPosition: z.string().trim().max(160).optional(),
  // Responsive drafting: the matter file (files.notion_id) this draft replies to.
  respondingToFileId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(8).max(64).optional(),
  // Sources the drafter curated out in the grounding panel.
  excludeGrounding: z.object({
    ownWorkTitles: z.array(z.string()).max(50).optional(),
    priorWorkKeys: z.array(z.string()).max(50).optional(),
    kbPageIds: z.array(z.number()).max(50).optional(),
    authorityCaseNumbers: z.array(z.string()).max(50).optional(),
  }).optional(),
});

const MAX_RESPONDING_TEXT = 60_000;

/**
 * POST /api/drafting/generate
 *
 * The Drafting Studio. Grounds a draft in the matter brief + the firm's own
 * prior filings + the KMS, drafts it with Sonnet in the firm's house style,
 * uploads the DOCX, and (by default) creates a draft deliverable so it
 * enters the review chain. Returns the download + the sources it grounded on.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isFeatureAvailable(session.firmId, 'drafting'))) {
    return NextResponse.json({ error: 'The drafting studio is not enabled for this firm.' }, { status: 403 });
  }

  const validation = await validateBody(req, bodySchema);
  if (!validation.success) return validation.response;
  const body = validation.data;

  // RLS: the authed read returns null unless the caller can access the matter.
  const authed = await getSupabaseServerAuthClient();
  const { data: matter } = await authed
    .from('matters')
    .select('notion_id, name, matter_code, type, case_title, case_number, court, client_name, client_id')
    .eq('notion_id', body.matterId)
    .maybeSingle();
  if (!matter) return NextResponse.json({ error: 'Matter not found' }, { status: 404 });

  // Idempotency: claim the key before the expensive Sonnet call so a
  // network-level retry of the same request can't produce a second draft +
  // deliverable. A duplicate key (still in-flight or already done) → 409.
  // Released on failure so a genuine retry can proceed.
  // Firm-scoped service client; drafting_idempotency is a global table and
  // passes through the facade unscoped.
  const service = getServiceDbForFirm(session.firmId);
  if (body.idempotencyKey) {
    const { error: claimErr } = await service
      .from('drafting_idempotency')
      .insert({ key: body.idempotencyKey, created_by: session.user.notionUserId });
    if (claimErr?.code === '23505') {
      return NextResponse.json({ error: 'This draft is already being generated.' }, { status: 409 });
    }
  }

  try {
    // 0. Responsive drafting: load the document being responded to. Scoped to
    //    this matter so a caller can't pull a file from a matter they picked but
    //    don't own. Prefer the Files API id (the model reads the real filing);
    //    fall back to extracted text.
    let respondingTo: { name: string; claudeFileId: string | null; text: string | null } | undefined;
    if (body.respondingToFileId) {
      const { data: file } = await service
        .from('files')
        .select('notion_id, name, matter_id')
        .eq('notion_id', body.respondingToFileId)
        .maybeSingle();
      if (file && file.matter_id === body.matterId) {
        const { data: analyses } = await service
          .from('file_analyses')
          .select('claude_file_id, extracted_text, created_at')
          .eq('file_id', file.notion_id)
          .order('created_at', { ascending: false });
        const claudeFileId = analyses?.find((a) => a.claude_file_id)?.claude_file_id ?? null;
        let text: string | null = claudeFileId
          ? null
          : analyses?.find((a) => a.extracted_text && a.extracted_text.length > 0)?.extracted_text ?? null;
        if (text && text.length > MAX_RESPONDING_TEXT) {
          text = `${text.slice(0, MAX_RESPONDING_TEXT)}\n\n[Document truncated]`;
        }
        if (claudeFileId || text) {
          respondingTo = { name: file.name ?? 'the document being responded to', claudeFileId, text };
        }
      }
    }

    // 1–2. Assemble grounding + draft in the firm's house style, grounded. Status
    //       reports run through the shared compose engine (activity aggregation
    //       + grounding). Pleadings are built with the docx library (no
    //       letterhead, Book Antiqua, real footnotes + multilevel numbering);
    //       letters go through the firm-letterhead template.
    let grounding: DraftGrounding;
    let docxBuffer: Buffer;
    let truncated: boolean;
    // What the file + deliverable are named/typed. Status reports override these.
    let outputName = body.documentType;
    let deliverableType: string = body.deliverableType;
    let deliverableSubtype: string | null = body.documentType;

    if (body.format === 'status_report') {
      const composed = await composeStatusReport({
        firmId: session.firmId,
        matterId: body.matterId,
        sinceDate: body.sinceDate,
        model: body.model,
        instructions: body.instructions,
        excludeGrounding: body.excludeGrounding,
      });
      grounding = composed.grounding;
      docxBuffer = composed.buffer;
      truncated = false; // the status-report drafter completes within one pass
      outputName = composed.deliverableName;
      deliverableType = 'Status Report';
      deliverableSubtype = null;
    } else {
      grounding = await assembleDraftGrounding({
        firmId: session.firmId,
        matterId: body.matterId,
        documentType: body.documentType,
        extraQuery: body.instructions,
        exclude: body.excludeGrounding,
      });
      const matterContext = {
        name: matter.name ?? undefined,
        matterCode: matter.matter_code ?? undefined,
        type: matter.type ?? undefined,
        caseTitle: matter.case_title ?? undefined,
        caseNumber: matter.case_number ?? undefined,
        court: matter.court ?? undefined,
        clientName: matter.client_name ?? undefined,
      };
      const draftModel = DRAFT_MODELS[body.model];
      const maxTokens = tokenBudgetFor(body.documentType, body.format);
      const drafted = body.format === 'letter'
        ? await generateDocumentDocx({
            firmId: session.firmId,
            templatePrompt: `Draft a "${body.documentType}" for this matter. Produce a complete, well-structured ${body.documentType} ready for a lawyer's review. Follow Philippine legal drafting conventions and the firm's house style.`,
            matterContext,
            additionalInstructions: body.instructions,
            signerName: body.signerName,
            signerPosition: body.signerPosition,
            groundingContext: grounding.promptBlock,
            respondingTo,
            model: draftModel,
            maxTokens,
          })
        : await generatePleadingDocx({
            firmId: session.firmId,
            documentType: body.documentType,
            matterContext,
            firmName: (await loadDocxBrand(session.firmId)).firmName,
            additionalInstructions: body.instructions,
            signerName: body.signerName,
            signerPosition: body.signerPosition,
            groundingContext: grounding.promptBlock,
            respondingTo,
            model: draftModel,
            maxTokens,
          });
      docxBuffer = drafted.buffer;
      truncated = drafted.truncated;
    }

    // 3. Upload the DOCX, log it, and get a download URL (shared with the
    //    Document Generator).
    const safeType = outputName.replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 80);
    const fileName = `${safeType} (draft).docx`;
    const storagePath = `documents/${body.matterId}/${Date.now()}_${fileName}`;

    const { downloadUrl, generationId } = await persistGeneratedDoc({
      firmId: session.firmId,
      docxBuffer,
      fileName,
      storagePath,
      templateName: `${outputName} (AI draft)`,
      matterId: body.matterId,
      matterName: matter.name,
      clientName: matter.client_name,
      generatedBy: session.user.notionUserId,
      generatedByName: session.user.name || null,
    });

    // 4. Optionally create a draft deliverable → enters the review chain.
    // Assigned to the requesting lawyer as drafter + current holder, so it
    // shows in their queue, fires the new-deliverable notification, and is a
    // valid SLA target (an unassigned deliverable is invisible to all three).
    let deliverableId: string | null = null;
    if (body.createDeliverable) {
      const newId = randomUUID();
      const nowIso = new Date().toISOString();
      const { error: delErr } = await service.from('deliverables').insert({
        notion_id: newId,
        name: outputName,
        matter_id: body.matterId,
        matter_name: matter.name,
        client_name: matter.client_name,
        type: deliverableType,
        subtype: deliverableSubtype,
        status: DELIVERABLE_STATUS.DRAFTING,
        priority: 'Medium',
        drafter_ids: [session.user.notionUserId],
        reviewer_ids: body.reviewerIds ?? [],
        currently_with_ids: [session.user.notionUserId],
        created_time: nowIso,
      });
      if (delErr) {
        console.error('[drafting] Deliverable insert failed:', delErr.message);
      } else {
        const { error: fileErr } = await service.from('deliverable_files').insert({
          deliverable_id: newId,
          version: 1,
          file_name: fileName,
          file_url: storagePath,
          file_size: docxBuffer.length,
          uploaded_by: session.user.notionUserId,
          action: 'AI draft',
        });
        if (fileErr) {
          // Don't leave a deliverable with no draft attached — roll it back.
          console.error('[drafting] Deliverable file insert failed, rolling back deliverable:', fileErr.message);
          await service.from('deliverables').delete().eq('notion_id', newId);
        } else {
          deliverableId = newId;
        }
      }
    }

    logAudit({
      firmId: session.firmId,
      entityType: 'AIDraft',
      entityId: deliverableId ?? storagePath,
      action: 'generated',
      performedBy: session.user.notionUserId,
      ipAddress: getClientIP(req),
    });

    // The draft is reachable only via the download link or the deliverable.
    // If neither materialized, the generated DOCX is stranded — surface it
    // rather than reporting success.
    if (!downloadUrl && !deliverableId) {
      console.error('[drafting] Draft generated but neither a download URL nor a deliverable could be produced:', storagePath);
      return NextResponse.json(
        { error: 'The draft was generated but could not be saved. Please try again.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      fileName,
      downloadUrl,
      deliverableId,
      generationId,
      truncated,
      grounding: {
        hasBrief: grounding.briefBlock.length > 0,
        ownWork: grounding.ownWork.map((w) => ({ title: w.title, origin: w.origin })),
        priorWork: grounding.priorWork.map((w) => ({ title: w.title, matterName: w.matterName, deliverableId: w.deliverableId })),
        kbPages: grounding.kbPages.map((p) => ({ id: p.id, title: p.title, kind: p.kind })),
        authorities: grounding.authorities.map((a) => ({ caseNumber: a.caseNumber, title: a.title, url: a.url })),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Drafting failed';
    console.error('[drafting] Error:', message);
    // Release the idempotency claim so the user can retry this draft.
    if (body.idempotencyKey) {
      await service.from('drafting_idempotency').delete().eq('key', body.idempotencyKey);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
