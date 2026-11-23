import { describe, it, expect } from 'vitest';
import { firmConfigurationIssues, type FirmConfigurationFacts } from './firm-issues';

const healthy: FirmConfigurationFacts = {
  status: 'active',
  primaryDomain: 'firm.example.com',
  invoiceSettingsPresent: true,
  invoiceSettingsMissing: [],
  activeTeamCount: 3,
};

describe('firmConfigurationIssues', () => {
  it('says nothing about a fully provisioned firm', () => {
    expect(firmConfigurationIssues(healthy)).toEqual([]);
  });

  it('flags a suspended firm', () => {
    const issues = firmConfigurationIssues({ ...healthy, status: 'suspended' });
    expect(issues).toEqual(['Status is suspended']);
  });

  it('flags a firm with no primary domain', () => {
    const issues = firmConfigurationIssues({ ...healthy, primaryDomain: null });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('No primary domain');
  });

  it('flags a missing invoice settings row', () => {
    const issues = firmConfigurationIssues({
      ...healthy,
      invoiceSettingsPresent: false,
      invoiceSettingsMissing: [],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('No invoice settings row');
  });

  // A row that exists but is still the placeholder one provisioning wrote is
  // the same outage as no row at all — it just fails later, at generation time.
  it('names the fields of a present-but-incomplete invoice settings row', () => {
    const issues = firmConfigurationIssues({
      ...healthy,
      invoiceSettingsMissing: ['bank name', 'TIN'],
    });
    expect(issues).toEqual(['Invoice settings incomplete: bank name, TIN']);
  });

  it('does not report both "no row" and "incomplete" for the same firm', () => {
    const issues = firmConfigurationIssues({
      ...healthy,
      invoiceSettingsPresent: false,
      invoiceSettingsMissing: ['bank name'],
    });
    expect(issues).toHaveLength(1);
  });

  it('flags a firm nobody can sign in to', () => {
    const issues = firmConfigurationIssues({ ...healthy, activeTeamCount: 0 });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('nobody can sign in');
  });

  it('reports every problem a half-provisioned firm has, not just the first', () => {
    const issues = firmConfigurationIssues({
      status: 'suspended',
      primaryDomain: null,
      invoiceSettingsPresent: false,
      invoiceSettingsMissing: [],
      activeTeamCount: 0,
    });
    expect(issues).toHaveLength(4);
  });
});
