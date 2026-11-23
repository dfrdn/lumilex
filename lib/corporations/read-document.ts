import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { rowToCorporation } from '@/lib/corporation-row';
import {
  extractCorporationDocument,
  isExtractable,
  hasAnyField,
  matchesExpectedName,
  autoAppliesOnUpload,
  type DocumentExtraction,
} from '@/lib/ai/corporation-doc-extract';
import { missingRegistrationFacts } from '@/lib/corporation-lifecycle';
import { runSecApprovalAutoChain } from '@/lib/corporations/sec-approval-chain';
import { logAudit } from '@/lib/audit';
import { CORPORATION_SELECT } from '@/lib/corporations/matter-links';

export interface DocumentReadOutcome {
  /** 'applied' — written straight to the record (SEC COR only).
   *  'needs_review' — fields read, waiting on a human.
   *  'unreadable' — nothing usable came out of the document. */
  result: 'applied' | 'needs_review' | 'unreadable';
  reason?: string;
  extraction?: DocumentExtraction;
  corporation?: ReturnType<typeof rowToCorporation>;
}

/**
 * Read a registration document and either apply it or hand the values back for
 * confirmation.
 *
 * Only the SEC COR applies itself, and only when the name it carries matches
 * one already on the record: the approval chain renames the client and cascades
 * that name across the denormalized finance tables, so an unexpected name is
 * held rather than propagated into invoices on the strength of an OCR read.
 * Everything else always confirms, and so does a SEC COR read again from a
 * file already on record (`autoApply: false`): someone asked to see it read.
 *
 * Never throws — a failed read must not fail the upload.
 */
export async function readDocument(
  firmId: string,
  corporationId: string,
  category: string,
  storagePath: string,
  fileName: string,
  userId: string,
  { autoApply }: { autoApply: boolean },
): Promise<DocumentReadOutcome | null> {
  if (!isExtractable(category)) return null;

  const supabase = getServiceDbForFirm(firmId);
  const { data: row } = await supabase.from('corporations').select(CORPORATION_SELECT).eq('id', corporationId).maybeSingle();
  if (!row) return null;

  // A SEC COR filed against an already-registered corporation is being kept for
  // the record, not to transition anything.
  if (category === 'SEC COR' && row.sec_registration_date) return null;

  let extraction: DocumentExtraction;
  try {
    const { data: blob, error } = await supabase.storage.from('files').download(storagePath);
    if (error || !blob) throw error ?? new Error('download returned no data');
    const buffer = Buffer.from(await blob.arrayBuffer());
    extraction = await extractCorporationDocument(firmId, category, buffer, fileName);
  } catch (e) {
    console.error('[corporation files] extraction failed', e);
    return { result: 'unreadable', reason: 'The document could not be read.' };
  }

  if (!extraction.isExpectedDocument) {
    return {
      result: 'unreadable',
      reason: `This does not look like a ${category}. Nothing was filled in.`,
      extraction,
    };
  }
  if (!hasAnyField(extraction)) {
    return {
      result: 'needs_review',
      reason: extraction.notes || 'No fields could be read with confidence.',
      extraction,
    };
  }

  if (!autoApply || !autoAppliesOnUpload(category as never)) {
    return { result: 'needs_review', extraction };
  }

  // ── SEC COR only, from here ──────────────────────────────────────────────
  const f = extraction.fields;
  const missing = missingRegistrationFacts({
    approvedName: f.approvedName ?? undefined,
    secRegistrationNo: f.secRegistrationNo ?? undefined,
    secRegistrationDate: f.secRegistrationDate ?? undefined,
  });
  if (missing.length) {
    return {
      result: 'needs_review',
      reason: `Could not read ${missing.join(', ')} from the certificate.`,
      extraction,
    };
  }

  const corp = rowToCorporation(row as Record<string, unknown>);
  const expected = [corp.approvedName, ...corp.proposedNames];
  if (!matchesExpectedName(f.approvedName!, expected)) {
    logAudit({
      firmId,
      entityType: 'Corporation',
      entityId: corporationId,
      entityName: f.approvedName ?? undefined,
      action: 'cor_extract_needs_review',
      fieldChanged: 'approved_name',
      oldValue: expected.filter(Boolean).join(' · '),
      newValue: f.approvedName ?? '',
      performedBy: userId,
    });
    return {
      result: 'needs_review',
      reason: `The certificate names "${f.approvedName}", which doesn't match any name on this record. Confirm before applying.`,
      extraction,
    };
  }

  const { data: updated, error } = await supabase
    .from('corporations')
    .update({
      approved_name: f.approvedName,
      sec_registration_no: f.secRegistrationNo,
      sec_registration_date: f.secRegistrationDate,
      ...(f.companyType && !corp.companyType ? { company_type: f.companyType } : {}),
      // A certificate in hand is proof the eSPARC application was approved, so
      // the rest of the SEC Registration panel settles with it rather than
      // leaving a corporation registered but still reading "For SEC Approval".
      esparc_status: 'Approved',
      updated_at: new Date().toISOString(),
    })
    .eq('id', corporationId)
    .select(CORPORATION_SELECT)
    .single();
  if (error || !updated) {
    console.error('[corporation files] COR auto-apply update failed', error);
    return { result: 'needs_review', reason: 'Could not save the extracted details.', extraction };
  }

  await runSecApprovalAutoChain(firmId, updated as Record<string, unknown>, userId);

  logAudit({
    firmId,
    entityType: 'Corporation',
    entityId: corporationId,
    entityName: f.approvedName ?? undefined,
    action: 'sec_registered',
    fieldChanged: 'approvedName, secRegistrationNo, secRegistrationDate',
    newValue: `auto-applied from ${fileName}`,
    performedBy: userId,
  });

  const { data: fresh } = await supabase.from('corporations').select(CORPORATION_SELECT).eq('id', corporationId).single();
  return {
    result: 'applied',
    extraction,
    corporation: rowToCorporation((fresh ?? updated) as Record<string, unknown>),
  };
}
