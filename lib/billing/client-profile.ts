import type { SupabaseClient } from '@supabase/supabase-js';
import type { LetterAddressee } from './letter-content';

/**
 * A client's billing profile: everything about the letter and whoever receives
 * it, set once per client — not per matter. A client's monthly invoice covers
 * all its matters, so these used to be read from whichever matter config
 * sorted first, and a client whose matters disagreed got a letter decided by
 * the sort order. Fee terms (retainer, cap, rates, discounts on the fees
 * themselves) stay on each matter, where the engagement sets them.
 *
 * Stored in `client_billing_profiles.settings`. The per-invoice override in
 * Review and Generate can still change any of it for one invoice.
 */
export interface ClientBillingProfile {
  letterAddressee?: LetterAddressee;
  clientAddress?: string;
  attnName?: string;
  attnTitle?: string;
  throughName?: string;
  salutation?: string;
  clientEmail?: string;
  ccEmails?: string;
  includeVAT?: boolean;
  includeLessenFeesNote?: boolean;
  /** Opens the letter as an initial billing statement. */
  initialStatement?: boolean;
  /** Keys of finance's optional paragraphs this client's letters carry. */
  optionalParagraphs?: string[];
  /** Percent off the period's legal fees for paying early; blank is no offer. */
  earlyPaymentDiscountPercent?: string;
  /** Days after the letter the client has to earn the discount. */
  earlyPaymentDays?: string;
}

const TEXT_KEYS = [
  'clientAddress', 'attnName', 'attnTitle', 'throughName', 'salutation', 'clientEmail', 'ccEmails',
  'earlyPaymentDiscountPercent', 'earlyPaymentDays',
] as const;
const FLAG_KEYS = ['includeVAT', 'includeLessenFeesNote', 'initialStatement'] as const;

/** A stored profile, read defensively: unknown keys dropped, wrong types ignored. */
export function readClientProfile(raw: unknown): ClientBillingProfile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: ClientBillingProfile = {};
  for (const k of TEXT_KEYS) if (typeof r[k] === 'string' && (r[k] as string).trim()) out[k] = (r[k] as string).trim();
  for (const k of FLAG_KEYS) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  if (r.letterAddressee === 'company' || r.letterAddressee === 'person') out.letterAddressee = r.letterAddressee;
  if (Array.isArray(r.optionalParagraphs)) {
    out.optionalParagraphs = [...new Set(r.optionalParagraphs.filter((k): k is string => typeof k === 'string' && !!k.trim()))];
  }
  return out;
}

/** The profile of the client billed under this name; empty when it has none yet. */
export async function loadClientProfile(
  supabase: SupabaseClient,
  clientName: string,
): Promise<{ clientId: string | null; profile: ClientBillingProfile }> {
  const { data: client } = await supabase.from('clients').select('notion_id').eq('name', clientName).maybeSingle();
  const clientId = (client?.notion_id as string | undefined) ?? null;
  if (!clientId) return { clientId: null, profile: {} };
  const { data } = await supabase.from('client_billing_profiles').select('settings').eq('client_id', clientId).maybeSingle();
  return { clientId, profile: readClientProfile(data?.settings) };
}

/** Override keys for the optional paragraphs: `optional:<key>` = 'true' / 'false'. */
export const OPTIONAL_OVERRIDE_PREFIX = 'optional:';

/** Override keys the generic override layering must leave to `applyLetterOverride`. */
export function isLetterOverrideKey(k: string): boolean {
  return k === 'initialStatement' || k === 'letterAddressee' || k.startsWith(OPTIONAL_OVERRIDE_PREFIX);
}

function flag(v: unknown): boolean | undefined {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return undefined;
}

/** The profile's letter choices, with one invoice's override applied on top. */
export function applyLetterOverride(
  profile: ClientBillingProfile,
  override: Record<string, unknown> | null | undefined,
): Pick<ClientBillingProfile, 'initialStatement' | 'optionalParagraphs' | 'letterAddressee'> {
  const o = override ?? {};
  const optional = new Set(profile.optionalParagraphs ?? []);
  for (const [k, v] of Object.entries(o)) {
    if (!k.startsWith(OPTIONAL_OVERRIDE_PREFIX)) continue;
    const on = flag(v);
    const key = k.slice(OPTIONAL_OVERRIDE_PREFIX.length);
    if (on === true) optional.add(key);
    if (on === false) optional.delete(key);
  }
  const addressee = o.letterAddressee === 'company' || o.letterAddressee === 'person' ? o.letterAddressee : profile.letterAddressee;
  return {
    initialStatement: flag(o.initialStatement) ?? profile.initialStatement ?? false,
    optionalParagraphs: [...optional],
    letterAddressee: addressee,
  };
}
