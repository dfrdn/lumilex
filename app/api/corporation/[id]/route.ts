import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { rowToCorporation } from '@/lib/corporation-row';
import { runSecApprovalAutoChain } from '@/lib/corporations/sec-approval-chain';
import { spawnBusinessPermitTask } from '@/lib/corporations/permit-task';
import { firmHandles, isFirmFiling } from '@/lib/corporations/obligations';
import { DERIVED_STATUSES, missingRegistrationFacts } from '@/lib/corporation-lifecycle';
import type { CorporationStatus } from '@/types/corporations';
import { logAudit, getClientIP } from '@/lib/audit';
import { CORPORATION_SELECT, setMatterLink } from '@/lib/corporations/matter-links';
import { changePortalVisible, parsePortalSwitch } from '@/lib/portal/switch-access';

function filled(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

// Whitelist of PATCH-able columns on `corporations`.
const PATCH_COLUMNS: Record<string, string> = {
  proposedNames: 'proposed_names',
  approvedName: 'approved_name',
  companyType: 'company_type',
  industryClassification: 'industry_classification',
  primaryPurpose: 'primary_purpose',
  secondaryPurposes: 'secondary_purposes',

  authorizedCapitalStock: 'authorized_capital_stock',
  subscribedCapital: 'subscribed_capital',
  paidUpCapital: 'paid_up_capital',
  parValue: 'par_value',
  numberOfShares: 'number_of_shares',

  principalOfficeAddress: 'principal_office_address',
  officialEmail: 'official_email',
  alternateEmail: 'alternate_email',
  officialMobile: 'official_mobile',
  alternateMobile: 'alternate_mobile',
  website: 'website',

  contactFirstName: 'contact_first_name',
  contactLastName: 'contact_last_name',
  contactNationality: 'contact_nationality',
  contactGender: 'contact_gender',
  contactTin: 'contact_tin',
  contactPassportNumber: 'contact_passport_number',

  fiscalYearEndMonth: 'fiscal_year_end_month',

  esparcApplicationNo: 'esparc_application_no',
  esparcStatus: 'esparc_status',
  esparcSubmittedDate: 'esparc_submitted_date',

  secRegistrationNo: 'sec_registration_no',
  secRegistrationDate: 'sec_registration_date',

  birTin: 'bir_tin',
  birRdoCode: 'bir_rdo_code',
  birCorDate: 'bir_cor_date',
  birBooksRegistrationDate: 'bir_books_registration_date',
  birOrAuthorityDate: 'bir_or_authority_date',
  birOrusUsername: 'bir_orus_username',
  birOrusEnrolledDate: 'bir_orus_enrolled_date',

  businessTradeName: 'business_trade_name',
  annualMeetingBylaws: 'annual_meeting_bylaws',
  annualMeetingMonth: 'annual_meeting_month',
  annualMeetingDay: 'annual_meeting_day',
  geographicalCode: 'geographical_code',
  externalAuditorName: 'external_auditor_name',
  externalAuditorAccreditationNo: 'external_auditor_accreditation_no',
  telephoneNumber: 'telephone_number',
  faxNumber: 'fax_number',
  totalAssets: 'total_assets',
  totalAssetsAsOf: 'total_assets_as_of',

  secEfastUsername: 'sec_efast_username',
  secEfastEnrolledDate: 'sec_efast_enrolled_date',
  secHaborUsername: 'sec_habor_username',
  secHaborEnrolledDate: 'sec_habor_enrolled_date',

  businessPermitNo: 'business_permit_no',
  businessPermitLgu: 'business_permit_lgu',
  businessPermitIssuedDate: 'business_permit_issued_date',
  businessPermitExpiryDate: 'business_permit_expiry_date',

  sssEmployerNo: 'sss_employer_no',
  sssRegistrationDate: 'sss_registration_date',
  philhealthEmployerNo: 'philhealth_employer_no',
  philhealthRegistrationDate: 'philhealth_registration_date',
  pagibigEmployerNo: 'pagibig_employer_no',
  pagibigRegistrationDate: 'pagibig_registration_date',

  status: 'status',
  notes: 'notes',

  handlesIncorporation: 'handles_incorporation',
  handlesPostIncorporation: 'handles_post_incorporation',
  handlesHousekeeping: 'handles_housekeeping',
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const supabase = await getSupabaseServerAuthClient();
  const { data } = await supabase.from('corporations').select(CORPORATION_SELECT).eq('id', id).maybeSingle();
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ corporation: rowToCorporation(data as Record<string, unknown>) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data: existing } = await supabase
    .from('corporations')
    .select(CORPORATION_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const patch = body as Record<string, unknown>;

  const portalSwitch = parsePortalSwitch(patch);
  if (portalSwitch) {
    if ('error' in portalSwitch) return NextResponse.json({ error: portalSwitch.error }, { status: 400 });
    const result = await changePortalVisible(
      getServiceDbForFirm(session.firmId),
      'corporation',
      id,
      portalSwitch.visible,
      { firmId: session.firmId, personId: session.user.notionUserId, role: session.user.role },
      getClientIP(req),
    );
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    const { data: switched } = await supabase.from('corporations').select(CORPORATION_SELECT).eq('id', id).single();
    return NextResponse.json({ ok: true, corporation: rowToCorporation((switched ?? existing) as Record<string, unknown>) });
  }

  // 'Registered' and 'Active' are derived from the registration record by
  // trg_corporations_derive_status — accepting them here would let the caller
  // paint a status the underlying data doesn't support, which is exactly how
  // corporations ended up reading "Registered" with no COR, no client and no
  // compliance deliverables. Recording the registration is the only way in.
  if (typeof patch.status === 'string' && DERIVED_STATUSES.includes(patch.status as CorporationStatus)) {
    return NextResponse.json(
      {
        error:
          `"${patch.status}" is derived from the registration record and can't be set directly. ` +
          'Record the SEC registration (approved name, registration number, registration date) instead.',
        code: 'status_is_derived',
      },
      { status: 422 },
    );
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(patch)) {
    const col = PATCH_COLUMNS[k];
    if (col) update[col] = v;
  }
  if ('firmFiles' in patch) {
    if (!Array.isArray(patch.firmFiles) || !patch.firmFiles.every(isFirmFiling)) {
      return NextResponse.json({ error: 'firmFiles must list gis, afs, itr or permit' }, { status: 400 });
    }
    update.firm_files = [...new Set(patch.firmFiles)];
  }

  // The retainer is a matter link (matter_subjects), not a column: naming a
  // retainer matter links it, turning "under retainer" off unlinks it.
  const retainerChange =
    'retainerMatterId' in patch
      ? (typeof patch.retainerMatterId === 'string' && patch.retainerMatterId) || null
      : patch.isUnderRetainer === false
        ? null
        : undefined;
  if (retainerChange !== undefined) {
    try {
      await setMatterLink(supabase, session.firmId, id, 'retainer', patch.isUnderRetainer === false ? null : retainerChange);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Linking the retainer failed' }, { status: 500 });
    }
  }

  // SEC registration transition trigger: when sec_registration_date becomes
  // non-null for the first time, drive the auto-create chain.
  const becomingRegistered =
    !existing.sec_registration_date &&
    update.sec_registration_date &&
    typeof update.sec_registration_date === 'string';

  // Recording a registration is all-or-nothing: the approved name drives the
  // client rename and the registration number drives the AFS due date, so a
  // date on its own would fire the chain into a half-built state.
  if (becomingRegistered) {
    const missing = missingRegistrationFacts({
      approvedName: (update.approved_name ?? existing.approved_name) as string | undefined,
      secRegistrationNo: (update.sec_registration_no ?? existing.sec_registration_no) as string | undefined,
      secRegistrationDate: update.sec_registration_date as string,
    });
    if (missing.length) {
      return NextResponse.json(
        {
          error: `Recording a SEC registration also requires ${missing.join(', ')}.`,
          code: 'incomplete_registration',
          missing,
        },
        { status: 422 },
      );
    }

    // A registration on file is proof the eSPARC application was approved, so
    // the rest of the SEC Registration panel settles with it rather than
    // leaving a registered corporation reading "For SEC Approval". Explicit in
    // the body still wins — a caller correcting the record isn't overridden.
    if (update.esparc_status === undefined) update.esparc_status = 'Approved';
  }

  const { data: updated, error } = await supabase
    .from('corporations')
    .update(update)
    .eq('id', id)
    .select(CORPORATION_SELECT)
    .single();
  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 });
  }

  if (becomingRegistered) {
    await runSecApprovalAutoChain(session.firmId, updated as Record<string, unknown>, session.user.notionUserId);
  }

  // Recording the LGU permit for the first time is what makes a renewal a real
  // obligation — before it there is nothing to renew, so the corporation was
  // carrying the initial application task instead. Spawning here picks up the
  // renewal, dated off the permit's own expiry.
  //
  // Service-role for the same reason the SEC chain is: the authorization
  // decision was the RLS-gated corporation update above, and whoever records a
  // permit need not be teamed on the post-incorporation matter the task hangs
  // off — on the authed client the insert would silently no-op.
  const becomingPermitted =
    !filled(existing.business_permit_no) &&
    !filled(existing.business_permit_issued_date) &&
    (filled(update.business_permit_no) || filled(update.business_permit_issued_date));

  const updatedCorp = rowToCorporation(updated as Record<string, unknown>);
  if (becomingPermitted && firmHandles(updatedCorp, 'permit')) {
    try {
      await spawnBusinessPermitTask(
        updatedCorp,
        getServiceDbForFirm(session.firmId),
        session.firmId,
        session.user.notionUserId,
      );
    } catch (e) {
      console.error('[corporation PATCH] spawn permit renewal task failed', e);
    }
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    entityName: (updated.approved_name as string) ?? undefined,
    action: becomingRegistered ? 'sec_registered' : 'updated',
    fieldChanged: Object.keys(body as Record<string, unknown>).join(', '),
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  // Re-read to pick up any chained updates.
  const { data: fresh } = await supabase.from('corporations').select(CORPORATION_SELECT).eq('id', id).single();
  return NextResponse.json({ ok: true, corporation: rowToCorporation((fresh ?? updated) as Record<string, unknown>) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = session.user.role;
  if (role !== 'super_user' && role !== 'partner') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }
  const { id } = await params;
  const supabase = await getSupabaseServerAuthClient();
  const { data: existing } = await supabase
    .from('corporations')
    .select(CORPORATION_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const corp = rowToCorporation(existing as Record<string, unknown>);
  const name = corp.approvedName ?? corp.proposedNames[0] ?? undefined;

  // The caller must name the corporation they think they're deleting. Four
  // tables cascade off this row, so a misclick on the wrong detail page is
  // unrecoverable.
  const body = await _req.json().catch(() => null);
  const confirmName = typeof body?.confirmName === 'string' ? body.confirmName.trim() : '';
  if (!name || confirmName !== name) {
    return NextResponse.json(
      { error: 'Type the corporation name exactly to confirm deletion.', code: 'confirm_name_mismatch' },
      { status: 422 },
    );
  }

  // Storage isn't reachable by the FK cascade — read the paths before the rows
  // holding them disappear.
  const service = getServiceDbForFirm(session.firmId);
  const { data: fileRows } = await service
    .from('corporation_files')
    .select('storage_path')
    .eq('corporation_id', id);
  const storagePaths = (fileRows ?? [])
    .map((f) => f.storage_path as string | null)
    .filter((p): p is string => Boolean(p));

  const [{ count: peopleCount }, { count: meetingCount }, { count: resolutionCount }] = await Promise.all([
    service.from('corporation_persons').select('id', { count: 'exact', head: true }).eq('corporation_id', id),
    service.from('corporation_meetings').select('id', { count: 'exact', head: true }).eq('corporation_id', id),
    service.from('resolutions').select('id', { count: 'exact', head: true }).eq('corporation_id', id),
  ]);

  // Matters are referenced by text id with no FK, so they survive the delete by
  // default — and they should: they may carry time entries and billing. Record
  // which ones are being orphaned so the audit trail explains the loose ends.
  const mattersLeft = [
    corp.incorporationMatterId,
    corp.postIncorporationMatterId,
    corp.housekeepingMatterId,
    corp.retainerMatterId,
  ].filter((m): m is string => Boolean(m));

  const { error } = await supabase.from('corporations').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (storagePaths.length) {
    const { error: storageError } = await service.storage.from('files').remove(storagePaths);
    // The row is already gone; a failed storage sweep leaves orphaned objects
    // rather than a broken record, so it's logged, not surfaced as a failure.
    if (storageError) {
      console.error('[corporation DELETE] storage cleanup failed', storageError, storagePaths);
    }
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    entityName: name,
    action: 'deleted',
    fieldChanged: 'corporation',
    oldValue: [
      `${peopleCount ?? 0} people`,
      `${storagePaths.length} files`,
      `${meetingCount ?? 0} meetings`,
      `${resolutionCount ?? 0} resolutions`,
    ].join(', '),
    newValue: mattersLeft.length ? `matters left in place: ${mattersLeft.join(', ')}` : 'no linked matters',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(_req),
  });

  return NextResponse.json({
    ok: true,
    removed: {
      people: peopleCount ?? 0,
      files: storagePaths.length,
      meetings: meetingCount ?? 0,
      resolutions: resolutionCount ?? 0,
    },
    mattersLeft,
    clientLeft: corp.clientId ?? null,
  });
}
