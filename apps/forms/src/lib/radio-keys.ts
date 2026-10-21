/**
 * Arrow keys inside a radio group.
 *
 * The groups here are buttons with `role="radio"` (Send's three ways, the signing order, the
 * summary's source and task). That role promises the arrow keys move the choice, and a bare button
 * keeps no such promise, so a keyboard user met three tab stops and arrows that did nothing. One
 * listener on the document, as `fold.ts` does, rather than a handler in each of seven groups.
 *
 * Every radio stays a tab stop (no roving tabindex): a little more tabbing, nothing unreachable.
 */
const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function radioArrows(): () => void {
  const onKey = (event: KeyboardEvent) => {
    const step = STEP[event.key];
    const from = event.target;
    if (!step || !(from instanceof HTMLElement) || from.getAttribute('role') !== 'radio') return;
    const group = from.closest('[role="radiogroup"]');
    if (!group) return;
    const radios = [...group.querySelectorAll<HTMLElement>('[role="radio"]')].filter(
      (radio) => !radio.matches(':disabled, [aria-disabled="true"]'),
    );
    const next = radios[(radios.indexOf(from) + step + radios.length) % radios.length];
    if (!next) return;
    event.preventDefault();
    next.focus();
    next.click();
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
