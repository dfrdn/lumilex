import type { Home } from 'lucide-react';
import type { UserRole } from '@/lib/queries/team';
import type { FeatureKey } from '@/lib/firm/feature-shape';

/** A sidebar: the team dashboard, or the admin, finance or liaison area. */
export type NavArea = 'dashboard' | 'admin' | 'finance' | 'liaison';

export interface NavSection {
  id: string;
  /** Header text; null for an unlabeled group at the top. */
  label: string | null;
  /** The heading More gives an unlabeled group. */
  moreLabel?: string;
  /** Who sees the section. Omitted: everyone who can open the area. */
  roles?: readonly UserRole[];
  /** The partner block draws in gold. */
  variant?: 'partner';
  /** A heading only More shows: none of its pages has a sidebar link. */
  more?: true;
  /** Roles whose sidebar starts with the group folded, until they fold or unfold it themselves. */
  defaultFoldedFor?: readonly UserRole[];
  /** Sub-headings More groups the section's pages under, in order (`NavPage.subsection`). */
  subsections?: readonly { id: string; label: string }[];
}

export interface NavPage {
  href: string;
  label: string;
  icon: typeof Home;
  section: string;
  /** Its sub-heading in More, one of the section's `subsections`. */
  subsection?: string;
  /** One line on what the page does, shown on hover and on More. */
  description: string;
  /** Other words people use for it, matched by the search bar. */
  keywords?: string[];
  /** The day the page shipped (YYYY-MM-DD); drives the "New" pill. */
  addedOn: string;
  /** Active, and counted as visited, on any path under `href`. */
  matchPrefix?: boolean;
  /** Paths under `href` a more specific page owns, so only that one highlights. */
  except?: readonly string[];
  /** Who sees it. Omitted: every role that sees its section. */
  roles?: readonly UserRole[];
  /** false: no sidebar link; found by the search bar and More (Settings also opens from the avatar menu). */
  sidebar?: false;
  /**
   * Shown only when the firm has at least one of these features
   * (`featuresVisible`). The route redirects without it, so a firm that
   * hasn't bought the feature gets no way in rather than a dead link.
   */
  features?: readonly FeatureKey[];
}
