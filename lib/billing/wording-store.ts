import type { SupabaseClient } from '@supabase/supabase-js';
import { defaultParagraphs, letterWording, type LetterWording } from './letter-blocks';
import { defaultEmailParagraphs, emailSubjectWording } from './email-blocks';
import { readParagraphs, type BillingParagraph, type DocumentKind } from './paragraphs';

/**
 * Reading the billing letter's and email's wording as finance last saved it:
 * the fixed lines from billing_letter_blocks and the paragraph lists from
 * billing_paragraphs. A document with no saved paragraphs uses its defaults.
 *
 * A firm starts with no rows at all: its letter and email are the defaults in
 * code until finance first changes one, when `ensureParagraphs` writes the
 * defaults out as that firm's rows so the change lands among them.
 */

const PARAGRAPH_COLUMNS = 'key, document, label, body, rule, choice, system, sort_order, archived';

export async function loadLetterWording(supabase: SupabaseClient): Promise<LetterWording> {
  const [lines, paragraphs] = await Promise.all([
    supabase.from('billing_letter_blocks').select('key, kind, body'),
    supabase.from('billing_paragraphs').select(PARAGRAPH_COLUMNS).eq('document', 'letter'),
  ]);
  if (lines.error) throw new Error(`Failed to read the billing letter wording: ${lines.error.message}`);
  if (paragraphs.error) throw new Error(`Failed to read the billing letter paragraphs: ${paragraphs.error.message}`);
  const list = readParagraphs(paragraphs.data ?? [], 'letter');
  return list.length ? letterWording(lines.data ?? [], list) : letterWording(lines.data ?? []);
}

export async function loadEmailWording(supabase: SupabaseClient): Promise<{ subject: string; paragraphs: BillingParagraph[] }> {
  const [lines, paragraphs] = await Promise.all([
    supabase.from('billing_letter_blocks').select('key, kind, body').eq('key', 'email_subject'),
    supabase.from('billing_paragraphs').select(PARAGRAPH_COLUMNS).eq('document', 'email'),
  ]);
  if (paragraphs.error) throw new Error(`Failed to read the billing email paragraphs: ${paragraphs.error.message}`);
  const list = readParagraphs(paragraphs.data ?? [], 'email');
  return { subject: emailSubjectWording(lines.data ?? []), paragraphs: list.length ? list : defaultEmailParagraphs() };
}

/**
 * The paragraphs finance can tick for a client or an invoice, by choice: one
 * entry per choice, named by the paragraph that introduced it (letter first).
 */
/** A document's paragraphs as the firm starts with them. */
export function defaultParagraphsFor(document: DocumentKind): BillingParagraph[] {
  return document === 'email' ? defaultEmailParagraphs() : defaultParagraphs('letter');
}

/**
 * Writes a document's default paragraphs out as the firm's own rows when it has
 * none yet, so an edit to one paragraph doesn't leave it alone in the list.
 * Never touches a document that has rows — deleted ones included — so finance's
 * deletions and rewordings stay.
 */
export async function ensureParagraphs(supabase: SupabaseClient, firmId: string, document: DocumentKind, editedBy: string): Promise<void> {
  const { count, error } = await supabase
    .from('billing_paragraphs')
    .select('key', { count: 'exact', head: true })
    .eq('document', document);
  if (error) throw new Error(`Failed to read the billing ${document} paragraphs: ${error.message}`);
  if ((count ?? 0) > 0) return;
  const now = new Date().toISOString();
  const rows = defaultParagraphsFor(document).map((p) => ({
    firm_id: firmId,
    document,
    key: p.key,
    label: p.label,
    body: p.body,
    rule: p.rule,
    choice: p.choice,
    system: p.system,
    sort_order: p.sortOrder,
    archived: false,
    updated_at: now,
    updated_by: editedBy,
  }));
  const { error: insertError } = await supabase
    .from('billing_paragraphs')
    .upsert(rows, { onConflict: 'firm_id,document,key', ignoreDuplicates: true });
  if (insertError) throw new Error(`Failed to set up the billing ${document} paragraphs: ${insertError.message}`);
}

export async function loadClientChoices(supabase: SupabaseClient): Promise<{ key: string; label: string }[]> {
  const { data } = await supabase
    .from('billing_paragraphs')
    .select('document, label, choice, sort_order')
    .not('choice', 'is', null)
    .eq('archived', false)
    .order('document', { ascending: false })
    .order('sort_order');
  const out = new Map<string, string>();
  const rows = data?.length
    ? data
    : defaultParagraphsFor('letter').map((p) => ({ label: p.label, choice: p.choice }));
  for (const r of rows) if (r.choice && !out.has(r.choice)) out.set(r.choice as string, r.label as string);
  return [...out].map(([key, label]) => ({ key, label }));
}
