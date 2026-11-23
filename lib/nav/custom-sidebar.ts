import type { UserRole } from '@/lib/queries/team';
import type { FeatureFlags } from '@/lib/firm/feature-shape';
import { ALL_PAGES, NAV_AREAS, moreCountHrefs, sidebarPagesForRole, visiblePages } from './pages';
import type { NavArea, NavPage } from './types';

/*
 * A person's own sidebar: the role's default, with pages pinned to the top and
 * links hidden. What is saved only ever narrows or rearranges what the route
 * map (lib/nav/access.ts) already lets the role open, and the firm's features
 * already show: choices resolve against visiblePages at render, so a pin to a
 * page the person can no longer open drops out, and comes back if the access
 * (or the feature) does.
 */

export interface SidebarChoices {
  /** Pinned pages, in the order pinned. Any page the role can open, from any area. */
  pins: string[];
  /** Links of this area's default sidebar the person doesn't want. */
  hides: string[];
}

export type SavedSidebar = Partial<Record<NavArea, SidebarChoices>>;

export const NO_CHOICES: SidebarChoices = { pins: [], hides: [] };

const REGISTERED: ReadonlySet<string> = new Set(ALL_PAGES.map((p) => p.href));

function registeredHrefs(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((h): h is string => typeof h === 'string' && REGISTERED.has(h)))];
}

/** Choices as they may be kept: registered pages only, each once, and a pin beats a hide. */
export function cleanChoices(raw: unknown): SidebarChoices {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pins = registeredHrefs(record.pins);
  const pinned = new Set(pins);
  return { pins, hides: registeredHrefs(record.hides).filter((h) => !pinned.has(h)) };
}

const isEmpty = (c: SidebarChoices) => c.pins.length === 0 && c.hides.length === 0;

/** The saved record with one area's choices replaced; an area left with none is dropped. */
export function setAreaChoices(saved: SavedSidebar, area: NavArea, choices: SidebarChoices | null): SavedSidebar {
  const next = { ...saved };
  delete next[area];
  return choices && !isEmpty(choices) ? { ...next, [area]: choices } : next;
}

/** A stored `sidebar_layout`, whatever it holds: anything not understood counts as no choice. */
export function readSavedSidebar(raw: unknown): SavedSidebar {
  if (!raw || typeof raw !== 'object') return {};
  let saved: SavedSidebar = {};
  for (const area of Object.keys(NAV_AREAS) as NavArea[]) {
    saved = setAreaChoices(saved, area, cleanChoices((raw as Record<string, unknown>)[area]));
  }
  return saved;
}

/** Pin a page, or unpin it. Pinning a hidden link brings it back. */
export function togglePin(choices: SidebarChoices, href: string): SidebarChoices {
  if (choices.pins.includes(href)) return { ...choices, pins: choices.pins.filter((h) => h !== href) };
  return { pins: [...choices.pins, href], hides: choices.hides.filter((h) => h !== href) };
}

/** Hide a link, or show it again. Hiding a pinned link unpins it. */
export function toggleHide(choices: SidebarChoices, href: string): SidebarChoices {
  if (choices.hides.includes(href)) return { ...choices, hides: choices.hides.filter((h) => h !== href) };
  return { pins: choices.pins.filter((h) => h !== href), hides: [...choices.hides, href] };
}

/**
 * Pins in a new order. `shown` is the Pinned group as drawn; a saved pin the
 * person can't open right now keeps its place after them, so it comes back if
 * the access does, and the arrows never stall on a pin nobody can see.
 */
function withPinOrder(choices: SidebarChoices, shown: string[]): SidebarChoices {
  const drawn = new Set(shown);
  return { ...choices, pins: [...shown, ...choices.pins.filter((h) => !drawn.has(h))] };
}

/** Move a pinned link one place up or down the Pinned group; the edges stay put. */
export function movePin(choices: SidebarChoices, shown: string[], href: string, by: -1 | 1): SidebarChoices {
  const i = shown.indexOf(href);
  const j = i + by;
  if (i < 0 || j < 0 || j >= shown.length) return choices;
  const next = [...shown];
  [next[i], next[j]] = [next[j], next[i]];
  return withPinOrder(choices, next);
}

/** Put a pinned link where `target` is, shifting the rest: what a drag-and-drop ends in. */
export function placePin(choices: SidebarChoices, shown: string[], href: string, target: string): SidebarChoices {
  const from = shown.indexOf(href);
  const to = shown.indexOf(target);
  if (href === target || from < 0 || to < 0) return choices;
  const next = shown.filter((h) => h !== href);
  next.splice(from < to ? next.indexOf(target) + 1 : next.indexOf(target), 0, href);
  return withPinOrder(choices, next);
}

export interface CustomSidebar {
  /** The "Pinned" group, in the order pinned. */
  pinned: NavPage[];
  /** The default links left in their sections, in sidebar order. */
  links: NavPage[];
  /** Default links the person hid, listed so they can be brought back. */
  hidden: NavPage[];
  /** The pages whose counts the More link adds up: a hidden link's count lands here, a pinned page's doesn't. */
  moreCounts: string[];
}

/** Every page the role can open at this firm, from `area` outwards, so a page several areas list resolves to this area's entry. */
function openablePages(role: UserRole, area: NavArea, flags: FeatureFlags): Map<string, NavPage> {
  const areas = [area, ...(Object.keys(NAV_AREAS) as NavArea[]).filter((a) => a !== area)];
  const pages = new Map<string, NavPage>();
  for (const a of areas) {
    for (const page of visiblePages(role, a, flags)) {
      if (!pages.has(page.href)) pages.set(page.href, page);
    }
  }
  return pages;
}

/** The sidebar a person sees: default, pins, hides and access, merged. */
export function customSidebar(
  role: UserRole, area: NavArea, flags: FeatureFlags, choices: SidebarChoices = NO_CHOICES,
): CustomSidebar {
  const openable = openablePages(role, area, flags);
  const pinned = [...new Set(choices.pins)].flatMap((href) => openable.get(href) ?? []);
  const pinnedHrefs = new Set(pinned.map((p) => p.href));
  const hides = new Set(choices.hides);

  const defaults = sidebarPagesForRole(role, area, flags).filter((p) => !pinnedHrefs.has(p.href));
  const links = defaults.filter((p) => !hides.has(p.href));
  const hidden = defaults.filter((p) => hides.has(p.href));

  return {
    pinned,
    links,
    hidden,
    moreCounts: moreCountHrefs(role, area, flags, [...pinned, ...links].map((p) => p.href)),
  };
}

