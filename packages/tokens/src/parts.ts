/**
 * The four parts' own colours (`docs/plan/EASY.md`, E1): one strong, friendly fill each, with the
 * dark ink that is read on it. They colour the home tiles and the rail's chips, so a person can
 * find a part by its colour before reading its name.
 *
 * Fixed like the room's were: not brand-kit colours, never a status, never text on a page (a fill
 * is a fill, `DESIGN.md`). `parts.test.ts` holds each ink to the text contrast on its fill.
 */
export const PARTS = ['forms', 'scan', 'sign', 'send'] as const;
export type Part = (typeof PARTS)[number];

export const PART_HUES: Record<Part, { fill: string; ink: string }> = {
  forms: { fill: '#ffc233', ink: '#1b1d22' },
  scan: { fill: '#52c7f2', ink: '#10212b' },
  sign: { fill: '#ff8a7a', ink: '#2b1411' },
  send: { fill: '#7fd99a', ink: '#10261a' },
};

/** `--tp-part-<name>` (the fill) and `--tp-part-<name>-ink`, to set on an element that uses them. */
export function partCssVariables(): Record<string, string> {
  return Object.fromEntries(
    PARTS.flatMap((part) => [
      [`--tp-part-${part}`, PART_HUES[part].fill],
      [`--tp-part-${part}-ink`, PART_HUES[part].ink],
    ]),
  );
}
