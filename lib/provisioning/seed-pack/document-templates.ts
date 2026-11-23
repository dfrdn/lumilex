/**
 * The AI drafting templates a new firm starts with.
 *
 * There was no in-code registry to source these from: the only existing row set
 * lives in the archived pre-Lumilex migration journal, which CLAUDE.md says must
 * never be applied, and every one of its prompts ends by naming one firm's style
 * guide (and one of them a specific licensed typeface). So the eight rows below
 * are written fresh — the same eight document kinds, with prompts that describe
 * the document rather than a firm.
 *
 * Two rules the prompts follow, both of which the archived set broke:
 *   - no firm, client, court, or person is named anywhere;
 *   - house style is not restated in the prompt. The firm's own voice comes from
 *     `drafting_style_profiles`, distilled from its finalized deliverables — a
 *     prompt that hardcodes "Adobe Garamond Pro 12" freezes one firm's typeface
 *     into every tenant's drafts.
 *
 * `generation_mode` is `'ai'` throughout, and can only be. A `'placeholder'`
 * template is a DOCX in the `templates` bucket keyed by
 * `template_storage_path`; a data module cannot ship a binary, and the firm
 * uploads its own under Admin → Templates.
 */

import type { DocumentPlaceholder, DocumentTemplateSeed } from './types';

const P = (
  key: string,
  label: string,
  type: DocumentPlaceholder['type'] = 'text',
  required = true,
): DocumentPlaceholder => ({ key, label, type, required });

const T = (
  name: string,
  category: DocumentTemplateSeed['category'],
  subcategory: string | null,
  description: string,
  ai_prompt: string,
  placeholders: DocumentPlaceholder[],
): DocumentTemplateSeed => ({
  name,
  category,
  subcategory,
  description,
  generation_mode: 'ai',
  ai_prompt,
  placeholders,
  deadline_kind: null,
  is_active: true,
});

export const SEED_DOCUMENT_TEMPLATES: DocumentTemplateSeed[] = [
  T(
    'Motion',
    'legal',
    'legal-motion',
    'A motion for filing before a Philippine court in a pending case.',
    'Draft a motion for filing before a Philippine court. Open with the caption and title, ' +
      'then a prefatory statement identifying the movant and the relief sought. Set out the ' +
      'material facts in numbered paragraphs, then the legal grounds with citation to the ' +
      'applicable Rules of Court provisions and jurisprudence. Close with a prayer stating the ' +
      'relief precisely, followed by the notice of hearing where the Rules require one. Argue ' +
      'only from the facts supplied; do not invent dates, docket numbers, or authorities.',
    [P('relief_sought', 'Relief Sought', 'textarea'), P('grounds', 'Grounds', 'textarea')],
  ),
  T(
    'Affidavit',
    'legal',
    'legal-affidavit',
    'A sworn statement of an affiant, for notarization.',
    'Draft an affidavit in the first person of the affiant. Open with the affiant identifying ' +
      'themselves and stating that they are of legal age and competent to testify. Number each ' +
      'averment, keeping one fact to a paragraph and confining every averment to matters within ' +
      'the affiant’s personal knowledge. Close with the standard attestation and a jurat block ' +
      'for notarization. State no fact that was not supplied.',
    [
      P('affiant_name', 'Affiant Name'),
      P('affiant_details', 'Affiant Details (age, residence, capacity)', 'textarea'),
      P('facts', 'Facts to Attest', 'textarea'),
    ],
  ),
  T(
    'Contract / Agreement',
    'legal',
    'legal-contract',
    'A commercial agreement between two or more parties under Philippine law.',
    'Draft a commercial agreement governed by Philippine law. Open with the title, the parties ' +
      'and their details, and recitals establishing the background and consideration. Set out ' +
      'the operative terms in numbered clauses — obligations of each party, consideration and ' +
      'payment terms, term and termination, confidentiality, representations and warranties, ' +
      'indemnity, governing law and venue, and a dispute-resolution clause. Close with a ' +
      'signature block for each party. Use defined terms consistently and leave any commercial ' +
      'figure that was not supplied as a clearly marked blank rather than inventing one.',
    [
      P('party_a', 'First Party'),
      P('party_b', 'Second Party'),
      P('subject', 'Subject of the Agreement', 'textarea'),
      P('term', 'Term', 'text', false),
    ],
  ),
  T(
    'Demand Letter',
    'letter',
    'letter-demand',
    'A formal demand on a counterparty before resorting to legal action.',
    'Draft a formal demand letter. State the writer’s capacity as counsel and the client on ' +
      'whose behalf the demand is made, recount the material facts giving rise to the obligation, ' +
      'identify the legal basis of the demand, and state precisely what is demanded and by when. ' +
      'Close by reserving the client’s rights and stating the consequence of non-compliance. Keep ' +
      'the tone firm and professional; make no threat beyond lawful legal remedies.',
    [
      P('recipient', 'Recipient'),
      P('demand', 'What Is Demanded', 'textarea'),
      P('deadline', 'Compliance Deadline', 'date'),
    ],
  ),
  T(
    'Legal Opinion',
    'letter',
    'letter-opinion',
    'A written opinion answering a client’s legal question.',
    'Draft a legal opinion addressed to the client. Open by stating the question presented and ' +
      'the documents and facts relied upon. Give a short answer, then the discussion — the ' +
      'applicable Philippine statutes, regulations, and jurisprudence applied to the facts, ' +
      'addressing the contrary view where one is arguable. Close with a conclusion and the ' +
      'customary qualification that the opinion is confined to the facts and law stated. Do not ' +
      'cite an authority that was not supplied or that you cannot state precisely.',
    [
      P('question', 'Question Presented', 'textarea'),
      P('facts', 'Relevant Facts', 'textarea'),
    ],
  ),
  T(
    'Memorandum',
    'letter',
    'letter-memo',
    'An internal memorandum on a legal or factual question.',
    'Draft an internal memorandum. Use a To / From / Date / Re header, then a statement of the ' +
      'issue, a brief answer, the facts, the analysis, and a recommendation. Write for a lawyer ' +
      'reader: be direct about weaknesses in the position and about what is not yet known.',
    [P('subject', 'Subject'), P('issue', 'Issue', 'textarea')],
  ),
  T(
    'Status Report',
    'report',
    'report-status',
    'A periodic report to the client on the progress of a matter.',
    'Draft a status report to the client on the matter. Cover what has happened since the last ' +
      'report, the current posture of the matter, what is scheduled next and when, and what is ' +
      'required from the client. Write plainly for a non-lawyer reader and give dates only where ' +
      'they were supplied.',
    [P('period', 'Reporting Period'), P('developments', 'Developments', 'textarea')],
  ),
  T(
    'Case Summary',
    'report',
    'report-summary',
    'An internal digest of a matter’s facts, issues, and posture.',
    'Draft a case summary for internal use. Cover the parties, the procedural history, the ' +
      'material facts, the issues, each side’s theory, the evidence on hand and the evidence ' +
      'still needed, and the immediate next steps with their deadlines. Be concise and neutral; ' +
      'mark anything uncertain as uncertain rather than resolving it.',
    [P('matter_background', 'Matter Background', 'textarea', false)],
  ),
];
