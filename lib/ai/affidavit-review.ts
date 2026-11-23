import { anthropicFor, type AiContext } from '@/lib/ai/gate';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { uploadToClaudeFiles } from '@/lib/ai/claude';
import { semanticKbSearch } from '@/lib/ai/kb-search';
import { searchEmbeddingsByType } from '@/lib/ai/embeddings';
import { resolveCitations } from '@/lib/juris';
import { toolArray } from '@/lib/ai/json-response';
import { extractPdfText } from '@/lib/ai/pdf-text';

// Judicial-affidavit objection reviewer. Reads an affidavit (PDF/DOCX) via the
// Claude Files API, grounds the analysis in the firm's evidence-rule KB pages,
// and returns a per-question objection review through forced tool use.

const MODEL = 'claude-sonnet-4-6';

export type ReviewMode = 'self' | 'opposing';

export type ObjectionType =
  | 'leading' | 'misleading' | 'compound' | 'argumentative' | 'narrative'
  | 'asked_answered' | 'assumes_facts' | 'speculation' | 'opinion' | 'hearsay'
  | 'relevance' | 'original_document' | 'parol_evidence' | 'privilege'
  | 'incompetent' | 'foundation' | 'vague' | 'ja_rule_defect';

const OBJECTION_TYPES: ObjectionType[] = [
  'leading', 'misleading', 'compound', 'argumentative', 'narrative',
  'asked_answered', 'assumes_facts', 'speculation', 'opinion', 'hearsay',
  'relevance', 'original_document', 'parol_evidence', 'privilege',
  'incompetent', 'foundation', 'vague', 'ja_rule_defect',
];

export interface AffidavitObjection {
  type: ObjectionType;
  rule: string;
  severity: 'high' | 'medium' | 'low';
  rationale: string;
}

export interface AffidavitFinding {
  q_no: number;
  question: string;
  answer_excerpt: string;
  verdict: 'clean' | 'objectionable';
  objections: AffidavitObjection[];
  suggested_rephrase: string;
  objection_language: string;
}


async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const is429 = err instanceof Error && (err.message.includes('429') || err.message.includes('rate_limit'));
      if (!is429 || attempt === maxRetries) throw err;
      const waitMs = Math.min(60_000, (2 ** attempt) * 15_000);
      console.log(`[affidavit-review] Rate limited, retrying in ${waitMs / 1000}s`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error('Unreachable');
}

const EMIT_TOOL = {
  name: 'emit_objection_review',
  description: 'Emit the structured per-question objection review of the judicial affidavit.',
  input_schema: {
    type: 'object' as const,
    properties: {
      affiant_name: { type: 'string', description: 'Name of the affiant/witness, or empty string if not stated.' },
      summary: { type: 'string', description: 'Overall exposure assessment in 2-4 sentences: how many questions are problematic and the most serious risks.' },
      findings: {
        type: 'array',
        description: 'One entry per numbered question in the affidavit, in order.',
        items: {
          type: 'object',
          properties: {
            q_no: { type: 'integer', description: 'The question number as it appears in the affidavit.' },
            question: { type: 'string', description: 'The verbatim question text.' },
            answer_excerpt: { type: 'string', description: 'A short excerpt of the answer for context (may be empty).' },
            verdict: { type: 'string', enum: ['clean', 'objectionable'] },
            objections: {
              type: 'array',
              description: 'Empty when verdict is clean.',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: OBJECTION_TYPES },
                  rule: { type: 'string', description: 'Exact citation, e.g. "Rule 132, Sec. 10, 2019 Revised Rules on Evidence".' },
                  severity: { type: 'string', enum: ['high', 'medium', 'low'] },
                  rationale: { type: 'string', description: '1-2 sentences identifying the offending words and why they are objectionable.' },
                },
                required: ['type', 'rule', 'severity', 'rationale'],
              },
            },
            suggested_rephrase: { type: 'string', description: 'SELF mode only: a compliant rewording eliciting the same testimony. Empty otherwise.' },
            objection_language: { type: 'string', description: 'OPPOSING mode only: a ready-to-file objection / motion-to-strike line. Empty otherwise.' },
          },
          required: ['q_no', 'question', 'verdict', 'objections', 'suggested_rephrase', 'objection_language'],
        },
      },
      citations_seen: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Every case citation (G.R. No. …, A.M. No. …, A.C. No. …) and statute citation (RA …, Republic Act No. …) that appears VERBATIM anywhere in the document, copied exactly as written. Empty array if none. Do not include the rules of court or the citations you yourself supply in objections.',
      },
    },
    required: ['affiant_name', 'summary', 'findings'],
  },
};

function buildSystemPrompt(mode: ReviewMode, grounding: string, feedback: string): string {
  const modeBlock = mode === 'self'
    ? `MODE = SELF-REVIEW. This is OUR OWN witness's judicial affidavit and we want to fix it before filing. For every objectionable question, fill "suggested_rephrase" with a compliant rewording that elicits the same testimony without the defect, and leave "objection_language" as an empty string.`
    : `MODE = OPPOSING. This is the ADVERSE party's judicial affidavit and we want to object to it. For every objectionable question, fill "objection_language" with a concise, ready-to-file objection / motion-to-strike line stating the ground and citation (e.g. "Objection to Q12 — leading (Rule 132, Sec. 10); move to strike the answer."), and leave "suggested_rephrase" as an empty string.`;

  return `You are a Philippine litigation associate reviewing a JUDICIAL AFFIDAVIT for objectionable questions.

A judicial affidavit (A.M. No. 12-8-8-SC, the Judicial Affidavit Rule) takes the place of a witness's DIRECT testimony and is written in numbered question-and-answer (Q&A) form. Under Sec. 6, the adverse party may move to strike any objectionable question or answer. The grounds for objection come from the 2019 Revised Rules on Evidence (A.M. No. 19-08-15-SC).

TASK: Segment the document into its numbered Q&A pairs (Q1/A1, Q2/A2, …). For EACH question, decide whether the question — or the answer it elicits — is objectionable, and list every applicable ground.

OBJECTION TYPES (use these exact keys for "type"):
- leading — suggests its own answer; improper on direct examination (Rule 132, Sec. 10)
- misleading — assumes a fact or testimony not given (Rule 132, Sec. 12)
- compound — asks two or more things at once
- argumentative — argues, or asks the witness to adopt an inference
- narrative — so broad it invites an unguided narrative
- asked_answered — repetitious of a matter already answered
- assumes_facts — premised on a fact not yet in evidence
- speculation — calls for a guess outside personal knowledge (Rule 130, Sec. 22)
- opinion — calls for a lay opinion/conclusion (Rule 130, Secs. 51-53)
- hearsay — calls for an out-of-court statement offered for its truth (Rule 130, Sec. 37)
- relevance — irrelevant or immaterial (Rule 128, Secs. 3-4)
- original_document — contents of a writing without the original (Rule 130, Sec. 3)
- parol_evidence — varies the terms of a written agreement (Rule 130, Sec. 10)
- privilege — calls for a privileged communication (Rule 130, Sec. 24)
- incompetent — otherwise inadmissible / incompetent
- foundation — lacks a foundation / personal-knowledge predicate
- vague — unintelligible or ambiguous
- ja_rule_defect — a defect under the Judicial Affidavit Rule itself (not in Q&A form, missing admonition/attestation, Secs. 3-4)

IMPORTANT — DO NOT OVER-FLAG LEADING QUESTIONS:
- Leading questions are PERMITTED, and must NOT be flagged, on PRELIMINARY or FOUNDATIONAL matters: the witness's name, age, address, occupation/employment, relationship to the parties, the oath / perjury admonition, willingness or readiness to testify, and other undisputed introductory background. Rule 132, Sec. 10 expressly allows leading questions on preliminary matters — so an oath-admonition or "are you willing to testify" question is NOT objectionable as leading.
- Only treat a question as "leading" when it suggests the answer on a SUBSTANTIVE or CONTESTED fact. Leading is likewise proper on cross-examination, and for a hostile/unwilling witness, an adverse party (or its officers), or a child/ignorant/feeble-minded/deaf-mute witness.

For each objection set: "rule" to the exact citation; "severity" to high|medium|low (how likely a court strikes it and how damaging); and "rationale" to 1-2 sentences quoting or paraphrasing the offending words. Set "verdict" to "objectionable" when there is at least one objection, otherwise "clean" with an empty "objections" array.

${modeBlock}

Also extract "affiant_name" and write a "summary" of the overall exposure. In "citations_seen", copy every case citation (G.R. No., A.M. No., A.C. No.) and statute citation (RA / Republic Act No.) that appears verbatim in the DOCUMENT itself — not the rules you cite in your objections.

Be precise and conservative — only flag genuine issues — but do NOT miss leading questions, which are the most common defect in judicial affidavits since the affidavit is direct testimony. This is decision-support for a lawyer, not legal advice.
${grounding ? `\n${grounding}` : ''}${feedback ? `\n\n${feedback}` : ''}`;
}

/**
 * Run the objection review for a pending affidavit_reviews row. Idempotent:
 * only acts on a 'pending' row, flips it to 'processing', then 'completed' or
 * 'failed'. Called from the route's after() so it survives the response.
 */
export async function reviewAffidavit(reviewId: number, firmId: string): Promise<void> {
  const supabase = getServiceDbForFirm(firmId);

  const { data: review } = await supabase
    .from('affidavit_reviews').select('*').eq('id', reviewId).maybeSingle();
  if (!review) return;
  if (review.status !== 'pending') return;

  await supabase.from('affidavit_reviews').update({ status: 'processing' }).eq('id', reviewId);

  try {
    if (!review.storage_path) throw new Error('No file path on the review row');

    const { data: blob, error: dlErr } = await supabase.storage
      .from('files').download(review.storage_path);
    if (dlErr || !blob) throw new Error(`Could not download file: ${dlErr?.message ?? 'no data'}`);
    const buffer = Buffer.from(await blob.arrayBuffer());

    // Claude's document block accepts only PDF and plaintext. Send PDFs
    // natively via the Files API (handles scanned pages too); extract Word
    // documents to text first.
    const ext = (review.file_name || '').split('.').pop()?.toLowerCase() ?? '';
    let claudeFileId: string | null = null;
    let extractedText = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [];

    if (ext === 'pdf') {
      claudeFileId = await uploadToClaudeFiles({ firmId, feature: 'ai_analysis' }, buffer, review.file_name || 'affidavit.pdf');
      content.push({ type: 'document', source: { type: 'file', file_id: claudeFileId } });
      // Best-effort text extraction, used only to retrieve relevant reviewer notes.
      try {
        const parsed = await extractPdfText(buffer);
        extractedText = (parsed.text || '').trim();
      } catch { /* the note query falls back to the file name */ }
    } else {
      const mammoth = await import('mammoth');
      const { value } = await mammoth.extractRawText({ buffer });
      let text = (value || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (!text || text.length < 10) {
        throw new Error('Could not extract text from the affidavit (it may be a scanned image without OCR).');
      }
      if (text.length > 80_000) text = `${text.slice(0, 80_000)}\n\n[Document truncated]`;
      extractedText = text;
      content.push({ type: 'text', text: `--- JUDICIAL AFFIDAVIT TEXT ("${review.file_name}") ---\n\n${text}\n\n--- END OF AFFIDAVIT ---` });
    }

    const hits = await semanticKbSearch(
      'objections to judicial affidavit questions: leading, hearsay, opinion, relevance under the Philippine Revised Rules on Evidence',
      { firmId, limit: 10, kinds: ['evidence_rule'] },
    ).catch(() => []);
    const grounding = hits.length
      ? `FIRM REFERENCE — Philippine objection grounds (apply these and cite the rule text):\n${hits.map((h) => `- ${h.title}: ${h.snippet}`).join('\n')}`
      : '';

    // Reviewer notes feed the model. Same-affidavit notes are authoritative
    // (always applied); semantically-relevant notes from OTHER affidavits are
    // offered as cross-affidavit guidance so every note can enrich the AI.
    let feedback = '';
    const sameAffidavitNoteIds = new Set<string>();
    if (review.deliverable_id) {
      const { data: priorReviews } = await supabase
        .from('affidavit_reviews').select('id').eq('deliverable_id', review.deliverable_id);
      const ids = (priorReviews ?? []).map((r) => r.id as number).filter((rid) => rid !== reviewId);
      if (ids.length) {
        const { data: notes } = await supabase
          .from('affidavit_review_comments')
          .select('id, q_no, question, body')
          .in('review_id', ids)
          .order('created_at', { ascending: true });
        if (notes && notes.length) {
          notes.forEach((n) => sameAffidavitNoteIds.add(String(n.id)));
          feedback = `REVIEWER FEEDBACK FROM PRIOR REVIEWS OF THIS AFFIDAVIT — authoritative corrections from the firm's lawyers. Apply them and do not repeat the corrected mistakes:\n${notes
            .map((n) => `- ${n.question ? `On "${String(n.question).slice(0, 120)}": ` : (n.q_no != null ? `On Q${n.q_no}: ` : '')}${n.body}`)
            .join('\n')}`;
        }
      }
    }

    // Cross-affidavit learning: pull the most relevant reviewer notes from ANY
    // past review (excluding this affidavit's own, already injected above).
    const noteQuery = (extractedText || review.file_name || '').slice(0, 2000);
    if (noteQuery.trim()) {
      const noteHits = await searchEmbeddingsByType(noteQuery, ['affidavit_note'], { limit: 8, threshold: 0.3, firmId }).catch(() => []);
      const fresh = noteHits.filter((h) => !sameAffidavitNoteIds.has(h.source_id));
      if (fresh.length) {
        const block = `RELEVANT REVIEWER GUIDANCE FROM SIMILAR QUESTIONS IN OTHER AFFIDAVITS — apply only where it genuinely fits this affidavit's facts; ignore it where it does not:\n${fresh.map((h) => `- ${h.chunk_text}`).join('\n')}`;
        feedback = feedback ? `${feedback}\n\n${block}` : block;
      }
    }

    content.push({ type: 'text', text: 'Segment the affidavit into its numbered Q&A pairs and evaluate every question for objectionable form or substance. Return the result by calling the emit_objection_review tool — include one "findings" entry for EVERY numbered question (the clean ones too). The "summary" is only a brief overview and must NOT replace the per-question findings.' });

    const claude = await anthropicFor({ firmId, feature: 'ai_analysis' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createParams: any = {
      model: MODEL,
      max_tokens: 16384,
      system: buildSystemPrompt(review.mode as ReviewMode, grounding, feedback),
      tools: [EMIT_TOOL],
      tool_choice: { type: 'tool', name: 'emit_objection_review' },
      messages: [{ role: 'user', content }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = claudeFileId
      ? await withRetry(() => claude.beta.messages.create({ ...createParams, betas: ['files-api-2025-04-14'] }))
      : await withRetry(() => claude.messages.create(createParams));

    const truncated = response.stop_reason === 'max_tokens';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUse = (response.content as any[]).find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use' || !toolUse.input || typeof toolUse.input !== 'object') {
      throw new Error('Model did not return a structured review');
    }

    const out = toolUse.input as {
      affiant_name?: string;
      summary?: string;
      findings?: AffidavitFinding[];
      citations_seen?: string[];
    };
    const findings = toolArray<NonNullable<typeof out.findings>[number]>(out.findings);
    if (findings.length === 0) {
      throw new Error('No per-question findings were returned. Confirm the file is a judicial affidavit in numbered Q&A form, then run the review again.');
    }
    const objectionable = findings.filter((f) => f.verdict === 'objectionable').length;
    const severity = { high: 0, medium: 0, low: 0 };
    for (const f of findings) {
      for (const o of f.objections ?? []) {
        if (o.severity === 'high') severity.high++;
        else if (o.severity === 'medium') severity.medium++;
        else if (o.severity === 'low') severity.low++;
      }
    }

    const summary = truncated
      ? `${out.summary ?? ''}\n\nNote: the affidavit was long and the review may be incomplete (analysis hit its length limit).`.trim()
      : (out.summary ?? '');

    // Cite-check: citations the model saw verbatim (reliable for scanned PDFs)
    // plus a regex pass over the extracted text, verified against juris.ph.
    // Best-effort — an outage yields no citations, never a failed review.
    const citations = await resolveCitations(
      [...toolArray<string>(out.citations_seen), extractedText].join('\n'),
    );

    await supabase.from('affidavit_reviews').update({
      status: 'completed',
      affiant_name: out.affiant_name || null,
      summary,
      question_count: findings.length,
      objectionable_count: objectionable,
      severity_breakdown: severity,
      findings,
      citations: citations.length ? citations : null,
      claude_file_id: claudeFileId,
      token_count_input: response.usage.input_tokens,
      token_count_output: response.usage.output_tokens,
      model_used: MODEL,
      completed_at: new Date().toISOString(),
    }).eq('id', reviewId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[affidavit-review] review failed:', message);
    await supabase.from('affidavit_reviews').update({
      status: 'failed',
      error_message: message,
      completed_at: new Date().toISOString(),
    }).eq('id', reviewId);
  }
}
