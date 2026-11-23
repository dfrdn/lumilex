import { describe, expect, it } from 'vitest';
import {
  applyTokenMatch,
  buildDeliverablePatch,
  buildHearingPatch,
  buildMeetingPatch,
  buildTaskPatch,
  searchTokens,
} from './tools';

/** Records the PostgREST filter calls a query builder would receive. */
interface RecordingBuilder {
  calls: Array<{ kind: 'or' | 'ilike'; args: string[] }>;
  or(expr: string): RecordingBuilder;
  ilike(col: string, pattern: string): RecordingBuilder;
}

function recordingBuilder(): RecordingBuilder {
  const calls: RecordingBuilder['calls'] = [];
  const self: RecordingBuilder = {
    calls,
    or(expr) {
      calls.push({ kind: 'or', args: [expr] });
      return self;
    },
    ilike(col, pattern) {
      calls.push({ kind: 'ilike', args: [col, pattern] });
      return self;
    },
  };
  return self;
}

describe('searchTokens', () => {
  it('splits on punctuation, drops 1-char tokens and stopwords', () => {
    expect(searchTokens('People v. Dela Cruz')).toEqual(['people', 'dela', 'cruz']);
  });

  it('tokenizes a displayed filename into matchable parts', () => {
    expect(searchTokens('[210-10-0] MOA - Purchase of Property (to client).pdf')).toEqual([
      '210',
      '10',
      'moa',
      'purchase',
      'property',
      'to',
      'client',
      'pdf',
    ]);
  });
});

describe('applyTokenMatch', () => {
  it('ANDs one ilike per significant token on the target column', () => {
    const b = recordingBuilder();
    applyTokenMatch(b, 'file_name', 'MOA Purchase Property');
    expect(b.calls).toEqual([
      { kind: 'or', args: ['file_name.ilike.%moa%'] },
      { kind: 'or', args: ['file_name.ilike.%purchase%'] },
      { kind: 'or', args: ['file_name.ilike.%property%'] },
    ]);
  });

  it('matches the displayed filename a user echoes back', () => {
    const b = recordingBuilder();
    applyTokenMatch(b, 'file_name', '[210-10-0] MOA - Purchase of Property (to client).pdf');
    expect(b.calls.every((c) => c.kind === 'or')).toBe(true);
    expect(b.calls.map((c) => c.args[0])).toContain('file_name.ilike.%moa%');
    expect(b.calls.map((c) => c.args[0])).toContain('file_name.ilike.%210%');
  });

  it('falls back to a raw substring when the query tokenizes to nothing', () => {
    const b = recordingBuilder();
    applyTokenMatch(b, 'name', '7');
    expect(b.calls).toEqual([{ kind: 'ilike', args: ['name', '%7%'] }]);
  });
});

describe('update patch builders', () => {
  it('omits untouched fields — an empty input produces an empty patch', () => {
    expect(buildDeliverablePatch({})).toEqual({});
    expect(buildTaskPatch({})).toEqual({});
    expect(buildMeetingPatch({})).toEqual({});
    expect(buildHearingPatch({})).toEqual({});
  });

  it('maps only the provided deliverable fields to their db columns', () => {
    expect(buildDeliverablePatch({ status: 'For review', externalDueDate: '2026-08-10' })).toEqual({
      status: 'For review',
      external_due_date: '2026-08-10',
    });
  });

  it('treats an explicit empty array as a clear and null as a clear', () => {
    expect(buildDeliverablePatch({ drafterIds: [], subtype: null })).toEqual({
      drafter_ids: [],
      subtype: null,
    });
  });

  it('couples task done -> status Done', () => {
    expect(buildTaskPatch({ done: true })).toEqual({ done: true, status: 'Done' });
  });

  it('couples task done=false -> status In progress', () => {
    expect(buildTaskPatch({ done: false })).toEqual({ done: false, status: 'In progress' });
  });

  it('lets an explicit task status win over the one derived from done', () => {
    expect(buildTaskPatch({ done: true, status: 'Waiting' })).toEqual({
      done: true,
      status: 'Waiting',
    });
  });

  it('maps a meeting date to date_start', () => {
    expect(buildMeetingPatch({ date: '2026-08-07T10:00:00+08:00' })).toEqual({
      date_start: '2026-08-07T10:00:00+08:00',
    });
  });

  it('maps a hearing date to date and keeps status', () => {
    expect(buildHearingPatch({ date: '2026-08-07T09:00:00+08:00', status: 'Reset' })).toEqual({
      date: '2026-08-07T09:00:00+08:00',
      status: 'Reset',
    });
  });
});
