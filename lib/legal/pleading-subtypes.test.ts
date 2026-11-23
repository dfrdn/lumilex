import { describe, it, expect } from 'vitest';
import { isRedTeamable, isResponsivePleading } from './pleading-subtypes';

describe('isRedTeamable', () => {
  it('accepts the litigation subtypes', () => {
    expect(isRedTeamable('Complaint', 'Anything')).toBe(true);
    expect(isRedTeamable('Comment/Opposition', '')).toBe(true);
    expect(isRedTeamable('Pre-Trial Brief', '')).toBe(true);
  });

  it('rejects non-litigation subtypes', () => {
    expect(isRedTeamable('Contract/Agreement', '')).toBe(false);
    expect(isRedTeamable('Demand Letter', '')).toBe(false);
    expect(isRedTeamable('Notice', '')).toBe(false);
    expect(isRedTeamable('Other', '')).toBe(false);
  });

  it('leaves judicial affidavits to Affidavit Review', () => {
    expect(isRedTeamable('Judicial Affidavit', '')).toBe(false);
  });

  it('falls back to the name only when the row has no subtype', () => {
    expect(isRedTeamable(null, 'Answer with Compulsory Counterclaim', 'External')).toBe(true);
    expect(isRedTeamable('', 'Motion for Reconsideration', 'External')).toBe(true);
    expect(isRedTeamable(undefined, 'Petition for Review on Certiorari', 'Pleading')).toBe(true);
    expect(isRedTeamable(null, 'Board Resolution', 'External')).toBe(false);
  });

  // Measured against real data: a name-only fallback offered Red Team for 227
  // status reports and 49 client letters, because a status report names the
  // pleading it reports on.
  it('does not offer a status report that merely names a pleading', () => {
    expect(isRedTeamable(null, 'Status Report — Filing of Motion for Extension', 'Status Report')).toBe(false);
    expect(isRedTeamable(null, 'Status Report Re: Answer filed', 'Status Report')).toBe(false);
    expect(isRedTeamable(null, 'Letter re Motion to Dismiss', 'For Client')).toBe(false);
    expect(isRedTeamable(null, 'Witness Guide re Motion', 'Internal')).toBe(false);
  });

  it('withholds the name fallback when the type is unknown', () => {
    expect(isRedTeamable(null, 'Motion for Reconsideration')).toBe(false);
    expect(isRedTeamable(null, 'Motion for Reconsideration', '')).toBe(false);
  });

  it('still lets subtype override the type gate', () => {
    // A correctly tagged pleading is trusted regardless of the legacy type.
    expect(isRedTeamable('Motion', 'Anything', 'Status Report')).toBe(true);
  });

  it('does not let the name override an explicit non-litigation subtype', () => {
    // A contract whose title happens to mention a motion is still a contract.
    expect(isRedTeamable('Contract/Agreement', 'Deed re: Motion to Approve Compromise', 'External')).toBe(false);
  });

  it('handles a row with neither subtype nor name', () => {
    expect(isRedTeamable(null, null, null)).toBe(false);
  });
});

describe('isResponsivePleading', () => {
  it('recognises the subtypes that only exist as an answer to something', () => {
    expect(isResponsivePleading('Answer', 'Answer with Counterclaim')).toBe(true);
    expect(isResponsivePleading('Reply', 'Reply')).toBe(true);
    expect(isResponsivePleading('Comment/Opposition', 'Opposition to Motion to Dismiss')).toBe(true);
  });

  it('leaves pleadings that open a case, or are filed on a schedule, closed', () => {
    expect(isResponsivePleading('Complaint', 'Complaint for Sum of Money')).toBe(false);
    expect(isResponsivePleading('Petition', 'Petition for Certiorari')).toBe(false);
    expect(isResponsivePleading('Motion', 'Motion for Extension')).toBe(false);
    // Filed on the court's schedule rather than in answer to a specific filing.
    expect(isResponsivePleading('Position Paper', 'Position Paper')).toBe(false);
    expect(isResponsivePleading('Memorandum', 'Memorandum')).toBe(false);
  });

  it('falls back to the name for untagged legacy rows', () => {
    expect(isResponsivePleading(null, 'Answer Ad Cautelam')).toBe(true);
    expect(isResponsivePleading(null, 'Rejoinder')).toBe(true);
    expect(isResponsivePleading('', 'Comment on the Petition')).toBe(true);
    expect(isResponsivePleading(null, 'Complaint-Affidavit')).toBe(false);
  });

  // The subtype is the firm's own tagging; a name that reads responsive must not
  // reopen the question once the row says what it is.
  it('does not let the name override an explicit subtype', () => {
    expect(isResponsivePleading('Complaint', 'Complaint in Answer to the Demand')).toBe(false);
  });

  it('handles a row with neither subtype nor name', () => {
    expect(isResponsivePleading(null, null)).toBe(false);
  });
});
