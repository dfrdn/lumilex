/**
 * Seed the firm Knowledge Base with the Philippine objection taxonomy used by
 * the Judicial Affidavit reviewer: grounds for objecting to a question/answer
 * under the 2019 Revised Rules on Evidence (A.M. No. 19-08-15-SC) and the
 * Judicial Affidavit Rule (A.M. No. 12-8-8-SC).
 *
 * Pages are kind='evidence_rule', status='draft' — a lawyer should verify the
 * citations and promote them to 'published'. They are searchable while draft.
 *
 * Usage:
 *   NODE_OPTIONS=--experimental-websocket npx tsx scripts/seed-evidence-rules.ts [--firm <slug|uuid>]
 * With exactly one active firm the `--firm` flag can be omitted.
 */

import { readFileSync } from 'fs';

const envContent = readFileSync('.env.local', 'utf8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}
if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
}

import { getSupabase } from '../lib/supabase';
import { getServiceDbForFirm } from '../lib/tenancy/service-db';
import { generateEmbeddingsForEntity, deleteEmbeddingsForSource } from '../lib/ai/embeddings';
import { kbSlug, KB_KIND_LABELS, type KbKind } from '../lib/ai/kb-types';

/**
 * Resolve the firm to seed: `--firm <slug|uuid>`, else the only active firm.
 * With several active firms and no flag, refuse rather than guess.
 */
async function resolveFirmId(requested: string | null): Promise<string> {
  const { data: firms } = await getSupabase()
    .from('firms')
    .select('id, slug, status')
    .eq('status', 'active')
    .order('slug');
  const list = (firms ?? []) as { id: string; slug: string }[];
  if (list.length === 0) throw new Error('No active firms.');

  if (requested) {
    const hit = list.find((f) => f.id === requested || f.slug === requested);
    if (!hit) {
      throw new Error(`No active firm matching "${requested}". Active: ${list.map((f) => f.slug).join(', ')}`);
    }
    return hit.id;
  }

  if (list.length > 1) {
    throw new Error(`Several active firms — pass --firm <slug>: ${list.map((f) => f.slug).join(', ')}`);
  }
  console.log(`Firm: ${list[0].slug} (${list[0].id})`);
  return list[0].id;
}

const KIND: KbKind = 'evidence_rule';

interface SeedPage {
  /** objection_type key — also used by the reviewer's ObjectionType enum. */
  key: string;
  title: string;
  summary: string;
  content: string;
}

const PAGES: SeedPage[] = [
  {
    key: 'leading',
    title: 'Leading questions',
    summary: 'Questions that suggest their own answer — improper on direct examination, which is what a judicial affidavit is.',
    content: `**Rule:** Rule 132, Sec. 10, 2019 Revised Rules on Evidence. A leading question suggests to the witness the answer it desires. It is **not allowed on direct examination** — and a judicial affidavit takes the place of direct testimony, so leading questions in the proponent's own Q&A are objectionable and the answers may be stricken (A.M. No. 12-8-8-SC, Sec. 6).

**Exceptions (leading allowed):** on cross-examination; on preliminary matters; when there is difficulty getting direct/intelligible answers from an ignorant, child, feeble-minded, or deaf-mute witness; of an unwilling or hostile witness; or of an adverse party or its officer/agent.

**Trigger:** the question states the fact and asks the witness only to confirm it. Example — "You saw the accused stab the victim at 9:00 p.m., correct?"

**Fix (self-review):** make it open/non-suggestive — "What, if anything, did you see at about 9:00 p.m.?"`,
  },
  {
    key: 'misleading',
    title: 'Misleading questions',
    summary: 'Questions assuming a fact or prior testimony that is not in the record — never allowed, even on cross.',
    content: `**Rule:** Rule 132, Sec. 12, 2019 Revised Rules on Evidence. A misleading question assumes as true a fact not yet testified to, or contrary to what the witness actually stated. It is **not allowed in any type of examination.**

**Trigger:** the question presupposes testimony that was never given. Example — "When you ran the red light, was it raining?" where the witness never said he ran a red light.

**Fix:** establish the predicate fact first, then ask the dependent question.`,
  },
  {
    key: 'compound',
    title: 'Compound questions',
    summary: 'A single question that asks two or more things, making the answer ambiguous.',
    content: `**Ground:** objection as to the form of the question. A compound question joins two or more inquiries so a single "yes/no" answer is ambiguous as to which part it addresses.

**Trigger:** Example — "Did you see and hear the collision?" (two distinct inquiries).

**Fix (self-review):** split into separate questions — one for what the witness saw, one for what the witness heard.`,
  },
  {
    key: 'argumentative',
    title: 'Argumentative questions',
    summary: 'A question that makes an argument or asks the witness to adopt an inference rather than state facts.',
    content: `**Ground:** objection as to form. An argumentative question does not seek facts within the witness's knowledge; it argues the case or asks the witness to agree with the examiner's inference or characterization.

**Trigger:** Example — "If you really cared about your client, wouldn't you have called the police immediately?"

**Fix:** confine the question to facts perceived by the witness; save inferences for argument.`,
  },
  {
    key: 'narrative',
    title: 'Questions calling for a narrative',
    summary: 'A question so broad it invites an unguided narrative that may smuggle in inadmissible matter.',
    content: `**Ground:** objection as to form. An overly broad question invites a long, unsupervised narrative, risking hearsay, opinion, or irrelevant matter that the adverse party cannot object to in time.

**Trigger:** Example — "Tell us everything that happened in 2023."

**Fix (self-review):** break the testimony into focused questions tied to specific events, times, and perceptions.`,
  },
  {
    key: 'asked_answered',
    title: 'Asked and answered (repetitious)',
    summary: 'Repeating a question already answered — wastes time and unduly emphasizes the testimony.',
    content: `**Ground:** objection as to form / undue repetition (cf. the court's control over the mode of interrogation, Rule 132, Sec. 6). Re-asking a matter the witness has already answered serves only to emphasize it.

**Trigger:** the same fact is elicited a second time in substantially the same way.

**Fix:** remove the duplicate question from the affidavit.`,
  },
  {
    key: 'assumes_facts',
    title: 'Assumes facts not in evidence',
    summary: 'A question premised on a fact that has not been established in the record.',
    content: `**Ground:** objection as to form (closely related to misleading questions, Rule 132, Sec. 12). The question builds in a fact that no testimony or exhibit has yet established.

**Trigger:** Example — "Where did you hide the weapon?" when nothing shows the witness ever possessed or hid a weapon.

**Fix:** lay the foundation first; only then ask the dependent question.`,
  },
  {
    key: 'speculation',
    title: 'Calls for speculation',
    summary: 'Asking the witness to guess about matters outside personal knowledge.',
    content: `**Rule:** a witness may testify only to facts of which he has **personal knowledge** (Rule 130, Sec. 22, 2019 Revised Rules on Evidence). A question that asks the witness to guess — especially about another person's state of mind — calls for speculation.

**Trigger:** Example — "What was the driver thinking when he sped up?"

**Fix:** ask only what the witness personally perceived (saw, heard, did).`,
  },
  {
    key: 'opinion',
    title: 'Calls for opinion of a lay witness',
    summary: 'Ordinary witnesses may not give opinions except in the narrow categories allowed by the Rules.',
    content: `**Rule:** Rule 130, Secs. 51–53, 2019 Revised Rules on Evidence. The opinion of an **ordinary (lay) witness** is admissible only on: the identity of a person he knows; handwriting he is familiar with; the mental sanity of a person he is acquainted with; and his impressions of the emotion, behavior, condition, or appearance of a person. **Expert** opinion (Sec. 52) requires the witness be qualified in the relevant field.

**Trigger:** asking a non-expert for a legal/technical conclusion — e.g. "Was the contract legally binding?" or "Was the driver negligent?"

**Fix:** elicit the underlying facts and reserve conclusions for qualified experts or argument.`,
  },
  {
    key: 'hearsay',
    title: 'Hearsay',
    summary: 'Out-of-court statements offered for their truth — inadmissible unless an exception applies.',
    content: `**Rule:** Rule 130, Sec. 37, 2019 Revised Rules on Evidence: hearsay is a statement (other than one the declarant makes while testifying at the trial) offered to prove the truth of the matter asserted. It is inadmissible except as provided by the Rules (exceptions in Secs. 38–47: dying declaration, res gestae, business/official records, declaration against interest, etc.). The amended definition expressly covers **independently relevant statements** offered for their truth.

**Trigger (in a JA):** an answer reciting what a non-testifying person said, offered to prove that thing happened — e.g. "My neighbor told me the accused was at the scene."

**Fix:** elicit the witness's own perception, or lay the foundation for a recognized exception.`,
  },
  {
    key: 'relevance',
    title: 'Irrelevant or immaterial',
    summary: 'Evidence must relate to a fact in issue and be competent; otherwise it is objectionable.',
    content: `**Rule:** Rule 128, Secs. 3–4, 2019 Revised Rules on Evidence. Evidence is admissible only if **relevant** (it has a relation to the fact in issue such that it induces belief about its existence) and **competent** (not excluded by the Constitution, law, or Rules). Immaterial matter — directed at a fact not in issue — is likewise objectionable.

**Trigger:** the answer concerns matters with no logical bearing on the issues framed by the pleadings.

**Fix:** drop the question or tie it to a fact in issue.`,
  },
  {
    key: 'original_document',
    title: 'Original Document Rule (best evidence)',
    summary: 'To prove the contents of a writing, the original must be produced — testimony about contents is objectionable absent an exception.',
    content: `**Rule:** Rule 130, Secs. 3–8, 2019 Revised Rules on Evidence (the former Best Evidence Rule, now the **Original Document Rule**). When the subject of inquiry is the **contents of a document**, no evidence is admissible other than the original, except when the original is lost/destroyed without bad faith, is in the adverse party's control, consists of numerous accounts, is a public record, or is collateral.

**Trigger:** an answer testifying to what a contract, letter, or record says without the document being offered.

**Fix:** attach/produce the original (or establish an exception) before testifying to its contents.`,
  },
  {
    key: 'parol_evidence',
    title: 'Parol Evidence Rule',
    summary: 'When an agreement is reduced to writing, oral evidence may not vary its terms except in defined cases.',
    content: `**Rule:** Rule 130, Sec. 10, 2019 Revised Rules on Evidence. When the terms of an agreement are in writing, that writing is deemed to contain all agreed terms; no evidence of other terms may be admitted. **Exceptions** (must be put in issue in a verified pleading): an intrinsic ambiguity/mistake/imperfection in the writing; failure of the writing to express the true intent; validity of the agreement; or other terms agreed after execution.

**Trigger:** an answer adding or contradicting the written terms of a contract through prior/contemporaneous oral understandings.

**Fix:** confine testimony to the writing unless an exception was properly pleaded.`,
  },
  {
    key: 'privilege',
    title: 'Privileged communication',
    summary: 'Questions calling for protected communications (attorney-client, marital, etc.) are objectionable.',
    content: `**Rule:** Rule 130, Sec. 24, 2019 Revised Rules on Evidence. Protected communications include: husband-wife; **attorney-client** (extended to the lawyer's secretary/stenographer/clerk); physician-patient; priest-penitent; and public officers on matters whose disclosure would harm public interest.

**Trigger:** a question seeking the substance of a privileged communication without a waiver.

**Fix:** rephrase to avoid the privileged matter, or establish waiver.`,
  },
  {
    key: 'vague',
    title: 'Vague or ambiguous',
    summary: 'A question unintelligible or open to multiple meanings, yielding an unreliable answer.',
    content: `**Ground:** objection as to form. A vague, ambiguous, or unintelligible question cannot be answered reliably because the witness (and the record) cannot tell what is being asked.

**Trigger:** undefined pronouns, unclear time frames, or multiple plausible readings — e.g. "Did you do it then?"

**Fix:** specify the actor, act, time, and place.`,
  },
  {
    key: 'ja_rule_contents',
    title: 'Judicial Affidavit — required contents',
    summary: 'A judicial affidavit must comply with the content requirements of the JA Rule; defective form is objectionable.',
    content: `**Rule:** A.M. No. 12-8-8-SC (Judicial Affidavit Rule), Sec. 3. A judicial affidavit must state: (a) the name, age, residence/business address, and occupation of the witness; (b) the name and address of the lawyer who conducted/supervised the examination and the place where it was taken; (c) a statement that the witness was reminded of the **penalty for false testimony**; and (d) the **questions and the witness's answers**, consecutively numbered, showing the answers are the witness's own.

**Trigger:** an affidavit missing the attestation/admonition, not in true Q&A form, or in narrative form.

**Fix:** conform the affidavit to Sec. 3 before filing.`,
  },
  {
    key: 'ja_rule_attestation',
    title: 'Judicial Affidavit — lawyer attestation',
    summary: "The examining lawyer must attest that the testimony was faithfully recorded and the witness was not coached.",
    content: `**Rule:** A.M. No. 12-8-8-SC, Sec. 4. The judicial affidavit must contain a **sworn attestation** of the lawyer who conducted the examination, stating that he faithfully recorded or caused to be recorded the questions and the witness's answers, and that he neither coached the witness nor gave suggestions as to how to answer. A false attestation subjects the lawyer to discipline (Sec. 10).

**Trigger:** missing or defective lawyer attestation.

**Fix:** include the Sec. 4 attestation; without it the affidavit is vulnerable to exclusion.`,
  },
  {
    key: 'ja_rule_strike',
    title: 'Judicial Affidavit — objections and motion to strike',
    summary: 'The procedural hook: a party may object to and move to strike objectionable questions/answers in a JA.',
    content: `**Rule:** A.M. No. 12-8-8-SC, Sec. 6. Because the judicial affidavit replaces direct testimony, the **adverse party may move to strike out** any question or answer in the affidavit that is objectionable (e.g., leading, hearsay, opinion, irrelevant). The court rules on the objection and may order the offending question/answer expunged. Counsel should mark each objectionable item and state the specific ground.

**Use:** in opposing-party review, generate, per item, the ground + a one-line motion-to-strike entry citing the controlling rule.`,
  },
];

async function main() {
  const firmFlagIdx = process.argv.indexOf('--firm');
  const firmId = await resolveFirmId(firmFlagIdx !== -1 ? (process.argv[firmFlagIdx + 1] ?? null) : null);
  const supabase = getServiceDbForFirm(firmId);
  const nowIso = new Date().toISOString();
  let upserted = 0;
  let embedded = 0;

  for (const p of PAGES) {
    const slug = kbSlug(KIND, p.key);

    const { data: existing } = await supabase
      .from('kb_pages').select('id').eq('slug', slug).maybeSingle();

    let pageId: number;
    if (existing) {
      const { error } = await supabase.from('kb_pages').update({
        kind: KIND, title: p.title, summary: p.summary, content_md: p.content,
        jurisdiction: 'Philippines', generated_by: 'manual', status: 'draft',
        updated_at: nowIso, last_generated_at: nowIso,
      }).eq('id', existing.id);
      if (error) { console.error(`update ${slug}:`, error.message); continue; }
      pageId = existing.id as number;
    } else {
      const { data: inserted, error } = await supabase.from('kb_pages').insert({
        slug, kind: KIND, title: p.title, summary: p.summary, content_md: p.content,
        jurisdiction: 'Philippines', generated_by: 'manual', status: 'draft',
        last_generated_at: nowIso,
      }).select('id').single();
      if (error || !inserted) { console.error(`insert ${slug}:`, error?.message); continue; }
      pageId = inserted.id as number;
    }
    upserted++;

    await deleteEmbeddingsForSource('kb_page', String(pageId), firmId).catch(() => {});
    const n = await generateEmbeddingsForEntity(
      'kb_page',
      String(pageId),
      null,
      `${p.title} (${KB_KIND_LABELS[KIND]})\n\n${p.content}`,
      { kind: KIND, title: p.title, slug },
      firmId,
    ).catch((e) => { console.error(`embed ${slug}:`, e?.message ?? e); return 0; });
    if (n > 0) embedded++;

    console.log(`✓ ${slug} (page ${pageId}, ${n} chunk${n === 1 ? '' : 's'})`);
  }

  console.log(`\nDone. ${upserted}/${PAGES.length} pages upserted, ${embedded} embedded.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
