import { describe, it, expect } from 'vitest';
import {
  sidebarLayoutSaveSchema,
  dateSchema,
  emailSchema,
  uuidSchema,
  createDTRSchema,
  fileSignSchema,
  onAccountPaymentSchema,
  setPasswordSchema,
  createMeetingSchema,
} from './validation';

describe('dateSchema', () => {
  it('accepts a valid YYYY-MM-DD date', () => {
    expect(dateSchema.safeParse('2026-06-30').success).toBe(true);
  });

  it('rejects out-of-range months/days and non-padded or wrong formats', () => {
    expect(dateSchema.safeParse('2026-13-01').success).toBe(false); // month 13
    expect(dateSchema.safeParse('2026-00-10').success).toBe(false); // month 00
    expect(dateSchema.safeParse('2026-06-32').success).toBe(false); // day 32
    expect(dateSchema.safeParse('2026-6-1').success).toBe(false); // not zero-padded
    expect(dateSchema.safeParse('06/30/2026').success).toBe(false); // wrong format
  });
});

describe('emailSchema', () => {
  it('lowercases a valid email', () => {
    const r = emailSchema.safeParse('Foo@BAR.com');
    expect(r.success && r.data).toBe('foo@bar.com');
  });

  it('rejects whitespace-padded input (.email() validates before .trim())', () => {
    // The trailing .trim() only ever runs after validation passes, so padded
    // input is rejected outright rather than trimmed.
    expect(emailSchema.safeParse('  foo@bar.com  ').success).toBe(false);
  });

  it('rejects a malformed email', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('uuidSchema', () => {
  it('accepts UUIDs with or without dashes', () => {
    expect(uuidSchema.safeParse('123e4567-e89b-12d3-a456-426614174000').success).toBe(true);
    expect(uuidSchema.safeParse('123e4567e89b12d3a456426614174000').success).toBe(true);
  });

  it('rejects non-UUID strings', () => {
    expect(uuidSchema.safeParse('nope').success).toBe(false);
  });
});

describe('createDTRSchema', () => {
  it('applies defaults for hours/minutes/withIds', () => {
    const r = createDTRSchema.safeParse({ remarks: 'Drafted complaint', task: 'Draft', date: '2026-06-30' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.hours).toBe(1);
      expect(r.data.minutes).toBe(0);
      expect(r.data.withIds).toEqual([]);
    }
  });

  it('enforces hour/minute bounds and the task enum', () => {
    expect(createDTRSchema.safeParse({ remarks: 'x', task: 'Draft', date: '2026-06-30', hours: 25 }).success).toBe(false);
    expect(createDTRSchema.safeParse({ remarks: 'x', task: 'Draft', date: '2026-06-30', minutes: 60 }).success).toBe(false);
    expect(createDTRSchema.safeParse({ remarks: 'x', task: 'Nope', date: '2026-06-30' }).success).toBe(false);
    expect(createDTRSchema.safeParse({ remarks: '', task: 'Draft', date: '2026-06-30' }).success).toBe(false);
  });
});

describe('fileSignSchema', () => {
  it('accepts safe storage paths', () => {
    expect(fileSignSchema.safeParse({ paths: ['deliverables/2026/file.pdf'] }).success).toBe(true);
    expect(fileSignSchema.safeParse({ paths: ['documents/m1/1790145432679_Service Contract (draft).docx'] }).success).toBe(true);
    // A company name ending in a period meets the extension: not a traversal.
    expect(fileSignSchema.safeParse({ paths: ['corporations/c1/AOI - Sample Holdings Inc..pdf'] }).success).toBe(true);
  });

  it('rejects path traversal and illegal characters', () => {
    expect(fileSignSchema.safeParse({ paths: ['../etc/passwd'] }).success).toBe(false);
    expect(fileSignSchema.safeParse({ paths: ['corporations/c1/../../secret.pdf'] }).success).toBe(false);
    expect(fileSignSchema.safeParse({ paths: ['corporations/c1/./x.pdf'] }).success).toBe(false);
    expect(fileSignSchema.safeParse({ paths: ['file?.pdf'] }).success).toBe(false);
    expect(fileSignSchema.safeParse({ paths: ['50%.pdf'] }).success).toBe(false);
  });

  it('requires at least one path and caps the batch at 100', () => {
    expect(fileSignSchema.safeParse({ paths: [] }).success).toBe(false);
    const tooMany = Array.from({ length: 101 }, (_, i) => `f${i}.pdf`);
    expect(fileSignSchema.safeParse({ paths: tooMany }).success).toBe(false);
  });
});

describe('onAccountPaymentSchema', () => {
  it('requires a positive amount and defaults the payment method', () => {
    const r = onAccountPaymentSchema.safeParse({ clientName: 'Acme', amount: 5000, paymentDate: '2026-06-30' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.paymentMethod).toBe('bank_transfer');

    expect(onAccountPaymentSchema.safeParse({ clientName: 'Acme', amount: 0, paymentDate: '2026-06-30' }).success).toBe(false);
  });
});

describe('setPasswordSchema', () => {
  it('enforces a minimum password length and transforms the email', () => {
    const r = setPasswordSchema.safeParse({ email: 'USER@EXAMPLE.LAW', password: 'secret1' });
    expect(r.success && r.data.email).toBe('user@example.law');
    expect(setPasswordSchema.safeParse({ email: 'user@example.law', password: '123' }).success).toBe(false);
  });
});

describe('createMeetingSchema cross-field refinements', () => {
  const base = {
    meetingType: 'Regular Board' as const,
    meetingDate: '2026-06-30',
    meetingMode: 'In-Person' as const,
    venue: 'Main Boardroom',
    quorumAchieved: true,
  };

  it('accepts a well-formed in-person meeting', () => {
    expect(createMeetingSchema.safeParse(base).success).toBe(true);
  });

  it('requires a URL venue for virtual meetings', () => {
    expect(createMeetingSchema.safeParse({ ...base, meetingMode: 'Virtual', venue: 'Zoom' }).success).toBe(false);
    expect(createMeetingSchema.safeParse({ ...base, meetingMode: 'Virtual', venue: 'https://zoom.us/j/123' }).success).toBe(true);
  });

  it('rejects a notice date later than the meeting date', () => {
    expect(createMeetingSchema.safeParse({ ...base, noticeSentDate: '2026-07-01' }).success).toBe(false);
    expect(createMeetingSchema.safeParse({ ...base, noticeSentDate: '2026-06-01' }).success).toBe(true);
  });

  it('rejects shares represented exceeding total shares outstanding', () => {
    expect(createMeetingSchema.safeParse({ ...base, sharesRepresented: 1500, totalSharesOutstanding: 1000 }).success).toBe(false);
    expect(createMeetingSchema.safeParse({ ...base, sharesRepresented: 600, totalSharesOutstanding: 1000 }).success).toBe(true);
  });
});

describe('sidebarLayoutSaveSchema', () => {
  const ok = { area: 'dashboard', choices: { pins: ['/dashboard/calendar?tab=hearings'], hides: [] } };

  it('accepts page paths, and null for a reset', () => {
    expect(sidebarLayoutSaveSchema.safeParse(ok).success).toBe(true);
    expect(sidebarLayoutSaveSchema.safeParse({ area: 'admin', choices: null }).success).toBe(true);
  });

  it('refuses a URL and an unknown area', () => {
    expect(sidebarLayoutSaveSchema.safeParse({ ...ok, choices: { pins: ['https://example.com/x'], hides: [] } }).success).toBe(false);
    expect(sidebarLayoutSaveSchema.safeParse({ ...ok, area: 'portal' }).success).toBe(false);
  });
});
