/**
 * The empty firm-profile document a provisioned firm starts with.
 *
 * Every heading is page furniture — the same seven sections in the same order
 * for any firm, because they are what lib/pdf/firm-profile.ts renders. Every
 * value that says who the firm *is* — name, tagline, partners, client counts,
 * address — is blank, and stays blank until an admin fills it in under
 * Admin → Firm profile.
 *
 * Defined here rather than re-exported from lib/firm-profile/default.ts on
 * purpose. That module is the blank document the profile CMS opens on and is
 * free to grow example content later; this one is written into a real tenant's
 * database, and `seed-pack.test.ts` holds it to carrying no identity at all.
 * The two happen to agree today, and the test is what will notice if they stop.
 */

import type { FirmProfileContent } from '@/lib/firm-profile/types';

export const SEED_FIRM_PROFILE: FirmProfileContent = {
  cover: {
    firmName: '',
    fullName: '',
    year: String(new Date().getFullYear()),
    subtitle: '',
    practiceTags: [],
  },
  about: {
    heading: 'About Us',
    tagline: '',
    paragraphs: [],
  },
  practiceAreas: {
    heading: 'Practice Areas',
    items: [],
  },
  team: {
    heading: 'Our Team',
    groups: [],
    supportLabel: 'Support Team',
    support: [],
  },
  glance: {
    heading: 'The Firm at a Glance',
    stats: [],
    affiliationsLabel: 'Affiliations',
    affiliations: [],
  },
  contact: {
    heading: 'Contact Us',
    officeLabel: 'Office',
    addressLines: [],
    phone: '',
    email: '',
    website: '',
  },
};

/**
 * The fields that name the firm. `seed-pack.test.ts` asserts every one is blank
 * — a seed profile that carried a name would put it on another tenant's cover.
 */
export function firmProfileIdentityValues(profile: FirmProfileContent): string[] {
  return [
    profile.cover.firmName,
    profile.cover.fullName,
    profile.cover.subtitle,
    profile.about.tagline,
    profile.contact.phone,
    profile.contact.email,
    profile.contact.website,
    ...profile.cover.practiceTags,
    ...profile.about.paragraphs,
    ...profile.contact.addressLines,
    ...profile.glance.affiliations,
    ...profile.practiceAreas.items.flatMap((i) => [i.title, i.description]),
    ...profile.team.groups.flatMap((g) => g.members.flatMap((m) => [m.name, m.title, m.bio ?? ''])),
    ...profile.team.support.flatMap((s) => [s.name, s.role]),
    ...profile.glance.stats.flatMap((s) => [s.value, s.label]),
  ];
}
