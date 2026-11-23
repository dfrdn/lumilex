import { ArrowRight } from 'lucide-react';
import type { DemoPersonaKey } from '@/lib/demo/personas';

/**
 * The demo's request for access: who you are, then which role to try. A plain
 * form posting to /api/auth/demo, so it works before any script has loaded;
 * the route records the request (lib/demo/access.ts) and signs the visitor in.
 */
export default function DemoAccessForm({
  personas,
  selected,
  invalid,
}: {
  personas: { key: DemoPersonaKey; label: string; name: string }[];
  selected?: DemoPersonaKey;
  invalid: string[];
}) {
  const field =
    'w-full rounded-lg border bg-subtle px-3 py-2 text-sm text-foreground placeholder:text-[var(--text-muted)] focus:border-gold-400 focus:outline-none';
  const border = (name: string) => (invalid.includes(name) ? 'border-red-400' : 'border-[var(--border-color)]');

  return (
    <form method="post" action="/api/auth/demo" className="w-full flex flex-col gap-3">
      {invalid.length > 0 && (
        <p className="w-full text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-lg px-3 py-2 text-center">
          Please fill in your name, work email, position and a role.
        </p>
      )}
      <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-secondary)]">
        Your name
        <input name="name" required maxLength={120} autoComplete="name" placeholder="Maya Santos" className={`${field} ${border('name')}`} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-secondary)]">
        Work email
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          placeholder="maya@yourfirm.ph"
          className={`${field} ${border('email')}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-secondary)]">
        Position
        <input
          name="position"
          required
          maxLength={120}
          autoComplete="organization-title"
          placeholder="Managing partner"
          className={`${field} ${border('position')}`}
        />
      </label>
      {/* Bots fill every field; people never see this one. */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />

      <fieldset className="flex flex-col gap-1.5 mt-1">
        <legend className="text-xs font-medium text-[var(--text-secondary)] mb-1">Try it as</legend>
        {personas.map((p, i) => (
          <label
            key={p.key}
            className="flex items-center gap-3 rounded-xl border border-[var(--border-color)] bg-subtle px-3 py-2 text-sm cursor-pointer has-[:checked]:border-gold-400 has-[:checked]:bg-gold-400/5"
          >
            <input
              type="radio"
              name="as"
              value={p.key}
              defaultChecked={selected ? selected === p.key : i === 0}
              className="accent-[var(--color-gold-500)]"
            />
            <span className="font-semibold text-foreground">{p.label}</span>
            <span className="truncate text-[var(--text-muted)]">· {p.name}</span>
          </label>
        ))}
      </fieldset>

      <button
        type="submit"
        className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800 transition-colors"
      >
        Open the demo <ArrowRight className="w-4 h-4" />
      </button>
      <p className="text-[11px] text-[var(--text-muted)] text-center">
        We use these details only to follow up about Lumilex.
      </p>
    </form>
  );
}
