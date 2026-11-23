// ── Calendar feed: token handling and event gathering ───────────────
//
// Replaces the one-way Graph push that used to write Lumilex hearings,
// meetings and deadlines into each staff member's Outlook calendar. The same
// three sources, the same per-person filter — but the firm subscribes instead
// of us writing, so it needs no Microsoft credentials and works identically in
// Google and Apple Calendar.

import { randomBytes } from 'node:crypto';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { firmBaseUrl } from '@/lib/firm/config';
import type { FeedEvent } from '@/lib/calendar/ics';
import { isDateOnly, toManilaDay } from '@/lib/dates';

/**
 * How much of the calendar a feed carries.
 *
 * Unbounded would grow without limit and Outlook re-fetches the whole document
 * on every poll. The past window exists so a subscriber who adds the feed
 * today sees recent context rather than an empty calendar until the next
 * hearing.
 */
export const FEED_PAST_DAYS = 90;
export const FEED_FUTURE_DAYS = 365;

export interface FeedOwner {
  firmId: string;
  personId: string;
}

/** A 256-bit URL-safe token. This is a bearer credential; nothing else gates the feed. */
export function mintFeedToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Resolve a feed token to its owner, or null.
 *
 * firm-resolution lookup: scoped client follows. A calendar client fetches
 * this URL with no session and no firm — the token is the only thing the
 * request carries — so the row's own firm_id is read once, unscoped, and
 * everything downstream runs on the scoped client.
 */
export async function resolveFeedToken(token: string): Promise<FeedOwner | null> {
  if (!token) return null;

  const { data } = await getSupabase()
    .from('calendar_feed_tokens')
    .select('firm_id, person_id')
    .eq('token', token)
    .maybeSingle();

  if (!data) return null;
  return { firmId: data.firm_id as string, personId: data.person_id as string };
}

/** The caller's token, minting one on first use. */
export async function ensureFeedToken(firmId: string, personId: string): Promise<string> {
  const db = getServiceDbForFirm(firmId);

  const { data: existing } = await db
    .from('calendar_feed_tokens')
    .select('token')
    .eq('person_id', personId)
    .maybeSingle();

  if (existing?.token) return existing.token as string;

  const token = mintFeedToken();
  const { error } = await db
    .from('calendar_feed_tokens')
    .insert({ person_id: personId, token });

  if (error) throw new Error(`calendar feed token insert failed: ${error.message}`);
  return token;
}

/**
 * Replace the caller's token.
 *
 * Rotation *is* revocation — the previous URL stops resolving the moment this
 * returns, which is the only way to cut off a feed URL that leaked. Anyone
 * still subscribed to the old one silently stops receiving updates, so the UI
 * has to say so.
 */
export async function rotateFeedToken(firmId: string, personId: string): Promise<string> {
  const db = getServiceDbForFirm(firmId);
  const token = mintFeedToken();

  const { data, error } = await db
    .from('calendar_feed_tokens')
    .update({ token, rotated_at: new Date().toISOString() })
    .eq('person_id', personId)
    .select('token')
    .maybeSingle();

  if (error) throw new Error(`calendar feed token rotation failed: ${error.message}`);
  if (!data) return ensureFeedToken(firmId, personId);
  return token;
}

/** Best-effort access stamp, so an unused feed is visible as unused. */
export async function touchFeedToken(firmId: string, personId: string): Promise<void> {
  await getServiceDbForFirm(firmId)
    .from('calendar_feed_tokens')
    .update({ last_accessed_at: new Date().toISOString() })
    .eq('person_id', personId);
}

/** Plain-text event body. ICS DESCRIPTION is text — HTML would render as markup. */
function describe(parts: (string | null | undefined)[]): string | undefined {
  const lines = parts.filter((part): part is string => Boolean(part && part.trim()));
  return lines.length > 0 ? lines.join('\n') : undefined;
}

interface HearingRow {
  notion_id: string;
  name: string;
  date: string | null;
  matter_name: string | null;
  type: string | null;
  status: string | null;
}

interface MeetingRow {
  notion_id: string;
  name: string;
  date_start: string | null;
  date_end: string | null;
  matter_name: string | null;
  type: string | null;
  location: string | null;
}

interface DeliverableRow {
  notion_id: string;
  name: string;
  external_due_date: string | null;
  matter_name: string | null;
  client_name: string | null;
  status: string | null;
}

/**
 * Every event this person should see, from the same three sources and with the
 * same per-person filter the Graph push used: hearings and meetings they are
 * an attendee of, deliverables currently assigned to them.
 */
export async function gatherFeedEvents(
  firmId: string,
  personId: string,
  now: Date = new Date(),
): Promise<FeedEvent[]> {
  const db = getServiceDbForFirm(firmId);
  const base = await firmBaseUrl(firmId);

  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - FEED_PAST_DAYS);
  const to = new Date(now);
  to.setUTCDate(to.getUTCDate() + FEED_FUTURE_DAYS);

  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const fromDate = toManilaDay(from);
  const toDate = toManilaDay(to);

  const [hearings, meetings, deliverables] = await Promise.all([
    db
      .from('hearings')
      .select('notion_id, name, date, matter_name, type, status')
      .contains('attendee_ids', [personId])
      .not('date', 'is', null)
      .gte('date', fromIso)
      .lte('date', toIso),
    db
      .from('meetings')
      .select('notion_id, name, date_start, date_end, matter_name, type, location')
      .contains('attendee_ids', [personId])
      .not('date_start', 'is', null)
      .gte('date_start', fromIso)
      .lte('date_start', toIso),
    db
      .from('deliverables')
      .select('notion_id, name, external_due_date, matter_name, client_name, status')
      .contains('currently_with_ids', [personId])
      .not('external_due_date', 'is', null)
      .gte('external_due_date', fromDate)
      .lte('external_due_date', toDate),
  ]);

  const events: FeedEvent[] = [];

  for (const row of (hearings.data ?? []) as HearingRow[]) {
    if (!row.date) continue;
    // No all-day flag: a hearing entered without a time sits at Manila
    // midnight (older rows: midnight UTC), and its day is the Manila day.
    const allDay = isDateOnly(row.date);
    events.push({
      uid: `hearing-${row.notion_id}@lumilex`,
      summary: `[Hearing] ${row.name}`,
      description: describe([
        row.matter_name && `Matter: ${row.matter_name}`,
        row.type && `Type: ${row.type}`,
        row.status && `Status: ${row.status}`,
      ]),
      start: allDay ? toManilaDay(row.date) : row.date,
      allDay,
      url: `${base}/dashboard/hearings/${row.notion_id}`,
    });
  }

  for (const row of (meetings.data ?? []) as MeetingRow[]) {
    if (!row.date_start) continue;
    events.push({
      uid: `meeting-${row.notion_id}@lumilex`,
      summary: `[Meeting] ${row.name}`,
      description: describe([
        row.matter_name && `Matter: ${row.matter_name}`,
        row.type && `Type: ${row.type}`,
      ]),
      location: row.location || undefined,
      start: row.date_start,
      end: row.date_end || undefined,
      allDay: false,
      url: `${base}/dashboard/meetings/${row.notion_id}`,
    });
  }

  for (const row of (deliverables.data ?? []) as DeliverableRow[]) {
    if (!row.external_due_date) continue;
    events.push({
      uid: `deadline-${row.notion_id}@lumilex`,
      summary: `[Deadline] ${row.name}`,
      description: describe([
        row.matter_name && `Matter: ${row.matter_name}`,
        row.client_name && `Client: ${row.client_name}`,
        row.status && `Status: ${row.status}`,
      ]),
      start: row.external_due_date,
      allDay: true,
      url: `${base}/dashboard/deliverables/${row.notion_id}`,
    });
  }

  return events;
}
