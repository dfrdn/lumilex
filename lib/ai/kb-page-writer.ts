// KB page writer — synthesizes one firm-wide knowledge page from the
// observations multiple matters contributed about the same entity. Every
// claim must be grounded in a provided observation; output is ALWAYS a
// draft pending lawyer review. Low-volume, high-stakes: Sonnet.

import { anthropicFor, type AiContext } from '@/lib/ai/gate';
import { loadFirmPromptContext } from '@/lib/ai/firm-context';
import type { KbKind, KbPageDraft, KbCitation, KbSignalWithSource } from '@/lib/ai/kb-types';
import { KB_KIND_LABELS } from '@/lib/ai/kb-types';

// Doctrine synthesis is lawyer-reviewed and high-blast-radius — worth the
// stronger model. One-line change to claude-haiku-4-5-20251001 if needed.
const MODEL = 'claude-sonnet-4-6';

function systemPrompt(firmCtx: string): string {
  return `${firmCtx}

You are a senior legal knowledge editor. You write ONE firm-wide knowledge page by synthesizing observations that multiple of the firm's own matters contributed about a single entity (a doctrine, a reusable clause, a judge, a court, or opposing counsel).

You will receive numbered OBSERVATIONS, each tagged with the matter it came from (e.g. [M1], [M2]).

Output format — output the page as Markdown ONLY (no JSON, no preamble, no code fences):
- The FIRST line must be: SUMMARY: <one sentence describing this page for an index>
- Then the page body in Markdown, starting with a "## " heading.

Hard rules:
- Ground EVERY substantive claim in the observations. After each claim, cite the matter(s) it rests on using the bracket tags inline, e.g. "The Court of Appeals has accepted this framing [M2][M5]." Use ONLY tags that appear in the observations. Do NOT assert anything the observations don't support.
- This is an internal practice reference, not legal advice and not a treatise. Be concrete and firm-specific: what the firm has seen work, what to reuse, what to watch for.
- Neutral professional English. Philippine legal context. Do NOT invent case citations, statutes, or rules that are not in the observations — if a legal basis isn't given, describe the practice without fabricating authority.
- Do NOT include client-confidential specifics. Generalize to the reusable lesson.
- Structure with short Markdown sections appropriate to the kind (e.g. for doctrine: Summary, How we've argued it, What courts have held, Practice notes). Keep it tight — a reference, not an essay.`;
}


/**
 * Draft a KB page from contributing matter observations. `signals` are all
 * the per-matter observations about the same entity (same kind+key).
 * Returns markdown + structured citations resolved back to matter/source.
 */
export async function writeKbPage(opts: {
  firmId: string;
  kind: KbKind;
  title: string;
  jurisdiction?: string;
  signals: KbSignalWithSource[];
}): Promise<KbPageDraft> {
  const { firmId, kind, title, signals } = opts;

  // Tag each contributing matter [M1], [M2], … and remember the mapping so
  // the model's tag-based citations resolve back to real source rows.
  const tagToSource = new Map<string, KbSignalWithSource>();
  const observationLines: string[] = [];
  signals.forEach((s, i) => {
    const tag = `M${i + 1}`;
    tagToSource.set(tag, s);
    observationLines.push(`[${tag}] (matter: ${s.matterName}, confidence ${s.confidence.toFixed(2)}) ${s.observation}`);
  });

  const userMessage = [
    `PAGE KIND: ${KB_KIND_LABELS[kind]}`,
    `ENTITY / TITLE: ${title}`,
    opts.jurisdiction ? `JURISDICTION: ${opts.jurisdiction}` : '',
    '',
    `OBSERVATIONS (${signals.length} from the firm's matters):`,
    ...observationLines,
  ]
    .filter(Boolean)
    .join('\n');

  const firmCtx = await loadFirmPromptContext(firmId);
  const claude = await anthropicFor({ firmId, feature: 'ai_analysis' });
  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt(firmCtx),
    messages: [{ role: 'user', content: userMessage }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  let raw = content.text.trim();
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:markdown)?\n?/, '').replace(/\n?```$/, '').trim();

  // Pull the leading "SUMMARY: …" line; the rest is the page body.
  let summary = '';
  const lines = raw.split('\n');
  if (/^summary:/i.test(lines[0]?.trim() ?? '')) {
    summary = lines[0].replace(/^summary:/i, '').trim().slice(0, 400);
    raw = lines.slice(1).join('\n').trim();
  }
  const contentMd = raw;
  if (!contentMd) throw new Error('KB page writer returned empty content');
  if (!summary) summary = contentMd.replace(/[#*_>`-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);

  // Derive citations directly from the [Mx] tags the model used inline — no
  // fragile JSON. Each used tag → its real source row.
  const usedTags = new Set((contentMd.match(/\[M(\d+)\]/g) ?? []).map((t) => t.slice(1, -1)));
  const citationMap = new Map<string, KbCitation>();
  for (const tag of usedTags) {
    const src = tagToSource.get(tag);
    if (!src) continue;
    citationMap.set(`${src.matterId}::${src.sourceId}`, {
      matterId: src.matterId,
      sourceType: src.sourceType,
      sourceId: src.sourceId,
      excerpt: src.observation.slice(0, 300),
      confidence: src.confidence,
    });
  }

  // Safety net: never leave a page uncited — fall back to all contributors.
  if (citationMap.size === 0) {
    for (const s of signals) {
      citationMap.set(`${s.matterId}::${s.sourceId}`, {
        matterId: s.matterId,
        sourceType: s.sourceType,
        sourceId: s.sourceId,
        excerpt: s.observation.slice(0, 300),
        confidence: s.confidence,
      });
    }
  }

  return { contentMd, summary, citations: [...citationMap.values()], model: MODEL };
}
