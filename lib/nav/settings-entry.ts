import { Settings } from 'lucide-react';
import type { NavPage } from './types';

/**
 * Personal settings as an area's registry lists it. Only the liaison shell
 * draws it in the sidebar; elsewhere it opens from the avatar menu, and this
 * entry lets the search bar and More find it.
 */
export function settingsEntry(section: string, href: string, sidebar = false): NavPage {
  return {
    section, label: 'Settings', icon: Settings, href, addedOn: '2026-08-22',
    ...(sidebar ? {} : { sidebar: false as const }),
    description: 'Your profile, password, theme and notifications.',
    keywords: ['profile', 'password', 'notifications', 'theme', 'account', 'my settings'],
  };
}
