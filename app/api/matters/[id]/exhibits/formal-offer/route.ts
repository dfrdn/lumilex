import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { generateFOEDocx, signingCity, type FOEExhibitInput } from '@/lib/docx/formal-offer';
import { getFirmInvoiceConfig } from '@/lib/firm/config';
import { loadDocxBrand } from '@/lib/docx/brand';

export const maxDuration = 60;

const WRITE_ROLES = new Set(['lawyer', 'partner', 'admin', 'super_user']);

const OFFERED_BY = [
  'plaintiff', 'defendant', 'prosecution', 'accused',
  'petitioner', 'respondent', 'complainant', 'other',
] as const;

const Schema = z.object({
  offeredBy: z.enum(OFFERED_BY),
  partyLabel: z.string().trim().max(120).optional().default(''),
});

const OFFERING_PARTY_LABEL: Record<typeof OFFERED_BY[number], string> = {
  plaintiff: 'Plaintiff',
  defendant: 'Defendant',
  prosecution: 'Prosecution',
  accused: 'Accused',
  petitioner: 'Petitioner',
  respondent: 'Respondent',
  complainant: 'Complainant',
  other: 'Movant',
};

function sortLabels(a: string, b: string): number {
  const parse = (s: string) => {
    const [main, sub] = s.split(/-/, 2);
    return { main, sub: sub ?? '' };
  };
  const pa = parse(a);
  const pb = parse(b);
  const numA = /^\d+$/.test(pa.main);
  const numB = /^\d+$/.test(pb.main);
  let cmp = 0;
  if (numA && numB) cmp = parseInt(pa.main, 10) - parseInt(pb.main, 10);
  else if (numA) cmp = 1;
  else if (numB) cmp = -1;
  else cmp = pa.main.localeCompare(pb.main, undefined, { sensitivity: 'base' });
  if (cmp !== 0) return cmp;
  return pa.sub.localeCompare(pb.sub, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * POST /api/matters/[id]/exhibits/formal-offer
 *
 * Generates a Formal Offer of Evidence DOCX for the given offering party,
 * uploads it to Supabase Storage, and writes a `files` row tagged as
 * "Formal Offer (Draft)". Returns a short-lived signed download URL so the
 * client can open the file immediately.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!WRITE_ROLES.has(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id: matterId } = await params;

  const validation = await validateBody(req, Schema);
  if (!validation.success) return validation.response;
  const { offeredBy, partyLabel } = validation.data;

  // ── Authorization check via RLS-enforced authed client ─────────────────
  const authed = await getSupabaseServerAuthClient();
  const { data: matter } = await authed
    .from('matters')
    .select('notion_id, name, case_title, case_number, court, type, matter_code')
    .eq('notion_id', matterId)
    .maybeSingle();
  if (!matter) return NextResponse.json({ error: 'Matter not found' }, { status: 404 });

  const { data: exhibits } = await authed
    .from('exhibits')
    .select('id, label, title, description, document_date, purpose, status, parent_exhibit_id')
    .eq('matter_id', matterId)
    .eq('offered_by', offeredBy)
    .eq('party_label', partyLabel)
    .in('status', ['marked', 'offered']);

  const rows = (exhibits ?? []) as Array<{
    id: string;
    label: string;
    title: string;
    description: string;
    document_date: string | null;
    purpose: string;
    status: string;
    parent_exhibit_id: string | null;
  }>;
  rows.sort((a, b) => sortLabels(a.label, b.label));

  const offeringPartyName = offeredBy === 'other' && partyLabel.trim()
    ? partyLabel.trim()
    : OFFERING_PARTY_LABEL[offeredBy];

  const foeExhibits: FOEExhibitInput[] = rows.map((r) => ({
    label: r.label,
    title: r.title,
    description: r.description,
    purpose: r.purpose,
    documentDate: r.document_date,
  }));

  const today = new Date().toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila',
  });

  // ── Generate DOCX ──────────────────────────────────────────────────────
  let buffer: Buffer;
  try {
    buffer = await generateFOEDocx({
      caseTitle: matter.case_title || matter.name || '',
      caseNumber: matter.case_number || '',
      court: matter.court || '',
      natureOfAction: matter.type || '',
      offeringParty: offeringPartyName,
      exhibits: foeExhibits,
      brand: await loadDocxBrand(session.firmId),
      signers: [{ name: session.user.name || '', position: '' }],
      city: await firmSigningCity(session.firmId),
      date: today,
    });
  } catch (err) {
    console.error('[formal-offer] generation failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'DOCX generation failed' },
      { status: 500 },
    );
  }

  // ── Upload to Supabase Storage (service-role: storage path) ────────────
  const service = getServiceDbForFirm(session.firmId);
  const fileId = randomUUID();
  const safePartySlug = offeringPartyName.replace(/[^a-z0-9]/gi, '_');
  const filename = `Formal_Offer_of_Evidence_${safePartySlug}_${Date.now()}.docx`;
  const storagePath = `${fileId}/${filename}`;

  const { error: uploadErr } = await service.storage
    .from('files')
    .upload(storagePath, buffer, {
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    });
  if (uploadErr) {
    console.error('[formal-offer] upload failed:', uploadErr);
    return NextResponse.json(
      { error: `Storage upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  // ── Insert files row (service-role, like the bulk-create flow) ─────────
  const matterName = matter.name || matter.case_title || '';
  const displayName = `Formal Offer of Evidence (Draft) — ${offeringPartyName}`;
  const nowIso = new Date().toISOString();
  const { error: insertErr } = await service.from('files').insert({
    notion_id: fileId,
    matter_id: matterId,
    matter_name: matterName,
    name: displayName,
    origin: 'Generated — Formal Offer (Draft)',
    file_urls: [{ name: filename, url: '', path: storagePath }],
    created_time: nowIso,
  });
  if (insertErr) {
    console.error('[formal-offer] files insert failed:', insertErr);
    return NextResponse.json(
      { error: `File row insert failed: ${insertErr.message}` },
      { status: 500 },
    );
  }

  // ── Short-lived download URL ───────────────────────────────────────────
  const { data: signed } = await service.storage
    .from('files')
    .createSignedUrl(storagePath, 60 * 10, { download: filename });

  logAudit({
    firmId: session.firmId,
    entityType: 'formal_offer',
    entityId: fileId,
    entityName: displayName,
    action: 'generated',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({
    ok: true,
    fileId,
    storagePath,
    downloadUrl: signed?.signedUrl ?? null,
    exhibitCount: rows.length,
  });
}

async function firmSigningCity(firmId: string): Promise<string | null> {
  const invoice = await getFirmInvoiceConfig(firmId);
  return signingCity([invoice.firmAddress, invoice.firmAddress2].flatMap((b) => b.split('\n')));
}
