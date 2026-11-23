import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { searchEmbeddings } from '@/lib/ai/embeddings';
import {
  getMatterDeliverables,
  formatDeliverablesForPrompt,
  DELIVERABLE_LIFECYCLE_NOTE,
} from '@/lib/ai/matter-deliverables';
import { formatSourceLabel } from '@/lib/ai/knowledge-search';
import { loadFirmPromptContext } from '@/lib/ai/firm-context';
import { isVoyageConfigured } from '@/lib/ai/voyage';
import type Anthropic from '@anthropic-ai/sdk';
import { anthropicFor, refuseIfDisabled } from '@/lib/ai/gate';

export const maxDuration = 60;

function systemPrompt(firmCtx: string): string {
  return `${firmCtx}

You are a legal matter analyst. You answer questions about a specific legal matter.

You will receive these context blocks per turn:
- MATTER BRIEF — a maintained, structured synthesis (summary, parties, posture, key dates, rulings). Useful background, but it is regenerated periodically and can be STALE.
- CURRENT DELIVERABLES (live) — the up-to-the-minute structured status of this matter's deliverables. This is the SOURCE OF TRUTH for status, progress, who holds a deliverable, and deadlines. Prefer it over the brief for anything about current state.
- RETRIEVED CONTEXT — numbered chunks from individual documents, retrieved by semantic search. Use these to support specific claims with citations.
- USER QUESTION — what to answer.

Rules:
- For a deliverable's status, progress, or deadlines, rely on CURRENT DELIVERABLES — never state status, or that something is pending/awaiting/overdue, from the brief alone.
- Cite retrieved chunks by their bracketed number, e.g., [1], [2]. The brief and deliverables block do not need a citation.
- Be concise but thorough. Use professional legal language appropriate for practicing lawyers.
- For dates, deadlines, and obligations, be precise and highlight them clearly.
- Format your response in clear paragraphs. Use bullet points for lists of items.
- Do not make up information or speculate beyond what is in the provided context.

${DELIVERABLE_LIFECYCLE_NOTE}`;
}

/**
 * POST /api/matter-chat
 * RAG-powered Q&A: embed question → vector search → Claude answer with streaming
 *
 * Body: { matterId: string, message: string, history?: { role: string, content: string }[] }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isVoyageConfigured()) {
    return NextResponse.json(
      { error: 'Semantic search not configured. Set VOYAGE_API_KEY.' },
      { status: 400 },
    );
  }

  const { matterId, message, history = [] } = await req.json();

  if (!matterId || !message) {
    return NextResponse.json(
      { error: 'matterId and message are required' },
      { status: 400 },
    );
  }

  const supabase = getServiceDbForFirm(session.firmId);

  // Get matter info for context
  const { data: matter } = await supabase
    .from('matters')
    .select('notion_id, name, matter_code, client_name, type, case_title, case_number, court, is_case')
    .eq('notion_id', matterId)
    .single();

  if (!matter) {
    return NextResponse.json({ error: 'Matter not found' }, { status: 404 });
  }

  // Fetch the maintained matter brief (if one has been generated).
  // This is the Phase 1 matter wiki artifact — a structured synthesis that
  // sits between the raw docs and retrieval. Inject it unconditionally as a
  // non-RAG block so factual questions (parties, posture, deadlines) don't
  // depend on semantic search hitting the right chunks.
  const { data: brief } = await supabase
    .from('matter_summaries')
    .select('summary, latest_incident, latest_incident_date, key_dates, open_issues, posture, parties, claims_and_defenses, court_and_venue, key_rulings')
    .eq('matter_id', matterId)
    .maybeSingle();

  const briefBlock = brief ? formatMatterBriefForChat(brief, !!matter.is_case) : '';

  // Live, structured deliverable status — the source of truth the brief can lag.
  const deliverableBlock = formatDeliverablesForPrompt(await getMatterDeliverables(matterId, session.firmId));

  // Rewrite short / follow-up questions into a standalone retrieval query.
  // "and the next hearing?" -> "What is the next scheduled hearing in this
  // matter?" — embeds much better against our chunks.
  const retrievalQuery = await rewriteForRetrieval(session.firmId, message, history, matter.name);

  // Search for relevant context — bump limit now that the brief covers
  // structural facts and the index includes flattened entities.
  const matches = await searchEmbeddings(retrievalQuery, {
    matterId,
    limit: 15,
    threshold: 0.25,
    firmId: session.firmId,
  });

  // Build context block
  const contextBlocks = matches.map((m, i) => {
    const meta = m.metadata as Record<string, string>;
    const sourceLabel = formatSourceLabel(m.source_type, meta);
    return `[${i + 1}] ${sourceLabel}\n${m.chunk_text}`;
  });

  const contextText = contextBlocks.length > 0
    ? contextBlocks.join('\n\n---\n\n')
    : 'No relevant documents found for this matter. Please let the user know.';

  // Build messages for Claude
  const matterContext = [
    `Matter: ${matter.name}`,
    matter.matter_code && `Code: ${matter.matter_code}`,
    matter.client_name && `Client: ${matter.client_name}`,
    matter.type && `Type: ${matter.type}`,
    matter.case_title && `Case: ${matter.case_title}`,
    matter.court && `Court: ${matter.court}`,
  ].filter(Boolean).join(' | ');

  const claudeMessages: Anthropic.MessageParam[] = [];

  // Add recent history (last 10 messages)
  const recentHistory = history.slice(-10);
  for (const msg of recentHistory) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      claudeMessages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }
  }

  // Add the current user message with context
  const userParts = [matterContext];
  if (briefBlock) userParts.push('--- MATTER BRIEF ---', briefBlock);
  userParts.push('--- CURRENT DELIVERABLES (live) ---', deliverableBlock);
  userParts.push('--- RETRIEVED CONTEXT ---', contextText);
  userParts.push('--- USER QUESTION ---', message);
  claudeMessages.push({
    role: 'user',
    content: userParts.join('\n\n'),
  });

  // Store user message
  await supabase.from('chat_messages').insert({
    matter_id: matterId,
    user_id: session.user.notionUserId,
    user_name: session.user.name || 'User',
    role: 'user',
    content: message,
  });

  // Stream response from Claude
  const chatRefusal = await refuseIfDisabled(session.firmId, 'ai_assistant');
  if (chatRefusal) return chatRefusal;

  const claude = await anthropicFor({ firmId: session.firmId, feature: 'ai_assistant' });

  const stream = await claude.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: systemPrompt(await loadFirmPromptContext(session.firmId)),
    messages: claudeMessages,
  });

  // Create SSE stream
  const encoder = new TextEncoder();
  let fullResponse = '';

  const readable = new ReadableStream({
    async start(controller) {
      try {
        // Send sources first
        const sourcesData = matches.map((m, i) => ({
          index: i + 1,
          sourceType: m.source_type,
          sourceId: m.source_id,
          chunkText: m.chunk_text.slice(0, 200),
          similarity: Math.round(m.similarity * 100) / 100,
          metadata: m.metadata,
        }));
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'sources', sources: sourcesData })}\n\n`),
        );

        // Stream tokens
        for await (const event of stream) {
          if (event.type === 'content_block_delta') {
            const delta = event.delta;
            if ('text' in delta) {
              fullResponse += delta.text;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'token', text: delta.text })}\n\n`),
              );
            }
          }
        }

        // Get final message for token counts
        const finalMessage = await stream.finalMessage();

        // Store assistant response
        await supabase.from('chat_messages').insert({
          matter_id: matterId,
          user_id: 'assistant',
          user_name: 'AI Assistant',
          role: 'assistant',
          content: fullResponse,
          sources: sourcesData,
          model_used: finalMessage.model,
          token_count_input: finalMessage.usage.input_tokens,
          token_count_output: finalMessage.usage.output_tokens,
        });

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`),
        );
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Stream error';
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`),
        );
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

/**
 * Render the maintained matter brief as a plain-text block suitable for
 * injection into the chat user turn. Omits empty sections; cases-only
 * sections are skipped for non-case matters. The model treats this block
 * as ground truth alongside the retrieved chunks.
 */
function formatMatterBriefForChat(
  brief: {
    summary?: string | null;
    latest_incident?: string | null;
    latest_incident_date?: string | null;
    key_dates?: unknown;
    open_issues?: unknown;
    posture?: string | null;
    parties?: unknown;
    claims_and_defenses?: unknown;
    court_and_venue?: string | null;
    key_rulings?: unknown;
  },
  isCase: boolean,
): string {
  const parts: string[] = [];

  if (brief.summary?.trim()) parts.push(`Summary:\n${brief.summary.trim()}`);

  if (isCase) {
    if (brief.posture?.trim()) parts.push(`Posture:\n${brief.posture.trim()}`);
    if (brief.court_and_venue?.trim()) parts.push(`Court and venue:\n${brief.court_and_venue.trim()}`);

    const parties = Array.isArray(brief.parties) ? brief.parties as Array<{ name?: string; role?: string; side?: string; notes?: string }> : [];
    if (parties.length) {
      const lines = parties.map((p) => {
        const side = p.side ? ` [${p.side}]` : '';
        const notes = p.notes ? ` — ${p.notes}` : '';
        return `- ${p.name ?? ''} (${p.role ?? ''})${side}${notes}`;
      });
      parts.push(`Parties:\n${lines.join('\n')}`);
    }

    const claims = Array.isArray(brief.claims_and_defenses) ? brief.claims_and_defenses as Array<{ party?: string; theory?: string }> : [];
    if (claims.length) {
      const lines = claims.map((c) => `- ${c.party ?? ''}: ${c.theory ?? ''}`);
      parts.push(`Claims and defenses:\n${lines.join('\n')}`);
    }

    const rulings = Array.isArray(brief.key_rulings) ? brief.key_rulings as Array<{ date?: string; ruling?: string; effect?: string }> : [];
    if (rulings.length) {
      const lines = rulings.map((r) => `- ${r.date ?? ''}: ${r.ruling ?? ''} — ${r.effect ?? ''}`);
      parts.push(`Key rulings:\n${lines.join('\n')}`);
    }
  }

  const dates = Array.isArray(brief.key_dates) ? brief.key_dates as Array<{ date?: string; label?: string; status?: string }> : [];
  if (dates.length) {
    const lines = dates.map((d) => {
      const status = d.status ? ` [${d.status}]` : '';
      return `- ${d.date ?? ''}: ${d.label ?? ''}${status}`;
    });
    parts.push(`Key dates:\n${lines.join('\n')}`);
  }

  const issues = Array.isArray(brief.open_issues) ? brief.open_issues as Array<{ issue?: string }> : [];
  if (issues.length) {
    const lines = issues.map((i) => `- ${i.issue ?? ''}`);
    parts.push(`Open issues:\n${lines.join('\n')}`);
  }

  if (brief.latest_incident?.trim()) {
    const date = brief.latest_incident_date ? ` (${brief.latest_incident_date})` : '';
    parts.push(`Latest incident${date}: ${brief.latest_incident.trim()}`);
  }

  return parts.join('\n\n');
}

// ── Query rewrite ────────────────────────────────────────────────────
//
// Short follow-ups like "and the next hearing?" or "who were they again?"
// embed weakly because they carry no domain terms. Rewrite them into
// standalone questions using the last few turns as context so retrieval
// has something to match on. No-op on the first turn or when the message
// is already self-contained (long enough, contains specific terms).

const REWRITE_SKIP_MIN_LENGTH = 60; // chars — messages this long are usually self-contained already

async function rewriteForRetrieval(
  firmId: string,
  message: string,
  history: { role: string; content: string }[],
  matterName: string,
): Promise<string> {
  // No history -> nothing to resolve against, just embed the message.
  const priorTurns = history.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-6);
  if (priorTurns.length === 0) return message;

  // Already self-contained.
  if (message.length >= REWRITE_SKIP_MIN_LENGTH) return message;


  try {
    const claude = await anthropicFor({ firmId, feature: 'ai_assistant' });
    const history_text = priorTurns
      .map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content.slice(0, 400)}`)
      .join('\n\n');

    const response = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      system: `You rewrite a follow-up question into a standalone question so it can be embedded for semantic search over a legal matter's documents. Matter: "${matterName}".

Rules:
- Output ONLY the rewritten question. No preamble, no quotes, no explanation.
- Keep the specific names, dates, and terms the user mentioned.
- Resolve pronouns and implicit references using the prior turns.
- If the question is already standalone, output it unchanged.
- Maximum 30 words.`,
      messages: [
        {
          role: 'user',
          content: `Prior conversation:\n${history_text}\n\nFollow-up question:\n${message}\n\nStandalone rewrite:`,
        },
      ],
    });

    const content = response.content[0];
    if (content?.type !== 'text') return message;

    const rewritten = content.text.trim();
    // Guard against pathological outputs — fall back if it's empty, way too
    // long, or suspiciously like a refusal.
    if (!rewritten || rewritten.length > 400 || /^i\s+(can'?t|cannot|won'?t)\b/i.test(rewritten)) {
      return message;
    }
    return rewritten;
  } catch (err) {
    console.warn('[matter-chat] Query rewrite failed, using raw message:', err instanceof Error ? err.message : err);
    return message;
  }
}
