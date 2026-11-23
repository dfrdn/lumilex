/**
 * The blank firm-profile document a tenant starts from.
 *
 * This used to be one real firm's finished profile — its history, its partners'
 * bios, its client and matter counts. Served as the default for an empty
 * `firm_profiles` table, that meant a second tenant's marketing PDF rendered
 * another firm's people under its own cover. A starter template carries
 * structure, never someone else's identity.
 *
 * So: the section scaffolding and headings stay (they are the document's shape,
 * identical for every firm), and every value that says who the firm *is* is
 * blank for the admin to fill in. The renderer already omits empty sections.
 */

import type { FirmProfileContent } from './types';

export const DEFAULT_FIRM_PROFILE: FirmProfileContent = {
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
