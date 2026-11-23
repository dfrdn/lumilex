import type { UserRole } from '@/lib/queries/team';
import { canOpen } from './access';
import { MORE_HREF, NAV_AREAS, sidebarPagesForRole, visiblePages } from './pages';
import type { FeatureFlags } from '@/lib/firm/feature-shape';
import { AREA_LABELS } from './shells';
import type { NavArea, NavPage } from './types';

/*
 * More: every page a role can open, in every area, under the sidebar's own
 * headings and in the sidebar's order. The area the page is shown in comes
 * first; the role's other areas follow under their names. A page listed in
 * more than one area (Chat, Settings, Liaison Schedule) shows once, in the
 * first area that lists it.
 */

/** Each shell's More, all rendering the same list, so More never leaves the shell it is opened from. */
export const MORE_HREFS: Record<NavArea, string> = {
  dashboard: MORE_HREF,
  admin: '/admin/more',
  finance: '/finance/more',
  liaison: '/liaison/more',
};

/** Where More opens from a shell: the shell's own when the role may open it, else the first it may; null when none. */
export function moreHrefFor(role: UserRole, area: NavArea): string | null {
  if (canOpen(role, MORE_HREFS[area])) return MORE_HREFS[area];
  return Object.values(MORE_HREFS).find((h) => canOpen(role, h)) ?? null;
}

export interface MoreItem {
  page: NavPage;
  /** Has a link in that area's sidebar for the role; listed before the pages kept to More. */
  inSidebar: boolean;
}

export interface MoreSubgroup {
  id: string;
  anchor: string;
  label: string;
  items: MoreItem[];
}

export interface MoreGroup {
  id: string;
  /** The heading's id on the page, for <More>#<anchor>. */
  anchor: string;
  /** null for an unlabeled sidebar group of another area, which its area heading covers. */
  label: string | null;
  partner: boolean;
  /** Every page in the group, in the order shown. */
  items: MoreItem[];
  /** The group's sub-headings, when it has them; together they hold `items`. */
  subgroups?: MoreSubgroup[];
}

export interface MoreArea {
  area: NavArea;
  anchor: string;
  label: string;
  groups: MoreGroup[];
}

/** Sidebar pages first, then the rest, each in registry order. */
function ordered(pages: NavPage[], sidebar: Set<string>): MoreItem[] {
  const items = pages.map((page) => ({ page, inSidebar: sidebar.has(page.href) }));
  return [...items.filter((i) => i.inSidebar), ...items.filter((i) => !i.inSidebar)];
}

/** More's areas, headings and pages for a role, viewed from `viewArea`. */
export function moreForRole(role: UserRole, viewArea: NavArea, flags: FeatureFlags): MoreArea[] {
  const areaOrder = [viewArea, ...(Object.keys(NAV_AREAS) as NavArea[]).filter((a) => a !== viewArea)];
  const seen = new Set<string>();
  const result: MoreArea[] = [];

  for (const area of areaOrder) {
    const pages = visiblePages(role, area, flags).filter((p) => !seen.has(p.href));
    for (const p of pages) seen.add(p.href);
    if (pages.length === 0) continue;

    const sidebar = new Set(sidebarPagesForRole(role, area, flags).map((p) => p.href));
    const anchorOf = (id: string) => (area === viewArea ? id : `${area}-${id}`);
    const groups: MoreGroup[] = [];
    for (const section of NAV_AREAS[area].sections) {
      const inSection = pages.filter((p) => p.section === section.id);
      if (inSection.length === 0) continue;
      const anchor = anchorOf(section.id);
      const group: MoreGroup = {
        id: section.id,
        anchor,
        label: section.label ?? section.moreLabel ?? null,
        partner: section.variant === 'partner',
        items: [],
      };
      if (section.subsections) {
        group.subgroups = section.subsections
          .map((sub) => ({
            id: sub.id,
            anchor: `${anchor}-${sub.id}`,
            label: sub.label,
            items: ordered(inSection.filter((p) => p.subsection === sub.id), sidebar),
          }))
          .filter((sub) => sub.items.length > 0);
        group.items = group.subgroups.flatMap((sub) => sub.items);
      } else {
        group.items = ordered(inSection, sidebar);
      }
      groups.push(group);
    }
    result.push({ area, anchor: area, label: AREA_LABELS[area], groups });
  }
  return result;
}

/** Every item in More, in the order shown. */
export function moreItems(areas: MoreArea[]): MoreItem[] {
  return areas.flatMap((a) => a.groups.flatMap((g) => g.items));
}

/** An item of More with the headings it sits under, for a search hit shown outside them. */
export interface MoreEntry {
  item: MoreItem;
  area: NavArea;
  areaLabel: string;
  group: string | null;
  subgroup: string | null;
}

export function moreEntries(areas: MoreArea[]): MoreEntry[] {
  return areas.flatMap((a) => a.groups.flatMap((g) => {
    const subOf = new Map((g.subgroups ?? []).flatMap((s) => s.items.map((i) => [i.page.href, s.label] as const)));
    return g.items.map((item) => ({
      item, area: a.area, areaLabel: a.label, group: g.label, subgroup: subOf.get(item.page.href) ?? null,
    }));
  }));
}

/** Where a search hit lives, as its card names it: "Partner · Approvals", led by the area when More lists several. */
export function moreContext(entry: MoreEntry, multiArea: boolean): string {
  return [multiArea ? entry.areaLabel : null, entry.group, entry.subgroup].filter(Boolean).join(' · ');
}

/** More narrowed to the pages kept, dropping headings left empty. */
export function filterMore(areas: MoreArea[], keep: (page: NavPage) => boolean): MoreArea[] {
  return areas
    .map((area) => ({
      ...area,
      groups: area.groups
        .map((group) => {
          const subgroups = group.subgroups
            ?.map((sub) => ({ ...sub, items: sub.items.filter((i) => keep(i.page)) }))
            .filter((sub) => sub.items.length > 0);
          return { ...group, subgroups, items: group.items.filter((i) => keep(i.page)) };
        })
        .filter((group) => group.items.length > 0),
    }))
    .filter((area) => area.groups.length > 0);
}
