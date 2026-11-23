import { FlaskConical } from 'lucide-react';

/**
 * Tells a visitor to the public demo where they are, on every page. Pinned
 * bottom-centre rather than across the top: the role shells size themselves
 * to the viewport, and a bar above them would push every one into a scroll.
 * Not bottom-left, where the shells keep the signed-in user's menu, nor
 * bottom-right, where the chat and quick-add buttons are.
 * Rendered by the root layout only when the request is on the demo
 * (lib/demo/request.ts), so no firm's instance ever carries it.
 */
export default function DemoBanner() {
  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 w-max max-w-[calc(100vw-1.5rem)] flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-navy-900/95 dark:bg-navy-950/95 text-white text-xs px-3.5 py-2 shadow-[var(--shadow-elevated)] border border-white/10">
      <span className="flex items-center gap-1.5 font-medium">
        <FlaskConical className="w-3.5 h-3.5 text-gold-400" />
        Lumilex demo · fictional firm · resets nightly at 3:00 AM
      </span>
      <a href="/login?switch=1" className="underline underline-offset-2 text-white/80 hover:text-white">
        Switch role
      </a>
      <a href="https://lumilex.co" className="underline underline-offset-2 text-white/80 hover:text-white">
        lumilex.co
      </a>
    </div>
  );
}
