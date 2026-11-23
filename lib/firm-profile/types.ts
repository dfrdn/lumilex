/**
 * Content model for the firm-profile CMS. One `FirmProfileContent` document
 * maps 1:1 to the 7-page marketing PDF produced by lib/pdf/firm-profile.ts:
 *
 *   1. Cover            → `cover`
 *   2. About Us         → `about`
 *   3. Practice Areas   → `practiceAreas`
 *   4–5. Our Team       → `team`
 *   6. The Firm at a Glance → `glance`
 *   7. Contact Us       → `contact`
 *
 * The whole document is stored as a single JSONB column on `firm_profiles`;
 * the admin editor reads/writes this shape and the PDF renderer consumes it.
 */

export interface TeamMember {
  name: string;
  title: string;
  /** Long-form bio. Rendered only for `list`-layout groups. */
  bio?: string;
  /** Public URL of a headshot (avatars bucket). Optional. */
  photoUrl?: string;
}

export interface TeamGroup {
  /** Section label, e.g. "PARTNERS", "OF COUNSEL", "JUNIOR ASSOCIATES". */
  label: string;
  /**
   * `list`  → photo on the left, name + title + bio stacked to the right.
   * `grid`  → photo cards in a row with name + title beneath (no bio).
   */
  layout: 'list' | 'grid';
  members: TeamMember[];
}

export interface SupportMember {
  name: string;
  role: string;
}

export interface PracticeArea {
  title: string;
  description: string;
}

export interface GlanceStat {
  value: string;
  label: string;
}

export interface FirmProfileContent {
  cover: {
    /** Wordmark, e.g. "Smith & Reyes". */
    firmName: string;
    /** Full firm name set in small caps under the wordmark, e.g. "Smith Reyes & Partners". */
    fullName: string;
    year: string;
    subtitle: string;
    /** Practice-area tags joined with " | " on the cover footer rule. */
    practiceTags: string[];
  };
  about: {
    heading: string;
    /** Gold italic lead line under the heading. */
    tagline: string;
    paragraphs: string[];
  };
  practiceAreas: {
    heading: string;
    items: PracticeArea[];
  };
  team: {
    heading: string;
    groups: TeamGroup[];
    supportLabel: string;
    support: SupportMember[];
  };
  glance: {
    heading: string;
    stats: GlanceStat[];
    affiliationsLabel: string;
    affiliations: string[];
  };
  contact: {
    heading: string;
    officeLabel: string;
    addressLines: string[];
    phone: string;
    email: string;
    website: string;
  };
}

export interface FirmProfileRow {
  id: string;
  name: string;
  content: FirmProfileContent;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
