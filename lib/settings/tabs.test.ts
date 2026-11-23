import { describe, it, expect } from 'vitest';
import { isInPlaceClick, parseSettingsTab, settingsTabHref, SETTINGS_TABS } from './tabs';

describe('settings tabs', () => {
  it('opens on Profile unless the URL names another tab', () => {
    expect(parseSettingsTab(undefined)).toBe('profile');
    expect(parseSettingsTab(null)).toBe('profile');
    expect(parseSettingsTab('nope')).toBe('profile');
    expect(parseSettingsTab('calendar')).toBe('calendar');
    expect(parseSettingsTab(['security', 'calendar'])).toBe('security');
  });

  it('has no Connected apps tab', () => {
    expect(SETTINGS_TABS.map((t) => t.key)).toEqual(['profile', 'notifications', 'calendar', 'security']);
  });

  it('builds each tab under the shell it is opened in', () => {
    expect(settingsTabHref('/dashboard/settings', 'profile')).toBe('/dashboard/settings');
    expect(settingsTabHref('/liaison/settings', 'notifications')).toBe('/liaison/settings?tab=notifications');
    for (const t of SETTINGS_TABS) {
      expect(parseSettingsTab(new URL(settingsTabHref('/x', t.key), 'http://h').searchParams.get('tab'))).toBe(t.key);
    }
  });

  it('switches in place only on a plain left click', () => {
    const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
    expect(isInPlaceClick(plain)).toBe(true);
    expect(isInPlaceClick({ ...plain, metaKey: true })).toBe(false);
    expect(isInPlaceClick({ ...plain, ctrlKey: true })).toBe(false);
    expect(isInPlaceClick({ ...plain, shiftKey: true })).toBe(false);
    expect(isInPlaceClick({ ...plain, altKey: true })).toBe(false);
    expect(isInPlaceClick({ ...plain, button: 1 })).toBe(false);
  });
});
