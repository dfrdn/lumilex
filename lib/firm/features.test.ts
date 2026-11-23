import { describe, it, expect } from 'vitest';
import type { FirmConfig } from '@/lib/firm/config';
import type { FirmIntegration } from '@/lib/firm/integrations';
import {
  FEATURE_KEYS,
  evaluateFeature,
  featureSkip,
  isByoFeature,
  isFeatureEnabled,
  isFeatureKey,
  AI_FEATURE_KEYS,
  isAiFeatureKey,
  type FeatureKey,
} from './features';

function firm(features: Record<string, boolean>): FirmConfig {
  return { features } as FirmConfig;
}

function row(overrides: Partial<FirmIntegration> = {}): FirmIntegration {
  return {
    firmId: 'firm-1',
    feature: 'portal',
    enabled: true,
    config: {},
    credentials: {},
    ...overrides,
  };
}

/** A complete bring-your-own Graph app. */
const GRAPH_OWN = {
  config: { tenantId: 't', clientId: 'c', driveUser: 'd@x', spHostname: 'h', spSitePath: '/s' },
  credentials: { clientSecret: 's' },
};

describe('feature keys', () => {
  it('covers the integrations that are optional per firm', () => {
    expect([...FEATURE_KEYS]).toEqual([
      'portal',
      'sharepoint',
      'docx_pdf',
      'push',
      'issuances',
      'drafting',
      'red_team',
      'ai_analysis',
      'ai_search',
      'ai_assistant',
      'ai_client_chat',
    ]);
  });

  it('rejects anything not on the list', () => {
    expect(isFeatureKey('portal')).toBe(true);
    expect(isFeatureKey('portals')).toBe(false);
    expect(isFeatureKey('')).toBe(false);
    expect(isFeatureKey('__proto__')).toBe(false);
  });

  it('classifies which features are bring-your-own', () => {
    const byo = FEATURE_KEYS.filter(isByoFeature);
    expect(byo).toEqual(['sharepoint', 'docx_pdf']);
  });
});

describe('isFeatureEnabled', () => {
  it('reads the firm entitlement map', () => {
    expect(isFeatureEnabled(firm({ portal: true }), 'portal')).toBe(true);
    expect(isFeatureEnabled(firm({ portal: false }), 'portal')).toBe(false);
  });

  it('fails closed on a missing entry', () => {
    expect(isFeatureEnabled(firm({}), 'portal')).toBe(false);
    expect(isFeatureEnabled(firm({ drafting: true }), 'portal')).toBe(false);
  });

  it('treats a non-true value as off', () => {
    expect(isFeatureEnabled(firm({ portal: 1 as unknown as boolean }), 'portal')).toBe(false);
  });
});

describe('evaluateFeature — the three levels', () => {
  const enabledInputs = { entitled: true, integration: row(), platformConfigured: true };

  it('denies when the firm is not entitled', () => {
    expect(evaluateFeature('portal', { ...enabledInputs, entitled: false })).toEqual({
      key: 'portal',
      available: false,
      reason: 'not_entitled',
    });
  });

  it('denies when there is no integration row at all', () => {
    expect(evaluateFeature('portal', { ...enabledInputs, integration: null }).reason).toBe(
      'not_registered',
    );
  });

  it('denies when the integration row is switched off', () => {
    expect(
      evaluateFeature('portal', { ...enabledInputs, integration: row({ enabled: false }) }).reason,
    ).toBe('switched_off');
  });

  it('allows a plain feature when all three levels hold', () => {
    expect(evaluateFeature('portal', enabledInputs)).toEqual({
      key: 'portal',
      available: true,
      reason: 'ok',
    });
  });

  it('denies a platform-backed feature when the platform env is absent', () => {
    expect(
      evaluateFeature('push', { ...enabledInputs, platformConfigured: false }).reason,
    ).toBe('platform_unconfigured');
  });
});

describe('evaluateFeature — bring-your-own credentials', () => {
  it('allows a firm running its own Graph app even with no platform env', () => {
    for (const key of ['sharepoint', 'docx_pdf'] as FeatureKey[]) {
      expect(
        evaluateFeature(key, {
          entitled: true,
          integration: row(GRAPH_OWN),
          platformConfigured: false,
        }),
      ).toEqual({ key, available: true, reason: 'ok' });
    }
  });

  it('denies when the sealed client secret is absent', () => {
    expect(
      evaluateFeature('sharepoint', {
        entitled: true,
        integration: row({ config: GRAPH_OWN.config, credentials: {} }),
        platformConfigured: true,
      }).reason,
    ).toBe('credentials_missing');
  });

  it('treats a blank credential as absent', () => {
    expect(
      evaluateFeature('sharepoint', {
        entitled: true,
        integration: row({ config: GRAPH_OWN.config, credentials: { clientSecret: '   ' } }),
        platformConfigured: true,
      }).reason,
    ).toBe('credentials_missing');
  });

  it('denies when a required config field is absent', () => {
    const cases: [FeatureKey, string][] = [
      ['sharepoint', 'tenantId'],
      ['sharepoint', 'clientId'],
      ['sharepoint', 'spHostname'],
      ['sharepoint', 'spSitePath'],
      ['docx_pdf', 'driveUser'],
    ];
    for (const [key, field] of cases) {
      const config = { ...GRAPH_OWN.config } as Record<string, unknown>;
      delete config[field];
      expect(
        evaluateFeature(key, {
          entitled: true,
          integration: row({ config, credentials: GRAPH_OWN.credentials }),
          platformConfigured: true,
        }).reason,
      ).toBe('credentials_missing');
    }
  });

  it('holds each Graph feature to its own config, not its neighbours\u2019', () => {
    // One Entra app backs both, but they need different things from it:
    // SharePoint needs the site, DOCX conversion needs a OneDrive account.
    // Neither may demand the other's field.
    const base = { tenantId: 't', clientId: 'c' };
    const credentials = { clientSecret: 's' };

    expect(
      evaluateFeature('sharepoint', {
        entitled: true,
        integration: row({ config: { ...base, spHostname: 'h', spSitePath: '/sites/x' }, credentials }),
        platformConfigured: false,
      }).available,
    ).toBe(true);

    expect(
      evaluateFeature('docx_pdf', {
        entitled: true,
        integration: row({ config: { ...base, driveUser: 'docs@firm.test' }, credentials }),
        platformConfigured: false,
      }).available,
    ).toBe(true);
  });

});

describe('evaluateFeature — usePlatformEnv', () => {
  it('accepts the platform app when the firm has declared it as its own', () => {
    expect(
      evaluateFeature('sharepoint', {
        entitled: true,
        integration: row({ config: { usePlatformEnv: true } }),
        platformConfigured: true,
      }).available,
    ).toBe(true);
  });

  it('denies when the declared platform app has no env behind it', () => {
    expect(
      evaluateFeature('sharepoint', {
        entitled: true,
        integration: row({ config: { usePlatformEnv: true } }),
        platformConfigured: false,
      }).reason,
    ).toBe('platform_unconfigured');
  });

  it('is not triggered by a truthy non-boolean', () => {
    expect(
      evaluateFeature('sharepoint', {
        entitled: true,
        integration: row({ config: { usePlatformEnv: 'yes' } }),
        platformConfigured: true,
      }).reason,
    ).toBe('credentials_missing');
  });

  it('never lets a firm without the flag reach the platform app', () => {
    expect(
      evaluateFeature('sharepoint', {
        entitled: true,
        integration: row(),
        platformConfigured: true,
      }).available,
    ).toBe(false);
  });
});

describe('featureSkip', () => {
  it('labels a skip with the key and the reason', () => {
    expect(featureSkip({ key: 'sharepoint', available: false, reason: 'not_entitled' })).toEqual({
      skipped: 'sharepoint: not_entitled',
    });
  });
});

describe('the AI group', () => {
  it('names every key under which firm content reaches a model', () => {
    expect([...AI_FEATURE_KEYS]).toEqual([
      'ai_analysis',
      'ai_search',
      'ai_assistant',
      'ai_client_chat',
      'drafting',
      'red_team',
      'issuances',
    ]);
  });

  it('is a subset of the feature keys — an AI key is a feature key too', () => {
    for (const key of AI_FEATURE_KEYS) {
      expect(FEATURE_KEYS).toContain(key);
    }
  });

  it('recognises AI keys and rejects the rest', () => {
    expect(isAiFeatureKey('ai_analysis')).toBe(true);
    expect(isAiFeatureKey('red_team')).toBe(true);
    // A real feature key, but not one that reaches a model.
    expect(isAiFeatureKey('portal')).toBe(false);
    expect(isAiFeatureKey('ai_analysis ')).toBe(false);
    expect(isAiFeatureKey('')).toBe(false);
  });

  it('is off for a firm that has not been entitled to it', () => {
    // The whole point of the change: absent from settings.features is OFF,
    // even with the integration row present and the platform key configured.
    for (const key of AI_FEATURE_KEYS) {
      const state = evaluateFeature(key as FeatureKey, {
        entitled: isFeatureEnabled(firm({}), key as FeatureKey),
        integration: row({ feature: key, enabled: true }),
        platformConfigured: true,
      });
      expect(state.available).toBe(false);
      expect(state.reason).toBe('not_entitled');
    }
  });

  it('is off when entitled but the integration row is switched off', () => {
    const state = evaluateFeature('ai_analysis', {
      entitled: true,
      integration: row({ feature: 'ai_analysis', enabled: false }),
      platformConfigured: true,
    });
    expect(state).toEqual({ key: 'ai_analysis', available: false, reason: 'switched_off' });
  });

  it('is off when entitled and switched on but the platform key is absent', () => {
    const state = evaluateFeature('ai_search', {
      entitled: true,
      integration: row({ feature: 'ai_search', enabled: true }),
      platformConfigured: false,
    });
    expect(state.reason).toBe('platform_unconfigured');
  });

  it('needs all three levels to be on', () => {
    const state = evaluateFeature('ai_assistant', {
      entitled: true,
      integration: row({ feature: 'ai_assistant', enabled: true }),
      platformConfigured: true,
    });
    expect(state).toEqual({ key: 'ai_assistant', available: true, reason: 'ok' });
  });

  it('brings no credentials of its own — Anthropic and Voyage are platform keys', () => {
    for (const key of AI_FEATURE_KEYS) {
      expect(isByoFeature(key as FeatureKey)).toBe(false);
    }
  });

  it('reports a refusal a cron can print rather than skipping silently', () => {
    const state = evaluateFeature('ai_analysis', {
      entitled: false,
      integration: null,
      platformConfigured: true,
    });
    expect(featureSkip(state)).toEqual({ skipped: 'ai_analysis: not_entitled' });
  });
});
