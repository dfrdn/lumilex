import { cache } from 'react';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase';
import { appBaseUrl } from '@/lib/app-url';
import { DEMO_PERSONA_KEYS } from '@/lib/demo/personas';
import { LETTERHEAD_DESIGNS } from '@/lib/firm/letterhead-design';
import {
  getFirmInvoiceSettings,
  type FirmInvoiceSettings,
} from '@/lib/billing/firm-defaults';

/**
 * Per-firm configuration, loaded once per request (React cache) from the
 * `firms` row. Fail-loud contract: a missing firm row or an unparseable
 * config throws — nothing may fall back to another firm's identity.
 *
 * `branding` and `settings` are jsonb on `firms`; this module's Zod schemas
 * are their single source of shape truth. `invoice` is loaded lazily via
 * {@link getFirmInvoiceConfig} because most requests never touch billing.
 */

const paletteSchema = z.object({
  primary: z.string().default(''),
  accent: z.string().default(''),
});

/**
 * Exported because the operator surface edits this jsonb directly and must
 * validate through the same schema the loader parses with — a second shape
 * definition for `firms.branding` would let the editor write something
 * `getFirmConfig` then reads back as a default. Same for `emailSchema` and
 * `documentsSchema` below.
 */
export const brandingSchema = z.object({
  /** Display name lines for document covers (explicit, never derived). */
  nameLines: z.array(z.string()).max(3).default([]),
  /**
   * The firm's name as it is stamped on documents — the running header of every
   * proposal page, the PDF Author field, DOCX signature blocks. Distinct from
   * `firms.name`, which is the platform-facing label.
   */
  documentName: z.string().default(''),
  /** Spread small-caps line under the cover wordmark. Blank omits it. */
  tagline: z.string().default(''),
  /** Storage keys, relative to the firm's own storage prefix. Blank = none. */
  logoPath: z.string().default(''),
  /**
   * Reversed-out wordmark for dark grounds. The role shells and the chat header
   * sit the lockup on a near-black bar, where a dark-ink print logo disappears.
   * Falls back to `logoPath`; blank on both renders a text wordmark.
   */
  logoLightPath: z.string().default(''),
  monogramPath: z.string().default(''),
  /** Reversed-out monogram for dark grounds; falls back to `monogramPath`. */
  monogramLightPath: z.string().default(''),
  palette: paletteSchema.default({ primary: '', accent: '' }),
  /**
   * Name of a curated typeface set (see lib/pdf/fonts.ts `FONT_SETS`). Kept as a
   * string rather than an enum so adding a set is a one-file change; an unknown
   * name throws at render time rather than silently substituting.
   */
  fontSet: z.string().default('standard'),
  /**
   * The Word letterhead's design (lib/firm/letterhead-design.ts). `auto` picks
   * one from the document name, so a firm that never chose still gets a stable
   * letterhead of its own.
   */
  letterhead: z.enum(['auto', ...LETTERHEAD_DESIGNS]).default('auto'),
});

export const emailSchema = z.object({
  fromName: z.string().default(''),
  fromAddress: z.string().default(''),
  financeAddress: z.string().default(''),
  ipAddress: z.string().default(''),
  /** Corporate/compliance mailbox: client reports about a client's companies go out from it. */
  complianceAddress: z.string().default(''),
  /** Domains treated as the firm's own for email direction classification. */
  ownedDomains: z.array(z.string()).default([]),
});

const EMPTY_EMAIL = {
  fromName: '',
  fromAddress: '',
  financeAddress: '',
  ipAddress: '',
  complianceAddress: '',
  ownedDomains: [] as string[],
};

/**
 * Root folders for documents mirrored to the firm's SharePoint/OneDrive.
 * These name a live archive: changing one does not move what is already
 * filed there, so a firm's value is set once at provisioning and left alone.
 * Blank derives a root from the firm's short name.
 */
export const documentsSchema = z.object({
  financeRoot: z.string().default(''),
  corporateRoot: z.string().default(''),
});

const EMPTY_DOCUMENTS = { financeRoot: '', corporateRoot: '' };

/**
 * A ceiling on model calls, counted per firm in `ai_usage_hourly` and enforced
 * in `anthropicFor` (lib/ai/gate.ts). Null means no ceiling, which is every
 * real firm today; the public demo is the firm that needs one, because anyone
 * can sign in to it.
 */
export const aiLimitsSchema = z.object({
  perHour: z.number().int().positive(),
  /** Counted over the Manila calendar day. */
  perDay: z.number().int().positive(),
});

/**
 * Marks the firm as the public demo — a firm a stranger signs in to with one
 * click, as one of these staff members. It is one of the three conditions on
 * that sign-in (lib/demo/sign-in.ts); the other two are the deployment
 * declaring itself a demo and the persona being registered here. It also turns
 * on the refusals in lib/demo/guard.ts, which stop visitors changing accounts
 * or anything outside this firm.
 */
export const demoSchema = z.object({
  enabled: z.boolean().default(false),
  personas: z
    .array(z.object({ key: z.enum(DEMO_PERSONA_KEYS), personId: z.string().min(1) }))
    .default([]),
});

const settingsSchema = z.object({
  email: emailSchema.default(EMPTY_EMAIL),
  documents: documentsSchema.default(EMPTY_DOCUMENTS),
  features: z.record(z.string(), z.boolean()).default({}),
  aiLimits: aiLimitsSchema.nullable().default(null),
  demo: demoSchema.default({ enabled: false, personas: [] }),
});

export type FirmBranding = z.infer<typeof brandingSchema>;
export type FirmSettings = z.infer<typeof settingsSchema>;

export interface FirmConfig {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  status: 'active' | 'suspended';
  branding: FirmBranding;
  email: FirmSettings['email'];
  documents: FirmSettings['documents'];
  features: FirmSettings['features'];
  aiLimits: FirmSettings['aiLimits'];
  demo: FirmSettings['demo'];
}

/** Root folder for a firm's mirrored documents, derived from its short name
 *  when unconfigured so a new firm never files into another firm's archive. */
export function documentRoot(config: FirmConfig, kind: 'finance' | 'corporate'): string {
  const configured =
    kind === 'finance' ? config.documents.financeRoot : config.documents.corporateRoot;
  if (configured.trim()) return configured.trim();
  const label = kind === 'finance' ? 'Finance' : 'Corporate';
  return `${config.shortName} ${label}`;
}

export const getFirmConfig = cache(async (firmId: string): Promise<FirmConfig> => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('firms')
    .select('id, slug, name, short_name, status, branding, settings')
    .eq('id', firmId)
    .maybeSingle();

  if (error) throw new Error(`firms read failed: ${error.message}`);
  if (!data) throw new Error(`Unknown firm: ${firmId}`);

  const branding = brandingSchema.parse(data.branding ?? {});
  const settings = settingsSchema.parse(data.settings ?? {});

  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    shortName: data.short_name,
    status: data.status,
    branding,
    email: settings.email,
    documents: settings.documents,
    features: settings.features,
    aiLimits: settings.aiLimits,
    demo: settings.demo,
  };
});

/** Billing paths only: throws when the firm's invoice settings are absent or
 *  still incomplete. One rule, expressed once, in lib/billing/firm-defaults. */
export async function getFirmInvoiceConfig(firmId: string): Promise<FirmInvoiceSettings> {
  return getFirmInvoiceSettings(firmId);
}

/** Resolve a request Host header to a firm for pre-auth branding. Returns
 * null for unknown hosts (callers render the neutral platform chrome). */
export async function findFirmIdByHost(host: string): Promise<string | null> {
  const domain = host.toLowerCase().split(':')[0];
  const supabase = getSupabase();
  const { data } = await supabase
    .from('firm_domains')
    .select('firm_id')
    .eq('domain', domain)
    .maybeSingle();
  return data?.firm_id ?? null;
}

/**
 * Base URL for links sent TO a firm's people and clients — portal invites,
 * file requests, notification mails, push click-throughs.
 *
 * A firm's own primary host when it has one, the platform URL otherwise. The
 * scheme and port come from the platform URL rather than being assumed, so a
 * dev host resolves to http://firm.localhost:3000 and a production one to
 * https://firm.example.com without either case being special-cased.
 *
 * A firm with no domain of its own is not an error: the platform URL works,
 * and the proxy binds the session to the right host after sign-in anyway.
 */
export const firmBaseUrl = cache(async (firmId: string): Promise<string> => {
  const platform = new URL(appBaseUrl());
  const supabase = getSupabase();
  const { data } = await supabase
    .from('firm_domains')
    .select('domain')
    .eq('firm_id', firmId)
    .eq('is_primary', true)
    .maybeSingle();

  const domain = (data?.domain as string | undefined)?.trim();
  if (!domain) return platform.origin;

  platform.hostname = domain;
  return platform.origin;
});
