import { describe, it, expect } from 'vitest';
import { matterTeamOr, stepOptions, stepTaskName } from './step-tasks';
import type { Corporation } from '@/types/corporations';

function corp(p: Partial<Corporation> = {}): Corporation {
  return { proposedNames: [], approvedName: 'Acme Corp', ...p } as unknown as Corporation;
}

const steps = (c: Corporation, open?: string[]) => stepOptions(c, open).map((o) => o.step);

describe('stepOptions', () => {
  it('offers only SEC registration before the company is registered', () => {
    expect(steps(corp())).toEqual(['sec_registration']);
  });

  it('offers each registration not yet recorded once the company is registered', () => {
    expect(steps(corp({ secRegistrationDate: '2026-06-26', birCorDate: '2026-07-10' })))
      .toEqual(['bir_books', 'bir_atp', 'sss', 'philhealth', 'pagibig']);
  });

  it('never offers the business permit, whose task is spawned on its own', () => {
    expect(steps(corp({ secRegistrationDate: '2026-06-26' }))).not.toContain('business_permit');
  });

  it('leaves out a registration that already has an open task', () => {
    expect(steps(corp({ secRegistrationDate: '2026-06-26' }), ['sss'])).not.toContain('sss');
  });
});

describe('matterTeamOr', () => {
  it("gives the task to the matter's team", () => {
    expect(matterTeamOr(['lawyer-1', 'lawyer-2'], 'me')).toEqual(['lawyer-1', 'lawyer-2']);
  });

  it('falls back to the creator on a matter with no team', () => {
    expect(matterTeamOr([], 'me')).toEqual(['me']);
    expect(matterTeamOr(null, ['a', ''])).toEqual(['a']);
  });
});

describe('stepTaskName', () => {
  it('names the work, then the company', () => {
    expect(stepTaskName(corp(), 'sss')).toBe('SSS employer registration — Acme Corp');
  });
});
