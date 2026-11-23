/**
 * Bring a form field into view, put the cursor in it, and flash it — for
 * "Fill in"-style links that send someone to a field on another tab.
 *
 * Fields opt in with `data-field="<name>"` on the input or a wrapper around
 * it. The target tab may still be mounting, so this waits briefly for it.
 */
export function focusField(name: string, { timeoutMs = 2000, focus = true } = {}): void {
  const started = performance.now();
  const attempt = () => {
    const el = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(name)}"]`);
    if (!el) {
      if (performance.now() - started < timeoutMs) requestAnimationFrame(attempt);
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: focus ? 'center' : 'start' });
    // `focus: false` sends someone to a whole section rather than into a field.
    const target = !focus
      ? null
      : el.matches('input, textarea, select, button')
        ? el
        : el.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), textarea, select, button');
    target?.focus({ preventScroll: true });
    // Glow the control itself, not its label; a wrapper with no control of
    // its own (a whole section) glows as a block.
    const glow = target ?? el;
    glow.classList.remove('field-flash');
    void glow.offsetWidth; // restart the animation on a repeat click
    glow.classList.add('field-flash');
    window.setTimeout(() => glow.classList.remove('field-flash'), 2400);
  };
  requestAnimationFrame(attempt);
}
