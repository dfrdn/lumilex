import { describe, it, expect } from 'vitest';
import {
  canDeleteKind, canEditKind, canPublishKind, canRestoreKind, isHandbookKind, kindLabel, plainText,
  publishBlockedReason, sectionOf, slugify, stripCitationTags, SECTION_KINDS, LIBRARY_KIND_LABELS,
} from './model';

describe('kinds and sections', () => {
  it('splits handbook kinds from distilled ones', () => {
    expect(isHandbookKind('guide')).toBe(true);
    expect(isHandbookKind('doctrine')).toBe(false);
    expect(sectionOf('policy')).toBe('handbook');
    expect(sectionOf('template_clause')).toBe('distilled');
  });

  it('labels every kind in both sections', () => {
    for (const kinds of Object.values(SECTION_KINDS)) {
      for (const k of kinds) expect(LIBRARY_KIND_LABELS[k], k).toBeTruthy();
    }
    expect(kindLabel('doctrine')).toBe('Doctrine');
    expect(kindLabel('unknown_kind')).toBe('unknown_kind');
  });
});

describe('permissions', () => {
  it('lets lawyers author and publish handbook pages but not distilled ones', () => {
    expect(canEditKind('lawyer', 'guide')).toBe(true);
    expect(canPublishKind('lawyer', 'guide')).toBe(true);
    expect(canEditKind('lawyer', 'doctrine')).toBe(false);
    expect(canPublishKind('lawyer', 'doctrine')).toBe(false);
  });

  it('lets reviewers do everything and keeps deletion to handbook pages', () => {
    for (const role of ['partner', 'admin', 'super_user']) {
      expect(canEditKind(role, 'doctrine')).toBe(true);
      expect(canPublishKind(role, 'court')).toBe(true);
      expect(canDeleteKind(role, 'guide')).toBe(true);
      expect(canDeleteKind(role, 'doctrine')).toBe(false);
    }
    expect(canDeleteKind('lawyer', 'guide')).toBe(false);
  });

  it('keeps restoring a revision with reviewers, even on pages lawyers write', () => {
    expect(canRestoreKind('lawyer', 'guide')).toBe(false);
    expect(canRestoreKind('partner', 'guide')).toBe(true);
    expect(canRestoreKind('partner', 'doctrine')).toBe(true);
    expect(canRestoreKind('finance', 'guide')).toBe(false);
  });

  it('gives finance and liaison roles read-only access', () => {
    for (const role of ['finance', 'liaison_officer', 'chief_liaison_officer', undefined]) {
      expect(canEditKind(role, 'guide')).toBe(false);
      expect(canPublishKind(role, 'guide')).toBe(false);
    }
  });
});

describe('the Rules of Court', () => {
  it('are their own section, read-only for every role', () => {
    expect(sectionOf('rules_of_court')).toBe('rules');
    for (const role of ['lawyer', 'partner', 'admin', 'super_user']) {
      expect(canEditKind(role, 'rules_of_court')).toBe(false);
      expect(canPublishKind(role, 'rules_of_court')).toBe(false);
      expect(canDeleteKind(role, 'rules_of_court')).toBe(false);
      expect(canRestoreKind(role, 'rules_of_court')).toBe(false);
    }
  });
});

describe('publishBlockedReason', () => {
  it('blocks only uncited system-drafted pages', () => {
    expect(publishBlockedReason({ generated_by: 'llm', kind: 'doctrine' }, 0)).toMatch(/no citations/);
    expect(publishBlockedReason({ generated_by: 'llm', kind: 'doctrine' }, 3)).toBeNull();
    expect(publishBlockedReason({ generated_by: 'manual', kind: 'doctrine' }, 0)).toBeNull();
    expect(publishBlockedReason({ generated_by: 'manual', kind: 'guide' }, 0)).toBeNull();
  });
});

describe('text helpers', () => {
  it('slugifies titles', () => {
    expect(slugify('Litigation Playbook (2026)!')).toBe('litigation-playbook-2026');
    expect(slugify('  Many   spaces  ')).toBe('many-spaces');
  });

  it('turns editor HTML into readable plain text for the index', () => {
    const html = '<h1>Title</h1><p>First &amp; second&nbsp;line</p><ul><li>one</li><li>two</li></ul>';
    expect(plainText(html, 'html')).toBe('Title\nFirst & second line\none\ntwo');
    expect(plainText('# md', 'md')).toBe('# md');
  });

  it('strips grounding tags from generated markdown', () => {
    expect(stripCitationTags('Claim one. [M1] Claim two [M2][M3].')).toBe('Claim one. Claim two.');
  });
});
