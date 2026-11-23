import { describe, expect, it } from 'vitest';
import { filenameDate, generatedDocName, meetingFileName } from './file-names';

describe('filenameDate', () => {
  it('formats as dd mmm yyyy', () => {
    expect(filenameDate('2026-05-03')).toBe('03 May 2026');
    expect(filenameDate('2026-12-31T00:00:00Z')).toBe('31 Dec 2026');
  });

  it('passes through what it cannot read', () => {
    expect(filenameDate('soon')).toBe('soon');
    expect(filenameDate('2026-13-01')).toBe('2026-13-01');
  });
});

describe('generatedDocName', () => {
  it('leads with the date and keeps the stored extension', () => {
    expect(generatedDocName({
      title: 'Opening of Bank Account',
      dateOfResolution: '2026-05-03',
      generatedFilePath: 'corporations/x/resolutions/y/1780475524346.docx',
    })).toBe('03 May 2026 — Opening of Bank Account.docx');
  });

  it('strips characters a filesystem would reject', () => {
    expect(generatedDocName({ title: 'A/B: "C"?', dateOfResolution: '', generatedFilePath: null }))
      .toBe('A_B_ _C__.docx');
  });
});

describe('meetingFileName', () => {
  it('names the slot instead of the timestamped key', () => {
    expect(meetingFileName(
      { meetingDate: '2026-04-15', meetingType: 'Annual Stockholders' },
      'attendance',
      'corporations/x/meetings/y/1780475524346-sheet.pdf',
    )).toBe('15 Apr 2026 — Annual Stockholders Attendance Sheet.pdf');
  });
});
