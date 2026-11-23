'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowRightLeft, LogOut, Settings } from 'lucide-react';
import Avatar from '@/components/Avatar';
import SourceLink from '@/components/SourceLink';
import { useSession } from '@/components/SessionProvider';
import { signOut } from '@/lib/supabase-browser';
import { ROLE_LABELS, settingsHref, shellLinks } from '@/lib/nav/shells';
import type { NavArea } from '@/lib/nav/types';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return `${first}${last}`.toUpperCase();
}

const ITEM_SHAPE = 'w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm focus:outline-none transition-colors';
const ITEM = `${ITEM_SHAPE} text-foreground hover:bg-[var(--subtle-bg)] focus:bg-[var(--subtle-bg)]`;

/**
 * The person's own menu in a shell's header: who is signed in, their
 * settings, the other shells their role can open, and sign out. It renders on
 * document.body, above the detail pane and the chat panel, which would
 * otherwise cover it: the header's stacking context sits below both.
 */
export default function AvatarMenu({ area }: { area: NavArea }) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const ids = useId();
  const menuId = `${ids}-menu`;
  const whoId = `${ids}-who`;

  const user = session?.user;
  const role = user?.role ?? 'lawyer';
  const name = user?.name ?? '';
  const switches = user ? shellLinks(role, area) : [];

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.bottom + 8, right: Math.max(12, window.innerWidth - rect.right) });
  }, []);

  function openMenu() {
    place();
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!containerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      // The menu sits at the end of the body, so Tab moves on from the trigger, not from there.
      close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const down = e.key === 'ArrowDown';
      const next = at === -1 ? (down ? 0 : items.length - 1) : (at + (down ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            openMenu();
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Account menu"
        className={`ml-1 p-0.5 rounded-full transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 ${
          open ? 'ring-2 ring-gold-400/70' : 'hover:ring-2 hover:ring-navy-600 dark:hover:ring-white/15'
        }`}
      >
        <Avatar
          avatarUrl={user?.image}
          initials={initialsOf(name)}
          size={28}
          title=""
          fallbackClassName="bg-navy-700 dark:bg-[#2A2A2D] text-navy-200 dark:text-[#9B978F]"
        />
      </button>

      {open && anchor && createPortal(
        // Focusable itself, so a click on the name keeps Escape and the arrow keys working.
        <div
          ref={panelRef}
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
          style={{ top: anchor.top, right: anchor.right }}
          className="fixed z-[60] w-64 max-w-[calc(100vw-1.5rem)] bg-card rounded-xl shadow-[var(--shadow-elevated)] border border-[var(--border-color)] overflow-hidden py-1 focus:outline-none"
        >
          <div id={whoId} className="flex items-center gap-3 px-3 py-2.5 border-b border-[var(--border-color)] mb-1">
            <Avatar avatarUrl={user?.image} initials={initialsOf(name)} size={36} title="" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{name}</p>
              <p className="text-xs text-[var(--text-muted)] truncate">{ROLE_LABELS[role] ?? role}</p>
            </div>
          </div>

          <div id={menuId} ref={menuRef} role="menu" aria-labelledby={whoId}>
            <Link
              href={settingsHref(area)}
              role="menuitem"
              prefetch={false}
              onClick={() => close(false)}
              className={ITEM}
            >
              <Settings className="w-4 h-4 shrink-0 text-[var(--text-muted)]" />
              My Settings
            </Link>

            {switches.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                role="menuitem"
                prefetch={false}
                onClick={() => close(false)}
                className={ITEM}
              >
                <ArrowRightLeft className="w-4 h-4 shrink-0 text-[var(--text-muted)]" />
                {link.label}
              </Link>
            ))}

            <div role="none" className="border-t border-[var(--border-color)] mt-1 pt-1">
              <button
                type="button"
                role="menuitem"
                onClick={() => signOut()}
                className={`${ITEM_SHAPE} text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 focus:bg-red-50 dark:focus:bg-red-950/20`}
              >
                <LogOut className="w-4 h-4 shrink-0" />
                Sign out
              </button>
              <SourceLink className="block px-3 py-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
