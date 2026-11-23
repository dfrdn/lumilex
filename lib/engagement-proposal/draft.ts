/**
 * Drafting one version of an engagement proposal.
 *
 * Shared by the two routes that produce a draft — the first version of a new
 * proposal and a further version of an existing one — because the two differ
 * only in where the version number comes from. Everything that decides what the
 * letter says (the recipient's context, the scope selection, the signer, the
 * firm's cover band) is settled here, once.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { draftEngagementProposal } from '@/lib/ai/engagement-proposal';
import { loadFeeSchedules, loadProfessionalBody } from '@/lib/fee-schedule/load';
import { loadScopeTemplates } from '@/lib/scope-library/load';
import { loadFirmContact, loadPaymentDetails } from '@/lib/firm-profile/load';
import { getFirmConfig } from '@/lib/firm/config';
import { defaultScopeSlugs, offeredFor } from '@/lib/scope-library/select';
import { loadProspectContext, loadClientContext } from './context';
import type { EngagementProposalContent, ProposalRecipient } from './types';
import type { ProposalDraftInput } from './schema';
import { manilaToday } from '@/lib/dates';

export interface DraftRequest {
  supabase: SupabaseClient;
  /** Firm whose rate card, scope library, and team the letter draws on. */
  firmId: string;
  recipient: ProposalRecipient;
  input: ProposalDraftInput;
  /** Falls back to the caller when the drafter names no other signer. */
  fallbackSigner: { personId: string; name: string };
}

export interface DraftResult {
  content: EngagementProposalContent;
  clientId: string;
  intakeId: number | null;
}

/** Raised when the named recipient isn't visible to this caller. */
export class RecipientNotFound extends Error {}

export async function draftProposalVersion(req: DraftRequest): Promise<DraftResult> {
  const { supabase, firmId, recipient, input, fallbackSigner } = req;

  // The contact person is never inferred from a name match — it comes from the
  // drafter, or the letter goes out with the Attention line blank for them to fill.
  let clientId: string;
  let intakeId: number | null;
  let base;

  if (recipient.kind === 'prospect') {
    const loaded = await loadProspectContext(supabase, recipient.intakeId);
    if (!loaded) throw new RecipientNotFound('Prospect not found');
    clientId = loaded.intake.client_id;
    intakeId = loaded.intake.id;
    base = loaded.context;
  } else {
    const loaded = await loadClientContext(supabase, recipient.clientId);
    if (!loaded) throw new RecipientNotFound('Client not found');
    clientId = loaded.client.notion_id;
    intakeId = null;
    base = loaded.context;
  }

  const context = {
    ...base,
    attnName: input.attnName ?? null,
    attnTitle: input.attnTitle ?? null,
  };

  // The signing partner's position is read from `team`, not assumed: partner
  // roles change, and the position is printed under their name on a document
  // that becomes the engagement agreement.
  const signerId = input.signerPersonId ?? fallbackSigner.personId;
  const service = getServiceDbForFirm(firmId);
  const { data: signerRow } = await service
    .from('team')
    .select('name, position')
    .eq('person_id', signerId)
    .maybeSingle<{ name: string | null; position: string | null }>();

  const professional = await loadProfessionalBody(firmId);
  const schedules = (await loadFeeSchedules(firmId)).filter((s) => s.isActive);

  // The drafter's selection is authoritative; an omitted one falls back to what
  // the arrangement and the record imply, so a draft is never left scopeless.
  const arrangement = input.arrangement ?? 'retainer';
  const scopeTemplates = await loadScopeTemplates(firmId);
  const seeded = defaultScopeSlugs(scopeTemplates, arrangement, base.proposedServices);
  const offered = offeredFor(scopeTemplates, arrangement);
  const offeredSlugs = new Set(offered.map((t) => t.slug));

  let scopeSlugs = input.scopeSlugs
    ? input.scopeSlugs.filter((slug) => offeredSlugs.has(slug))
    : seeded;

  // A selection that survived an arrangement change can arrive with its
  // carve-outs filtered away. Dropping them silently would send a letter with
  // no out-of-scope clause at all, so fall back to the default for this
  // arrangement rather than assembling one without.
  const roleOf = (slug: string) => scopeTemplates.find((t) => t.slug === slug)?.content.role;
  if (!scopeSlugs.some((slug) => roleOf(slug) === 'exclusions')) {
    const fallback = seeded.filter((slug) => roleOf(slug) === 'exclusions');
    scopeSlugs = offered
      .filter((t) => scopeSlugs.includes(t.slug) || fallback.includes(t.slug))
      .map((t) => t.slug);
  }

  const content = await draftEngagementProposal(context, professional?.body ?? null, {
    firmId,
    arrangement: input.arrangement,
    tierLabel: input.tierLabel,
    caseType: input.caseType,
    instructions: input.instructions,
    scopeTemplates,
    scopeSlugs,
    customFigures: input.customFigures,
    signer: {
      firmName: (await getFirmConfig(firmId)).branding.documentName,
      name: signerRow?.name ?? fallbackSigner.name,
      position: signerRow?.position ?? 'Partner',
    },
    availableSchedules: schedules.map((s) => ({ slug: s.slug, name: s.name })),
    // Seeded from the profile, then editable on the draft — a letter under a
    // different line shouldn't require editing the firm-wide profile.
    firmContact: await loadFirmContact(firmId),
    // The account the invoices for this engagement will carry.
    payment: await loadPaymentDetails(firmId),
    today: manilaToday(),
  });

  return { content, clientId, intakeId };
}
