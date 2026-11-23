import { describe, it, expect } from 'vitest';
import { buildProposalRow, type ProposalInput } from './proposals';

const fileEntry: ProposalInput = {
  kind: 'file_entry',
  matterId: 'matter-1',
  source: 'court_mail',
  confidence: 0.92,
  reasoning: 'Received from RTC Branch 12 — "Order dated 3 Aug"',
  documentName: 'order.pdf',
  documentSummary: 'Order setting pre-trial.',
  provenance: { emailId: 7, emailAttachmentId: 11, fileAnalysisId: 3 },
};

const deadlineChain: ProposalInput = {
  kind: 'deadline_chain',
  matterId: 'matter-2',
  source: 'court_mail',
  confidence: 0.71,
  ruleSetId: 'roc-answer',
  ruleSetName: 'Answer (Rule 11)',
  triggerDate: '2026-08-03',
  triggerLabel: 'Service of summons',
  proposedItems: [{ label: 'File Answer', due_date: '2026-09-02' }],
};

describe('buildProposalRow', () => {
  it('stamps the filing agent and run on every proposal', () => {
    const row = buildProposalRow('lumilex-assistant', 42, fileEntry);
    expect(row.agent_id).toBe('lumilex-assistant');
    expect(row.agent_run_id).toBe(42);
    expect(row.source).toBe('court_mail');
  });

  it('maps a file_entry proposal without deadline fields', () => {
    const row = buildProposalRow('lumilex-assistant', 1, fileEntry);
    expect(row.kind).toBe('file_entry');
    expect(row.matter_id).toBe('matter-1');
    expect(row.confidence).toBe(0.92);
    expect(row.document_name).toBe('order.pdf');
    expect(row.email_attachment_id).toBe(11);
    // The deadline payload columns stay absent so the table's CHECK
    // constraints keep discriminating on kind.
    expect(row).not.toHaveProperty('rule_set_id');
    expect(row).not.toHaveProperty('trigger_date');
    expect(row).not.toHaveProperty('proposed_items');
  });

  it('maps a deadline_chain proposal with its computed items', () => {
    const row = buildProposalRow('lumilex-assistant', 1, deadlineChain);
    expect(row.kind).toBe('deadline_chain');
    expect(row.rule_set_id).toBe('roc-answer');
    expect(row.rule_set_name).toBe('Answer (Rule 11)');
    expect(row.trigger_date).toBe('2026-08-03');
    expect(row.trigger_label).toBe('Service of summons');
    expect(row.proposed_items).toEqual([{ label: 'File Answer', due_date: '2026-09-02' }]);
  });

  it('defaults optional prose to empty strings and provenance to null', () => {
    const row = buildProposalRow('some-agent', 5, {
      kind: 'file_entry',
      matterId: 'm',
      source: 'matter_review',
      confidence: 0.5,
    });
    expect(row.reasoning).toBe('');
    expect(row.document_name).toBe('');
    expect(row.document_summary).toBe('');
    expect(row.email_id).toBeNull();
    expect(row.email_attachment_id).toBeNull();
    expect(row.file_analysis_id).toBeNull();
  });

  it('never carries a status — proposals are always born pending', () => {
    const row = buildProposalRow('lumilex-assistant', 1, deadlineChain);
    expect(row).not.toHaveProperty('status');
    expect(row).not.toHaveProperty('decided_by');
  });
});
