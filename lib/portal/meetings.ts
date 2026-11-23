/**
 * Which meetings a client may see on the portal.
 *
 * A firm's own discussions about a matter are recorded as meetings on it, but
 * they are the firm's working notes, not something done with or for the
 * client — the name alone can disclose strategy. Every portal surface that
 * lists, counts or feeds meetings to a model filters through here.
 *
 * Meeting types are per-firm options (`enum_options`, entity `meetings`);
 * `Internal Discussion` is the seeded internal type. A firm that renames it
 * needs its label added here or, better, an `internal` flag on the option.
 */
export const INTERNAL_MEETING_TYPES: ReadonlySet<string> = new Set(['Internal Discussion']);

export function isClientVisibleMeeting(meeting: { type?: string | null }): boolean {
  return !meeting.type || !INTERNAL_MEETING_TYPES.has(meeting.type);
}
