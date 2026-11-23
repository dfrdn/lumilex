/**
 * Everything the proposal builder needs besides the proposal itself: what the
 * firm currently publishes, and who a letter can be addressed to.
 *
 * The builder runs the same selection logic the drafting route runs, so it is
 * given the catalogue rather than a precomputed list — a tier or a scope line
 * the firm has since changed must not survive in the UI as a stale copy.
 */

import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getFirmConfig } from '@/lib/firm/config';
import { pesoSymbol, resolveFontSet } from '@/lib/pdf/fonts';
import { loadFeeSchedules, loadProfessionalBody } from '@/lib/fee-schedule/load';
import { loadScopeTemplates } from '@/lib/scope-library/load';
import { loadFirmContact } from '@/lib/firm-profile/load';
import type { LoadedScopeTemplate } from '@/lib/scope-library/types';
import type { ProposalFirmContact } from './types';

export interface RetainerTierOption {
  label: string;
  hours: number | null;
  /** Null means the schedule prices this tier subject to negotiation. */
  monthlyFee: number | null;
}

/** A contested matter the schedule prices, e.g. "Civil cases" at 400,000. */
export interface AcceptanceFeeOption {
  matter: string;
  standard: number;
}

export interface ProposalCatalogue {
  schedules: { slug: string; name: string }[];
  scopeTemplates: LoadedScopeTemplate[];
  retainerTiers: RetainerTierOption[];
  acceptanceFees: AcceptanceFeeOption[];
  firmContact: ProposalFirmContact;
  /**
   * The currency prefix this firm's typeface set can print — ₱, or a bare "P"
   * for the core PDF faces, which have no U+20B1. The builder fills scope-line
   * tokens in the browser, so it needs the same decision `peso()` makes when the
   * fee schedules bound behind the letter are rendered.
   */
  pesoSymbol: string;
}

export async function loadProposalCatalogue(firmId: string): Promise<ProposalCatalogue> {
  const [schedules, scopeTemplates, professional, firmContact, config] = await Promise.all([
    loadFeeSchedules(firmId),
    loadScopeTemplates(firmId),
    loadProfessionalBody(firmId),
    loadFirmContact(firmId),
    getFirmConfig(firmId),
  ]);

  return {
    schedules: schedules.map((s) => ({ slug: s.slug, name: s.name })),
    scopeTemplates: scopeTemplates.filter((t) => t.isActive),
    retainerTiers: (professional?.body.retainer.tiers ?? []).map((t) => ({
      label: t.label,
      hours: t.hours,
      monthlyFee: t.monthlyFee,
    })),
    acceptanceFees: (professional?.body.acceptance.fees ?? []).map((f) => ({
      matter: f.matter,
      standard: f.standard,
    })),
    firmContact,
    pesoSymbol: pesoSymbol(resolveFontSet(config.branding.fontSet)),
  };
}

export interface RecipientOption {
  kind: 'prospect' | 'client';
  /** Intake id for a prospect, client id for a client. */
  id: string;
  name: string;
  /** Pipeline stage for a prospect, client status for a client. */
  detail: string | null;
}

/**
 * Who a proposal can be addressed to. Prospects come first — a letter to one is
 * the common case — and both lists are small enough for the firm that the
 * picker searches them in the browser rather than round-tripping per keystroke.
 *
 * Service-role: the picker offers the whole firm's book, and a partner drafting
 * a proposal for a client they don't personally act for is ordinary work.
 */
export async function loadRecipientOptions(firmId: string): Promise<RecipientOption[]> {
  const supabase = getServiceDbForFirm(firmId);

  const [{ data: intakes }, { data: clients }] = await Promise.all([
    supabase
      .from('client_intakes')
      .select('id, stage, clients(name)')
      .order('created_at', { ascending: false })
      .returns<{ id: number; stage: string | null; clients: { name: string } | null }[]>(),
    supabase
      .from('clients')
      .select('notion_id, name, status')
      .order('name', { ascending: true })
      .returns<{ notion_id: string; name: string; status: string | null }[]>(),
  ]);

  const prospects: RecipientOption[] = (intakes ?? [])
    // An engaged or declined prospect is history; a fresh engagement for one
    // that converted is a proposal to the *client*, which the next list offers.
    .filter((i) => i.stage !== 'Engaged' && i.stage !== 'Declined')
    .map((i) => ({
      kind: 'prospect' as const,
      id: String(i.id),
      name: i.clients?.name ?? `Prospect #${i.id}`,
      detail: i.stage,
    }));

  const existing: RecipientOption[] = (clients ?? []).map((c) => ({
    kind: 'client' as const,
    id: c.notion_id,
    name: c.name,
    detail: c.status,
  }));

  return [...prospects, ...existing];
}
