import { describe, it, expect } from 'vitest';
import { buildIcs, escapeText, foldLine, formatDate, formatUtc, nextDay } from './ics';

describe('escapeText', () => {
  it('escapes the four special characters', () => {
    expect(escapeText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d');
  });

  it('escapes the backslash before the escapes it introduces', () => {
    // A naive order turns `\` into `\\` and then re-escapes the second one.
    expect(escapeText('\\')).toBe('\\\\');
  });

  it('folds every newline form into a literal \\n', () => {
    expect(escapeText('a\r\nb\nc\rd')).toBe('a\\nb\\nc\\nd');
  });

  it('drops unrepresentable control characters', () => {
    expect(escapeText('a\u0000b\u0007c\u007Fd')).toBe('abcd');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeText('Hearing re Acme Corp')).toBe('Hearing re Acme Corp');
  });
});

describe('foldLine', () => {
  it('leaves a line at the limit unfolded', () => {
    const line = 'A'.repeat(75);
    expect(foldLine(line)).toBe(line);
  });

  it('folds one octet past the limit', () => {
    const folded = foldLine('A'.repeat(76));
    expect(folded).toBe(`${'A'.repeat(75)}\r\n A`);
  });

  it('gives continuation lines 74 octets, not 75', () => {
    // The leading space counts against the 75-octet limit.
    const folded = foldLine('A'.repeat(200));
    const segments = folded.split('\r\n ');
    expect(segments[0]).toHaveLength(75);
    expect(segments[1]).toHaveLength(74);
  });

  it('never splits a multi-byte sequence', () => {
    // 'é' is two octets: a byte-wise slice at 75 would land inside one.
    const folded = foldLine('é'.repeat(60));
    for (const segment of folded.split('\r\n ')) {
      expect(Buffer.byteLength(segment, 'utf8')).toBeLessThanOrEqual(75);
      expect(segment).not.toContain('�');
    }
    expect(folded.split('\r\n ').join('')).toBe('é'.repeat(60));
  });

  it('keeps surrogate pairs intact', () => {
    const folded = foldLine('🏛'.repeat(30));
    expect(folded.split('\r\n ').join('')).toBe('🏛'.repeat(30));
  });
});

describe('date formatting', () => {
  it('formats an instant as UTC with no separators', () => {
    expect(formatUtc(new Date('2026-08-25T09:30:00+08:00'))).toBe('20260825T013000Z');
  });

  it('formats a date-only value', () => {
    expect(formatDate('2026-08-25')).toBe('20260825');
  });

  it('advances an exclusive all-day end by one day', () => {
    expect(nextDay('2026-08-25')).toBe('20260826');
  });

  it('rolls over a month boundary', () => {
    expect(nextDay('2026-08-31')).toBe('20260901');
  });

  it('rolls over a leap day', () => {
    expect(nextDay('2028-02-28')).toBe('20280229');
  });
});

describe('buildIcs', () => {
  const now = new Date('2026-08-25T00:00:00Z');

  it('wraps events in a well-formed calendar', () => {
    const ics = buildIcs({ name: 'Test', events: [], now });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('METHOD:PUBLISH');
  });

  it('uses CRLF for every line break', () => {
    const ics = buildIcs({
      name: 'Test',
      events: [{ uid: 'a@lumilex', summary: 'X', start: '2026-08-25', allDay: true }],
      now,
    });
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('renders an all-day event with an exclusive end', () => {
    const ics = buildIcs({
      name: 'Test',
      events: [{ uid: 'd-1@lumilex', summary: 'Filing due', start: '2026-08-25', allDay: true }],
      now,
    });
    expect(ics).toContain('DTSTART;VALUE=DATE:20260825');
    expect(ics).toContain('DTEND;VALUE=DATE:20260826');
  });

  it('renders a timed event in UTC', () => {
    const ics = buildIcs({
      name: 'Test',
      events: [
        {
          uid: 'm-1@lumilex',
          summary: 'Client meeting',
          start: '2026-08-25T09:00:00+08:00',
          end: '2026-08-25T10:00:00+08:00',
          allDay: false,
        },
      ],
      now,
    });
    expect(ics).toContain('DTSTART:20260825T010000Z');
    expect(ics).toContain('DTEND:20260825T020000Z');
  });

  it('omits optional properties that are absent', () => {
    const ics = buildIcs({
      name: 'Test',
      events: [{ uid: 'h-1@lumilex', summary: 'Hearing', start: '2026-08-25', allDay: true }],
      now,
    });
    expect(ics).not.toContain('LOCATION:');
    expect(ics).not.toContain('DESCRIPTION:');
    expect(ics).not.toContain('URL:');
  });

  it('escapes a comma in a matter name rather than starting a new value', () => {
    const ics = buildIcs({
      name: 'Test',
      events: [
        { uid: 'h-2@lumilex', summary: 'Acme, Inc. v. Beta', start: '2026-08-25', allDay: true },
      ],
      now,
    });
    expect(ics).toContain('SUMMARY:Acme\\, Inc. v. Beta');
  });

  it('leaves a URL unescaped so its query survives', () => {
    const ics = buildIcs({
      name: 'Test',
      events: [
        {
          uid: 'h-3@lumilex',
          summary: 'Hearing',
          start: '2026-08-25',
          allDay: true,
          url: 'https://example.test/hearing/1?a=1,2',
        },
      ],
      now,
    });
    expect(ics).toContain('URL:https://example.test/hearing/1?a=1,2');
  });

  it('carries the refresh hint both clients understand', () => {
    const ics = buildIcs({ name: 'Test', events: [], now, refreshMinutes: 15 });
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT15M');
    expect(ics).toContain('X-PUBLISHED-TTL:PT15M');
  });

  it('stamps every event with the same DTSTAMP', () => {
    const ics = buildIcs({
      name: 'Test',
      events: [
        { uid: 'a@lumilex', summary: 'A', start: '2026-08-25', allDay: true },
        { uid: 'b@lumilex', summary: 'B', start: '2026-08-26', allDay: true },
      ],
      now,
    });
    expect(ics.match(/DTSTAMP:20260825T000000Z/g)).toHaveLength(2);
  });
});
