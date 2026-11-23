import { describe, it, expect } from 'vitest';
import { parseJsonResponse, toolArray, toolObject } from './json-response';

describe('parseJsonResponse', () => {
  it('parses a plain object', () => {
    expect(parseJsonResponse('{"a":1,"b":"two"}')).toEqual({ a: 1, b: 'two' });
  });

  it('parses a fenced object', () => {
    const raw = '```json\n{"summary":"A motion to dismiss."}\n```';
    expect(parseJsonResponse(raw)).toEqual({ summary: 'A motion to dismiss.' });
  });

  it('ignores prose before and after the object', () => {
    const raw = 'Here is the analysis:\n{"documentType":"Order"}\nLet me know if you need more.';
    expect(parseJsonResponse(raw)).toEqual({ documentType: 'Order' });
  });

  it('keeps braces and escaped quotes inside strings intact', () => {
    const raw = '{"summary":"The court said \\"denied\\" — see {Annex A}","n":2}';
    expect(parseJsonResponse(raw)).toEqual({
      summary: 'The court said "denied" — see {Annex A}',
      n: 2,
    });
  });

  it('does not mistake a trailing backslash for an escaped quote', () => {
    expect(parseJsonResponse('{"path":"C:\\\\cases\\\\","ok":true}')).toEqual({
      path: 'C:\\cases\\',
      ok: true,
    });
  });

  it('parses a top-level array', () => {
    expect(parseJsonResponse('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  // The Library extractor's replies, verbatim in shape: a fenced object and
  // then a rationale in markdown. Its own parser stripped the leading fence,
  // choked on the prose, and reported a valid empty answer as unparseable.
  it('reads a fenced object followed by a markdown rationale', () => {
    const raw =
      '```json\n{\n  "doctrineTags": [],\n  "signals": []\n}\n```\n\n' +
      '**Rationale:** This matter is administrative corporate housekeeping — nothing {firm-wide} to learn.';
    expect(parseJsonResponse(raw)).toEqual({ doctrineTags: [], signals: [] });
  });

  it('reads the same shape when it carries signals', () => {
    const raw =
      '```json\n{"doctrineTags":["forum-shopping"],"signals":[{"kind":"court","key":"rtc-makati-137",' +
      '"title":"Branch 137 resets pre-trial","observation":"Resets the first setting when the brief is late.",' +
      '"confidence":0.7}]}\n```\n\n**Reasoning:** Two settings were reset for the same cause.';
    expect(parseJsonResponse(raw)).toEqual({
      doctrineTags: ['forum-shopping'],
      signals: [
        {
          kind: 'court',
          key: 'rtc-makati-137',
          title: 'Branch 137 resets pre-trial',
          observation: 'Resets the first setting when the brief is late.',
          confidence: 0.7,
        },
      ],
    });
  });

  describe('truncated responses', () => {
    it('recovers fields completed before a cut mid-string', () => {
      const raw = '{"shortSummary":"Motion to dismiss","summary":"The accused argues that the info';
      expect(parseJsonResponse(raw)).toEqual({ shortSummary: 'Motion to dismiss' });
    });

    it('recovers fields completed before a cut mid-key', () => {
      const raw = '{"shortSummary":"Order","documentType":"Resolution","juris';
      expect(parseJsonResponse(raw)).toEqual({
        shortSummary: 'Order',
        documentType: 'Resolution',
      });
    });

    it('recovers a completed nested object', () => {
      const raw = '{"entities":{"parties":["Reyes","Cruz"],"documentType":"Motion"},"summary":"The';
      expect(parseJsonResponse(raw)).toEqual({
        entities: { parties: ['Reyes', 'Cruz'], documentType: 'Motion' },
      });
    });

    it('recovers completed elements of a truncated array', () => {
      const raw = '{"parties":["Reyes","Cruz","Sant';
      expect(parseJsonResponse(raw)).toEqual({ parties: ['Reyes', 'Cruz'] });
    });

    it('drops a value cut mid-number rather than corrupting it', () => {
      const raw = '{"a":1,"b":234';
      expect(parseJsonResponse(raw)).toEqual({ a: 1 });
    });

    it('does not close on a brace that appears inside a truncated string', () => {
      const raw = '{"a":1,"summary":"see {Annex A} and';
      expect(parseJsonResponse(raw)).toEqual({ a: 1 });
    });
  });

  describe('balanced but malformed', () => {
    it('salvages fields before a missing comma', () => {
      const raw = '{"a":1,"b":"x" "c":2}';
      expect(parseJsonResponse(raw)).toEqual({ a: 1 });
    });

    it('salvages fields before an unescaped control character', () => {
      const raw = '{"shortSummary":"Order","summary":"line one\nline two"}';
      expect(parseJsonResponse(raw)).toEqual({ shortSummary: 'Order' });
    });

    it('salvages a completed nested object before the fault', () => {
      const raw = '{"entities":{"parties":["Reyes"]},"summary":"a" "b"}';
      expect(parseJsonResponse(raw)).toEqual({ entities: { parties: ['Reyes'] } });
    });
  });

  describe('unrecoverable input', () => {
    it('throws when there is no JSON at all', () => {
      expect(() => parseJsonResponse('I could not read this document.')).toThrow(
        /No JSON value found/,
      );
    });

    it('throws when truncated before any value completed', () => {
      expect(() => parseJsonResponse('{"shortSummary":"Motion to dis')).toThrow(
        /truncated before any complete value/,
      );
    });
  });
});

describe('toolArray', () => {
  it('unwraps a stringified tool input that repeats the field name', () => {
    const wrapped = JSON.stringify({ propositions: [{ statement: 'a' }, { statement: 'b' }] });
    expect(toolArray<{ statement: string }>(wrapped).map((p) => p.statement)).toEqual(['a', 'b']);
    expect(toolArray(JSON.stringify({ a: [1], b: [2] }))).toEqual([]);
  });

  it('passes a real array through untouched', () => {
    const arr = [{ q_no: 1 }];
    expect(toolArray(arr)).toBe(arr);
  });

  it('decodes an array the model sent as a JSON string', () => {
    // The shape that failed a 37-question affidavit review in production.
    const encoded = JSON.stringify([{ q_no: 1, verdict: 'clean' }, { q_no: 2, verdict: 'objectionable' }], null, 2);
    expect(toolArray<{ q_no: number }>(encoded).map((f) => f.q_no)).toEqual([1, 2]);
  });

  it('decodes a fenced string', () => {
    expect(toolArray('```json\n[1,2,3]\n```')).toEqual([1, 2, 3]);
  });

  it('returns empty for a string that encodes an object, not an array', () => {
    expect(toolArray('{"q_no": 1}')).toEqual([]);
  });

  it('returns empty for missing, blank or non-JSON values', () => {
    expect(toolArray(undefined)).toEqual([]);
    expect(toolArray(null)).toEqual([]);
    expect(toolArray('')).toEqual([]);
    expect(toolArray('not json at all')).toEqual([]);
    expect(toolArray({ q_no: 1 })).toEqual([]);
  });
});

describe('toolObject', () => {
  it('reads an object field whether the model sent it as an object or as JSON text', () => {
    expect(toolObject({ court: 'RTC' })).toEqual({ court: 'RTC' });
    expect(toolObject('{"court": "RTC", "caseNumber": "1"}')).toEqual({ court: 'RTC', caseNumber: '1' });
  });

  it('is null for anything that is not an object', () => {
    expect(toolObject(undefined)).toBeNull();
    expect(toolObject('')).toBeNull();
    expect(toolObject('[1, 2]')).toBeNull();
    expect(toolObject(['a'])).toBeNull();
    expect(toolObject('not json')).toBeNull();
  });
});
