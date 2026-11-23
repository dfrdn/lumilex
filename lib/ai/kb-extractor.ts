// KB extractor — distills one matter's brief + analyses into firm-wide
// knowledge signals (doctrine, template clauses, judge/court/counsel notes).
// High-volume, cheap: runs once per matter during backfill / incremental
// ingest. Haiku.

import { anthropicFor, type AiContext } from '@/lib/ai/gate';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { loadFirmPromptContext } from '@/lib/ai/firm-context';
import type { KbExtractionResult, KbSignal, KbKind } from '@/lib/ai/kb-types';
import { kbKey } from '@/lib/ai/kb-types';
import { parseJsonResponse } from '@/lib/ai/json-response';

const MODEL = 'claude-haiku-4-5-20251001';

const VALID_KINDS: KbKind[] = [
  'doctrine', 'template_clause', 'judge', 'court', 'opposing_counsel', 'opposing_party',
];

function systemPrompt(firmCtx: string): string {
  return `${firmCtx}

You are a legal knowledge analyst. You read the firm's internal brief for ONE matter and extract reusable, firm-wide knowledge signals — the things worth remembering across cases.

Extract two things:

1. doctrineTags: canonical Philippine legal doctrines / causes of action / procedural concepts this matter actually involved (e.g. "forum-shopping", "quieting-of-title", "illegal-dismissal", "probable-cause", "certiorari-rule-65"). Lowercase kebab-case. Only tag what the matter genuinely engaged — not every word mentioned.

2. signals: discrete, reusable observations. Each is ONE thing this matter teaches about ONE entity:
   - kind "doctrine": how a doctrine was argued, what the court held, what worked or failed.
   - kind "template_clause": a notable clause / pleading formulation / argument structure worth reusing.
   - kind "judge": an observation about a specific judge's tendency or preference (only if clearly evidenced).
   - kind "court": a venue-specific practice or requirement.
   - kind "opposing_counsel" / "opposing_party": a pattern about how they litigate (only if clearly evidenced).

Rules:
- Be conservative and concrete. Only emit a signal you could cite to this matter's record. No speculation.
- "observation" must be a self-contained sentence or two that would make sense on a firm-wide page, written in neutral professional English. Do NOT include client-confidential specifics (settlement numbers, private facts) — generalize to the reusable lesson.
- "key" is a stable kebab-case identifier for the entity (e.g. doctrine "forum-shopping", judge "hon-maria-santos"). "title" is the human label.
- confidence 0..1: how strongly this matter evidences the observation.
- If the matter teaches nothing reusable, return empty arrays.

Return ONLY valid JSON:
{
  "doctrineTags": ["..."],
  "signals": [
    { "kind": "doctrine", "key": "forum-shopping", "title": "Forum Shopping", "observation": "...", "confidence": 0.8 }
  ]
}`;
}

interface MatterSummaryRow {
  matter_id: string;
  summary: string | null;
  posture: string | null;
  court_and_venue: string | null;
  parties: unknown;
  claims_and_defenses: unknown;
  key_rulings: unknown;
  open_issues: unknown;
}


/**
 * Extract knowledge signals for one matter. Returns empty signals (not an
 * error) when the matter has no brief or nothing reusable.
 */
export async function extractMatterKnowledge(
  matterId: string,
  firmId: string,
): Promise<KbExtractionResult> {
  const supabase = getServiceDbForFirm(firmId);

  const { data: brief } = await supabase
    .from('matter_summaries')
    .select('matter_id, summary, posture, court_and_venue, parties, claims_and_defenses, key_rulings, open_issues')
    .eq('matter_id', matterId)
    .maybeSingle<MatterSummaryRow>();

  if (!brief?.summary) {
    return { doctrineTags: [], signals: [], model: MODEL };
  }

  const { data: matter } = await supabase
    .from('matters')
    .select('name, type, court, case_title')
    .eq('notion_id', matterId)
    .maybeSingle();

  // The brief (matter_summaries) is itself the distilled synthesis of the
  // matter's file analyses — the right, already-scoped input here.
  const userMessage = [
    `MATTER: ${matter?.case_title || matter?.name || matterId}`,
    matter?.type ? `Type: ${matter.type}` : '',
    matter?.court ? `Court: ${matter.court}` : '',
    brief.posture ? `Posture: ${brief.posture}` : '',
    brief.court_and_venue ? `Court and venue: ${brief.court_and_venue}` : '',
    '',
    `Summary:\n${brief.summary}`,
    jsonSection('Claims and defenses', brief.claims_and_defenses),
    jsonSection('Key rulings', brief.key_rulings),
    jsonSection('Open issues', brief.open_issues),
  ]
    .filter(Boolean)
    .join('\n');

  const firmCtx = await loadFirmPromptContext(firmId);
  const claude = await anthropicFor({ firmId, feature: 'ai_analysis' });
  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: systemPrompt(firmCtx),
    messages: [{ role: 'user', content: userMessage }],
  });

  if (response.stop_reason === 'max_tokens') {
    console.warn(`[kb-extractor] Output truncated for ${matterId} — signals may be incomplete.`);
  }

  const content = response.content[0];
  if (content.type !== 'text') return { doctrineTags: [], signals: [], model: MODEL };

  const parsed = parseJson(content.text);
  if (!parsed) return { doctrineTags: [], signals: [], model: MODEL };

  const doctrineTags = Array.isArray(parsed.doctrineTags)
    ? [...new Set(parsed.doctrineTags.map((t) => kbKey(String(t))).filter(Boolean))]
    : [];

  const signals: KbSignal[] = Array.isArray(parsed.signals)
    ? parsed.signals
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          kind: VALID_KINDS.includes(s.kind as KbKind) ? (s.kind as KbKind) : 'doctrine',
          key: kbKey(String(s.key ?? s.title ?? '')),
          title: String(s.title ?? '').trim().slice(0, 160),
          observation: String(s.observation ?? '').trim().slice(0, 1200),
          confidence: clamp01(Number(s.confidence)),
        }))
        .filter((s) => s.key && s.title && s.observation.length > 20)
    : [];

  return { doctrineTags, signals, model: MODEL };
}

function jsonSection(label: string, value: unknown): string {
  if (!value || (Array.isArray(value) && value.length === 0)) return '';
  return `\n${label}:\n${JSON.stringify(value)}`;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

/**
 * The model's answer, read through the shared parser: it is asked for bare
 * JSON but sometimes fences it and adds a "Rationale" paragraph after, or runs
 * out of tokens mid-signal. An empty answer (no tags, no signals) is a valid
 * one — most matters teach nothing firm-wide — and is not an error.
 */
export function parseJson(text: string): { doctrineTags?: unknown[]; signals?: unknown[] } | null {
  try {
    const parsed = parseJsonResponse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    /* reported below */
  }
  console.error('[kb-extractor] Unparseable model output:', text.trim().slice(0, 160));
  return null;
}
