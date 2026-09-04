/**
 * The crease that runs across a control when it is pressed.
 *
 * One listener on the document rather than a handler on every button. Buttons arrive from a dozen
 * screens, half of them loaded lazily, and a prop threaded to each one is a prop somebody forgets
 * on the thirteenth.
 *
 * ## Why `.system` and not the whole page
 *
 * Because the fold is *our* house style, and one screen in this app is not ours: a published form
 * wears the organisation's brand and is read by their members. A folding animation nobody chose is
 * our design arriving uninvited on somebody else's registration page.
 *
 * So the effect is opt-in by ancestry — the app shell, the marketing site and the sign-in screens
 * carry `.system`, and the public form does not. Checking for it here rather than binding to a
 * root element means a screen cannot acquire the effect by being moved somewhere new, and the CSS
 * is scoped the same way, so neither half can drift into the form on its own.
 *
 * ## Why not `:active`
 *
 * `:active` ends the moment the finger lifts, so a tap plays a fraction of the animation and the
 * effect reads as broken rather than quick. The class is added on press and removed when the
 * animation reports that it is over, so every press plays a whole fold.
 */
const FOLDING = 'is-folding';

export function foldOnPress(): () => void {
  const start = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest('button, .button');
    if (!(button instanceof HTMLElement)) return;
    // Ours to decorate, or somebody else's page.
    if (!button.closest('.system')) return;
    // A disabled control has not been pressed; it has been pressed *at*.
    if (button.matches(':disabled, [aria-disabled="true"]')) return;

    /*
     * Restart rather than ignore, so a second press during the first is acknowledged. Removing the
     * class and reading a layout property forces the reflow that lets the same animation play
     * again — without it the browser coalesces the two class changes and nothing happens.
     */
    button.classList.remove(FOLDING);
    void button.offsetWidth;
    button.classList.add(FOLDING);
  };

  const end = (event: AnimationEvent) => {
    if (!event.animationName.startsWith('button-fold')) return;
    if (event.target instanceof HTMLElement) event.target.classList.remove(FOLDING);
  };

  document.addEventListener('pointerdown', start);
  // Animations on `::before`/`::after` are reported against the element that owns them.
  document.addEventListener('animationend', end, true);

  return () => {
    document.removeEventListener('pointerdown', start);
    document.removeEventListener('animationend', end, true);
  };
}
