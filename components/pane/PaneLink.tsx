import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';

/**
 * A referenced entity inside the pane (matter, client, related deliverable).
 * Always opens in a new tab: the pane is a peek surface, so following a
 * reference shouldn't throw away the list the user was working through.
 * Falls back to plain text when the reference has no resolvable id.
 */
export default function PaneLink({
  href,
  label,
  icon,
}: {
  href: string | null;
  label: string;
  icon?: ReactNode;
}) {
  if (!href) {
    return (
      <p className="text-sm text-foreground inline-flex items-center gap-1.5">
        {icon}
        {label}
      </p>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group text-sm text-foreground hover:text-gold-700 dark:hover:text-gold-400 inline-flex items-center gap-1.5 rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500"
    >
      {icon}
      <span className="underline decoration-dotted decoration-[var(--text-muted)] underline-offset-[3px] group-hover:decoration-solid group-hover:decoration-current">
        {label}
      </span>
      <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" />
    </a>
  );
}
