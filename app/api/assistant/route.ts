import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { anthropicFor, refuseIfDisabled } from '@/lib/ai/gate';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import {
  TOOLS,
  executeTool,
  manilaToday,
  signedUrlFor,
  type ToolContext,
} from '@/lib/assistant/tools';
import { DELIVERABLE_LIFECYCLE_NOTE } from '@/lib/ai/matter-deliverables';
import { loadFirmPromptContext } from '@/lib/ai/firm-context';

export const maxDuration = 60;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_TURNS = 8;

// Friendly status shown while a tool runs (the non-streamable part of a turn).
const STATUS: Record<string, string> = {
  find_matter: 'Finding the matter…',
  find_person: 'Looking up people…',
  get_schedule: 'Checking the schedule…',
  get_matter: 'Reading the matter…',
  get_deliverables: 'Checking deliverable status…',
  search_matter_context: 'Searching documents…',
  create_deliverable: 'Creating the deliverable…',
  create_task: 'Creating the task…',
  create_meeting: 'Scheduling the meeting…',
  create_hearing: 'Scheduling the hearing…',
  fetch_file: 'Fetching the file…',
};

function systemPrompt(firmCtx: string, name: string, role: string): string {
  return `${firmCtx}

You are Lumilex Assistant, the firm-wide assistant embedded in the Lumilex web app. You help ${name} (role: ${role}).

Today is ${manilaToday()} (Asia/Manila). All dates and times are Manila time (+08:00).

What you can do:
- Answer questions about a matter using get_matter (overview + brief + live deliverables) and search_matter_context (semantic search over documents, filings, and analyses).
- Check LIVE deliverable status, progress, and deadlines with get_deliverables — the source of truth.
- Report the firm's schedule and deadlines with get_schedule.
- Create deliverables, tasks, meetings, and hearings.
- Fetch a document with fetch_file — it is returned to the user as a download link.

How to work:
- To act on or look up a matter named in words, FIRST call find_matter to resolve a matterId. If several match, ask which — never guess.
- Resolve people (drafters, reviewers, assignees, attendees) to personIds with find_person first.
- Before creating anything, ensure every REQUIRED field is known. If a required detail is missing or ambiguous, ASK a concise follow-up instead of inventing it.
- For a deliverable's status, progress, or deadlines, rely on get_deliverables (or get_schedule) — the LIVE data. The get_matter brief can be stale; never state status, or that something is pending/awaiting/overdue, from the brief alone.
- For "today"/"this week"/"my deadlines", default get_schedule scope to 'mine'.
- Never invent matter facts, dates, parties, or filings. If the tools don't surface it, say so.

${DELIVERABLE_LIFECYCLE_NOTE}

Style: concise and practical. Use light markdown — bold labels, bullet lists, links. Do NOT use markdown tables (they don't render in chat) — use bullet lists or short "Label: value" lines instead. When you deliver a file, mention it by name; the app shows the download link.`;
}

async function loadHistory(
  firmId: string,
  personId: string,
  limit: number,
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const { data } = await getServiceDbForFirm(firmId)
    .from('assistant_messages')
    .select('role, content')
    .eq('person_id', personId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? [])
    .reverse()
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

async function saveTurn(
  firmId: string,
  personId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  await getServiceDbForFirm(firmId)
    .from('assistant_messages')
    .insert({ person_id: personId, role, content });
}

/** GET — load the current user's persisted assistant thread for the UI. */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const messages = await loadHistory(session.firmId, session.user.notionUserId, 100);
  return NextResponse.json({ messages });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Refuse before assembling any history or prompt: the assistant is opt-in
  // and most firms will not have it on.
  const assistantRefusal = await refuseIfDisabled(session.firmId, 'ai_assistant');
  if (assistantRefusal) return assistantRefusal;

  let body: { message?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 });

  const personId = session.user.notionUserId;
  const firmId = session.firmId;
  const history = await loadHistory(firmId, personId, 20);

  // Resolve the auth user id so bot-style writes can run AS this user via the
  // existing routes (RLS gate).
  const { data: teamRow } = await getServiceDbForFirm(firmId)
    .from('team')
    .select('auth_user_id')
    .eq('person_id', session.user.notionUserId)
    .maybeSingle();

  await saveTurn(firmId, personId, 'user', message);

  const client = await anthropicFor({ firmId, feature: 'ai_assistant' });
  const system = systemPrompt(
    await loadFirmPromptContext(firmId),
    session.user.name,
    session.user.role,
  );
  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user' as const, content: message },
  ];

  const encoder = new TextEncoder();
  const sse = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      const ctx: ToolContext = {
        member: {
          personId,
          authUserId: teamRow?.auth_user_id ?? null,
          name: session.user.name,
          role: session.user.role,
          firmId,
        },
        chatId: `web:${personId}`,
        deliverFile: async ({ storageRef, name }) => {
          const url = await signedUrlFor(storageRef);
          if (!url) return { ok: false, error: 'could not sign file' };
          send({ type: 'file', name, url });
          return { ok: true, url };
        },
      };

      let assembled = '';
      try {
        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          let firstText = true;
          const run = client.messages.stream({
            model: MODEL,
            max_tokens: 2048,
            system,
            tools: TOOLS,
            messages,
          });

          for await (const event of run) {
            if (event.type === 'content_block_delta' && 'text' in event.delta) {
              let text = event.delta.text;
              // Separate text emitted across tool-use turns so the last word of
              // one turn doesn't fuse with the first of the next ("matter.Based").
              if (firstText && assembled && !/\s$/.test(assembled)) text = `\n\n${text}`;
              firstText = false;
              assembled += text;
              send({ type: 'token', text });
            }
          }

          const final = await run.finalMessage();
          if (final.stop_reason !== 'tool_use') break;

          const toolUses = final.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
          );
          messages.push({ role: 'assistant', content: final.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            send({ type: 'status', text: STATUS[tu.name] ?? 'Working…' });
            const result = await executeTool(tu.name, tu.input, ctx);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: JSON.stringify(result).slice(0, 12000),
            });
          }
          messages.push({ role: 'user', content: toolResults });
        }

        const reply = assembled.trim() || 'Done.';
        await saveTurn(firmId, personId, 'assistant', reply);
        send({ type: 'done' });
      } catch (err) {
        console.error('[assistant] run failed:', err);
        send({ type: 'error', error: 'The assistant hit an error. Please try again.' });
      }
      controller.close();
    },
  });

  return new Response(sse, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
