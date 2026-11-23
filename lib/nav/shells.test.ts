import { describe, it, expect } from 'vitest';
import { canOpen, STAFF_ROLES } from './access';
import { ROLE_LABELS, settingsHref, shellLinks } from './shells';
import type { NavArea } from './types';

const hrefs = (role: Parameters<typeof shellLinks>[0], area: NavArea) => shellLinks(role, area).map((l) => l.href);

describe('settingsHref', () => {
  it('keeps liaisons in their shell', () => {
    expect(settingsHref('liaison')).toBe('/liaison/settings');
    for (const area of ['dashboard', 'admin', 'finance'] as const) expect(settingsHref(area)).toBe('/dashboard/settings');
  });

  it('opens for every role that sees the shell', () => {
    for (const role of STAFF_ROLES) {
      if (canOpen(role, '/liaison')) expect(canOpen(role, settingsHref('liaison')), role).toBe(true);
      if (canOpen(role, '/admin')) expect(canOpen(role, settingsHref('admin')), role).toBe(true);
      if (canOpen(role, '/finance')) expect(canOpen(role, settingsHref('finance')), role).toBe(true);
    }
  });
});

describe('shellLinks', () => {
  it('keeps the Go to Dashboard links the admin and finance shells had', () => {
    expect(hrefs('admin', 'admin')).toEqual(['/dashboard']);
    expect(hrefs('finance', 'finance')).toEqual(['/dashboard']);
    expect(hrefs('super_user', 'admin')).toEqual(['/dashboard']);
    expect(hrefs('super_user', 'liaison')).toEqual(['/dashboard']);
  });

  it('leads a role back to its home shell', () => {
    expect(hrefs('admin', 'dashboard')).toEqual(['/admin']);
    expect(hrefs('finance', 'admin')).toEqual(['/finance', '/dashboard']);
    expect(hrefs('admin', 'liaison')).toEqual(['/admin', '/dashboard']);
    expect(hrefs('liaison_officer', 'dashboard')).toEqual(['/liaison/my-errands']);
    expect(hrefs('chief_liaison_officer', 'dashboard')).toEqual(['/liaison']);
  });

  it('offers nothing to a role already in its only shell', () => {
    expect(hrefs('lawyer', 'dashboard')).toEqual([]);
    expect(hrefs('partner', 'dashboard')).toEqual([]);
    expect(hrefs('liaison_officer', 'liaison')).toEqual([]);
    expect(hrefs('chief_liaison_officer', 'liaison')).toEqual([]);
  });

  it('never offers a shell the role is refused', () => {
    for (const role of STAFF_ROLES) {
      for (const area of ['dashboard', 'admin', 'finance', 'liaison'] as const) {
        for (const link of shellLinks(role, area)) expect(canOpen(role, link.href), `${role} in ${area} → ${link.href}`).toBe(true);
      }
    }
  });
});

describe('ROLE_LABELS', () => {
  it('names every staff role', () => {
    for (const role of STAFF_ROLES) expect(ROLE_LABELS[role]).toBeTruthy();
  });
});
