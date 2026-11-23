// ── AI Proofreading via Claude ───────────────────────────────────

import type Anthropic from '@anthropic-ai/sdk';
import { anthropicFor, type AiContext } from '@/lib/ai/gate';

let _client: Anthropic | null = null;


export interface ProofreadCorrection {
  original: string;
  corrected: string;
  reason: string;
}

export interface ProofreadResult {
  corrections: ProofreadCorrection[];
  summary: string;
}

const SYSTEM_PROMPT = `You are a meticulous proofreader for a Philippine law firm. Review the provided legal document text for:

1. Spelling errors
2. Grammar mistakes
3. Punctuation issues
4. Typographical errors (e.g., extra spaces, wrong quotes, missing periods)
5. Inconsistent formatting (e.g., inconsistent capitalization of legal terms)

Do NOT flag:
- Legal style choices (e.g., "WHEREAS" in all caps is intentional)
- Latin legal terms (e.g., "prima facie", "res judicata")
- Philippine legal citations and formatting conventions
- Content or legal accuracy — you are only checking language mechanics

Return a JSON object:
{
  "corrections": [
    { "original": "the exact text with the error", "corrected": "the corrected text", "reason": "brief explanation" }
  ],
  "summary": "One sentence overall assessment. If no errors found, say 'No issues found.'"
}

If the document is clean, return an empty corrections array.
Return ONLY the JSON object, no other text.`;

/**
 * Proofread document text using Claude.
 * Returns display-only corrections — does not modify the document.
 */
export async function proofreadDocument(
  firmId: string,
  text: string,
): Promise<ProofreadResult> {
  const claude = await anthropicFor({ firmId, feature: 'ai_analysis' });

  // Truncate very long documents to avoid token limits
  const maxChars = 100_000;
  const truncated = text.length > maxChars ? text.substring(0, maxChars) : text;

  const response = await claude.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Please proofread the following legal document:\n\n${truncated}`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    return { corrections: [], summary: 'No response from proofreader.' };
  }

  try {
    // Extract JSON from response (handle potential markdown code blocks)
    let jsonStr = content.text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const parsed = JSON.parse(jsonStr);
    return {
      corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
      summary: parsed.summary || 'Proofreading complete.',
    };
  } catch {
    console.error('[proofread] Failed to parse Claude response:', content.text);
    return { corrections: [], summary: 'Failed to parse proofreading results.' };
  }
}
