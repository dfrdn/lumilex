// ── iCalendar (RFC 5545) serialisation ──────────────────────────────
// Pure text assembly, no IO — the feed's data gathering lives in
// lib/calendar/feed.ts. Kept separate because the escaping and folding rules
// are the part that is easy to get subtly wrong and worth testing directly:
// a calendar client rejects the whole feed on one malformed line, so a single
// unescaped comma in a matter name silently empties somebody's calendar.

/** One event in a feed. `start`/`end` are ISO instants, or YYYY-MM-DD when allDay. */
export interface FeedEvent {
  /** Stable across regenerations — it is what makes an edit an update. */
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end?: string;
  allDay: boolean;
  url?: string;
}

export interface IcsOptions {
  /** Shown as the calendar's name in Outlook/Google/Apple. */
  name: string;
  events: FeedEvent[];
  /** Injected in tests; defaults to now. */
  now?: Date;
  /**
   * Polling hint. Outlook and Google both treat it as advisory and neither
   * promises to honour it, which is the known cost of a feed over a push.
   */
  refreshMinutes?: number;
}

/**
 * Escape a value for a text-typed ICS property (RFC 5545 §3.3.11).
 *
 * Order matters: backslash first, or the escapes we add get re-escaped.
 * Control characters other than the newline we fold into `\n` are dropped —
 * they are not representable and clients differ on how they fail.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/**
 * Fold a content line to 75 octets (RFC 5545 §3.1), continuations prefixed
 * with one space.
 *
 * The limit is octets, not characters, and the split may not land inside a
 * UTF-8 sequence — so this measures encoded length per code point rather than
 * slicing the string. Astral characters (an emoji in a meeting title) are one
 * code point of four octets; iterating with for..of keeps surrogate pairs
 * together, which a plain index loop would tear in half.
 */
export function foldLine(line: string): string {
  const LIMIT = 75;
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  // Continuation lines spend one octet on the leading space.
  let limit = LIMIT;

  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
      limit = LIMIT - 1;
    }
    current += char;
    bytes += size;
  }
  out.push(current);

  return out.join('\r\n ');
}

/** `YYYYMMDDTHHMMSSZ` — UTC form, which needs no VTIMEZONE component. */
export function formatUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

/** `YYYYMMDD` from a `YYYY-MM-DD` date, for a DATE-valued property. */
export function formatDate(ymd: string): string {
  return ymd.slice(0, 10).replace(/-/g, '');
}

/**
 * The day after `ymd`, as `YYYYMMDD`.
 *
 * An all-day DTEND is *exclusive*, so a one-day event ends on the following
 * day. Omitting it — or setting it equal to DTSTART — renders a zero-length
 * event that Google drops entirely.
 */
export function nextDay(ymd: string): string {
  const date = new Date(`${ymd.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return formatDate(date.toISOString());
}

function property(name: string, value: string): string {
  return foldLine(`${name}:${escapeText(value)}`);
}

function eventLines(event: FeedEvent, stamp: string): string[] {
  const lines = ['BEGIN:VEVENT', foldLine(`UID:${event.uid}`), `DTSTAMP:${stamp}`];

  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatDate(event.start)}`);
    lines.push(`DTEND;VALUE=DATE:${nextDay(event.end ?? event.start)}`);
  } else {
    lines.push(`DTSTART:${formatUtc(new Date(event.start))}`);
    if (event.end) lines.push(`DTEND:${formatUtc(new Date(event.end))}`);
  }

  lines.push(property('SUMMARY', event.summary));
  if (event.description) lines.push(property('DESCRIPTION', event.description));
  if (event.location) lines.push(property('LOCATION', event.location));
  // URL is a URI-typed property: escaping it would corrupt the query string.
  if (event.url) lines.push(foldLine(`URL:${event.url}`));
  lines.push('END:VEVENT');

  return lines;
}

/** Serialise a whole feed. CRLF throughout, as the spec requires. */
export function buildIcs({ name, events, now, refreshMinutes = 30 }: IcsOptions): string {
  const stamp = formatUtc(now ?? new Date());
  const duration = `PT${refreshMinutes}M`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lumilex//Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    property('X-WR-CALNAME', name),
    'X-WR-TIMEZONE:Asia/Manila',
    `REFRESH-INTERVAL;VALUE=DURATION:${duration}`,
    `X-PUBLISHED-TTL:${duration}`,
    ...events.flatMap((event) => eventLines(event, stamp)),
    'END:VCALENDAR',
  ];

  return `${lines.join('\r\n')}\r\n`;
}
