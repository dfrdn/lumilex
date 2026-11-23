import { describe, it, expect } from 'vitest';
import { getAvailableActions } from './deliverable-actions';

const labels = (status: string, reviewerCount = 0, reviewerIndex = -1, type?: string) =>
  getAvailableActions(status, reviewerCount, reviewerIndex, type).map((a) => a.label);

describe('getAvailableActions — forward transitions', () => {
  it('Not started → Start Drafting (plus Awaiting/Archive for external)', () => {
    const actions = getAvailableActions('Not started', 0, -1);
    expect(actions.map((a) => a.label)).toEqual(['Start Drafting', 'Awaiting Client', 'Archive']);
    expect(actions[0].newStatus).toBe('Drafting');
    expect(actions[0].updatesCurrentlyWith).toBe('drafter');
  });

  it('external Drafting → For Review, with a target picker only when >1 reviewer', () => {
    expect(labels('Drafting', 1, -1)).toEqual(['For Review', 'Awaiting Client', 'Archive']);
    expect(getAvailableActions('Drafting', 1, -1)[0].needsReviewTargetPicker).toBe(false);
    expect(getAvailableActions('Drafting', 3, -1)[0].needsReviewTargetPicker).toBe(true);
    expect(getAvailableActions('Drafting', 1, -1)[0].newStatus).toBe('Under Review');
  });

  it('Under Review with a next reviewer offers handoff (status stays) + revision', () => {
    const actions = getAvailableActions('Under Review', 2, 0);
    expect(actions.map((a) => a.label)).toContain('For Review');
    expect(actions.map((a) => a.label)).toContain('For Revision');
    expect(actions.map((a) => a.label)).not.toContain('For Finalization');
    const forReview = actions.find((a) => a.label === 'For Review')!;
    expect(forReview.newStatus).toBeNull(); // stays Under Review
    expect(forReview.updatesCurrentlyWith).toBe('nextReviewer');
  });

  it('Under Review with the last reviewer offers Finalization, not handoff', () => {
    const actions = getAvailableActions('Under Review', 2, 1);
    expect(actions.map((a) => a.label)).toContain('For Finalization');
    expect(actions.map((a) => a.label)).not.toContain('For Review');
    expect(actions.find((a) => a.label === 'For Finalization')!.newStatus).toBe('Finalizing');
  });

  it('walks the finalization tail: Finalizing → Pre-finalized → Outbox → Filed', () => {
    expect(getAvailableActions('Finalizing', 1, 0)[0]).toMatchObject({ newStatus: 'Pre-finalized' });
    expect(getAvailableActions('Pre-finalized', 1, 0)[0]).toMatchObject({ newStatus: 'Outbox' });
    expect(getAvailableActions('Outbox', 1, 0)[0]).toMatchObject({ newStatus: 'Filed or Sent out' });
  });
});

describe('getAvailableActions — internal deliverables', () => {
  it('Drafting → Submit (to recipients), no review pipeline', () => {
    const actions = getAvailableActions('Drafting', 0, -1, 'Internal');
    expect(actions.map((a) => a.label)).toEqual(['Submit']);
    expect(actions[0]).toMatchObject({ newStatus: 'Submitted', updatesCurrentlyWith: 'recipients', needsDTR: true });
  });

  it('Submitted → Acknowledge (clears currently-with)', () => {
    const actions = getAvailableActions('Submitted', 0, -1, 'Internal');
    expect(actions.map((a) => a.label)).toEqual(['Acknowledge']);
    expect(actions[0]).toMatchObject({ newStatus: 'Acknowledged', updatesCurrentlyWith: 'clear' });
  });

  it('hides Awaiting Client and Archive for internal deliverables', () => {
    expect(labels('Drafting', 0, -1, 'Internal')).not.toContain('Awaiting Client');
    expect(labels('Drafting', 0, -1, 'Internal')).not.toContain('Archive');
  });
});

describe('getAvailableActions — terminal & utility', () => {
  it('offers nothing on filed/archived deliverables', () => {
    expect(getAvailableActions('Filed or Sent out', 1, 0)).toEqual([]);
    expect(getAvailableActions('Archived', 1, 0)).toEqual([]);
  });

  it('does not re-offer Awaiting Client when already awaiting', () => {
    expect(labels('Awaiting Client', 0, -1)).not.toContain('Awaiting Client');
  });
});
