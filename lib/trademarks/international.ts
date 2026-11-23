import type { SupabaseClient } from '@supabase/supabase-js';
import type { InternationalRegistration, Trademark } from '@/types/notion';
import { TRADEMARK_SELECT, rowToInternationalRegistration, rowToTrademark } from '@/lib/trademark-row';
import { parseCountries } from '@/lib/trademarks/countries';
import { isNational } from '@/lib/trademark-deadlines';

/**
 * Whether a mark can be the basic mark of an international registration:
 * a Philippine application already filed with IPOPHL (the office of origin),
 * not itself a designation, and not abandoned.
 */
export function basicMarkProblem(base: Pick<Trademark, 'origin' | 'status' | 'filingDate'>): string | null {
  if (!isNational(base)) return 'Only a Philippine application or registration can be the basic mark of an international registration.';
  if (base.status === 'Abandoned') return 'The mark is abandoned, so it can’t carry an international registration.';
  if (!base.filingDate || base.status === 'Prelim' || base.status === 'For Filing') {
    return 'File the Philippine application first — the international application rests on it.';
  }
  return null;
}

/** The countries to designate, or why the list can't be used. */
export function designationCountries(countries: string[], already: string[] = []): { codes: string[] } | { error: string } {
  const { codes, unknown } = parseCountries(countries.join(','));
  if (unknown.length) return { error: `Not a country or regional office: ${unknown.join(', ')}` };
  const repeated = codes.filter((c) => already.includes(c));
  if (repeated.length) return { error: `Already designated: ${repeated.join(', ')}` };
  return { codes };
}

/**
 * Adds one mark per designated country under an international registration,
 * copying what the basic mark is (its client, matter, mark and goods). Each is
 * pending before its country's office until it refuses or protects it. The
 * countries go in as one insert, so either all of them are recorded or none.
 */
export async function insertDesignations(
  supabase: SupabaseClient,
  firmId: string,
  base: Trademark,
  ir: { id: string; irNo: string | null; irDate: string | null },
  opts: { codes: string[]; designationDate: string | null; refusalPeriodMonths: 12 | 18; createdBy: string },
): Promise<{ ids: string[] } | { error: string }> {
  let lastError: { code?: string; message: string } | null = null;
  // Each mark takes the client's next Ref. No. index; a concurrent insert taking one retries.
  for (let attempt = 0; attempt < 3; attempt++) {
    let next = 1;
    if (base.clientId) {
      const { data } = await supabase
        .from('trademarks').select('client_index').eq('client_id', base.clientId).order('client_index', { ascending: false }).limit(1);
      next = ((data?.[0]?.client_index as number | undefined) ?? 0) + 1;
    }
    const rows = opts.codes.map((country, i) => ({
      firm_id: firmId,
      matter_id: base.matterId,
      matter_name: base.matterName,
      client_id: base.clientId,
      client_name: base.clientName,
      client_code: base.clientCode,
      client_index: base.clientId ? next + i : 0,
      mark: base.mark,
      type: base.type,
      classes: base.classes,
      goods_services: base.goodsServices,
      owner: base.owner,
      contact_email: base.contactEmail,
      origin: 'madrid_out',
      ir_id: ir.id,
      country,
      reg_ir_no: ir.irNo,
      ir_date: ir.irDate,
      designation_date: opts.designationDate,
      refusal_period_months: opts.refusalPeriodMonths,
      status: 'Pending',
      created_by: opts.createdBy,
    }));
    const { data, error } = await supabase.from('trademarks').insert(rows).select('id');
    if (!error && data) return { ids: data.map((r) => r.id as string) };
    lastError = error;
    if (error?.code !== '23505') break;
  }
  return { error: `Could not add the designated countries: ${lastError?.message ?? 'insert failed'}` };
}

export interface RegistrationWithDesignations extends InternationalRegistration {
  designations: Trademark[];
}

/** A basic mark's international registrations, oldest first, each with its designated countries. */
export async function loadRegistrations(supabase: SupabaseClient, baseId: string): Promise<RegistrationWithDesignations[]> {
  const { data: irs } = await supabase
    .from('international_registrations').select('*').eq('base_trademark_id', baseId).order('created_at');
  if (!irs?.length) return [];
  const { data: rows } = await supabase
    .from('trademarks').select(TRADEMARK_SELECT).in('ir_id', irs.map((r) => r.id)).order('country');
  const designations = (rows ?? []).map(rowToTrademark);
  return irs.map((r) => ({ ...rowToInternationalRegistration(r), designations: designations.filter((d) => d.irId === r.id) }));
}
