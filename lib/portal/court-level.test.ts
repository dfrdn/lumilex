import { describe, it, expect } from 'vitest';
import { classifyCourtLevel, COURT_LEVELS } from './court-level';

// Inputs mirror real values in matters.court — free text entered by the team.
describe('classifyCourtLevel', () => {
  it('classifies the Supreme Court', () => {
    expect(classifyCourtLevel('Supreme Court, Manila').key).toBe('supreme_court');
    expect(classifyCourtLevel('SC En Banc').key).toBe('supreme_court');
  });

  it('classifies appellate courts', () => {
    expect(classifyCourtLevel('Court of Appeals, Manila').key).toBe('appellate');
    expect(classifyCourtLevel('CA-Mindanao, Cagayan de Oro City').key).toBe('appellate');
    expect(classifyCourtLevel('CA Cagayan de Oro City - Special Twenty-Second Division').key).toBe(
      'appellate',
    );
    expect(classifyCourtLevel('Court of Tax Appeals').key).toBe('appellate');
    expect(classifyCourtLevel('Sandiganbayan, Quezon City').key).toBe('appellate');
  });

  it('classifies regional trial courts and family courts', () => {
    expect(classifyCourtLevel('RTC Branch 85, Quezon City').key).toBe('trial');
    expect(classifyCourtLevel('RTC - Branch 271, Taguig City').key).toBe('trial');
    expect(classifyCourtLevel('FC - Branch 18, Cainta, Rizal').key).toBe('trial');
  });

  it('classifies first-level courts', () => {
    expect(classifyCourtLevel('MeTC - Branch 13, Manila').key).toBe('first_level');
    expect(classifyCourtLevel('MeTC, Branch 41, Quezon City').key).toBe('first_level');
    expect(classifyCourtLevel('MTC, Floridablanca, Pampanga').key).toBe('first_level');
  });

  it('classifies prosecution and investigation forums', () => {
    expect(classifyCourtLevel('OCP, Quezon City').key).toBe('prosecutor');
    expect(classifyCourtLevel('NPS - Office of the City Prosecutor, Quezon City').key).toBe(
      'prosecutor',
    );
    expect(classifyCourtLevel('Department of Justice, Manila').key).toBe('prosecutor');
    expect(classifyCourtLevel('DOJ, Manila').key).toBe('prosecutor');
    expect(classifyCourtLevel('National Bureau of Investigation').key).toBe('prosecutor');
    expect(classifyCourtLevel('NBI Manila').key).toBe('prosecutor');
    expect(classifyCourtLevel('Office of the Ombudsman, Quezon City').key).toBe('prosecutor');
  });

  it('classifies labor tribunals', () => {
    expect(classifyCourtLevel('NLRC, Quezon City').key).toBe('labor');
    expect(classifyCourtLevel('DOLE NCR - Quezon City').key).toBe('labor');
    expect(classifyCourtLevel('DOLE - NLRC, Quezon City').key).toBe('labor');
    expect(classifyCourtLevel('NLRC- NCR Branch 3').key).toBe('labor');
    expect(classifyCourtLevel('RCMB - NCR, Intramuros, Manila').key).toBe('labor');
  });

  it('sends other named forums to the agency bucket', () => {
    expect(classifyCourtLevel('COA, ORD, San Fernando, Pampanga').key).toBe('agency');
    expect(classifyCourtLevel('Bureau of Immigration').key).toBe('agency');
    expect(classifyCourtLevel('Commission on Elections, Intramuros, Manila').key).toBe('agency');
    expect(classifyCourtLevel('IBP - Commission on Bar Discipline').key).toBe('agency');
    expect(classifyCourtLevel('PRC - Board of Architecture, Manila City').key).toBe('agency');
  });

  it('maps empty court to advisory work', () => {
    expect(classifyCourtLevel(null).key).toBe('none');
    expect(classifyCourtLevel('').key).toBe('none');
    expect(classifyCourtLevel('   ').key).toBe('none');
  });

  it('short acronyms do not fire inside longer tokens', () => {
    // COA must not match \bCA\b; NCMB must not match \bMB\b-style rules.
    expect(classifyCourtLevel('COA, ORD').key).toBe('agency');
    expect(classifyCourtLevel('NCMB - NCR').key).toBe('labor');
  });

  it('ranks follow the judicial hierarchy', () => {
    expect(COURT_LEVELS.supreme_court.rank).toBeLessThan(COURT_LEVELS.appellate.rank);
    expect(COURT_LEVELS.appellate.rank).toBeLessThan(COURT_LEVELS.trial.rank);
    expect(COURT_LEVELS.trial.rank).toBeLessThan(COURT_LEVELS.first_level.rank);
  });
});
