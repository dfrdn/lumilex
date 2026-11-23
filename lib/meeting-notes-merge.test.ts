import { describe, expect, it } from 'vitest';
import { CLASH_END, CLASH_MINE, clashTheirs, mergeNotes } from './meeting-notes-merge';

const lines = (...l: string[]) => l.join('\n');

describe('mergeNotes', () => {
  it('takes the only side that changed', () => {
    expect(mergeNotes('a', 'a', 'b', 'Ana')).toEqual({ text: 'b', clashes: 0 });
    expect(mergeNotes('a', 'b', 'a', 'Ana')).toEqual({ text: 'b', clashes: 0 });
    expect(mergeNotes('a', 'b', 'b', 'Ana')).toEqual({ text: 'b', clashes: 0 });
  });

  it('combines edits to different lines', () => {
    const base = lines('Agenda', 'Fees', 'Next steps');
    const mine = lines('Agenda', 'Fees: retainer agreed', 'Next steps');
    const theirs = lines('Agenda', 'Fees', 'Next steps: draft the MOA');
    expect(mergeNotes(base, mine, theirs, 'Ana')).toEqual({
      text: lines('Agenda', 'Fees: retainer agreed', 'Next steps: draft the MOA'),
      clashes: 0,
    });
  });

  it('keeps lines both sides added in different places', () => {
    const base = lines('One', 'Two');
    const mine = lines('Zero', 'One', 'Two');
    const theirs = lines('One', 'Two', 'Three');
    expect(mergeNotes(base, mine, theirs, 'Ana').text).toBe(lines('Zero', 'One', 'Two', 'Three'));
  });

  it('starts from empty notes on both sides', () => {
    const r = mergeNotes('', 'Mine', 'Theirs', 'Ana');
    expect(r.clashes).toBe(1);
    expect(r.text).toBe(lines(CLASH_MINE, 'Mine', clashTheirs('Ana'), 'Theirs', CLASH_END));
  });

  it('marks the same line changed two ways and leaves the rest merged', () => {
    const base = lines('Venue', 'Fees', 'End');
    const mine = lines('Venue: office', 'Fees: 50k', 'End');
    const theirs = lines('Venue', 'Fees: 60k', 'End.');
    const r = mergeNotes(base, mine, theirs, 'Ana');
    expect(r.clashes).toBe(1);
    expect(r.text).toBe(lines('Venue: office', CLASH_MINE, 'Fees: 50k', clashTheirs('Ana'), 'Fees: 60k', CLASH_END, 'End.'));
  });
});
