import { describe, expect, it } from 'vitest';
import { attachmentName, isReportUpload, reportUploadPath } from './report-attachments';

describe('attachmentName', () => {
  it('drops the storage timestamp from a stored letter', () => {
    expect(attachmentName('trademarks/t/reports/1792601158544-TEST_MARK-Filing_report-2026-10-15.pdf')).toBe('TEST_MARK-Filing_report-2026-10-15.pdf');
  });
  it('leaves a timeline file’s name alone', () => {
    expect(attachmentName('trademarks/t/files/2026 Application.pdf')).toBe('2026 Application.pdf');
  });
});

const FIRM = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';

describe('report uploads', () => {
  it('keeps the name people know, behind a stamp', () => {
    const path = reportUploadPath(FIRM, 't1', 'Report to client (final).pdf', 1792601158544);
    expect(path).toBe(`${FIRM}/trademarks/t1/reports/1792601158544-Report to client _final_.pdf`);
    expect(attachmentName(path)).toBe('Report to client _final_.pdf');
  });
  it('accepts only files in the mark’s own report folder', () => {
    expect(isReportUpload(FIRM, 't1', reportUploadPath(FIRM, 't1', 'a.pdf'))).toBe(true);
    expect(isReportUpload(FIRM, 't1', `${FIRM}/trademarks/t2/reports/1792601158544-a.pdf`)).toBe(false);
    expect(isReportUpload(FIRM, 't1', `${FIRM}/trademarks/t1/1792601158544_a.pdf`)).toBe(false);
    expect(isReportUpload(FIRM, 't1', `${FIRM}/trademarks/t1/reports/../t2/a.pdf`)).toBe(false);
    expect(isReportUpload(FIRM, 't1', `${FIRM}/trademarks/t1/reports/sub/a.pdf`)).toBe(false);
  });
  it('refuses another firm’s report folder', () => {
    expect(isReportUpload(FIRM, 't1', reportUploadPath(OTHER, 't1', 'a.pdf'))).toBe(false);
    expect(isReportUpload(FIRM, 't1', 'trademarks/t1/reports/1792601158544-a.pdf')).toBe(false);
  });
});
