import { describe, expect, it } from 'vitest';
import { detectTrack, inferStage, stageOfHearing, stageSteps, STAGES, TRACKS } from './stages';

const base = { courtLevel: null, relation: 'original' as const, docketNo: null, caption: '', nature: null };

describe('detectTrack', () => {
  it('reads the kind of proceeding from its forum and record', () => {
    expect(detectTrack({ ...base, forumType: 'prosecutor' })).toBe('preliminary_investigation');
    expect(detectTrack({ ...base, forumType: 'doj', relation: 'review' })).toBe('petition_for_review');
    expect(detectTrack({ ...base, forumType: 'labor' })).toBe('labor');
    expect(detectTrack({ ...base, forumType: 'agency' })).toBe('administrative');
    expect(detectTrack({ ...base, forumType: 'court', courtLevel: 'ca', relation: 'rule_65' })).toBe('appellate');
  });

  it('tells criminal, special, summary and civil apart in a trial court', () => {
    const court = { ...base, forumType: 'court' as const, courtLevel: 'rtc' as const };
    expect(detectTrack({ ...court, caption: 'People v. Valdez, et al.' })).toBe('criminal_trial');
    expect(detectTrack({ ...court, docketNo: 'R-QZN-26-00123-24-CR' })).toBe('criminal_trial');
    expect(detectTrack({ ...court, docketNo: 'Special Proceedings No R-0001' })).toBe('special_proceeding');
    expect(detectTrack({ ...court, caption: 'In re: Petition for Guardianship' })).toBe('special_proceeding');
    expect(detectTrack({ ...court, courtLevel: 'mtc', nature: 'Unlawful Detainer' })).toBe('summary_procedure');
    expect(detectTrack({ ...court, docketNo: 'Civil Case No. 123', nature: 'Collection of Sum of Money' })).toBe('civil_trial');
  });
});

describe('stages', () => {
  it('has memoranda optional in trials, and no trial under summary procedure', () => {
    expect(STAGES.criminal_trial.find((s) => s.key === 'memoranda')?.optional).toBe(true);
    expect(STAGES.civil_trial.find((s) => s.key === 'memoranda')?.optional).toBe(true);
    expect(STAGES.summary_procedure.map((s) => s.key)).not.toContain('plaintiff_evidence');
    expect(STAGES.summary_procedure.map((s) => s.key)).toContain('position_papers');
  });

  it('every track ends in a required stage', () => {
    for (const t of TRACKS) expect(STAGES[t].some((s) => !s.optional)).toBe(true);
  });
});

describe('stageOfHearing', () => {
  it('reads the firm’s hearing names', () => {
    expect(stageOfHearing('criminal_trial', 'Arraignment and Pre-trial')).toBe('pre_trial');
    expect(stageOfHearing('criminal_trial', 'Continuance of Pre-marking of Evidence')).toBe('pre_trial');
    expect(stageOfHearing('criminal_trial', 'Presentation of Prosecution’s Evidence')).toBe('prosecution_evidence');
    expect(stageOfHearing('criminal_trial', 'Initial Presentation of Defense Evidence')).toBe('defense_evidence');
    expect(stageOfHearing('criminal_trial', 'Presentation of Ana Cruz')).toBe('prosecution_evidence');
    expect(stageOfHearing('criminal_trial', 'Promulgation')).toBe('promulgation');
    expect(stageOfHearing('civil_trial', 'Presentation of Plaintiff’s Witness')).toBe('plaintiff_evidence');
    expect(stageOfHearing('civil_trial', 'Court-annexed Mediation')).toBe('pre_trial');
    expect(stageOfHearing('summary_procedure', 'Preliminary Conference')).toBe('preliminary_conference');
    expect(stageOfHearing('labor', 'Conciliation-Mediation Conference')).toBe('conciliation');
    expect(stageOfHearing('labor', 'Filing of Reply to Position Paper')).toBe('replies');
    expect(stageOfHearing('labor', 'Pre-Execution Conference')).toBe('execution');
    expect(stageOfHearing('special_proceeding', 'Jurisdictional Hearing')).toBe('jurisdictional_hearing');
    expect(stageOfHearing('preliminary_investigation', 'Preliminary Investigation')).toBe('counter_affidavit');
  });

  it('ignores settings that don’t move a case along', () => {
    expect(stageOfHearing('criminal_trial', 'Motion Hearing')).toBeNull();
    expect(stageOfHearing('civil_trial', 'Monitor Hearing')).toBeNull();
    expect(stageOfHearing('civil_trial', 'Compliance Hearing')).toBeNull();
  });
});

describe('inferStage', () => {
  it('takes the furthest stage the hearings reach, the next one included', () => {
    const hearings = [
      { name: 'Arraignment', date: '2026-01-10' },
      { name: 'Pre-trial Conference', date: '2026-03-10' },
      { name: 'Motion Hearing', date: '2026-05-01' },
      { name: 'Initial Presentation of Defense Evidence', date: '2026-11-02' },
    ];
    expect(inferStage('criminal_trial', hearings, false)).toBe('defense_evidence');
  });

  it('starts at the first stage with nothing to go on, and ends at the decision once resolved', () => {
    expect(inferStage('civil_trial', [], false)).toBe('pleadings');
    expect(inferStage('civil_trial', [], true)).toBe('decision');
    expect(inferStage('preliminary_investigation', [], true)).toBe('resolved');
  });
});

describe('stageSteps', () => {
  it('marks what is behind, where it is, and hides the after-decision stages until reached', () => {
    const steps = stageSteps('criminal_trial', 'prosecution_evidence', false);
    expect(steps.map((s) => [s.key, s.state])).toEqual([
      ['arraignment', 'done'],
      ['pre_trial', 'done'],
      ['prosecution_evidence', 'current'],
      ['defense_evidence', 'upcoming'],
      ['memoranda', 'upcoming'],
      ['awaiting_decision', 'upcoming'],
      ['promulgation', 'upcoming'],
      ['reconsideration', 'upcoming'],
    ]);
  });

  it('gives every kind of proceeding an MR period after its decision', () => {
    for (const t of TRACKS) {
      const keys = stageSteps(t, null, false).map((s) => s.key);
      expect(keys, t).toContain('reconsideration');
      expect(keys.indexOf('reconsideration'), t).toBe(STAGES[t].findIndex((s) => s.key === 'reconsideration'));
      expect(keys, t).not.toContain('execution');
    }
  });

  it('shows an optional stage passed over as skipped', () => {
    const steps = stageSteps('criminal_trial', 'awaiting_decision', false);
    expect(steps.find((s) => s.key === 'memoranda')?.state).toBe('skipped');
  });

  it('shows execution once a case reaches it', () => {
    expect(stageSteps('civil_trial', 'execution', false).map((s) => s.key)).toContain('execution');
  });
});
