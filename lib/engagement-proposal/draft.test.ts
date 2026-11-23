import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const draftEngagementProposal = vi.fn(async (...args: unknown[]) => ({ args }));

vi.mock('@/lib/ai/engagement-proposal', () => ({
  draftEngagementProposal: (...args: unknown[]) => draftEngagementProposal(...args),
}));
vi.mock('@/lib/tenancy/service-db', () => ({
  getServiceDbForFirm: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    }),
  }),
}));
vi.mock('./context', () => ({
  loadProspectContext: vi.fn(),
  loadClientContext: async () => ({
    client: { notion_id: 'client-1' },
    context: { proposedServices: [] },
  }),
}));
vi.mock('@/lib/fee-schedule/load', () => ({
  loadFeeSchedules: async () => [],
  loadProfessionalBody: async () => null,
}));
vi.mock('@/lib/scope-library/load', () => ({ loadScopeTemplates: async () => [] }));
vi.mock('@/lib/firm-profile/load', () => ({
  loadFirmContact: async () => null,
  loadPaymentDetails: async () => null,
}));
vi.mock('@/lib/firm/config', () => ({
  getFirmConfig: async () => ({ branding: { documentName: 'Firm' } }),
}));

import { draftProposalVersion } from './draft';
import type { ProposalDraftInput } from './schema';

// 05:42 on 6 October in Manila — still 5 October in UTC.
const EARLY_MORNING_MANILA = new Date('2026-10-05T21:42:00Z');

describe('engagement proposal date', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(EARLY_MORNING_MANILA);
    draftEngagementProposal.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dates the letter by the Manila calendar day', async () => {
    await draftProposalVersion({
      supabase: {} as never,
      firmId: 'firm-1',
      recipient: { kind: 'client', clientId: 'client-1' },
      input: {} as ProposalDraftInput,
      fallbackSigner: { personId: 'p-1', name: 'Signer' },
    });

    const options = draftEngagementProposal.mock.calls[0][2] as { today: string };
    expect(options.today).toBe('2026-10-06');
  });
});
