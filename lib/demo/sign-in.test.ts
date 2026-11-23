import { describe, it, expect } from 'vitest';
import { demoMemberUsable, isDemoDeploymentEnv, resolveDemoPersona } from './sign-in';

const DEMO = {
  enabled: true,
  personas: [
    { key: 'partner' as const, personId: 'person-partner' },
    { key: 'finance' as const, personId: 'person-finance' },
  ],
};

describe('isDemoDeploymentEnv', () => {
  it('is true only for the exact role', () => {
    expect(isDemoDeploymentEnv({ LUMILEX_INSTANCE_ROLE: 'demo' })).toBe(true);
    expect(isDemoDeploymentEnv({})).toBe(false);
    expect(isDemoDeploymentEnv({ LUMILEX_INSTANCE_ROLE: 'Demo' })).toBe(false);
    expect(isDemoDeploymentEnv({ LUMILEX_INSTANCE_ROLE: 'firm' })).toBe(false);
  });
});

describe('resolveDemoPersona', () => {
  it('maps a registered role to its person', () => {
    expect(resolveDemoPersona({ deploymentIsDemo: true, demo: DEMO, as: 'partner' })).toEqual({
      ok: true,
      personId: 'person-partner',
    });
  });

  it('refuses on a deployment that is not a demo, whatever the firm says', () => {
    expect(resolveDemoPersona({ deploymentIsDemo: false, demo: DEMO, as: 'partner' })).toEqual({
      ok: false,
      reason: 'not_a_demo_deployment',
    });
  });

  it('refuses for a firm that is not a demo, or no firm at all', () => {
    expect(
      resolveDemoPersona({ deploymentIsDemo: true, demo: { ...DEMO, enabled: false }, as: 'partner' }),
    ).toEqual({ ok: false, reason: 'firm_not_demo' });
    expect(resolveDemoPersona({ deploymentIsDemo: true, demo: null, as: 'partner' })).toEqual({
      ok: false,
      reason: 'firm_not_demo',
    });
  });

  it('refuses a role the firm has not registered, and anything that is not a role', () => {
    for (const as of ['lawyer', 'super_user', 'person-partner', '', null, undefined, ['partner']]) {
      expect(resolveDemoPersona({ deploymentIsDemo: true, demo: DEMO, as })).toEqual({
        ok: false,
        reason: 'unknown_persona',
      });
    }
  });
});

describe('demoMemberUsable', () => {
  const expected = { firmId: 'firm-demo', personId: 'person-partner' };
  const member = {
    personId: 'person-partner',
    firmId: 'firm-demo',
    role: 'partner',
    active: true,
    authUserId: 'auth-1',
  };

  it('accepts the active row with a login', () => {
    expect(demoMemberUsable(member, expected)).toBe(true);
  });

  it('refuses a missing, inactive, login-less or super_user row', () => {
    expect(demoMemberUsable(null, expected)).toBe(false);
    expect(demoMemberUsable({ ...member, active: false }, expected)).toBe(false);
    expect(demoMemberUsable({ ...member, authUserId: null }, expected)).toBe(false);
    expect(demoMemberUsable({ ...member, role: 'super_user' }, expected)).toBe(false);
  });

  it('refuses a row from another firm or another person', () => {
    expect(demoMemberUsable({ ...member, firmId: 'firm-real' }, expected)).toBe(false);
    expect(demoMemberUsable({ ...member, personId: 'person-other' }, expected)).toBe(false);
  });
});
